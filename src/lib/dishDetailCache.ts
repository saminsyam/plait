/**
 * Dish-detail cache (Phase 3, slice 3) — persists the lazy "tell me more"
 * sheet call so a repeat open of the same dish is free ACROSS sessions, not
 * just within one (the picks screen keeps an in-memory map as tier 1).
 *
 * Per-user, NOT shared: detail text is personalized — it references the diner's
 * constraints and answers — so the key (dishDetailKey) folds in a hash of
 * (preferences + answers). Same diner + dish + profile → same key → a free
 * repeat; a profile edit or a different refine re-fetches.
 *
 * Offline contract (same as the other caches): reads resolve null on any
 * failure or when Supabase is unconfigured; writes are fire-and-forget. The
 * sheet always works — a miss just pays the (cheap Haiku) call.
 */
import type { DishDetail } from '@/engine/callDishDetail';
import { ensureSignedIn, getSupabase } from '@/lib/supabase';

/** Detail older than this is re-fetched (menus/prep drift; profile may shift). */
export const DISH_DETAIL_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** The persisted detail for this cache key, or null (miss / stale / offline). */
export async function loadDishDetail(cacheKey: string): Promise<DishDetail | null> {
  try {
    const supabase = getSupabase();
    if (!supabase) return null;
    if (!(await ensureSignedIn())) return null;
    const { data, error } = await supabase
      .from('dish_detail_cache')
      .select('payload, created_at')
      .eq('cache_key', cacheKey)
      .maybeSingle();
    if (error || !data) return null;
    const at = new Date(data.created_at as string).getTime();
    const age = Date.now() - at;
    if (!Number.isFinite(at) || age < 0 || age > DISH_DETAIL_TTL_MS) return null;
    const payload = data.payload as DishDetail;
    if (typeof payload?.why_this_pick !== 'string') return null;
    return payload;
  } catch {
    return null;
  }
}

/** Persist one dish's detail under its key. Fire-and-forget. */
export function saveDishDetail(cacheKey: string, detail: DishDetail): void {
  void (async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    if (!(await ensureSignedIn())) return;
    await supabase.from('dish_detail_cache').upsert(
      {
        cache_key: cacheKey,
        payload: detail,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,cache_key' }
    );
  })().catch(() => {});
}
