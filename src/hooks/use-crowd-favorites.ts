/**
 * Crowd-favorites lifecycle for the picks screen — Sushi 2.1 makes it fully
 * automatic: check the review cache for free, and when there's nothing cached
 * fire ONE background review search (~$0.02) without blocking anything. The
 * ★ crowd-favorite badges simply appear on the cards when the data lands.
 *
 * Matching returned dish names to scanned items is pure on-device string work
 * (zero tokens), and the dietary gate still rules: a review favorite that maps
 * to a gate-BLOCKED dish never enters the session map the ranking context
 * reads — honest data, same safety invariant.
 *
 * `crowdReady` flips true once the initial cache check has resolved — the
 * instant rank waits for it so CACHED crowd favorites make it into the very
 * first ranking call instead of racing it. The background fetch is never
 * waited on; its names only feed later re-ranks (refine).
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
  /** True once the (local, fast) cache check has resolved. */
  crowdReady: boolean;
} {
  const { menuContext, items, blocked, setCrowdFavorites } = useSession();
  const restaurantName = menuContext?.restaurant_name.trim() ?? '';

  const [crowdEntries, setCrowdEntries] = useState<GatedFavorite[]>([]);
  const [crowdReady, setCrowdReady] = useState(false);
  // One background search per restaurant, even across re-renders of the screen.
  const fetchedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!restaurantName) {
      setCrowdReady(true);
      return;
    }
    let active = true;

    // Fold a cached/fetched result into the badges + the session map the
    // ranking call reads. Blocked matches stay out of the rankable map.
    const applyReviews = (r: ReviewsResult) => {
      if (!active || !r.found) return;
      const { entries, rankable } = gateCrowdFavorites(
        matchCrowdFavorites(r.crowd_favorites, items),
        blocked
      );
      setCrowdFavorites(rankable);
      setCrowdEntries(entries);
    };

    (async () => {
      const cached = await getCachedReviews(restaurantName);
      if (!active) return;
      if (cached) {
        applyReviews(cached);
        setCrowdReady(true);
        return;
      }
      setCrowdReady(true);
      // Nothing cached → one silent background search; badges pop in when it
      // lands. A dry or failed search just means no badges — never an error UI.
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
  }, [restaurantName, items, blocked, setCrowdFavorites]);

  return { crowdEntries, crowdReady };
}
