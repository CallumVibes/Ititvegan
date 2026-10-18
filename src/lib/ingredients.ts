/**
 * Ingredient rules engine.
 *
 * Three verdicts per matched term:
 *   'no'     - not vegan, no realistic ambiguity
 *   'likely' - usually animal-derived, but a vegan version exists
 *   'maybe'  - genuinely source-dependent; needs a human claim to resolve
 *
 * Matching is done on a normalised ingredient string with word boundaries,
 * so "milk" does not fire on "milk thistle" or "coconut milk" (see EXCEPTIONS).
 */

export type Severity = 'no' | 'likely' | 'maybe';

export interface Rule {
	/** Canonical display name. */
	term: string;
	severity: Severity;
	/** Extra spellings / E-numbers / synonyms. */
	aliases?: string[];
	/** Short reason shown to the user. */
	why: string;
}

export const RULES: Rule[] = [
	// ---------- Dairy ----------
	{ term: 'milk', severity: 'no', aliases: ['milk solids', 'milk powder', 'skimmed milk', 'whole milk', 'buttermilk', 'milk fat', 'milkfat'], why: 'Dairy' },
	{ term: 'whey', severity: 'no', aliases: ['whey powder', 'whey protein', 'whey permeate'], why: 'Dairy by-product' },
	{ term: 'casein', severity: 'no', aliases: ['caseinate', 'sodium caseinate', 'calcium caseinate', 'caseinates'], why: 'Milk protein' },
	{ term: 'lactose', severity: 'no', why: 'Milk sugar' },
	{ term: 'lactalbumin', severity: 'no', aliases: ['lactoglobulin'], why: 'Milk protein' },
	{ term: 'butter', severity: 'no', aliases: ['butterfat', 'butter oil', 'ghee', 'clarified butter'], why: 'Dairy' },
	{ term: 'cheese', severity: 'no', aliases: ['paneer', 'curd', 'quark', 'mascarpone', 'ricotta'], why: 'Dairy' },
	{ term: 'cream', severity: 'no', aliases: ['creme fraiche', 'crème fraîche', 'sour cream', 'double cream', 'single cream'], why: 'Dairy' },
	{ term: 'yoghurt', severity: 'no', aliases: ['yogurt', 'kefir', 'dahi'], why: 'Dairy' },
	{ term: 'custard', severity: 'likely', why: 'Usually contains milk and egg' },

	// ---------- Egg ----------
	{ term: 'egg', severity: 'no', aliases: ['egg white', 'egg yolk', 'dried egg', 'egg powder', 'free range egg'], why: 'Egg' },
	{ term: 'albumen', severity: 'no', aliases: ['albumin', 'ovalbumin', 'egg albumen'], why: 'Egg white protein' },
	{ term: 'lysozyme', severity: 'no', aliases: ['e1105'], why: 'Enzyme from egg white' },
	{ term: 'livetin', severity: 'no', aliases: ['vitellin', 'ovomucin', 'ovomucoid'], why: 'Egg protein' },
	{ term: 'meringue', severity: 'no', why: 'Egg white' },

	// ---------- Land animal ----------
	{ term: 'gelatine', severity: 'no', aliases: ['gelatin', 'e441', 'bovine gelatine', 'porcine gelatine'], why: 'Animal collagen' },
	{ term: 'collagen', severity: 'no', why: 'Animal connective tissue' },
	{ term: 'lard', severity: 'no', aliases: ['pork fat'], why: 'Pig fat' },
	{ term: 'tallow', severity: 'no', aliases: ['beef tallow', 'suet', 'dripping'], why: 'Rendered animal fat' },
	{ term: 'rennet', severity: 'no', aliases: ['animal rennet'], why: 'Enzyme from calf stomach' },
	{ term: 'aspic', severity: 'no', why: 'Meat jelly' },
	{ term: 'bone phosphate', severity: 'no', aliases: ['e542', 'edible bone phosphate'], why: 'Ground animal bone' },
	{ term: 'bone char', severity: 'no', aliases: ['natural carbon'], why: 'Charred animal bone' },
	{ term: 'l-cysteine', severity: 'likely', aliases: ['e920', 'cysteine'], why: 'Often from feathers or hair; synthetic version exists' },
	{ term: 'lanolin', severity: 'no', aliases: ['e913', 'wool fat', 'wool grease'], why: 'Wool grease' },
	{ term: 'keratin', severity: 'no', why: 'Animal horn, hoof or feather' },
	{ term: 'castoreum', severity: 'no', why: 'Beaver secretion' },

	// ---------- Fish / shellfish ----------
	{ term: 'isinglass', severity: 'no', why: 'Fish swim bladder (fining agent)' },
	{ term: 'anchovy', severity: 'no', aliases: ['anchovies', 'fish sauce', 'fish stock', 'fish extract'], why: 'Fish' },
	{ term: 'oyster sauce', severity: 'no', aliases: ['oyster extract'], why: 'Shellfish' },
	{ term: 'worcestershire sauce', severity: 'likely', why: 'Traditionally contains anchovy' },
	{ term: 'omega-3', severity: 'maybe', aliases: ['omega 3', 'dha', 'epa'], why: 'May be fish oil or algal' },
	{ term: 'chitosan', severity: 'likely', aliases: ['chitin'], why: 'Usually crustacean shell' },
	{ term: 'squalene', severity: 'maybe', aliases: ['squalane'], why: 'May be shark liver or olive' },

	// ---------- Insect ----------
	{ term: 'honey', severity: 'no', why: 'Bee product' },
	{ term: 'beeswax', severity: 'no', aliases: ['e901', 'cera alba'], why: 'Bee product' },
	{ term: 'propolis', severity: 'no', aliases: ['royal jelly'], why: 'Bee product' },
	{ term: 'shellac', severity: 'no', aliases: ['e904', 'confectioners glaze', "confectioner's glaze"], why: 'Lac insect resin' },
	{ term: 'carmine', severity: 'no', aliases: ['e120', 'cochineal', 'carminic acid', 'crimson lake', 'natural red 4'], why: 'Crushed cochineal insects' },
	{ term: 'silk', severity: 'no', aliases: ['sericin', 'silk protein'], why: 'Silkworm' },

	// ---------- Ambiguous additives ----------
	{ term: 'mono- and diglycerides', severity: 'maybe', aliases: ['e471', 'monoglycerides', 'diglycerides', 'mono and diglycerides'], why: 'Emulsifier; may be plant or animal fat' },
	{ term: 'e472', severity: 'maybe', aliases: ['e472a', 'e472b', 'e472c', 'e472e', 'datem', 'esters of mono- and diglycerides'], why: 'Emulsifier; may be plant or animal fat' },
	{ term: 'glycerol', severity: 'maybe', aliases: ['e422', 'glycerin', 'glycerine'], why: 'May be plant or animal fat' },
	{ term: 'stearic acid', severity: 'maybe', aliases: ['e570', 'magnesium stearate', 'stearate', 'stearates'], why: 'May be plant or animal fat' },
	{ term: 'oleic acid', severity: 'maybe', aliases: ['oleate'], why: 'May be plant or animal fat' },
	{ term: 'vitamin d3', severity: 'likely', aliases: ['cholecalciferol'], why: 'Usually from lanolin; lichen-derived version exists' },
	{ term: 'vitamin a palmitate', severity: 'maybe', aliases: ['retinyl palmitate'], why: 'Carrier may be animal-derived' },
	{ term: 'disodium inosinate', severity: 'maybe', aliases: ['e631', 'inosinate'], why: 'May be from meat or fish' },
	{ term: 'disodium guanylate', severity: 'maybe', aliases: ['e627', 'guanylate'], why: 'May be from meat or fish' },
	{ term: 'natural flavouring', severity: 'maybe', aliases: ['natural flavoring', 'natural flavour', 'natural flavor', 'natural flavours', 'natural flavors'], why: 'Source not disclosed' },
	{ term: 'lactic acid', severity: 'maybe', aliases: ['e270'], why: 'Usually plant-fermented, occasionally dairy-derived' },
	{ term: 'ascorbyl palmitate', severity: 'maybe', aliases: ['e304'], why: 'Carrier may be animal-derived' },
	{ term: 'lecithin', severity: 'maybe', aliases: ['e322'], why: 'Usually soy or sunflower, rarely egg' },
	{ term: 'sugar', severity: 'maybe', aliases: ['refined sugar', 'cane sugar'], why: 'Some cane sugar is filtered through bone char' },
	{ term: 'lactitol', severity: 'likely', aliases: ['e966'], why: 'Derived from lactose' },
	{ term: 'calcium phosphate', severity: 'maybe', aliases: ['e341', 'tricalcium phosphate'], why: 'May be mineral or bone-derived' }
];

