/**
 * Product claim model: encode/decode between Nostr events and the
 * app's Claim type.
 *
 * One addressable event (kind 30301) per author per barcode. Because
 * `d` is replaceable per-author, each person owns their own claim and
 * nobody can overwrite anyone else's — the dataset is append-only in
 * practice and cannot be vandalised by a single bad actor.
 */

import type { Event, EventTemplate } from 'nostr-tools';
import { KIND_CLAIM } from './nostr';

export type Verdict = 'vegan' | 'not-vegan' | 'unclear';

export interface Claim {
	/** Event id, absent on an unsent draft. */
	id?: string;
	/** Author pubkey (hex), absent on an unsent draft. */
	pubkey?: string;
	/** Unix seconds. */
	created_at?: number;
	barcode: string;
	name: string;
	brand?: string;
	verdict: Verdict;
	/** Raw ingredients text as printed on the pack. */
	ingredients?: string;
	/** Short reasons, e.g. "contains vitamin D3". */
	why: string[];
	/** Blossom image refs. */
	images: { url: string; sha256: string }[];
	/** Free-text note from the contributor. */
	note?: string;
	/** Where the data came from: 'label' (read off the pack) or 'off'. */
	source?: 'label' | 'off' | 'manufacturer';
}

/** Normalise a scanned barcode: digits only, EAN-13 from UPC-A. */
export function normaliseBarcode(raw: string): string {
	const digits = raw.replace(/\D/g, '');
	// UPC-A (12) is EAN-13 with a leading zero; store one canonical form.
	if (digits.length === 12) return '0' + digits;
	return digits;
}

/**
 * Length-only check, for codes a human typed in.
 *
 * Checksum validation is right for camera reads, where a misread is
 * common and silently looking up the wrong product is worse than asking
 * again. It is wrong for typed codes: in-store, own-brand and some
 * regional items carry codes that fail mod-10, and refusing to even look
 * them up strands the user with no route forward.
 */
export function isPlausibleBarcode(raw: string): boolean {
	return [8, 12, 13, 14].includes(normaliseBarcode(raw).length);
}

export function isValidBarcode(raw: string): boolean {
	const d = normaliseBarcode(raw);
	if (![8, 13, 14].includes(d.length)) return false;
	// Mod-10 check digit.
	const body = d.slice(0, -1).split('').reverse().map(Number);
	const check = Number(d.slice(-1));
	const sum = body.reduce((acc, n, i) => acc + n * (i % 2 === 0 ? 3 : 1), 0);
	return (10 - (sum % 10)) % 10 === check;
}

/* ------------------------------------------------------------------ */
/* Encode                                                              */
/* ------------------------------------------------------------------ */

export function toEventTemplate(claim: Claim): EventTemplate {
	const tags: string[][] = [
		['d', claim.barcode],
		['name', claim.name],
		['v', claim.verdict]
	];
	if (claim.brand) tags.push(['brand', claim.brand]);
	for (const w of claim.why) tags.push(['why', w]);
	for (const img of claim.images) tags.push(['img', img.url, img.sha256]);
	if (claim.source) tags.push(['src', claim.source]);
	// Indexable alias so search-capable relays can find products by name.
	tags.push(['t', 'isitvegan']);

	return {
		kind: KIND_CLAIM,
		created_at: Math.floor(Date.now() / 1000),
		tags,
		content: JSON.stringify({
			ingredients: claim.ingredients ?? '',
			note: claim.note ?? ''
		})
	};
}

/* ------------------------------------------------------------------ */
/* Decode                                                              */
/* ------------------------------------------------------------------ */

const VERDICTS: Verdict[] = ['vegan', 'not-vegan', 'unclear'];

/**
 * Parse an event into a Claim, or null if it is malformed.
 *
 * Everything here arrives from a public relay written by strangers.
 * Treat it strictly as data: validate shape, clamp lengths, and never
 * render any field as HTML.
 */
export function fromEvent(ev: Event): Claim | null {
	if (ev.kind !== KIND_CLAIM) return null;

	const tag = (k: string) => ev.tags.find((t) => t[0] === k)?.[1];
	const all = (k: string) => ev.tags.filter((t) => t[0] === k);

	const barcode = tag('d');
	const name = tag('name');
	const verdict = tag('v') as Verdict | undefined;

	if (!barcode || !name || !verdict) return null;
	if (!VERDICTS.includes(verdict)) return null;
	if (!/^\d{8,14}$/.test(barcode)) return null;

	let ingredients = '';
	let note = '';
	try {
		const body = JSON.parse(ev.content || '{}');
		if (typeof body.ingredients === 'string') ingredients = body.ingredients;
		if (typeof body.note === 'string') note = body.note;
	} catch {
		/* malformed content is survivable — tags carry the verdict */
	}

	const src = tag('src');

	return {
		id: ev.id,
		pubkey: ev.pubkey,
		created_at: ev.created_at,
		barcode,
		name: clamp(name, 200),
		brand: clamp(tag('brand') ?? '', 120) || undefined,
		verdict,
		ingredients: clamp(ingredients, 4000) || undefined,
		why: all('why')
			.map((t) => clamp(t[1] ?? '', 200))
			.filter(Boolean)
			.slice(0, 12),
		images: all('img')
			.filter((t) => typeof t[1] === 'string' && /^https:\/\//.test(t[1]))
			.filter((t) => typeof t[2] === 'string' && /^[0-9a-f]{64}$/i.test(t[2]))
			.map((t) => ({ url: t[1], sha256: t[2].toLowerCase() }))
			.slice(0, 6),
		note: clamp(note, 1000) || undefined,
		source: src === 'label' || src === 'off' || src === 'manufacturer' ? src : undefined
	};
}

function clamp(s: string, max: number): string {
	return s.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Decode a batch, dropping anything malformed. */
export function fromEvents(events: Event[]): Claim[] {
	return events.map(fromEvent).filter((c): c is Claim => c !== null);
}
