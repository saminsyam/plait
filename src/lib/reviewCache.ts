/**
 * Shared review cache (Phase 3, slice 2) — tier 2 of the crowd-favorites
 * lookup: local AsyncStorage (engine) → THIS table → one live web search.
 *
 * Review search results are public web data, so the cache is SHARED across
 * users: one `review_cache` row per restaurant, readable and refreshable by
 * any signed-in user. One web search per restaurant TOTAL — it survives
 * reinstall, and later TestFlight users inherit each other's searches.
 *
 * Freshness: the same 14-day TTL as the local tier, enforced here against
 * `fetched_at`. Callers seed the local cache with the ORIGINAL fetch time
 * (cacheReviewsLocally(..., fetchedAt)) so hopping tiers never stretches it.
 *
 * Offline contract: reads resolve null on any failure or when Supabase is
 * unconfigured; writes are fire-and-forget — the picks flow never waits.
 */
import {
  normalizeRestaurantName,
  normalizeReviews,
  REVIEWS_TTL_MS,
  type ReviewsResult,
} from '@/engine/callReviews';
import { ensureSignedIn, getSupabase } from '@/lib/supabase';

/** The shared row for a restaurant, or null (miss / stale / offline / unset). */
export async function fetchSharedReviews(
  restaurant: string
): Promise<{ result: ReviewsResult; fetchedAt: number } | null> {
  try {
    const key = normalizeRestaurantName(restaurant);
    if (key === '') return null;
    const supabase = getSupabase();
    if (!supabase) return null;
    if (!(await ensureSignedIn())) return null;
    const { data, error } = await supabase
      .from('review_cache')
      .select('payload, fetched_at')
      .eq('restaurant_key', key)
      .maybeSingle();
    if (error || !data) return null;
    const fetchedAt = new Date(data.fetched_at as string).getTime();
    const age = Date.now() - fetchedAt;
    // A future timestamp counts as stale — same clock-skew policy as the
    // local tier: refetch rather than pin.
    if (!Number.isFinite(fetchedAt) || age < 0 || age > REVIEWS_TTL_MS) return null;
    const result = normalizeReviews(data.payload);
    return result.found ? { result, fetchedAt } : null;
  } catch {
    return null;
  }
}

/** Publish a fresh (found) search result for everyone. Fire-and-forget. */
export function saveSharedReviews(restaurant: string, result: ReviewsResult): void {
  const key = normalizeRestaurantName(restaurant);
  if (key === '' || !result.found) return;
  void (async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    if (!(await ensureSignedIn())) return;
    await supabase.from('review_cache').upsert(
      {
        restaurant_key: key,
        restaurant: restaurant.trim(),
        payload: result,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: 'restaurant_key' }
    );
  })().catch(() => {});
}