/**
 * Phrases that contain a flagged term but are themselves vegan.
 * Checked before rule matching and masked out of the string.
 */
export const EXCEPTIONS = [
	'coconut milk', 'almond milk', 'soy milk', 'soya milk', 'oat milk', 'rice milk',
	'cashew milk', 'hemp milk', 'hazelnut milk', 'pea milk', 'milk thistle',
	'coconut cream', 'cream of tartar', 'creamed corn', 'salad cream', 'ice cream cone',
	'cocoa butter', 'shea butter', 'peanut butter', 'nut butter', 'almond butter',
	'apple butter', 'butternut', 'butter bean', 'butterhead', 'buttercup',
	'vegan cheese', 'plant-based cheese', 'nutritional yeast',
	'egg plant', 'eggplant', 'egg-free', 'egg replacer',
	'soy yoghurt', 'soy yogurt', 'coconut yoghurt', 'coconut yogurt',
	'vegetarian rennet', 'microbial rennet', 'vegetable rennet',
	'vegan gelatine', 'agar', 'carrageenan',
	'milk chocolate flavour substitute',
	'dairy-free', 'dairy free', 'milk-free', 'milk free',
	'honeydew', 'honeycomb toffee', 'honeysuckle',
	'vitamin d2', 'ergocalciferol',
	'sunflower lecithin', 'soy lecithin', 'soya lecithin',
	'algal oil', 'algae oil', 'flaxseed oil'
];

