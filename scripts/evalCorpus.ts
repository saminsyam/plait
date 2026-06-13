/**
 * Corpus eval (Phase 2) — measures the engine against REAL captured scans,
 * the flip side of scripts/eval.ts (which uses synthetic fixtures).
 *
 *   npm run eval:corpus
 *
 * Reads every scan_traces row from Supabase and reports:
 *   • hard invariants  — pool containment, no blocked dish in any slate,
 *                        ranks ascending/unique (any failure exits non-zero)
 *   • slate quality    — size distribution vs the 3–8 target, score/rank order
 *   • suits coverage   — per tune chip: does the slate give it real material
 *                        (≥1 tagged pick / a beyond-top-3 dish to surface)?
 *   • gate agreement   — verify-flagged dishes that ranked: did the model
 *                        attach the required flag or "verify" clause?
 *   • macros + keto    — estimate completeness, confidence mix, swap coverage
 *
 * Needs SUPABASE_SECRET_KEY in .env (Dashboard → API Keys → Secret keys).
 * The secret key stays server-side: NEVER prefix it EXPO_PUBLIC_, or Expo
 * would inline it into the shipped app bundle. RLS hides the app's anonymous
 * rows from any other login, so the anon key cannot read the corpus here.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createClient } from '@supabase/supabase-js';

import type { Answers, MenuItem, Pick, Question, TuneSuit, VisionMenuContext } from '../src/engine/types';

function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    /* no .env — rely on the ambient environment */
  }
}

// ── Row shapes (what scanCorpus.ts writes) ──────────────────────────────────
type ScanPayload = {
  /** Where the items came from — absent on traces written before slice 1. */
  source?: 'vision' | 'menu_cache';
  items: MenuItem[];
  menu_context: VisionMenuContext;
  gate: {
    candidate_ids: string[];
    verify_by_id: Record<string, string[]>;
    blocked: { id: string; name: string; reasons: string[] }[];
  };
  profile: { preferences: string; spice_ceiling: number };
};
type RankPayload = {
  mode: 'popular' | 'custom' | 'keto';
  pool_ids: string[];
  questions: Question[];
  answers: Answers;
  crowd_map: Record<string, string>;
  slate: Pick[];
};
type TraceRow = {
  scan_id: string;
  kind: 'scan' | 'rank';
  restaurant: string;
  cuisine: string;
  payload: ScanPayload | RankPayload;
  created_at: string;
};

const TUNE_IDS: readonly TuneSuit[] = ['price', 'light', 'safe', 'surprise'];

type Check = { name: string; pass: boolean; info?: string };
const checks: Check[] = [];
function check(name: string, pass: boolean, info?: string) {
  checks.push({ name, pass, info });
  console.log(`  ${pass ? '✅' : '❌'} ${name}${info ? `  (${info})` : ''}`);
}
function stat(label: string, value: string) {
  console.log(`  📊 ${label}: ${value}`);
}
const pct = (n: number, d: number) => (d === 0 ? '–' : `${Math.round((n / d) * 100)}%`);

