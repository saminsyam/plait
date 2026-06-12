/**
 * Deterministic dietary hard-gate.
 *
 * This module is the ONE place where life-safety filtering lives. It runs
 * on-device, makes NO model calls, and is a pure function so the policy is
 * unit-testable and auditable in a single file. The model (Reason) only ever
 * ranks the survivors of this gate — it can never recommend something it does
 * not see.
 *
 * Conservative invariant: a MISSING or UNCERTAIN tag is never treated as
 * "safe". Absence of evidence is not evidence of absence. But "not safe" means
 * "make the user verify", NOT "hide it" — only a dish that AFFIRMATIVELY
 * contains the allergen is blocked. Otherwise a name-only menu (no ingredient
 * text) would wipe out every dish for a severe allergy and recommend nothing.
 *
 *   - Allergen present (conflict)        → blocked ("contains X")
 *   - Allergen confidently absent (clear)→ allowed
 *   - Allergen unknown, SEVERE           → verify ("MUST confirm X-free with staff")
 *   - Allergen unknown, MILD             → verify ("could not verify — ask staff")
 *   - Religious rule  + unknown          → verify
 *
 * The enriched item shape is the pipeline's `MenuItem` (see ./types and
 * ./callVision). The only fields this gate inspects are `name`, `description`,
 * `ingredients`, `protein_type`, and `dietary_tags`.
 */
import type { MenuItem } from './types';

/** The enriched menu item produced by the Vision / Lookup pipeline. */
export type EnrichedItem = MenuItem;

export type AllergenSeverity = 'severe' | 'mild';

export type HardConstraint =
  | { kind: 'allergen'; allergen: string; severity: AllergenSeverity }
  | { kind: 'religious'; rule: 'halal' | 'kosher' };

export type HardConstraints = HardConstraint[];

export type FilterOutcome = 'allowed' | 'verify' | 'blocked';

/** How a single item classifies against a single constraint. */
export type Classification = 'conflict' | 'clear' | 'unknown';

export type FilteredItem = {
  item: EnrichedItem;
  outcome: FilterOutcome;
  /** Human-readable, names the specific allergen/rule. Shown verbatim in UI. */
  reasons: string[];
};

export type FilterResult = {
  /** Safe to rank normally. */
  allowed: EnrichedItem[];
  /** Rankable, but Reason must attach a "verify with staff" note. */
  verify: FilteredItem[];
  /** NEVER sent to Reason. Surfaced in the "avoid" list with reasons. */
  blocked: FilteredItem[];
};

// ---------------------------------------------------------------------------
// Tag → constraint mapping (the auditable table)
//
// Detection leans on `protein_type` first (the most reliable structured tag),
// then a curated keyword scan over the dish name / description / ingredients.
// Keyword matching is intentionally conservative: it uses a left word-boundary
// so it prefers a false-positive block over a false-negative miss. e.g. a
// shellfish allergy may over-block a generic "seafood" dish — the safe
// direction for a hard constraint.
// ---------------------------------------------------------------------------

/** protein_type values that carry no information about presence/absence. */
const AMBIGUOUS_PROTEINS = new Set(['', 'unknown', 'mixed', 'other']);

type AllergenProfile = {
  /** Display label used in reason strings, e.g. "shellfish". */
  label: string;
  /** protein_type values that affirmatively mean the allergen is PRESENT. */
  conflictProteins: string[];
  /** name/description/ingredient keywords that mean the allergen is PRESENT. */
  conflictKeywords: string[];
  /** dietary_tags that affirmatively mean the allergen is ABSENT. */
  clearTags: string[];
};

/**
 * Per-allergen detection table. Allergens with a non-empty `conflictProteins`
 * are "protein-based" — a confident, specific, non-conflicting protein clears
 * them (e.g. a chicken dish is clear for a shellfish allergy). Allergens with
 * no protein signal (peanuts, dairy, …) can only be cleared by an explicit
 * tag; otherwise an untagged dish stays `unknown` (→ blocked when severe).
 */
