/**
 * Offline cache. The app has to work standing in a shop aisle with one
 * bar of signal, so every resolved product is written through to
 * IndexedDB and served from there first while the network catches up.
 */

import type { Claim } from './product';

const DB_NAME = 'isitvegan';
const DB_VERSION = 1;
const STORE_PRODUCTS = 'products';
const STORE_PENDING = 'pending';
const STORE_META = 'meta';

export interface CachedProduct {
	barcode: string;
	claims: Claim[];
	/** Unix ms of last successful relay fetch. */
	fetchedAt: number;
}

/** A claim written while offline, waiting to be published. */
export interface PendingClaim {
	id: string;
	claim: Claim;
	queuedAt: number;
	attempts: number;
	lastError?: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
	if (!dbPromise) {
		dbPromise = new Promise((resolve, reject) => {
			const req = indexedDB.open(DB_NAME, DB_VERSION);
			req.onupgradeneeded = () => {
				const d = req.result;
				if (!d.objectStoreNames.contains(STORE_PRODUCTS))
					d.createObjectStore(STORE_PRODUCTS, { keyPath: 'barcode' });
				if (!d.objectStoreNames.contains(STORE_PENDING))
					d.createObjectStore(STORE_PENDING, { keyPath: 'id' });
				if (!d.objectStoreNames.contains(STORE_META))
					d.createObjectStore(STORE_META);
			};
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
	}
	return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
	return db().then(
		(d) =>
			new Promise<T>((resolve, reject) => {
				const t = d.transaction(store, mode);
				const req = fn(t.objectStore(store));
				req.onsuccess = () => resolve(req.result as T);
				req.onerror = () => reject(req.error);
			})
	);
}

/* ---------------- Products ---------------- */

export async function getProduct(barcode: string): Promise<CachedProduct | undefined> {
	return tx<CachedProduct | undefined>(STORE_PRODUCTS, 'readonly', (s) => s.get(barcode));
}

/**
 * Cap on cached products.
 *
 * History is the cache, so pruning throws away someone's scan history —
 * but an unbounded IndexedDB on a phone eventually gets the whole origin
 * evicted by the browser, losing everything including the contributor
 * key. A generous cap that trims the oldest is the lesser loss, and
 * anything trimmed is one relay query from coming back.
 */
const MAX_CACHED_PRODUCTS = 1000;
const PRUNE_TO = 900;

export async function putProduct(barcode: string, claims: Claim[]): Promise<void> {
	await tx(STORE_PRODUCTS, 'readwrite', (s) =>
		s.put({ barcode, claims, fetchedAt: Date.now() } satisfies CachedProduct)
	);
	await prune();
}

/**
 * Trim the oldest entries once over the cap.
 *
 * Deliberately hysteretic: it prunes down to PRUNE_TO rather than to the
 * cap, so the next scan does not immediately trigger another prune. A
 * delete-one-per-insert loop would thrash the store forever at the
 * boundary.
 */
async function prune(): Promise<void> {
	const all = await allProducts();
	if (all.length <= MAX_CACHED_PRODUCTS) return;

	const doomed = all
		.sort((a, b) => a.fetchedAt - b.fetchedAt)
		.slice(0, all.length - PRUNE_TO);

	const d = await db();
	await new Promise<void>((resolve, reject) => {
		const t = d.transaction(STORE_PRODUCTS, 'readwrite');
		const store = t.objectStore(STORE_PRODUCTS);
		for (const p of doomed) store.delete(p.barcode);
		t.oncomplete = () => resolve();
		t.onerror = () => reject(t.error);
	});
}

export async function allProducts(): Promise<CachedProduct[]> {
	return tx<CachedProduct[]>(STORE_PRODUCTS, 'readonly', (s) => s.getAll());
}

/**
 * Claim counts per pubkey across everything cached — feeds the
 * flooding heuristic in the spam filter.
 */
export async function globalCounts(): Promise<Map<string, number>> {
	const products = await allProducts();
	const counts = new Map<string, number>();
	for (const p of products)
		for (const c of p.claims)
			if (c.pubkey) counts.set(c.pubkey, (counts.get(c.pubkey) ?? 0) + 1);
	return counts;
}

/* ---------------- Pending queue ---------------- */

export async function queueClaim(claim: Claim): Promise<void> {
	await tx(STORE_PENDING, 'readwrite', (s) =>
		s.put({
			id: `${claim.barcode}:${Date.now()}`,
			claim,
			queuedAt: Date.now(),
			attempts: 0
		} satisfies PendingClaim)
	);
}

export async function pending(): Promise<PendingClaim[]> {
	return tx<PendingClaim[]>(STORE_PENDING, 'readonly', (s) => s.getAll());
}

export async function dequeue(id: string): Promise<void> {
	await tx(STORE_PENDING, 'readwrite', (s) => s.delete(id));
}

export async function markAttempt(p: PendingClaim, error: string): Promise<void> {
	await tx(STORE_PENDING, 'readwrite', (s) =>
		s.put({ ...p, attempts: p.attempts + 1, lastError: error })
	);
}

/* ---------------- Blocklist ---------------- */

export async function blocked(): Promise<Set<string>> {
	const list = await tx<string[] | undefined>(STORE_META, 'readonly', (s) => s.get('blocked'));
	return new Set(list ?? []);
}

export async function block(pubkey: string): Promise<void> {
	const set = await blocked();
	set.add(pubkey);
	await tx(STORE_META, 'readwrite', (s) => s.put([...set], 'blocked'));
}

export async function unblock(pubkey: string): Promise<void> {
	const set = await blocked();
	set.delete(pubkey);
	await tx(STORE_META, 'readwrite', (s) => s.put([...set], 'blocked'));
}
