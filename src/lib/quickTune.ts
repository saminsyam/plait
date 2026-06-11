/**
 * Quick-tune chips for the picks screen — one-tap corrections that are far
 * lighter than the full refine flow. Each chip is a deterministic, on-device
 * pool filter (zero tokens; identity for context-only chips) plus ONE short
 * request line for the re-rank call.
 *
 * Chips only ever narrow the gate's survivors — they can never resurrect a
 * blocked item — and every filter falls back to the unfiltered pool rather
 * than stranding the user with nothing.
 */
import { classifyAgainstConstraint } from './dietaryFilter';
import type { MenuItem } from './types';

export type QuickTuneId = 'lighter' | 'protein' | 'cheaper' | 'no_seafood';

export type QuickTune = {
  id: QuickTuneId;
  /** Chip label, shown verbatim. */
  label: string;
  /** Deterministic pool filter. Identity for context-only chips. */
  filter: (pool: MenuItem[]) => MenuItem[];
  /** Short request line added to the re-rank context. */
  request: string;
};

/** Seafood detection reuses the audited dietaryFilter keyword patterns. */
function isSeafood(item: MenuItem): boolean {
  return (
    classifyAgainstConstraint(item, { kind: 'allergen', allergen: 'shellfish', severity: 'mild' }) ===
      'conflict' ||
    classifyAgainstConstraint(item, { kind: 'allergen', allergen: 'fish', severity: 'mild' }) ===
      'conflict'
  );
}

/**
 * Keep the cheaper half: dishes at or below the median of the priced items.
 * Unpriced items (price 0) stay — absence of a price isn't evidence of cost.
 * Fewer than 2 priced items → nothing meaningful to split on.
 */
function cheaperHalf(pool: MenuItem[]): MenuItem[] {
  const priced = pool
    .map((i) => i.price)
    .filter((p) => p > 0)
    .sort((a, b) => a - b);
  if (priced.length < 2) return pool;
  const median = priced[Math.floor((priced.length - 1) / 2)];
  return pool.filter((i) => i.price === 0 || i.price <= median);
}

export const QUICK_TUNES: QuickTune[] = [
  {
    id: 'lighter',
    label: '🥗 Lighter',
    filter: (pool) =>
      pool.filter((i) => !i.flavor_profile.includes('rich') && i.category !== 'dessert'),
    request: 'something lighter — fresh over heavy',
  },
  {
    id: 'protein',
    label: '💪 More protein',
    // Grams aren't known before ranking, so this chip is context-only.
    filter: (pool) => pool,
    request: 'maximize protein',
  },
  {
    id: 'cheaper',
    label: '💸 Cheaper',
    filter: cheaperHalf,
    request: 'keep the price down',
  },
  {
    id: 'no_seafood',
    label: '🐟 No seafood',
    filter: (pool) => pool.filter((i) => !isSeafood(i)),
    request: 'no seafood today',
  },
];

/**
 * Apply the active chips' filters in order. Any filter that would empty the
 * pool is skipped (keep recommending > obey the chip).
 */
export function applyQuickTunes(pool: MenuItem[], ids: QuickTuneId[]): MenuItem[] {
  let out = pool;
  for (const id of ids) {
    const tune = QUICK_TUNES.find((t) => t.id === id);
    if (!tune) continue;
    const next = tune.filter(out);
    if (next.length > 0) out = next;
  }
  return out;
}

/** The request lines for the active chips, for the re-rank context. */
export function tuneRequests(ids: QuickTuneId[]): string[] {
  return ids
    .map((id) => QUICK_TUNES.find((t) => t.id === id)?.request)
    .filter((r): r is string => !!r);
}
