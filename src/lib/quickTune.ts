/**
 * Quick-tune chips for the picks screen — one-tap corrections that are far
 * lighter than the full refine flow. Each chip is a deterministic, on-device
 * pool filter (zero tokens; identity for context-only chips) plus ONE short
 * request line for the re-rank call.
 *
 * Chips only ever narrow (or reorder) the gate's survivors — they can never
 * resurrect a blocked item — and every filter falls back to the unfiltered
 * pool rather than stranding the user with nothing.
 */
import { classifyAgainstConstraint } from './dietaryFilter';
import { PROTEIN_VALUE_REQUEST, sortByProteinValue } from './proteinValue';
import type { MenuItem } from './types';

export type QuickTuneId = 'lighter' | 'protein_value' | 'no_seafood';

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

export const QUICK_TUNES: QuickTune[] = [
  {
    id: 'lighter',
    label: '🥗 Lighter',
    filter: (pool) =>
      pool.filter((i) => !i.flavor_profile.includes('rich') && i.category !== 'dessert'),
    request: 'something lighter — fresh over heavy',
  },
  {
    id: 'protein_value',
    label: '💪 Protein per $',
    // Reorder, never drop: value candidates first, best est. ratio leading,
    // so the ranker reads the pool best-gains-per-dollar first.
    filter: sortByProteinValue,
    request: PROTEIN_VALUE_REQUEST,
  },
  // Price moved to the budget slider (lib/budget) — a real dollar ceiling
  // derived from the menu beats a blind cheaper-half cut.
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
