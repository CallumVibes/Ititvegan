/**
 * Scan orchestration: cache → relays → Open Food Facts.
 *
 * Yields results progressively so the UI can paint something within
 * ~50ms of a scan instead of waiting on the slowest relay.
 */

import { fetchClaims } from './nostr';
import { fromEvents, normaliseBarcode, isPlausibleBarcode, type Claim } from './product';
import { resolve, type Resolution } from './consensus';
import { getProduct, putProduct, globalCounts, blocked } from './cache';
import { lookup as offLookup } from './openfoodfacts';

export interface ScanResult {
	barcode: string;
	resolution: Resolution;
	/** Where this particular snapshot came from. */
	stage: 'cache' | 'relays' | 'empty';
	/** Populated when no claims exist and OFF had a record. */
	suggestion?: Partial<Claim>;
	/** True when OFF carries a vegan label for this product. */
	offLabelVegan?: boolean;
	stale?: boolean;
}

const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

/**
 * Resolve a barcode, emitting each stage as it lands.
 *
 * Usage:
 *   for await (const r of scan(code)) render(r);
 */
export async function* scan(raw: string): AsyncGenerator<ScanResult> {
	const barcode = normaliseBarcode(raw);

	// Plausible, not checksum-valid: the camera path already enforces the
	// checksum, and a typed code that fails it may still be a real
	// in-store or own-brand product.
	if (!isPlausibleBarcode(barcode)) {
		throw new Error(`"${raw}" doesn't look like a product barcode.`);
	}

	const [ctxBlocked, ctxCounts] = await Promise.all([blocked(), globalCounts()]);
	const ctx = { blocked: ctxBlocked, globalCounts: ctxCounts };

	// 1. Cache — instant, works with no signal.
	const cached = await getProduct(barcode);
	const hadCache = !!cached?.claims.length;

	if (hadCache) {
		yield {
			barcode,
			resolution: resolve(cached!.claims, ctx),
			stage: 'cache',
			stale: Date.now() - cached!.fetchedAt > STALE_AFTER_MS
		};
	}

	// 2. Relays — the real answer.
	let claims: Claim[] = [];
	try {
		claims = fromEvents(await fetchClaims(barcode));
	} catch {
		// Swallowed deliberately; handled by the hadCache branch below.
	}

	if (claims.length) {
		await putProduct(barcode, claims);
		yield { barcode, resolution: resolve(claims, ctx), stage: 'relays' };
		return;
	}

	// Relays came back with nothing. That is NOT the same as "this product
	// does not exist" — fetchClaims resolves on a timeout rather than
	// rejecting, so an offline device reaches here every time. If we
	// already showed a cached answer, downgrading it to "nobody has
	// scanned this" would replace a correct verdict with a wrong one and
	// then ask the user to pay to fix a product that is already in the
	// database. Keep what we had.
	if (hadCache) return;

	// 3. Genuinely nothing on file — offer an Open Food Facts prefill.
	const off = await offLookup(barcode);
	yield {
		barcode,
		resolution: resolve([], ctx),
		stage: 'empty',
		suggestion: off.draft,
		offLabelVegan: off.offLabelVegan
	};
}
