/**
 * Deterministic bridge pick for the adventurous lens ("Surprise me") — zero tokens.
 * An `allowed`-only candidate outside the current picks (verify items never
 * stretch: stretch requires HIGHER confidence, never lower), preferring house
 * signatures and dishes sharing a flavor lane with the hero so the unfamiliar
 * item has a bridge back to something the ranker already matched.
 */
import type { MenuItem, Pick } from './types';

export type BridgePickInput = {
  picks: Pick[];
  /** The gate's survivors (allowed + verify). */
  candidates: MenuItem[];
  /** item_id → ask-staff reasons; anything listed here never stretches. */
  verifyById: Record<string, string[]>;
  /** House signature dishes from the orientation pass. */
  signatureIds: string[];
  byId: Map<string, MenuItem>;
};

export function bridgePick({
  picks,
  candidates,
  verifyById,
  signatureIds,
  byId,
}: BridgePickInput): { item: MenuItem; why: string } | null {
  const picked = new Set(picks.map((p) => p.item_id));
  const hero = picks.length > 0 ? byId.get(picks[0].item_id) : undefined;
  const sigs = new Set(signatureIds);
  const pool = candidates.filter((c) => !picked.has(c.id) && !(verifyById[c.id]?.length));
  if (pool.length === 0) return null;

  const shared = (c: MenuItem) =>
    hero ? c.flavor_profile.filter((f) => hero.flavor_profile.includes(f)) : [];
  const score = (c: MenuItem) => (sigs.has(c.id) ? 2 : 0) + Math.min(2, shared(c).length);
  const sorted = [...pool].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
  const item = sorted[0];

  const bridge = shared(item);
  const why =
    hero && bridge.length > 0
      ? `New to you — shares the ${bridge[0]} lane of the ${hero.name}, a low-risk doorway.`
      : sigs.has(item.id)
        ? 'New to you — a house signature that still clears your gate.'
        : 'New to you — a different lane on this menu that still clears your gate.';
  return { item, why };
}
