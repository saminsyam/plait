/**
 * Tune chips — the persistent bottom row on the picks screen (v2 spec §5):
 * `$ lower` · `Light meal` · `Safe bet` · `Surprise me`. One chip active at a
 * time; tapping it again clears back to the model's order.
 *
 * The ranker returns a SLATE of up to 8 picks, each tagged with the tunes it
 * genuinely suits (judged from ingredient/preparation context in the one rank
 * call we already pay for). A chip is a deterministic SELECTION from that
 * slate — suited picks first, ordered by the tune's own key, the rest as
 * backfill — so tapping a chip can change which dishes appear, not just their
 * order. Still pure on-device work: zero tokens, instant (spec §2.5), and
 * every card keeps the ranker's honest "why". Chips never touch the gate.
 */
import type { MenuItem, Pick, TuneSuit } from './types';

/** Chip ids ARE the model-facing suit tags — one vocabulary, can't drift. */
export type TuneId = TuneSuit;

export const TUNES: { id: TuneId; label: string }[] = [
  { id: 'price', label: '$ lower' },
  { id: 'light', label: 'Light meal' },
  { id: 'safe', label: 'Safe bet' },
  { id: 'surprise', label: 'Surprise me' },
];

/** One ranked pick joined with its menu item; the screen precomputes verify. */
export type DealEntry = {
  pick: Pick;
  item: MenuItem;
  /** True when the dish carries any ask-staff reason or safety flag. */
  needsVerify: boolean;
};

/** Price for sorting — unpriced (0) dishes sort last, not first. */
function priceKey(e: DealEntry): number {
  return e.item.price > 0 ? e.item.price : Number.POSITIVE_INFINITY;
}

/**
 * "Light" = lowest carbs+fat. Macros are model estimates that can be null;
 * dishes we can't weigh sort last rather than masquerading as light.
 */
function lightKey(e: DealEntry): number {
  const { carbs_g, fat_g } = e.pick;
  if (carbs_g == null || fat_g == null) return Number.POSITIVE_INFINITY;
  return carbs_g + fat_g;
}

/** Per-tune ordering within each partition (suited, then backfill). */
function compareFor(tune: TuneId): (a: DealEntry, b: DealEntry) => number {
  switch (tune) {
    case 'price':
      return (a, b) => priceKey(a) - priceKey(b);
    case 'light':
      return (a, b) => lightKey(a) - lightKey(b);
    case 'safe':
      return (a, b) =>
        Number(a.needsVerify) - Number(b.needsVerify) || b.pick.match_score - a.pick.match_score;
    case 'surprise':
      // Deepest cuts first — generalizes the old `.reverse()` and guarantees
      // the deal differs from the default top-3.
      return (a, b) => b.pick.rank - a.pick.rank;
  }
}

/**
 * Re-deal the slate for one chip (null = the ranker's original order). The
 * model's contextual judgment leads: picks tagged for the tune come first,
 * ordered by the tune's deterministic key; untagged picks backfill in the same
 * order. With no tags at all (model noise) this degrades to a pure
 * deterministic sort — exactly the old behavior. Never mutates the input.
 */
export function applyTune(tune: TuneId | null, deal: DealEntry[]): DealEntry[] {
  if (tune === null) return [...deal];
  const suited = deal.filter((e) => e.pick.suits.includes(tune));
  const rest = deal.filter((e) => !e.pick.suits.includes(tune));
  const cmp = compareFor(tune);
  return [...suited.sort(cmp), ...rest.sort(cmp)];
}

/**
 * Budget ceiling — a deterministic, ZERO-TOKEN price filter on the already
 * ranked slate (no re-rank, no model call). Keeps picks at or under `ceiling`;
 * unpriced dishes (price 0 = unknown) are always kept rather than hidden on a
 * guess. `null` ceiling = off. Order is preserved so a tune/keto lens still
 * controls ordering downstream. Never strands the user: if every priced pick
 * is over budget, the single cheapest priced pick is kept as a floor so the
 * deal always has a hero. Never mutates the input.
 */
export function applyBudget(deal: DealEntry[], ceiling: number | null): DealEntry[] {
  if (ceiling === null) return [...deal];
  const under = deal.filter((e) => e.item.price === 0 || e.item.price <= ceiling);
  if (under.length > 0) return under;
  const priced = deal.filter((e) => e.item.price > 0);
  if (priced.length === 0) return [...deal];
  const cheapest = priced.reduce((a, b) => (b.item.price < a.item.price ? b : a));
  return [cheapest];
}
