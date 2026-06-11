/**
 * Crowd-favorites lifecycle for the post-scan screen: check the review cache
 * for free, offer a tap-to-fetch (~$0.02) when there's nothing cached, match
 * returned dish names to scanned items on-device (zero tokens), and record
 * the matches into the session so the ranking call can cite them.
 *
 * The dietary gate is folded into the tile: a review favorite that maps to a
 * gate-BLOCKED dish still shows its honest "on this menu" badge but carries
 * the gate's reasons as an inline ⚠️, and never enters the session map the
 * ranking context reads.
 *
 * `crowdReady` flips true once the initial cache check has resolved — the
 * instant rank waits for it so cached crowd favorites make it into the very
 * first ranking call instead of racing it.
 *
 * Owns its own useProgressSteps so the tile's loading line shows the REAL
 * latest pipeline status — independent of any other progress stream.
 */
import { useCallback, useEffect, useState } from 'react';

import type { CrowdFavoriteEntry, CrowdFavoritesState } from '@/components/restaurant-summary';
import { useProgressSteps } from '@/hooks/use-progress-steps';
import { callReviews, getCachedReviews, type ReviewsResult } from '@/lib/callReviews';
import { gateCrowdFavorites, matchCrowdFavorites } from '@/lib/matchReviews';
import { useSession } from '@/state/session';

/** Where the crowd-favorites tile is in its lifecycle. */
type ReviewPhase =
  | { status: 'hidden' } // no restaurant name read → nothing to search for
  | { status: 'offer' } // nothing cached → tap-to-fetch
  | { status: 'loading' }
  | { status: 'loaded'; entries: CrowdFavoriteEntry[] }
  | { status: 'empty' } // search ran dry
  | { status: 'error' };

export function useCrowdFavorites(): { crowdState: CrowdFavoritesState; crowdReady: boolean } {
  const { menuContext, items, blocked, setCrowdFavorites } = useSession();
  const restaurantName = menuContext?.restaurant_name.trim() ?? '';

  const [reviewPhase, setReviewPhase] = useState<ReviewPhase>({ status: 'hidden' });
  const [crowdReady, setCrowdReady] = useState(false);
  const { steps, onProgress, resetProgress } = useProgressSteps();

  // Fold a fetched/cached review result into the tile + the session map the
  // ranking call reads. Matching is pure string work — zero tokens; blocked
  // matches get the gate's warning and stay out of the rankable map.
  const applyReviews = useCallback(
    (r: ReviewsResult) => {
      if (!r.found) {
        setReviewPhase({ status: 'empty' });
        return;
      }
      const { entries, rankable } = gateCrowdFavorites(
        matchCrowdFavorites(r.crowd_favorites, items),
        blocked
      );
      setCrowdFavorites(rankable);
      setReviewPhase({ status: 'loaded', entries });
    },
    [items, blocked, setCrowdFavorites]
  );

  // Cached reviews are free — light the tile up without spending anything.
  // No cache → offer the fetch; the baseline scan stays exactly as cheap.
  useEffect(() => {
    if (!restaurantName) {
      setReviewPhase({ status: 'hidden' });
      setCrowdReady(true);
      return;
    }
    let active = true;
    (async () => {
      const cached = await getCachedReviews(restaurantName);
      if (!active) return;
      if (cached) applyReviews(cached);
      else setReviewPhase({ status: 'offer' });
      setCrowdReady(true);
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
  let crowdState: CrowdFavoritesState;
  switch (reviewPhase.status) {
    case 'offer':
      crowdState = { kind: 'offer', onFetch: fetchReviews };
      break;
    case 'loading':
      crowdState = {
        kind: 'loading',
        statusLine: lastStep
          ? `${lastStep.label}${lastStep.detail ? ` — ${lastStep.detail}` : ''}`
          : null,
      };
      break;
    case 'loaded':
      crowdState = { kind: 'loaded', favorites: reviewPhase.entries };
      break;
    case 'empty':
      crowdState = { kind: 'empty' };
      break;
    case 'error':
      crowdState = { kind: 'empty', message: 'Review lookup failed — couldn’t reach the web.' };
      break;
    default:
      crowdState = { kind: 'hidden' };
  }
  return { crowdState, crowdReady };
}