const ALLERGEN_TABLE: Record<string, AllergenProfile> = {
  shellfish: {
    label: 'shellfish',
    conflictProteins: ['shellfish', 'seafood'],
    conflictKeywords: [
      'shellfish', 'shrimp', 'prawn', 'crab', 'lobster', 'crayfish', 'crawfish',
      'scallop', 'clam', 'mussel', 'oyster', 'calamari', 'squid', 'octopus',
    ],
    clearTags: [],
  },
  fish: {
    label: 'fish',
    conflictProteins: ['fish'],
    conflictKeywords: [
      'fish', 'salmon', 'tuna', 'cod', 'halibut', 'trout', 'tilapia', 'anchovy',
      'sardine', 'snapper', 'mackerel', 'herring', 'branzino', 'sea bass',
    ],
    clearTags: [],
  },
  peanut: {
    label: 'peanuts',
    conflictProteins: [],
    conflictKeywords: ['peanut', 'satay', 'goober'],
    clearTags: [],
  },
  treenut: {
    label: 'tree nuts',
    conflictProteins: [],
    conflictKeywords: [
      'almond', 'cashew', 'walnut', 'pecan', 'pistachio', 'hazelnut',
      'macadamia', 'pine nut', 'praline', 'nutella', 'marzipan',
    ],
    clearTags: [],
  },
  dairy: {
    label: 'dairy',
    conflictProteins: [],
    conflictKeywords: [
      'milk', 'cheese', 'butter', 'cream', 'yogurt', 'yoghurt', 'parmesan',
      'mozzarella', 'ricotta', 'custard', 'ghee', 'queso', 'alfredo', 'paneer',
    ],
    clearTags: ['vegan'],
  },
  egg: {
    label: 'eggs',
    conflictProteins: [],
    conflictKeywords: [
      'egg', 'benedict', 'omelet', 'omelette', 'frittata', 'mayonnaise', 'aioli',
      'meringue', 'custard', 'quiche', 'carbonara',
    ],
    clearTags: ['vegan'],
  },
  gluten: {
    label: 'gluten',
    conflictProteins: [],
    conflictKeywords: [
      'bread', 'bun', 'wheat', 'flour', 'pasta', 'noodle', 'toast', 'breaded',
      'tempura', 'barley', 'rye', 'cracker', 'crouton', 'pancake', 'waffle',
      'biscuit', 'pita', 'tortilla', 'dumpling',
    ],
    clearTags: ['gluten-free'],
  },
  soy: {
    label: 'soy',
    conflictProteins: [],
    conflictKeywords: ['soy', 'tofu', 'edamame', 'tempeh', 'miso', 'teriyaki'],
    clearTags: [],
  },
  sesame: {
    label: 'sesame',
    conflictProteins: [],
    conflictKeywords: ['sesame', 'tahini', 'hummus', 'halva'],
    clearTags: [],
  },
};

type ReligiousProfile = {
  label: string;
  /** name/description keywords that affirmatively VIOLATE the rule. */
  conflictKeywords: string[];
  /** protein_type values that affirmatively VIOLATE the rule. */
  conflictProteins: string[];
  /** protein_type values that affirmatively COMPLY with the rule. */
  clearProteins: string[];
  /** dietary_tags that affirmatively COMPLY with the rule. */
  clearTags: string[];
};

// Forbidden ingredients shared / specific to each rule. `ham` would collide
// with "hamburger"/"graham", so pork-via-ham relies on protein_type instead.
const PORK_KEYWORDS = [
  'pork', 'bacon', 'prosciutto', 'pancetta', 'pepperoni', 'chorizo', 'lard',
  'carnitas', 'guanciale', 'speck', 'salami', 'mortadella',
];
const ALCOHOL_KEYWORDS = [
  'wine', 'beer', 'rum', 'vodka', 'whiskey', 'whisky', 'bourbon', 'sake',
  'tequila', 'brandy', 'liqueur', 'champagne', 'prosecco', 'mimosa', 'sherry',
  'marsala', 'cognac',
];
const SHELLFISH_KEYWORDS = ALLERGEN_TABLE.shellfish.conflictKeywords;

