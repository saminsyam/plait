/**
 * Per-menu budget ceiling — the brain behind the results screen's budget
 * slider. Pure and on-device (zero tokens), same philosophy as the spice
 * trim: the slider's range comes from THIS menu's actual prices, the filter
 * runs over the gate's survivors before ranking, and the model only gets one
 * short context line ("keep it under $24").
 *
 * Conservative invariants, mirroring quickTune:
 *   - Unpriced dishes (price 0) always survive — no price is not a price.
 *   - A ceiling that would empty the pool is ignored (keep recommending).
 *   - Menus with <2 distinct prices get no slider at all — nothing to slice.
 */
import type { MenuItem } from './types';

export type BudgetBounds = {
  /** Slider minimum — the cheapest priced dish, rounded down to a step. */
  min: number;
  /** Slider maximum — the priciest dish, rounded up to a step. At max the
   *  slider reads "No limit" and no filter applies. */
  max: number;
  /** Snap increment ($1 on tight menus, $5 once the spread is wide). */
  step: number;
};

/**
 * Derive the slider's range from the pool's prices, or null when a budget
 * question isn't worth asking (fewer than 2 priced dishes, or all priced
 * dishes cost the same).
 */
export function budgetBounds(pool: MenuItem[]): BudgetBounds | null {
  const prices = pool.map((i) => i.price).filter((p) => p > 0);
  if (prices.length < 2) return null;
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  if (lo === hi) return null;
  const step = hi - lo > 30 ? 5 : 1;
  return {
    min: Math.floor(lo / step) * step,
    max: Math.ceil(hi / step) * step,
    step,
  };
}

/**
 * Keep dishes at or under the ceiling; unpriced dishes always stay. A null
 * ceiling (slider at "No limit") and a ceiling that would strand the user
 * both return the pool unchanged.
 */
export function filterByBudget(pool: MenuItem[], ceiling: number | null): MenuItem[] {
  if (ceiling == null) return pool;
  const kept = pool.filter((i) => i.price === 0 || i.price <= ceiling);
  return kept.length > 0 ? kept : pool;
}

/** The one context line for the ranking call, or null at "No limit". */
export function budgetRequest(ceiling: number | null): string | null {
  return ceiling == null ? null : `keep each dish under $${ceiling}`;
}