async function main() {
  loadEnv();
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    console.error(
      'Missing EXPO_PUBLIC_SUPABASE_URL and/or SUPABASE_SECRET_KEY in .env.\n' +
        'Get the secret key from Supabase → Project Settings → API Keys → Secret keys\n' +
        '(sb_secret_…). Do NOT prefix it EXPO_PUBLIC_ — it must never reach the app bundle.'
    );
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase
    .from('scan_traces')
    .select('scan_id, kind, restaurant, cuisine, payload, created_at')
    .order('created_at', { ascending: true })
    .limit(1000);
  if (error) {
    console.error('Supabase query failed:', error.message);
    process.exit(1);
  }
  const rows = (data ?? []) as TraceRow[];
  const scans = rows.filter((r) => r.kind === 'scan');
  const ranks = rows.filter((r) => r.kind === 'rank');
  const scanById = new Map(scans.map((s) => [s.scan_id, s.payload as ScanPayload]));

  if (rows.length === 0) {
    console.log('Corpus is empty — scan some menus first.');
    process.exit(1);
  }

  // ── Corpus overview ─────────────────────────────────────────────────────
  console.log('\n── Corpus overview ──');
  const restaurants = [...new Set(scans.map((s) => s.restaurant || '(unnamed)'))];
  const modes = ranks.reduce<Record<string, number>>((acc, r) => {
    const m = (r.payload as RankPayload).mode ?? 'unknown';
    acc[m] = (acc[m] ?? 0) + 1;
    return acc;
  }, {});
  stat('scans', `${scans.length} (${restaurants.join(' · ')})`);
  stat(
    'rank traces',
    `${ranks.length} (${Object.entries(modes).map(([m, n]) => `${m}: ${n}`).join(', ')})`
  );
  for (const s of scans) {
    const p = s.payload as ScanPayload;
    const blocked = p.gate.blocked.length;
    stat(
      `  ${s.restaurant || '(unnamed)'}`,
      `${p.items.length} dishes read → ${p.gate.candidate_ids.length} rankable` +
        (blocked > 0 ? ` · ${blocked} blocked` : '') +
        (Object.keys(p.gate.verify_by_id).length > 0
          ? ` · ${Object.keys(p.gate.verify_by_id).length} verify`
          : '')
    );
  }
  check('every rank trace links to a scan trace', ranks.every((r) => scanById.has(r.scan_id)));

  // ── Hard invariants ─────────────────────────────────────────────────────
  console.log('\n── Hard invariants ──');
  let poolLeaks = 0;
  let blockedLeaks = 0;
  let badRankOrder = 0;
  for (const r of ranks) {
    const p = r.payload as RankPayload;
    const pool = new Set(p.pool_ids);
    if (!p.slate.every((k) => pool.has(k.item_id))) poolLeaks++;
    const scan = scanById.get(r.scan_id);
    if (scan) {
      const blockedIds = new Set(scan.gate.blocked.map((b) => b.id));
      if (p.slate.some((k) => blockedIds.has(k.item_id))) blockedLeaks++;
    }
    const sorted = [...p.slate].sort((a, b) => a.rank - b.rank);
    const unique = new Set(sorted.map((k) => k.rank)).size === sorted.length;
    if (!unique) badRankOrder++;
  }
  check('every pick came from its rank call’s pool', poolLeaks === 0, `${poolLeaks} leaks`);
  check('no gate-blocked dish in any slate', blockedLeaks === 0, `${blockedLeaks} leaks`);
  check('ranks unique within every slate', badRankOrder === 0, `${badRankOrder} bad`);

  // ── Slate quality ───────────────────────────────────────────────────────
  console.log('\n── Slate quality ──');
  const mainRanks = ranks.filter((r) => (r.payload as RankPayload).mode !== 'keto');
  const sizeInfo = mainRanks.map((r) => {
    const p = r.payload as RankPayload;
    return { pool: p.pool_ids.length, slate: p.slate.length, mode: p.mode };
  });
  stat('pool → slate (popular/custom)', sizeInfo.map((s) => `${s.pool}→${s.slate}`).join(', ') || '–');
  // A slate can't be wider than its pool — a custom rank over a refine-narrowed
  // pool of 1–3 dishes is correct at that size. Judge against min(4, pool).
  const tooNarrow = sizeInfo.filter((s) => s.slate < Math.min(4, s.pool));
  check(
    'slates wide enough to feed the chips (≥ min(4, pool))',
    tooNarrow.length === 0,
    `${sizeInfo.length - tooNarrow.length}/${sizeInfo.length} traces`
  );
  // Engine-tuning signal, not a model failure: a custom pool this small means
  // the refine flow over-narrowed — the re-rank has nothing left to rank and
  // the chips get no material. (Fix lives in the narrowing rules, not the prompt.)
  const overNarrowed = sizeInfo.filter((s) => s.mode === 'custom' && s.pool < 3).length;
  if (overNarrowed > 0) {
    stat('⚠ custom ranks over a pool < 3 (refine over-narrowed)', `${overNarrowed}`);
  }
  let scorePairs = 0;
  let scoreOrdered = 0;
  let whyTotal = 0;
  let whyShort = 0;
  for (const r of mainRanks) {
    const slate = [...(r.payload as RankPayload).slate].sort((a, b) => a.rank - b.rank);
    for (let i = 1; i < slate.length; i++) {
      scorePairs++;
      if (slate[i].match_score <= slate[i - 1].match_score) scoreOrdered++;
    }
    for (const k of slate) {
      whyTotal++;
      if (k.why.trim().length < 30) whyShort++;
    }
  }
  stat('match_score falls with rank', `${pct(scoreOrdered, scorePairs)} of adjacent pairs`);
  check('no generic one-liner whys (<30 chars)', whyShort === 0, `${whyShort}/${whyTotal} short`);

  // ── Suits coverage (tune chip fuel) ─────────────────────────────────────
  console.log('\n── Suits coverage ──');
  const allPicks = mainRanks.flatMap((r) => (r.payload as RankPayload).slate);
  const tagged = allPicks.filter((k) => (k.suits ?? []).length > 0).length;
  stat('picks carrying ≥1 suit tag', `${pct(tagged, allPicks.length)} (${tagged}/${allPicks.length})`);
  for (const tune of TUNE_IDS) {
    let withMaterial = 0;
    let changesDeal = 0;
    for (const r of mainRanks) {
      const slate = (r.payload as RankPayload).slate;
      const suited = slate.filter((k) => (k.suits ?? []).includes(tune));
      if (suited.length > 0) withMaterial++;
      if (suited.some((k) => k.rank > 3)) changesDeal++;
    }
    stat(
      `"${tune}"`,
      `${pct(withMaterial, mainRanks.length)} of traces have material · ` +
        `${pct(changesDeal, mainRanks.length)} surface a beyond-top-3 dish`
    );
  }

  // ── Gate agreement (safety) ─────────────────────────────────────────────
  console.log('\n── Gate agreement ──');
  let verifyPicks = 0;
  let verifyHonored = 0;
  const misses: string[] = [];
  for (const r of ranks) {
    const scan = scanById.get(r.scan_id);
    if (!scan) continue;
    const names = new Map(scan.items.map((i) => [i.id, i.name]));
    const certified = scan.menu_context.restaurant_notes.some((n) => /halal|kosher/i.test(n));
    for (const k of (r.payload as RankPayload).slate) {
      const reasons = scan.gate.verify_by_id[k.item_id];
      if (!reasons || reasons.length === 0) continue;
      verifyPicks++;
      // A cert note legitimately waives halal verification (prompt rule).
      const waived = certified && reasons.every((x) => /halal|kosher/i.test(x));
      if (waived || k.flag !== null || /verify/i.test(k.why)) verifyHonored++;
      else misses.push(`${r.restaurant || r.scan_id}: ${names.get(k.item_id) ?? k.item_id}`);
    }
  }
  check(
    'verify-gated picks carry a flag or “verify” clause',
    verifyPicks === verifyHonored,
    `${verifyHonored}/${verifyPicks}` + (misses.length > 0 ? ` — missed: ${misses.join('; ')}` : '')
  );

  // ── Macros + keto ───────────────────────────────────────────────────────
  console.log('\n── Macros & keto ──');
  const withMacros = allPicks.filter(
    (k) => k.protein_g !== null && k.carbs_g !== null && k.fat_g !== null
  ).length;
  const conf = allPicks.reduce<Record<string, number>>((acc, k) => {
    const c = k.confidence ?? 'null';
    acc[c] = (acc[c] ?? 0) + 1;
    return acc;
  }, {});
  stat('picks with full macro estimates', pct(withMacros, allPicks.length));
  stat('macro confidence mix', Object.entries(conf).map(([c, n]) => `${c}: ${n}`).join(', ') || '–');
  const ketoRanks = ranks.filter((r) => (r.payload as RankPayload).mode === 'keto');
  if (ketoRanks.length > 0) {
    const ketoPicks = ketoRanks.flatMap((r) => (r.payload as RankPayload).slate);
    const withSwap = ketoPicks.filter((k) => k.swap).length;
    const highCarb = ketoPicks.filter((k) => (k.carbs_g ?? 0) > 20).length;
    stat('keto picks', `${ketoPicks.length} across ${ketoRanks.length} runs`);
    stat('swap coverage', pct(withSwap, ketoPicks.length));
    check('keto picks stay under 20g carbs (post-swap)', highCarb === 0, `${highCarb} over`);
  } else {
    stat('keto traces', 'none yet — toggle Keto? on a scan to start measuring');
  }

  // ── Caches (Phase 3 — token savings) ─────────────────────────────────────
  console.log('\n── Caches ──');
  // Menu-cache hit rate from the scan traces' source tag. Traces written
  // before slice 1 have no source — count them as 'vision' (the old behavior).
  const cacheHits = scans.filter((s) => (s.payload as ScanPayload).source === 'menu_cache').length;
  const taggedScans = scans.filter((s) => (s.payload as ScanPayload).source !== undefined).length;
  stat(
    'menu-cache hit rate (vision reads skipped)',
    `${pct(cacheHits, scans.length)} (${cacheHits}/${scans.length})` +
      (taggedScans < scans.length ? ` · ${scans.length - taggedScans} pre-slice-1 scans counted as vision` : '')
  );
  // Cache-table sizes — how much corpus the runtime caches have banked.
  const sizeOf = async (table: string): Promise<number | null> => {
    const { count, error: e } = await supabase.from(table).select('*', { count: 'exact', head: true });
    return e ? null : count ?? 0;
  };
  const [menuRows, reviewRows, detailRows] = await Promise.all([
    sizeOf('menu_cache'),
    sizeOf('review_cache'),
    sizeOf('dish_detail_cache'),
  ]);
  const rowLabel = (n: number | null) => (n === null ? 'table missing — run the schema section' : `${n} rows`);
  stat('menu_cache', rowLabel(menuRows));
  stat('review_cache (shared)', rowLabel(reviewRows));
  stat('dish_detail_cache', rowLabel(detailRows));

  // ── Report ──────────────────────────────────────────────────────────────
  const failed = checks.filter((c) => !c.pass);
  console.log('\n══ Corpus eval report ══');
  console.log(`traces: ${scans.length} scans · ${ranks.length} ranks`);
  console.log(`checks: ${checks.length - failed.length}/${checks.length} passed`);
  if (failed.length > 0) {
    console.log('\nFailed:');
    for (const f of failed) console.log(`  ❌ ${f.name}${f.info ? `  (${f.info})` : ''}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('Corpus eval crashed:', e);
  process.exit(1);
});