const RELIGIOUS_TABLE: Record<'halal' | 'kosher', ReligiousProfile> = {
  halal: {
    label: 'halal',
    conflictKeywords: [...PORK_KEYWORDS, ...ALCOHOL_KEYWORDS],
    conflictProteins: ['pork'],
    // Fish/seafood need no ritual slaughter; vegetarian/vegan have no meat.
    clearProteins: ['fish', 'seafood', 'vegetarian', 'vegan'],
    clearTags: ['halal', 'vegan', 'vegetarian'],
  },
  kosher: {
    label: 'kosher',
    conflictKeywords: [...PORK_KEYWORDS, ...SHELLFISH_KEYWORDS],
    conflictProteins: ['pork', 'shellfish', 'seafood'],
    clearProteins: ['vegetarian', 'vegan'],
    clearTags: ['kosher', 'vegan', 'vegetarian'],
  },
};

// ---------------------------------------------------------------------------
// Matching helpers
// ---------------------------------------------------------------------------

const lc = (s: string) => s.toLowerCase();

/** All free-text on an item we can scan for ingredient keywords. */
function itemText(item: EnrichedItem): string {
  return lc([item.name, item.description, ...(item.ingredients ?? [])].filter(Boolean).join(' '));
}

const proteinsOf = (item: EnrichedItem): string[] => (item.protein_type ?? []).map(lc);
const tagsOf = (item: EnrichedItem): string[] => (item.dietary_tags ?? []).map(lc);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Keyword present at a left word-boundary. Boundary on the left stops
 * collisions like "ham" inside "graham"/"hamburger", while allowing the right
 * side to grow ("egg" → "eggs", "shrimp" → "shrimps").
 */
function hasKeyword(haystack: string, keyword: string): boolean {
  return new RegExp(`\\b${escapeRegExp(lc(keyword))}`).test(haystack);
}

