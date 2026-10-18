/**
 * Open Food Facts lookup — the "unknown barcode" fallback.
 *
 * This only ever PREFILLS the add-product form. The user confirms what
 * they can see on the physical pack before anything is published, so a
 * wrong OFF record cannot silently become a claim in our dataset.
 *
 * OFF data is ODbL. Attribute it in the UI wherever it is shown.
 */

import type { Claim } from './product';

const BASE = 'https://world.openfoodfacts.org/api/v2/product';

// OFF asks clients to identify themselves via User-Agent, but that is a
// forbidden header name in browsers — fetch silently drops it, so setting
// it would be theatre. Identify in the query string instead, which OFF
// also accepts.
const CLIENT = 'IsItVegan/0.1';

export interface OffResult {
	found: boolean;
	draft?: Partial<Claim>;
	/** OFF's own vegan label, if the product carries one. */
	offLabelVegan?: boolean;
}

export async function lookup(barcode: string, signal?: AbortSignal): Promise<OffResult> {
	const fields = [
		'product_name',
		'brands',
		'ingredients_text',
		'ingredients_text_en',
		'labels_tags',
		'image_front_url'
	].join(',');

	let res: Response;
	try {
		res = await fetch(
			`${BASE}/${encodeURIComponent(barcode)}.json?fields=${fields}` +
				`&user_agent=${encodeURIComponent(CLIENT)}`,
			{ headers: { Accept: 'application/json' }, signal }
		);
	} catch {
		// Offline, or OFF is down. Not an error the user needs to see —
		// they can still fill the form in by hand.
		return { found: false };
	}

	if (!res.ok) return { found: false };

	let json: any;
	try {
		json = await res.json();
	} catch {
		return { found: false };
	}

	if (json?.status !== 1 || !json?.product) return { found: false };

	const p = json.product;
	const labels: string[] = Array.isArray(p.labels_tags) ? p.labels_tags : [];
	const offLabelVegan = labels.some((l) => l === 'en:vegan' || l.endsWith(':vegan'));

	const ingredients: string =
		(typeof p.ingredients_text_en === 'string' && p.ingredients_text_en) ||
		(typeof p.ingredients_text === 'string' && p.ingredients_text) ||
		'';

	const name = typeof p.product_name === 'string' ? p.product_name.trim() : '';
	const brand =
		typeof p.brands === 'string' ? p.brands.split(',')[0]?.trim() : undefined;

	if (!name && !ingredients) return { found: false };

	return {
		found: true,
		offLabelVegan,
		draft: {
			barcode,
			name: name.slice(0, 200),
			brand: brand?.slice(0, 120) || undefined,
			ingredients: ingredients.slice(0, 4000) || undefined,
			source: 'off'
		}
	};
}
