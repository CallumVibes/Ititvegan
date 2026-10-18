/**
 * Verdict resolution: blends the ingredients rules engine with
 * agreement across independent pubkeys, and filters spam client-side.
 *
 * Because the relay is open, anything here may be hostile. The design
 * assumption is that the rules engine is the anchor of truth (it reads
 * the actual ingredients list) and human claims adjust confidence
 * around it, rather than human claims being trusted on their own.
 */

import { evaluate, type RuleVerdict } from './ingredients';
import type { Claim, Verdict } from './product';

export interface Resolution {
	verdict: Verdict;
	/** 0..1 — how much to trust the verdict. Drives the UI colour. */
	confidence: number;
	/** Human-readable reasons, ordered most-important first. */
	reasons: string[];
	/** The rules-engine result, for the "why?" detail view. */
	rules: RuleVerdict | null;
	/** Claims that survived spam filtering, newest first. */
	accepted: Claim[];
	/** Claims dropped as spam, kept for a debug view. */
	rejected: { claim: Claim; reason: string }[];
	/** True when humans and the ingredients list disagree. */
	conflict: boolean;
	/** Distinct pubkeys backing the winning verdict. */
	agreeing: number;
}

export interface FilterContext {
	/** Pubkeys the user has personally blocked. */
	blocked?: Set<string>;
	/** Claim counts per pubkey across the whole local cache. */
	globalCounts?: Map<string, number>;
	/** Now, in unix seconds. Injectable for tests. */
	now?: number;
}

/* ------------------------------------------------------------------ */
/* Spam filtering                                                      */
/* ------------------------------------------------------------------ */

const MAX_CLAIMS_PER_PUBKEY_GLOBAL = 2000;
const MIN_NAME_LENGTH = 2;
const URL_RE = /https?:\/\//i;

/**
 * Drop claims that look like spam before they ever reach the tally.
 *
 * These are cheap heuristics, not a reputation system. They catch
 * low-effort flooding; a patient adversary with £0 of cost will get
 * through, which is the trade-off of an open relay.
 */
export function filterClaims(
	claims: Claim[],
	ctx: FilterContext = {}
): { accepted: Claim[]; rejected: { claim: Claim; reason: string }[] } {
	const accepted: Claim[] = [];
	const rejected: { claim: Claim; reason: string }[] = [];
	const now = ctx.now ?? Math.floor(Date.now() / 1000);
	const seenByPubkey = new Set<string>();

	// Newest first, so a pubkey's most recent claim is the one kept.
	const sorted = [...claims].sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));

	for (const c of sorted) {
		const pk = c.pubkey ?? '';

		if (ctx.blocked?.has(pk)) {
			rejected.push({ claim: c, reason: 'Blocked by you' });
			continue;
		}
		// One claim per pubkey per product. Relays should enforce this for
		// addressable events, but not every relay does.
		if (seenByPubkey.has(pk)) {
			rejected.push({ claim: c, reason: 'Superseded by a newer claim from the same key' });
			continue;
		}
		if ((c.created_at ?? 0) > now + 600) {
			rejected.push({ claim: c, reason: 'Timestamp in the future' });
			continue;
		}
		if (c.name.trim().length < MIN_NAME_LENGTH) {
			rejected.push({ claim: c, reason: 'Empty product name' });
			continue;
		}
		if (URL_RE.test(c.name) || URL_RE.test(c.brand ?? '') || URL_RE.test(c.note ?? '')) {
			rejected.push({ claim: c, reason: 'Contains a link' });
			continue;
		}
		if ((ctx.globalCounts?.get(pk) ?? 0) > MAX_CLAIMS_PER_PUBKEY_GLOBAL) {
			rejected.push({ claim: c, reason: 'Key is flooding the network' });
			continue;
		}

		seenByPubkey.add(pk);
		accepted.push(c);
	}

	return { accepted, rejected };
}

/* ------------------------------------------------------------------ */
/* Resolution                                                          */
/* ------------------------------------------------------------------ */

/** Pick the ingredients text to run rules against: the most common one. */
function bestIngredients(claims: Claim[]): string | null {
	const counts = new Map<string, number>();
	for (const c of claims) {
		const t = c.ingredients?.trim();
		if (t && t.length > 20) counts.set(t, (counts.get(t) ?? 0) + 1);
	}
	if (!counts.size) return null;
	return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0];
}

/**
 * Resolve a product to a single verdict.
 *
 * Precedence:
 *  1. A hard 'no' ingredient hit wins outright — a label listing gelatine
 *     is not vegan regardless of how many people vote otherwise. Humans
 *     disagreeing flips `conflict` on so the UI can surface the dispute.
 *  2. Otherwise human agreement decides, with the rules engine adding or
 *     removing confidence.
 *  3. No claims and no ingredients means unclear, which is a real answer.
 */
