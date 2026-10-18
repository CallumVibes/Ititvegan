import { describe, it, expect } from 'vitest';
import { evaluate } from '../src/lib/ingredients';
import { resolve } from '../src/lib/consensus';
import { normaliseBarcode, isValidBarcode, type Claim } from '../src/lib/product';

const claim = (p: Partial<Claim>): Claim => ({
	barcode: '05000112637922',
	name: 'Test product',
	verdict: 'vegan',
	why: [],
	images: [],
	...p
});

describe('ingredients rules engine', () => {
	it('flags obvious dairy', () => {
		const r = evaluate('Water, sugar, whole milk powder, cocoa butter');
		expect(r.verdict).toBe('not-vegan');
		expect(r.hits.map((h) => h.rule.term)).toContain('milk');
	});

	it('does not fire on plant milks', () => {
		expect(evaluate('Water, coconut milk, salt').verdict).toBe('vegan');
		expect(evaluate('Oat milk, sunflower oil').verdict).toBe('vegan');
	});

	it('does not fire on cocoa butter or peanut butter', () => {
		expect(evaluate('Cocoa mass, cocoa butter, sugar').verdict).toBe('vegan');
		expect(evaluate('Peanut butter, salt').verdict).toBe('vegan');
	});

	it('catches E-numbers', () => {
		expect(evaluate('Sugar, glucose syrup, E120').verdict).toBe('not-vegan');
		expect(evaluate('Glazing agent (E904)').verdict).toBe('not-vegan');
	});

	it('returns unclear for source-dependent additives', () => {
		const r = evaluate('Flour, water, E471, salt');
		expect(r.verdict).toBe('unclear');
		expect(r.hits[0].rule.severity).toBe('maybe');
	});

	it('detects a vegan label', () => {
		expect(evaluate('Suitable for vegans. Water, salt.').labelledVegan).toBe(true);
	});

	it('treats empty input as unclear, not vegan', () => {
		expect(evaluate('').verdict).toBe('unclear');
	});
});

describe('barcodes', () => {
	it('pads UPC-A to EAN-13', () => {
		expect(normaliseBarcode('036000291452')).toBe('0036000291452');
	});
	it('validates check digits', () => {
		expect(isValidBarcode('5000112637922')).toBe(true);
		expect(isValidBarcode('5000112637923')).toBe(false);
	});
});

describe('consensus', () => {
	it('is unclear with no data at all', () => {
		const r = resolve([]);
		expect(r.verdict).toBe('unclear');
		expect(r.confidence).toBe(0);
	});

	it('lets the ingredients list override a popular wrong answer', () => {
		const claims = [
			claim({ pubkey: 'a', verdict: 'vegan', ingredients: 'Sugar, gelatine, colours' }),
			claim({ pubkey: 'b', verdict: 'vegan', ingredients: 'Sugar, gelatine, colours' }),
			claim({ pubkey: 'c', verdict: 'vegan', ingredients: 'Sugar, gelatine, colours' })
		];
		const r = resolve(claims);
		expect(r.verdict).toBe('not-vegan');
		expect(r.conflict).toBe(true);
	});

	it('counts distinct pubkeys, not events', () => {
		const claims = [
			claim({ pubkey: 'a', verdict: 'vegan', created_at: 200 }),
			claim({ pubkey: 'a', verdict: 'vegan', created_at: 100 }),
			claim({ pubkey: 'a', verdict: 'vegan', created_at: 50 })
		];
		const r = resolve(claims);
		expect(r.agreeing).toBe(1);
		expect(r.accepted).toHaveLength(1);
	});

	it('drops claims containing links', () => {
		const r = resolve([claim({ pubkey: 'spam', name: 'Buy now http://x.co' })]);
		expect(r.accepted).toHaveLength(0);
		expect(r.rejected[0].reason).toMatch(/link/i);
	});

	it('respects the user blocklist', () => {
		const r = resolve([claim({ pubkey: 'bad' })], { blocked: new Set(['bad']) });
		expect(r.accepted).toHaveLength(0);
	});

	it('gains confidence when humans and the label agree', () => {
		const ing = 'Water, oats, sunflower oil, salt';
		const few = resolve([claim({ pubkey: 'a', verdict: 'vegan', ingredients: ing })]);
		const many = resolve(
			['a', 'b', 'c', 'd', 'e'].map((pk) =>
				claim({ pubkey: pk, verdict: 'vegan', ingredients: ing })
			)
		);
		expect(many.confidence).toBeGreaterThan(few.confidence);
	});
});

describe('blocklist', () => {
	const c = (pk: string, v: 'vegan' | 'not-vegan' | 'unclear'): Claim => ({
		barcode: '05000112637922',
		name: 'Test',
		verdict: v,
		why: [],
		images: [],
		pubkey: pk,
		created_at: 1000
	});

	it('flips the verdict once the outlier is hidden', () => {
		const claims = [c('a', 'vegan'), c('b', 'vegan'), c('spam', 'not-vegan')];

		const before = resolve(claims);
		expect(before.verdict).toBe('vegan');

		// Hiding the two honest keys should leave the spammer's verdict.
		const after = resolve(claims, { blocked: new Set(['a', 'b']) });
		expect(after.verdict).toBe('not-vegan');
		expect(after.accepted).toHaveLength(1);
		expect(after.rejected).toHaveLength(2);
	});

	it('counts hidden claims so the UI can show how many', () => {
		const claims = [c('a', 'vegan'), c('bad', 'vegan')];
		const r = resolve(claims, { blocked: new Set(['bad']) });
		expect(r.rejected.filter((x) => x.reason === 'Blocked by you')).toHaveLength(1);
	});

	it('accepted plus rejected is every claim, so a local re-resolve is lossless', () => {
		const claims = [c('a', 'vegan'), c('b', 'not-vegan'), c('c', 'unclear')];
		const r = resolve(claims, { blocked: new Set(['b']) });
		const all = [...r.accepted, ...r.rejected.map((x) => x.claim)];
		expect(all).toHaveLength(claims.length);
	});
});
