/**
 * Pure TypeScript menu analysis. No API calls — runs instantly and
 * deterministically. Given the parsed menu items, work out which dimensions
 * actually split this menu so we can ask smart, menu-aware questions.
 */
import type { HighSignalDimension, MenuContext, MenuItem } from './types';

export const SEAFOOD_KEYWORDS: Record<string, string[]> = {
  salmon: ['salmon', 'sake'],
  tuna: ['tuna', 'maguro'],
  albacore: ['albacore', 'white tuna'],
  shrimp: ['shrimp', 'ebi', 'tempura'],
  crab: ['crab', 'kani'],
  scallop: ['scallop', 'hotate'],
  eel: ['eel', 'unagi'],
  yellowtail: ['yellowtail', 'hamachi'],
};

export const COOKING_STYLE_KEYWORDS: Record<string, string[]> = {
  baked: ['baked'],
  fried: ['fried', 'crispy', 'tempura', 'panko'],
  raw: ['raw', 'sashimi'],
  karahi: ['karahi', 'kadai'],
  tandoor: ['tandoor', 'tikka', 'tandoori', 'seekh'],
  nihari: ['nihari', 'slow cooked'],
  korma: ['korma', 'creamy'],
  biryani: ['biryani', 'pulao'],
  taco: ['taco'],
  burrito: ['burrito'],
  bowl: ['bowl'],
  grilled: ['grilled', 'kebab', 'kofta'],
};

const UNIFORM_THRESHOLD = 0.9;
const MIN_ELIMINATION_POWER = 0.15;

/**
 * Gini–Simpson diversity over a distribution of counts.
 * elimination_power = 1 - sum(proportion^2).
 * A 50/50 split ≈ 0.5, a 90/10 split ≈ 0.18, a single bucket = 0.
 */
function eliminationPower(counts: Record<string, number>): number {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  let sumSq = 0;
  for (const n of Object.values(counts)) {
    const p = n / total;
    sumSq += p * p;
  }
  return 1 - sumSq;
}

function itemText(item: MenuItem): string {
  return `${item.name} ${item.description}`.toLowerCase();
}

/** Count items whose text matches at least one keyword for each category. */
function keywordSplit(
  items: MenuItem[],
  keywordMap: Record<string, string[]>
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const text = itemText(item);
    for (const [category, keywords] of Object.entries(keywordMap)) {
      if (keywords.some((kw) => text.includes(kw))) {
        counts[category] = (counts[category] ?? 0) + 1;
      }
    }
  }
  return counts;
}

function spiceBucket(level: number): 'none' | 'mild' | 'medium' | 'hot' {
  if (level <= 0) return 'none';
  if (level <= 2) return 'mild';
  if (level <= 3) return 'medium';
  return 'hot';
}

/** Distribution of a multi-valued string field across items. */
function multiSplit(items: MenuItem[], pick: (i: MenuItem) => string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    for (const v of pick(item)) {
      const key = v.toLowerCase().trim();
      if (!key) continue;
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return counts;
}

export function analyzeMenu(items: MenuItem[]): MenuContext {
  const totalItems = items.length;

  const spice_distribution = { none: 0, mild: 0, medium: 0, hot: 0 };
  for (const item of items) {
    spice_distribution[spiceBucket(item.spice_level ?? 0)] += 1;
  }

  const protein_split = multiSplit(items, (i) => i.protein_type ?? []);
  const texture_split = multiSplit(items, (i) => i.texture ?? []);

  // Cuisine: usually one dominant value across a single restaurant's menu.
  const cuisineCounts = multiSplit(items, (i) => (i.cuisine_type ? [i.cuisine_type] : []));
  const cuisine_type =
    Object.entries(cuisineCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown';

  // --- Uniform traits: anything shared by >90% of items. We never ask about these.
  const uniform_traits: string[] = [];
  const dominantProtein = Object.entries(protein_split).sort((a, b) => b[1] - a[1])[0];
  const proteinIsUniform =
    !!dominantProtein && dominantProtein[1] / totalItems > UNIFORM_THRESHOLD;
  if (proteinIsUniform) uniform_traits.push(`protein:${dominantProtein[0]}`);

  const dietary_split = multiSplit(items, (i) => i.dietary_tags ?? []);
  for (const [tag, n] of Object.entries(dietary_split)) {
    if (n / totalItems > UNIFORM_THRESHOLD) uniform_traits.push(`dietary:${tag}`);
  }
  if (Object.keys(cuisineCounts).length === 1) uniform_traits.push(`cuisine:${cuisine_type}`);

  // --- Sub-protein: only meaningful when one protein dominates (e.g. all seafood).
  let sub_protein_split: Record<string, number> | null = null;
  if (proteinIsUniform && /seafood|fish/.test(dominantProtein[0])) {
    const seafood = keywordSplit(items, SEAFOOD_KEYWORDS);
    if (Object.keys(seafood).length >= 2) sub_protein_split = seafood;
  }

  // --- Cooking style: scan names/descriptions for cooking-method keywords.
  const cookingRaw = keywordSplit(items, COOKING_STYLE_KEYWORDS);
  const cooking_style_split = Object.keys(cookingRaw).length >= 2 ? cookingRaw : null;

  // --- Score candidate dimensions by how evenly they split the menu.
  const candidates: Array<{ dimension: string; counts: Record<string, number> }> = [
    { dimension: 'spice', counts: spice_distribution },
    { dimension: 'protein', counts: protein_split },
    { dimension: 'texture', counts: texture_split },
  ];
  if (sub_protein_split) candidates.push({ dimension: 'sub_protein', counts: sub_protein_split });
  if (cooking_style_split)
    candidates.push({ dimension: 'cooking_style', counts: cooking_style_split });

  const high_signal_dimensions: HighSignalDimension[] = candidates
    .map(({ dimension, counts }) => ({
      dimension,
      elimination_power: eliminationPower(counts),
      // Only options that actually appear on this menu (non-zero count).
      options_present: Object.entries(counts)
        .filter(([, n]) => n > 0)
        .map(([k]) => k),
    }))
    // Don't ask about dimensions that are effectively uniform or single-valued.
    .filter(
      (d) => d.elimination_power >= MIN_ELIMINATION_POWER && d.options_present.length >= 2
    )
    .sort((a, b) => b.elimination_power - a.elimination_power);

  return {
    totalItems,
    cuisine_type,
    spice_distribution,
    protein_split,
    texture_split,
    sub_protein_split,
    cooking_style_split,
    uniform_traits,
    high_signal_dimensions,
  };
}
