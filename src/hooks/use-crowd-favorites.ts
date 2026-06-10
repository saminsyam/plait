/**
 * Crowd-favorites lifecycle for the post-scan screen: check the review cache
 * for free, offer a tap-to-fetch (~$0.02) when there's nothing cached, match
 * returned dish names to scanned items on-device (zero tokens), and record
 * the matches into the session so the ranking call can cite them.
 *
 * Returns the tile state the shared <RestaurantSummary> renders. Owns its own
 * useProgressSteps so the tile's loading line shows the REAL latest pipeline
 * status — independent of any other progress stream on the screen.
 */
import { useCallback, useEffect, useState } from 'react';

import type { CrowdFavoriteEntry, CrowdFavoritesState } from '@/components/restaurant-summary';
import { useProgressSteps } from '@/hooks/use-progress-steps';
import { callReviews, getCachedReviews, type ReviewsResult } from '@/lib/callReviews';
import { matchCrowdFavorites } from '@/lib/matchReviews';
import { useSession } from '@/state/session';

/** Where the crowd-favorites tile is in its lifecycle. */
type ReviewPhase =
  | { status: 'hidden' } // no restaurant name read → nothing to search for
  | { status: 'offer' } // nothing cached → tap-to-fetch
  | { status: 'loading' }
  | { status: 'loaded'; entries: CrowdFavoriteEntry[] }
  | { status: 'empty' } // search ran dry
  | { status: 'error' };

export function useCrowdFavorites(): CrowdFavoritesState {
  const { menuContext, items, setCrowdFavorites } = useSession();
  const restaurantName = menuContext?.restaurant_name.trim() ?? '';

  const [reviewPhase, setReviewPhase] = useState<ReviewPhase>({ status: 'hidden' });
  const { steps, onProgress, resetProgress } = useProgressSteps();

  // Fold a fetched/cached review result into the tile + the session map the
  // ranking call reads. Matching is pure string work — zero tokens.
  const applyReviews = useCallback(
    (r: ReviewsResult) => {
      if (!r.found) {
        setReviewPhase({ status: 'empty' });
        return;
      }
      const matches = matchCrowdFavorites(r.crowd_favorites, items);
      setCrowdFavorites(
        Object.fromEntries(
          matches.filter((m) => m.itemId !== null).map((m) => [m.itemId as string, m.favorite.name])
        )
      );
      setReviewPhase({
        status: 'loaded',
        entries: matches.map((m) => ({
          name: m.favorite.name,
          blurb: m.favorite.blurb,
          onMenu: m.itemId !== null,
        })),
      });
    },
    [items, setCrowdFavorites]
  );

  // Cached reviews are free — light the tile up without spending anything.
  // No cache → offer the fetch; the baseline scan stays exactly as cheap.
  useEffect(() => {
    if (!restaurantName) {
      setReviewPhase({ status: 'hidden' });
      return;
    }
    let active = true;
    (async () => {
      const cached = await getCachedReviews(restaurantName);
      if (!active) return;
      if (cached) applyReviews(cached);
      else setReviewPhase({ status: 'offer' });
    })();
    return () => {
      active = false;
    };
  }, [restaurantName, applyReviews]);

  const fetchReviews = () => {
    setReviewPhase({ status: 'loading' });
    resetProgress();
    (async () => {
      try {
        applyReviews(await callReviews(restaurantName, '', onProgress));
      } catch {
        setReviewPhase({ status: 'error' });
      }
    })();
  };

  // Map the local lifecycle onto the shared component's tile state. While
  // loading, surface the REAL latest pipeline status line — never a fake timer.
  const lastStep = steps.length > 0 ? steps[steps.length - 1] : null;
  switch (reviewPhase.status) {
    case 'offer':
      return { kind: 'offer', onFetch: fetchReviews };
    case 'loading':
      return {
        kind: 'loading',
        statusLine: lastStep
          ? `${lastStep.label}${lastStep.detail ? ` — ${lastStep.detail}` : ''}`
          : null,
      };
    case 'loaded':
      return { kind: 'loaded', favorites: reviewPhase.entries };
    case 'empty':
      return { kind: 'empty' };
    case 'error':
      return { kind: 'empty', message: 'Review lookup failed — couldn’t reach the web.' };
    default:
      return { kind: 'hidden' };
  }
}
