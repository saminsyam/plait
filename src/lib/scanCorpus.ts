/**
 * Scan corpus — captures every scan's REAL engine trace to Supabase so prompts
 * can be evaluated offline against actual menus instead of fixtures (the
 * development-time flywheel: measure suits coverage, score calibration, gate
 * agreement, slate quality on real data).
 *
 * Two trace kinds share one table (`scan_traces`), linked by a client-side
 * `scan_id`:
 *   • 'scan' — the vision read + the gate's three-way split (one per scan)
 *   • 'rank' — one per ranking call: the pool, the Q/A, the crowd context,
 *              and the returned slate with suits tags (popular AND custom)
 *
 * Every write is fire-and-forget: failures are swallowed, nothing on the
 * critical path waits, and with Supabase unconfigured this whole module is a
 * no-op. Pure telemetry for the developer-user — no app feature reads it.
 */
import type { FilteredItem } from '@/engine/dietaryFilter';
import type { Answers, MenuItem, Pick, Question, VisionMenuContext } from '@/engine/types';
import { ensureSignedIn, getSupabase } from '@/lib/supabase';

/** scan_id for the scan currently on screen (one scan at a time). */
let currentScanId: string | null = null;

function newScanId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function insert(row: {
  scan_id: string;
  kind: 'scan' | 'rank';
  restaurant: string;
  cuisine: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  if (!(await ensureSignedIn())) return;
  await supabase.from('scan_traces').insert(row);
}

/** Log the vision read + gate split; remembers the scan_id for rank traces. */
export function beginScanTrace(input: {
  items: MenuItem[];
  menuContext: VisionMenuContext;
  candidates: MenuItem[];
  verifyById: Record<string, string[]>;
  blocked: FilteredItem[];
  preferences: string;
  spiceCeiling: number;
}): void {
  const scanId = newScanId();
  currentScanId = scanId;
  const { items, menuContext, candidates, verifyById, blocked, preferences, spiceCeiling } = input;
  void insert({
    scan_id: scanId,
    kind: 'scan',
    restaurant: menuContext.restaurant_name,
    cuisine: menuContext.cuisine_type,
    payload: {
      items,
      menu_context: menuContext,
      gate: {
        candidate_ids: candidates.map((i) => i.id),
        verify_by_id: verifyById,
        blocked: blocked.map((b) => ({ id: b.item.id, name: b.item.name, reasons: b.reasons })),
      },
      profile: { preferences, spice_ceiling: spiceCeiling },
    },
  }).catch(() => {});
}

/** Log one ranking call's full input/output (popular or custom). */
export function logRankTrace(input: {
  mode: 'popular' | 'custom';
  restaurant: string;
  cuisine: string;
  pool: MenuItem[];
  questions: Question[];
  answers: Answers;
  crowdMap: Record<string, string>;
  picks: Pick[];
}): void {
  const { mode, restaurant, cuisine, pool, questions, answers, crowdMap, picks } = input;
  void insert({
    scan_id: currentScanId ?? newScanId(),
    kind: 'rank',
    restaurant,
    cuisine,
    payload: {
      mode,
      pool_ids: pool.map((i) => i.id),
      questions,
      answers,
      crowd_map: crowdMap,
      slate: picks,
    },
  }).catch(() => {});
}