export interface Hit {
	rule: Rule;
	/** The literal text that matched. */
	matched: string;
}

export interface RuleVerdict {
	verdict: 'vegan' | 'not-vegan' | 'unclear';
	hits: Hit[];
	/** True when the label itself asserts vegan status. */
	labelledVegan: boolean;
}

const VEGAN_LABEL = /\b(certified\s+)?vegan\b|\bvegan\s+(society|certified|approved)\b|\bsuitable for vegans\b/i;

function normalise(s: string): string {
	return s
		.toLowerCase()
		.replace(/[_*]/g, ' ')
		.replace(/[\u2018\u2019]/g, "'")
		.replace(/\s+/g, ' ')
		.trim();
}

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Run the rules engine against a raw ingredients string.
 *
 * Deliberately conservative: a single 'no' hit means not-vegan, any 'likely'
 * or 'maybe' hit means unclear, and a clean pass means vegan. "Unclear" is a
 * real answer here, not a failure — it is the signal that a human claim is
 * needed to resolve the product.
 */
export function evaluate(ingredients: string): RuleVerdict {
	if (!ingredients || !ingredients.trim()) {
		return { verdict: 'unclear', hits: [], labelledVegan: false };
	}

	const labelledVegan = VEGAN_LABEL.test(ingredients);
	let text = normalise(ingredients);

	// Mask exceptions so their substrings cannot trigger rules.
	for (const ex of EXCEPTIONS) {
		const re = new RegExp(`\\b${escapeRe(normalise(ex))}\\b`, 'g');
		text = text.replace(re, (m) => '\u0000'.repeat(m.length));
	}

	const hits: Hit[] = [];
	const seen = new Set<string>();

	for (const rule of RULES) {
		const terms = [rule.term, ...(rule.aliases ?? [])];
		for (const t of terms) {
			const re = new RegExp(`\\b${escapeRe(normalise(t))}\\b`);
			if (re.test(text) && !seen.has(rule.term)) {
				seen.add(rule.term);
				hits.push({ rule, matched: t });
				break;
			}
		}
	}

	if (hits.some((h) => h.rule.severity === 'no')) {
		return { verdict: 'not-vegan', hits, labelledVegan };
	}
	if (hits.length > 0) {
		return { verdict: 'unclear', hits, labelledVegan };
	}
	return { verdict: 'vegan', hits, labelledVegan };
}