/** True when the item carries a confident, specific (non-ambiguous) protein. */
function hasConfidentProtein(proteins: string[]): boolean {
  return proteins.length > 0 && proteins.every((p) => !AMBIGUOUS_PROTEINS.has(p));
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

function allergenProfile(allergen: string): AllergenProfile {
  const key = lc(allergen).replace(/[\s_-]+/g, '');
  // Normalize a few common synonyms onto table keys.
  const alias: Record<string, string> = {
    shellfish: 'shellfish',
    crustacean: 'shellfish',
    shrimp: 'shellfish',
    fish: 'fish',
    peanut: 'peanut',
    peanuts: 'peanut',
    treenut: 'treenut',
    treenuts: 'treenut',
    nuts: 'treenut',
    nut: 'treenut',
    dairy: 'dairy',
    milk: 'dairy',
    lactose: 'dairy',
    egg: 'egg',
    eggs: 'egg',
    gluten: 'gluten',
    wheat: 'gluten',
    soy: 'soy',
    soya: 'soy',
    sesame: 'sesame',
  };
  const resolved = alias[key] ?? key;
  return (
    ALLERGEN_TABLE[resolved] ?? {
      // Unknown allergen: no detection signal → everything is `unknown`
      // (→ blocked when severe, verify when mild). Conservative by design.
      label: lc(allergen),
      conflictProteins: [],
      conflictKeywords: [],
      clearTags: [],
    }
  );
}

function classifyAllergen(item: EnrichedItem, allergen: string): Classification {
  const profile = allergenProfile(allergen);
  const text = itemText(item);
  const proteins = proteinsOf(item);

  // CONFLICT — affirmative presence.
  if (profile.conflictKeywords.some((k) => hasKeyword(text, k))) return 'conflict';
  if (proteins.some((p) => profile.conflictProteins.includes(p))) return 'conflict';

  // CLEAR — affirmative absence.
  if (profile.clearTags.length > 0 && tagsOf(item).some((t) => profile.clearTags.includes(t))) {
    return 'clear';
  }
  // Protein-based allergens: a confident, specific, non-conflicting protein clears it.
  if (
    profile.conflictProteins.length > 0 &&
    hasConfidentProtein(proteins) &&
    !proteins.some((p) => profile.conflictProteins.includes(p))
  ) {
    return 'clear';
  }

  // UNKNOWN — no confident evidence either way. Never inferred as safe.
  return 'unknown';
}

function classifyReligious(item: EnrichedItem, rule: 'halal' | 'kosher'): Classification {
  const profile = RELIGIOUS_TABLE[rule];
  const text = itemText(item);
  const proteins = proteinsOf(item);

  // CONFLICT — affirmatively forbidden.
  if (profile.conflictKeywords.some((k) => hasKeyword(text, k))) return 'conflict';
  if (proteins.some((p) => profile.conflictProteins.includes(p))) return 'conflict';

  // CLEAR — affirmatively compliant.
  if (tagsOf(item).some((t) => profile.clearTags.includes(t))) return 'clear';
  if (
    hasConfidentProtein(proteins) &&
    proteins.every((p) => profile.clearProteins.includes(p))
  ) {
    return 'clear';
  }

  // UNKNOWN — e.g. land meat with no certification tag → must verify slaughter.
  return 'unknown';
}

/**
 * Classify a single item against a single constraint. Centralized entry point
 * for the per-constraint tag mapping so the safety logic is auditable here.
 */
export function classifyAgainstConstraint(
  item: EnrichedItem,
  constraint: HardConstraint
): Classification {
  return constraint.kind === 'allergen'
    ? classifyAllergen(item, constraint.allergen)
    : classifyReligious(item, constraint.rule);
}

// ---------------------------------------------------------------------------
// Outcome mapping + gate
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<FilterOutcome, number> = { allowed: 0, verify: 1, blocked: 2 };

function mostRestrictive(a: FilterOutcome, b: FilterOutcome): FilterOutcome {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

/** Map (classification, constraint) → outcome + optional human-readable reason. */
function outcomeFor(
  classification: Classification,
  constraint: HardConstraint
): { outcome: FilterOutcome; reason: string | null } {
  if (constraint.kind === 'allergen') {
    const name = allergenProfile(constraint.allergen).label;
    if (classification === 'conflict') return { outcome: 'blocked', reason: `contains ${name}` };
    if (classification === 'clear') return { outcome: 'allowed', reason: null };
    // unknown → we can't prove absence (common on name-only menus). Surface it
    // as a verify-with-staff item rather than blocking, so the user still gets
    // recommendations. Severe allergies get a stronger, mandatory warning.
    return constraint.severity === 'severe'
      ? { outcome: 'verify', reason: `MUST confirm this is free of ${name} with staff before ordering` }
      : { outcome: 'verify', reason: `could not verify absence of ${name} — ask staff` };
  }

  // religious
  const rule = constraint.rule;
  if (classification === 'conflict') {
    return { outcome: 'blocked', reason: `not ${rule} — contains a forbidden ingredient` };
  }
  if (classification === 'clear') return { outcome: 'allowed', reason: null };
  return { outcome: 'verify', reason: `could not verify ${rule} — ask staff` };
}

/**
 * Sort every item into allowed / verify / blocked against the user's hard
 * constraints. An item with multiple hits takes the MOST restrictive outcome
 * (blocked > verify > allowed) and accumulates every reason.
 *
 * No active constraints → everything is allowed (an empty set blocks nothing).
 */
export function applyHardGate(
  items: EnrichedItem[],
  constraints: HardConstraints
): FilterResult {
  if (!constraints || constraints.length === 0) {
    return { allowed: [...items], verify: [], blocked: [] };
  }

  const allowed: EnrichedItem[] = [];
  const verify: FilteredItem[] = [];
  const blocked: FilteredItem[] = [];

  for (const item of items) {
    let outcome: FilterOutcome = 'allowed';
    const reasons: string[] = [];

    for (const constraint of constraints) {
      const classification = classifyAgainstConstraint(item, constraint);
      const result = outcomeFor(classification, constraint);
      outcome = mostRestrictive(outcome, result.outcome);
      if (result.reason) reasons.push(result.reason);
    }

    if (outcome === 'blocked') blocked.push({ item, outcome, reasons });
    else if (outcome === 'verify') verify.push({ item, outcome, reasons });
    else allowed.push(item);
  }

  return { allowed, verify, blocked };
}
