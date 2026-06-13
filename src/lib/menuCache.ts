/**
 * Menu cache (Phase 3, slice 1) — one row per (user, restaurant) holding the
 * raw vision read. "Recent places" on the camera screen loads it back and
 * skips the vision call entirely — the most expensive call in the pipeline —
 * on repeat visits.
 *
 * Safety contract: the payload is the UN-GATED read ({ items, menu_context }
 * exactly as callVision returned them). The hard gate re-runs at load time
 * against the CURRENT profile, so a cached menu is exactly as safe as a fresh
 * scan even after the user edits their constraints.
 *
 * Offline contract (same as the scan corpus): saves are fire-and-forget;
 * reads resolve [] / null on any failure or when Supabase is unconfigured —
 * the camera screen simply shows no recent-places row and the golden path is
 * untouched.
 */
import type { MenuItem, VisionMenuContext } from '@/engine/types';
import { ensureSignedIn, getSupabase } from '@/lib/supabase';

export type RecentMenu = {
  restaurantKey: string;
  restaurant: string;
  cuisine: string;
  /** ISO timestamp of the cached scan — the UI shows its age. */
  scannedAt: string;
};

export type CachedMenu = { items: MenuItem[]; menu_context: VisionMenuContext };

/** Lookup key: lowercase, collapsed whitespace. '' = uncacheable (no name). */
export function menuKey(restaurantName: string): string {
  return restaurantName.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Upsert the raw vision read for this restaurant. Fire-and-forget. */
export function saveMenuCache(input: { items: MenuItem[]; menuContext: VisionMenuContext }): void {
  const key = menuKey(input.menuContext.restaurant_name);
  if (key === '') return; // no printed name → nothing to key the cache on
  void (async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    if (!(await ensureSignedIn())) return;
    await supabase.from('menu_cache').upsert(
      {
        restaurant_key: key,
        restaurant: input.menuContext.restaurant_name.trim(),
        cuisine: input.menuContext.cuisine_type,
        payload: { items: input.items, menu_context: input.menuContext },
        scanned_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,restaurant_key' }
    );
  })().catch(() => {});
}

/** The user's most recently scanned restaurants, newest first. [] on any failure. */
export async function listRecentMenus(limit = 3): Promise<RecentMenu[]> {
  try {
    const supabase = getSupabase();
    if (!supabase) return [];
    if (!(await ensureSignedIn())) return [];
    const { data, error } = await supabase
      .from('menu_cache')
      .select('restaurant_key, restaurant, cuisine, scanned_at')
      .order('scanned_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data.map((r) => ({
      restaurantKey: r.restaurant_key as string,
      restaurant: r.restaurant as string,
      cuisine: (r.cuisine as string) ?? '',
      scannedAt: r.scanned_at as string,
    }));
  } catch {
    return [];
  }
}

/** The cached read for one restaurant, or null (miss / offline / unconfigured). */
export async function loadMenuCache(restaurantKey: string): Promise<CachedMenu | null> {
  try {
    const supabase = getSupabase();
    if (!supabase) return null;
    if (!(await ensureSignedIn())) return null;
    const { data, error } = await supabase
      .from('menu_cache')
      .select('payload')
      .eq('restaurant_key', restaurantKey)
      .maybeSingle();
    if (error || !data) return null;
    const payload = data.payload as CachedMenu;
    if (!Array.isArray(payload.items) || payload.items.length === 0 || !payload.menu_context) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
