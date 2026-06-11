/**
 * Protein-per-dollar value sort — "gains per dollar" for the macro crowd.
 *
 * Pure and on-device, same philosophy as lib/budget: the enrichment pass
 * estimates each dish's protein (MenuItem.protein_g_est, a name-only guess),
 * and this module turns that into a deterministic ordering plus ONE context
 * line for the ranking call. Zero extra tokens at tune time.
 *
 * Honesty rules:
 *   - No price, or no protein estimate → no ratio. Never guess either side.
 *   - Cheap sides skew the math (a $4 egg side "beats" every entrée), so a
 *     dish only counts as a value candidate if it reads like a meal: category
 *     "main", or an estimated MIN_MEAL_PROTEIN_G+ grams of protein.
 *   - The sort reorders; it never drops. Ineligible dishes keep their relative
 *     order after the eligible ones, so the ranker still sees the whole pool.
 */
import type { MenuItem } from './types';

/** Below this estimate a non-main is a snack, not a meal — skip its ratio. */
export const MIN_MEAL_PROTEIN_G = 20;

/**
 * Estimated grams of protein per dollar, or null when either side is unknown
 * (price 0 / "market price", or no enrichment estimate).
 */
export function proteinPerDollar(item: MenuItem): number | null {
  const est = item.protein_g_est ?? 0;
  if (est <= 0 || item.price <= 0) return null;
  return est / item.price;
}

/** A dish the value sort should rank: has a ratio AND reads like a meal. */
export function isValueCandidate(item: MenuItem): boolean {
  if (proteinPerDollar(item) === null) return false;
  return item.category === 'main' || (item.protein_g_est ?? 0) >= MIN_MEAL_PROTEIN_G;
}

/**
 * Value candidates first (best ratio first), everything else after in its
 * original order. Same pool in, same pool out — sorting only.
 */
export function sortByProteinValue(pool: MenuItem[]): MenuItem[] {
  const eligible = pool
    .filter(isValueCandidate)
    .sort((a, b) => (proteinPerDollar(b) ?? 0) - (proteinPerDollar(a) ?? 0));
  const rest = pool.filter((i) => !isValueCandidate(i));
  return [...eligible, ...rest];
}

/** The one context line for the ranking call when value mode is on. */
export const PROTEIN_VALUE_REQUEST =
  'maximize protein per dollar — items carry a rough "protein_g_est" and are ' +
  'pre-sorted best-value first; prefer real meals over cheap sides';

/**
 * Badge text for a pick card, from the RANKER's protein estimate (better than
 * the name-only enrichment guess) and the menu price. Null when either side
 * is unknown. One decimal — these are estimates, not lab values.
 */
export function proteinValueLabel(proteinG: number | null, price: number): string | null {
  if (proteinG == null || proteinG <= 0 || price <= 0) return null;
  return `~${(proteinG / price).toFixed(1)}g protein/$`;
}
