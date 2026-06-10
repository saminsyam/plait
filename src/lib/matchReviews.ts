/**
 * On-device fuzzy matching between review-sourced crowd-favorite dish names
 * and the scanned menu's items. Pure string work — ZERO tokens. A match links
 * the crowd-favorites tile to real menu items and lets the ranking call cite
 * "reviewers love this" for items that are actually orderable.
 *
 * Also home to the lookup page's hard-constraint check: crowd-favorite NAMES
 * are string-matched against the user's constraints via the dietaryFilter
 * patterns (no model call). Only affirmative conflicts warn — a name-only
 * dish list can't prove absence, and a preview page shouldn't cry wolf on
 * every unknown.
 */
import type { CrowdFavorite } from './callReviews';
import {
  classifyAgainstConstraint,
  type HardConstraints,
} from './dietaryFilter';
import type { MenuItem } from './types';

// ---------------------------------------------------------------------------
// Fuzzy dish matching
// ---------------------------------------------------------------------------

/** Connective / filler words that carry no dish identity. */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'de', 'house', 'la', 'of', 'on', 'our', 'special', 'style', 'the', 'with',
]);

/** Lowercase, strip accents and punctuation, drop stopwords. */
function dishTokens(name: string): Set<string> {
  const cleaned = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return new Set(cleaned.split(' ').filter((t) => t !== '' && !STOPWORDS.has(t)));
}

function isSubset(small: Set<string>, big: Set<string>): boolean {
  for (const t of small) if (!big.has(t)) return false;
  return true;
}

/**
 * Score how well a review dish name matches a menu item name:
 *   3 — identical token sets ("Tea Leaf Salad" vs "tea-leaf salad")
 *   2 — one set contains the other ("Mohinga" vs "Mohinga Fish Soup")
 *   0 — anything else (partial overlap is NOT a match: "Coconut Rice" must
 *       not light up "Coconut Chicken Soup")
 * Ties at level 2 are broken by token-count closeness.
 */
function matchScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const subset = a.size <= b.size ? isSubset(a, b) : isSubset(b, a);
  if (!subset) return 0;
  return a.size === b.size ? 3 : 2;
}

export type FavoriteMatch = {
  favorite: CrowdFavorite;
  /** Matched menu item id, or null when the dish isn't on the scanned menu. */
  itemId: string | null;
};

/**
 * Match each crowd favorite to at most one menu item (and each item to at
 * most one favorite — best score wins, earlier favorite wins ties).
 */
export function matchCrowdFavorites(
  favorites: CrowdFavorite[],
  items: MenuItem[]
): FavoriteMatch[] {
  const itemTokens = items.map((i) => ({ id: i.id, tokens: dishTokens(i.name) }));
  const taken = new Set<string>();

  return favorites.map((favorite) => {
    const favTokens = dishTokens(favorite.name);
    let best: { id: string; score: number; sizeDiff: number } | null = null;
    for (const it of itemTokens) {
      if (taken.has(it.id)) continue;
      const score = matchScore(favTokens, it.tokens);
      if (score === 0) continue;
      const sizeDiff = Math.abs(favTokens.size - it.tokens.size);
      if (!best || score > best.score || (score === best.score && sizeDiff < best.sizeDiff)) {
        best = { id: it.id, score, sizeDiff };
      }
    }
    if (best) taken.add(best.id);
    return { favorite, itemId: best ? best.id : null };
  });
}

// ---------------------------------------------------------------------------
// Hard-constraint warning for review-only dish names (lookup flow)
// ---------------------------------------------------------------------------

/**
 * Inline ⚠️ text when a crowd-favorite NAME affirmatively conflicts with the
 * user's hard constraints (e.g. "Garlic Shrimp" vs a shellfish allergy), or
 * null. Uses the dietaryFilter keyword patterns by probing with a name-only
 * item; this is a heads-up for a page with no menu, NOT the safety gate — the
 * real applyHardGate still runs on every scanned menu.
 */
export function crowdFavoriteWarning(
  dishName: string,
  constraints: HardConstraints
): string | null {
  if (!constraints || constraints.length === 0) return null;
  const probe: MenuItem = {
    id: 'review-probe',
    name: dishName,
    price: 0,
    description: '',
    ingredients: [],
    flavor_profile: [],
    texture: [],
    spice_level: 0,
    dietary_tags: [],
    protein_type: [],
    category: '',
    cuisine_type: '',
  };
  const hits = constraints
    .filter((c) => classifyAgainstConstraint(probe, c) === 'conflict')
    .map((c) =>
      c.kind === 'allergen'
        ? `likely contains ${c.allergen}`
        : `likely not ${c.rule}`
    );
  return hits.length > 0 ? hits.join(' · ') : null;
}