export function resolve(rawClaims: Claim[], ctx: FilterContext = {}): Resolution {
	const { accepted, rejected } = filterClaims(rawClaims, ctx);

	const ingredients = bestIngredients(accepted);
	const rules = ingredients ? evaluate(ingredients) : null;

	// Tally distinct pubkeys per verdict.
	const tally = new Map<Verdict, Set<string>>([
		['vegan', new Set()],
		['not-vegan', new Set()],
		['unclear', new Set()]
	]);
	for (const c of accepted) tally.get(c.verdict)?.add(c.pubkey ?? c.id ?? '');

	const votes = {
		vegan: tally.get('vegan')!.size,
		'not-vegan': tally.get('not-vegan')!.size,
		unclear: tally.get('unclear')!.size
	};
	const total = votes.vegan + votes['not-vegan'] + votes.unclear;

	const reasons: string[] = [];
	let verdict: Verdict;
	let confidence: number;
	let conflict = false;

	const hardHits = rules?.hits.filter((h) => h.rule.severity === 'no') ?? [];

	if (hardHits.length > 0) {
		// ---- Rules engine override ----
		verdict = 'not-vegan';
		confidence = 0.95;
		reasons.push(
			`Ingredients list contains ${hardHits.map((h) => h.rule.term).join(', ')}`
		);
		for (const h of hardHits.slice(0, 3)) reasons.push(`${h.rule.term}: ${h.rule.why}`);
		if (votes.vegan > votes['not-vegan'] && votes.vegan > 0) {
			conflict = true;
			confidence = 0.7;
			reasons.push(
				`${votes.vegan} ${votes.vegan === 1 ? 'person has' : 'people have'} marked this vegan, which contradicts the label — the recipe may have changed, or the ingredients on file may be stale`
			);
		}
	} else if (total === 0) {
		// ---- No human input ----
		if (rules && rules.verdict === 'vegan') {
			verdict = rules.labelledVegan ? 'vegan' : 'unclear';
			confidence = rules.labelledVegan ? 0.8 : 0.45;
			reasons.push(
				rules.labelledVegan
					? 'Label states vegan, and no animal-derived ingredients were found'
					: 'No animal-derived ingredients found, but nobody has verified this yet'
			);
		} else if (rules) {
			verdict = 'unclear';
			confidence = 0.3;
			reasons.push('Ingredients include items that may or may not be animal-derived');
			for (const h of rules.hits.slice(0, 4)) reasons.push(`${h.rule.term}: ${h.rule.why}`);
		} else {
			verdict = 'unclear';
			confidence = 0;
			reasons.push('Nobody has scanned this product yet — be the first to add it');
		}
	} else {
		// ---- Human agreement, adjusted by rules ----
		const top = (Object.entries(votes) as [Verdict, number][]).sort((a, b) => b[1] - a[1])[0];
		verdict = top[0];
		const share = top[1] / total;

		// Confidence grows with agreement count but saturates: five
		// independent keys is good evidence, fifty is not ten times better.
		const volume = 1 - Math.exp(-top[1] / 3);
		confidence = Math.min(0.9, 0.35 + 0.5 * volume * share);

		reasons.push(
			`${top[1]} of ${total} ${total === 1 ? 'contributor' : 'contributors'} marked this ${labelFor(top[0])}`
		);

		if (rules) {
			if (rules.verdict === verdict) {
				confidence = Math.min(0.95, confidence + 0.15);
				reasons.push('The ingredients list agrees');
			} else if (rules.verdict === 'unclear' && verdict === 'vegan') {
				confidence = Math.max(0.3, confidence - 0.2);
				conflict = true;
				reasons.push('Some ingredients are source-dependent — contributors may have checked with the manufacturer');
				for (const h of rules.hits.slice(0, 3)) reasons.push(`${h.rule.term}: ${h.rule.why}`);
			}
		} else {
			confidence = Math.max(0.25, confidence - 0.15);
			reasons.push('No ingredients list on file — this rests on contributor reports alone');
		}

		if (share < 0.6 && total >= 3) {
			conflict = true;
			reasons.push('Contributors disagree about this product');
		}
	}

	return {
		verdict,
		confidence: Math.round(confidence * 100) / 100,
		reasons,
		rules,
		accepted,
		rejected,
		conflict,
		agreeing: tally.get(verdict)?.size ?? 0
	};
}

function labelFor(v: Verdict): string {
	return v === 'not-vegan' ? 'not vegan' : v;
}

/** Bucket confidence for UI copy. Never render a bare percentage. */
export function confidenceLabel(c: number): string {
	if (c >= 0.85) return 'Strong evidence';
	if (c >= 0.6) return 'Good evidence';
	if (c >= 0.35) return 'Weak evidence';
	return 'Not verified';
}
