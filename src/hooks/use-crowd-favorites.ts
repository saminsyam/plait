/**
 * Crowd-favorites lifecycle for the picks screen — Sushi 2.1 folds online
 * reviews into the *Popular* result. On scan we check the review cache for
 * free, and when there's nothing cached we fire ONE review search (~$0.02).
 *
 * Matching returned dish names to scanned items is pure on-device string work
 * (zero tokens), and the dietary gate still rules: a review favorite that maps
 * to a gate-BLOCKED dish never enters the rankable map — honest data, same
 * safety invariant.
 *
 * `crowdReady` flips true once the local review CACHE check resolves — the
 * Popular rank waits only for that, so it renders instantly (with cached
 * reviews folded in when present). When nothing is cached the rank runs on the
 * dietary profile alone and the background search folds its results in a beat
 * later: `crowdMap` / `crowdEntries` update, so the ★ badges and reviewer
 * blurbs simply appear on the already-shown cards (no re-rank, no shuffle).
 * The hook returns `crowdMap` (itemId → name) directly so the rank reads the
 * resolved cache without a cross-provider race.
 */
import { useEffect, useRef, useState } from 'react';

import { callReviews, getCachedReviews, type ReviewsResult } from '@/engine/callReviews';
import {
  gateCrowdFavorites,
  matchCrowdFavorites,
  type GatedFavorite,
} from '@/engine/matchReviews';
import { useSession } from '@/state/session';

export function useCrowdFavorites(): {
  /** Loaded review favorites (empty until the cache or the fetch lands). */
  crowdEntries: GatedFavorite[];
  /** itemId → crowd-favorite name, gated (blocked dishes excluded). */
  crowdMap: Record<string, string>;
  /** True once the local cache check resolves — the Popular rank waits on this. */
  crowdReady: boolean;
} {
  const { menuContext, items, blocked } = useSession();
  const restaurantName = menuContext?.restaurant_name.trim() ?? '';

  const [crowdEntries, setCrowdEntries] = useState<GatedFavorite[]>([]);
  const [crowdMap, setCrowdMap] = useState<Record<string, string>>({});
  const [crowdReady, setCrowdReady] = useState(false);
  // One search per restaurant, even across re-renders of the screen.
  const fetchedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!restaurantName) {
      setCrowdReady(true);
      return;
    }
    let active = true;

    // Fold a cached/fetched result into the badges + the rankable map. Blocked
    // matches stay out of the map so a blocked dish can never be cited.
    const applyReviews = (r: ReviewsResult) => {
      if (!active || !r.found) return;
      const { entries, rankable } = gateCrowdFavorites(
        matchCrowdFavorites(r.crowd_favorites, items),
        blocked
      );
      setCrowdMap(rankable);
      setCrowdEntries(entries);
    };

    (async () => {
      const cached = await getCachedReviews(restaurantName);
      if (!active) return;
      if (cached) applyReviews(cached);
      // Ready as soon as the cache check resolves — the Popular rank fires now
      // (instant), with cached reviews folded in when present.
      setCrowdReady(true);
      if (cached) return;
      // Nothing cached → one background search; its results fold in a beat
      // later as ★ badges + blurbs on the already-shown cards (no re-rank). A
      // dry or failed search just means no badges — never an error UI.
      if (fetchedFor.current === restaurantName) return;
      fetchedFor.current = restaurantName;
      try {
        applyReviews(await callReviews(restaurantName, ''));
      } catch {
        // Offline / search failed — the picks stand on their own.
      }
    })();

    return () => {
      active = false;
    };
  }, [restaurantName, items, blocked]);

  return { crowdEntries, crowdMap, crowdReady };
}
