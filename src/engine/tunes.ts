/**
 * Tune chips — the persistent bottom row on the picks screen (v2 spec §5):
 * `$ lower` · `Light meal` · `Safe bet` · `Surprise me`. One chip active at a
 * time; tapping it again clears back to the model's order.
 *
 * Each chip is a deterministic re-deal of the CURRENT ranked picks — pure
 * reordering on-device, zero tokens, instant (spec §2.5). Chips never pull in
 * unranked dishes and never touch the gate: they only rearrange what the
 * ranker already explained, so every card keeps its honest "why".
 */
import type { MenuItem, Pick } from './types';

export type TuneId = 'price' | 'light' | 'safe' | 'surprise';

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

/** Re-deal the picks for one chip (null = the ranker's original order). */
export function applyTune(tune: TuneId | null, deal: DealEntry[]): DealEntry[] {
  const out = [...deal];
  switch (tune) {
    case 'price':
      out.sort((a, b) => priceKey(a) - priceKey(b));
      break;
    case 'light':
      out.sort((a, b) => lightKey(a) - lightKey(b));
      break;
    case 'safe':
      out.sort(
        (a, b) =>
          Number(a.needsVerify) - Number(b.needsVerify) ||
          b.pick.match_score - a.pick.match_score
      );
      break;
    case 'surprise':
      out.reverse();
      break;
    case null:
      break;
  }
  return out;
}
