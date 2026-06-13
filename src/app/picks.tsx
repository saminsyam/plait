/**
 * Picks screen — Sushi 2.1. Everything after the scan lives on this one page:
 * header + gate line, ONE hero card ("Our pick for you") with hold-to-lock,
 * two compact contenders, a detail sheet with tap-to-explain, and the four
 * tune chips as a persistent bottom row.
 *
 * Zero-token interactions feel instant (spec §2.5): tune chips re-deal the
 * ranked picks deterministically on-device — "Surprise me" doubling as the
 * adventurous lens (it flips one contender into a deterministic stretch pick,
 * dashed plum, allowed-only). The "Keto?" toggle is the exception: it runs the
 * keto AGENT once per scan — a specialist rank with per-dish swaps ("bun →
 * lettuce wrap"); swaps exist only in keto mode — then caches the slate. The
 * model appears twice on the golden path (instant rank + ONE refine re-rank);
 * dish detail and the keto agent are lazy, on-demand calls. Blocked dishes
 * live behind the gate line's "view" — never silently dropped.
 */
import { Redirect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ExplainText } from '@/components/explain-text';
import { HoldToLock } from '@/components/hold-to-lock';
import { MatchRing } from '@/components/match-ring';
import { RefineSheet } from '@/components/refine-sheet';
import { Body, Eyebrow, PrimaryButton } from '@/components/ui-kit';
import { Plait } from '@/constants/plait-theme';
import { bridgePick } from '@/engine/bridgePick';
import { callDishDetail, dishDetailKey, type DishDetail } from '@/engine/callDishDetail';
import { callKeto } from '@/engine/callKeto';
import { rankFromPool } from '@/engine/rankFromPool';
import type { FilteredItem } from '@/engine/dietaryFilter';
import { choicesToQA, filterBySpice, nextQuestion, type EngineChoice } from '@/engine/questionEngine';
import { refineNudge } from '@/engine/refineNudge';
import { applyTune, TUNES, type DealEntry, type TuneId } from '@/engine/tunes';
import type { Answers, MenuItem, Pick, Question } from '@/engine/types';
import { useCrowdFavorites } from '@/hooks/use-crowd-favorites';
import { loadDishDetail, saveDishDetail } from '@/lib/dishDetailCache';
import { logRankTrace } from '@/lib/scanCorpus';
import { useProgressSteps, type ProgressStep } from '@/hooks/use-progress-steps';
import { useProfile } from '@/state/profile';
import { useSession } from '@/state/session';

// LayoutAnimation needs to be explicitly enabled on Android.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const CONFIDENCE_LABEL: Record<string, string> = {
  high: '±10%',
  medium: '±15%',
  low: '±25%',
};

/** What the cards (and the detail sheet) are showing for one slot. */
type DisplayEntry =
  | { kind: 'pick'; pick: Pick; item: MenuItem; needsVerify: boolean }
  | { kind: 'stretch'; item: MenuItem; why: string };

type BadgeKind = 'verify' | 'stretch' | 'crowd' | 'spice' | null;

/** Gate-line summary: "pork, shrimp paste" from the blocked items' reasons. */
function gateSummary(blocked: FilteredItem[]): string {
  const terms: string[] = [];
  for (const b of blocked) {
    for (const r of b.reasons) {
      const t = r.replace(/^contains /, '').replace(/ — .*$/, '');
      if (!terms.includes(t)) terms.push(t);
    }
  }
  return terms.slice(0, 2).join(', ') + (terms.length > 2 ? '…' : '');
}

/**
 * Deterministic FALLBACK when the keto agent call fails: low-carb first,
 * higher protein as the tie-break, over the main slate (no swaps). Macros are
 * model estimates that can be null; dishes we can't weigh sort last rather
 * than masquerading as keto-friendly. Never mutates the input.
 */
function ketoOrder(deal: DealEntry[]): DealEntry[] {
  const proteinDesc = (a: DealEntry, b: DealEntry) =>
    (b.pick.protein_g ?? 0) - (a.pick.protein_g ?? 0);
  return [...deal].sort((a, b) => {
    const ca = a.pick.carbs_g;
    const cb = b.pick.carbs_g;
    if (ca == null && cb == null) return proteinDesc(a, b);
    if (ca == null) return 1;
    if (cb == null) return -1;
    if (ca !== cb) return ca - cb;
    return proteinDesc(a, b);
  });
}

/** Card deal-in: fade + rise with an 80ms stagger (spec motion, ~0.45s). */
function DealIn({
  children,
  index,
  reduceMotion,
}: {
  children: React.ReactNode;
  index: number;
  reduceMotion: boolean;
}) {
  const v = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    Animated.timing(v, {
      toValue: 1,
      duration: 450,
      delay: index * 80,
      useNativeDriver: true,
    }).start();
  }, [index, reduceMotion, v]);
  const translateY = v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] });
  return (
    <Animated.View style={{ opacity: v, transform: [{ translateY }] }}>{children}</Animated.View>
  );
}

/** One macro row — mono label, thin track, grams. */
function MacroBar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const pct = Math.min(1, value / max);
  return (
    <View style={mb.row}>
      <Text style={mb.label}>{label}</Text>
      <View style={mb.track}>
        <View style={[mb.fill, { width: `${Math.round(pct * 100)}%`, backgroundColor: color }]} />
      </View>
      <Text style={mb.value}>{value}g</Text>
    </View>
  );
}

const mb = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  label: { fontFamily: Plait.font.mono, fontSize: 11, width: 56, color: Plait.color.inkSoft },
  track: { flex: 1, height: 6, backgroundColor: Plait.color.line, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  value: { fontFamily: Plait.font.mono, fontSize: 11, width: 36, textAlign: 'right', color: Plait.color.ink },
});

/** The one badge a card is allowed (spec: max one). */
function CardBadge({ kind }: { kind: BadgeKind }) {
  if (kind === 'verify') return <Text style={[badge.base, badge.verify]}>ask staff</Text>;
  if (kind === 'stretch') return <Text style={[badge.base, badge.stretch]}>stretch pick</Text>;
  if (kind === 'crowd') return <Text style={[badge.base, badge.crowd]}>★ crowd favorite</Text>;
  if (kind === 'spice') return <Text style={[badge.base, badge.spice]}>🌶 spicier than stated</Text>;
  return null;
}

const badge = StyleSheet.create({
  base: {
    fontFamily: Plait.font.bodySemiBold,
    fontSize: 10.5,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: Plait.radius.pill,
    overflow: 'hidden',
  },
  verify: { color: Plait.color.amber, backgroundColor: Plait.color.amberSoft },
  stretch: { color: Plait.color.plum, backgroundColor: Plait.color.plumSoft },
  crowd: { color: Plait.color.green, backgroundColor: Plait.color.greenSoft },
  spice: { color: Plait.color.inkSoft, backgroundColor: Plait.color.line },
});

export default function PicksScreen() {
  const router = useRouter();
  const session = useSession();
  const { preferences, spiceCeiling } = useProfile();
  const {
    items,
    restaurantNotes,
    blocked,
    candidates,
    verifyById,
    menuContext,
    popularPicks,
    popularReady,
    customPicks,
    customQuestions,
    customAnswers,
    customReady,
    setPopular,
    setCustom,
  } = session;
  const { crowdEntries, crowdMap, crowdReady } = useCrowdFavorites();

  // Which cached result set is on screen. Popular = dietary + online reviews;
  // Custom = the refine narrowing flow. Switching is free — both are cached.
  const [view, setView] = useState<'popular' | 'custom'>('popular');
  const activePicks = view === 'custom' && customReady ? customPicks : popularPicks;
  const activeQuestions = view === 'custom' ? customQuestions : [];
  const activeAnswers: Answers = view === 'custom' ? customAnswers : {};

  // Detail sheet state — one dish at a time, detail lazily fetched + cached.
  const [sheet, setSheet] = useState<DisplayEntry | null>(null);
  const [detail, setDetail] = useState<DishDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);
  const detailCache = useRef<Record<string, DishDetail>>({});
  const activeIdRef = useRef<string | null>(null);

  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  // ── Ranking. Popular runs once off the scan (waits for reviews); Custom runs
  // when the refine sheet finishes narrowing. Each writes its own cached set.
  const { steps, onProgress, resetProgress } = useProgressSteps();
  const [rankState, setRankState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const rankStarted = useRef(false);
  type RankRequest = {
    pool: MenuItem[];
    questions: Question[];
    answers: Answers;
    mode: 'popular' | 'custom';
    /** itemId → crowd-favorite name; review dishes still in the pool get cited. */
    crowdMap: Record<string, string>;
  };
  const lastRank = useRef<RankRequest | null>(null);

  // ── One-page interactions: tune chip, mode toggle, lock, gate view, refine.
  const [tune, setTune] = useState<TuneId | null>(null);
  const [keto, setKeto] = useState(false);

  // ── Keto agent: a separate on-demand specialist rank with per-dish swaps.
  // Runs ONCE per scan (first toggle), then the slate is cached; toggling
  // after that is instant. Its own progress steps so it never fights the
  // main rank's status box.
  const [ketoPicks, setKetoPicks] = useState<Pick[] | null>(null);
  const [ketoState, setKetoState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const {
    steps: ketoSteps,
    onProgress: onKetoProgress,
    resetProgress: resetKetoProgress,
  } = useProgressSteps();

  const runKeto = useCallback(async () => {
    setKetoState('running');
    resetKetoProgress();
    try {
      const pool = filterBySpice(candidates, spiceCeiling);
      const picks = await callKeto({
        items: pool,
        userPreferences: preferences ?? '',
        verifyById,
        restaurantNotes,
        onProgress: onKetoProgress,
      });
      setKetoPicks(picks);
      setKetoState('done');
      logRankTrace({
        mode: 'keto',
        restaurant: menuContext?.restaurant_name ?? '',
        cuisine: menuContext?.cuisine_type ?? '',
        pool,
        questions: [],
        answers: {},
        crowdMap: {},
        picks,
      });
    } catch {
      // The toggle still works — the deal falls back to the deterministic
      // low-carb ordering of the main slate (no swaps), with an honest note.
      setKetoState('error');
    }
  }, [candidates, spiceCeiling, preferences, verifyById, restaurantNotes, menuContext, onKetoProgress, resetKetoProgress]);
  const [locked, setLocked] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);
  const [refineOpen, setRefineOpen] = useState(false);

  const runRank = useCallback(
    async (request: RankRequest) => {
      lastRank.current = request;
      setRankState('running');
      setLocked(false);
      setTune(null);
      resetProgress();
      try {
        const { pool, questions: qs, answers: ans, mode, crowdMap: cm } = request;
        const ranked = await rankFromPool({
          pool,
          questions: qs,
          answers: ans,
          preferences: preferences ?? '',
          verifyById,
          restaurantNotes,
          crowdMap: cm,
          onProgress,
        });
        if (mode === 'popular') {
          setPopular({ spice: spiceCeiling, picks: ranked });
        } else {
          setCustom({ questions: qs, answers: ans, spice: spiceCeiling, picks: ranked });
          setView('custom');
        }
        logRankTrace({
          mode,
          restaurant: menuContext?.restaurant_name ?? '',
          cuisine: menuContext?.cuisine_type ?? '',
          pool,
          questions: qs,
          answers: ans,
          crowdMap: cm,
          picks: ranked,
        });
        setRankState('done');
      } catch {
        setRankState('error');
      }
    },
    [verifyById, preferences, restaurantNotes, spiceCeiling, menuContext, onProgress, resetProgress, setPopular, setCustom]
  );

  // Popular rank: the scan lands here directly and ranks instantly once the
  // local review cache check resolves (cached reviews fold into this rank; an
  // uncached search folds in a beat later as badges, no re-rank).
  const hasScan = !!menuContext && items.length > 0;
  useEffect(() => {
    if (rankStarted.current) return;
    if (!hasScan || candidates.length === 0) return;
    if (!crowdReady) return;
    if (popularReady) return; // already ranked (e.g. remount on web reload)
    rankStarted.current = true;
    void runRank({
      pool: filterBySpice(candidates, spiceCeiling),
      questions: [],
      answers: {},
      mode: 'popular',
      crowdMap,
    });
  }, [hasScan, candidates, spiceCeiling, popularReady, crowdReady, crowdMap, runRank]);

  // The refine sheet hands back a narrowed pool + recorded choices → the Custom
  // rank, which never touches the cached Popular result.
  const onRefineDone = useCallback(
    (pool: MenuItem[], choices: EngineChoice[]) => {
      setRefineOpen(false);
      const qa = choicesToQA(choices);
      void runRank({ pool, questions: qa.questions, answers: qa.answers, mode: 'custom', crowdMap });
    },
    [runRank, crowdMap]
  );

  // Guard: no scan in progress → home. <Redirect> (not router.replace in an
  // effect) is safe on a cold web load, before the root navigator mounts.
  if (!hasScan) return <Redirect href="/" />;

  const byId = new Map(items.map((i) => [i.id, i]));

  // A halal/kosher certification note is a positive trust signal — surface it
  // as a quiet line, and suppress the per-dish "verify halal" flag (cert covers it).
  const halalCertified = restaurantNotes.some((n) => /halal/i.test(n));
  const trustNotes = restaurantNotes.filter((n) => /halal|kosher/i.test(n));

  // Keto mode deals the keto agent's own slate (its macros reflect the swap);
  // everything else deals from the active Popular/Custom set.
  const dealSource: Pick[] = keto && ketoPicks ? ketoPicks : activePicks;
  const ketoLoading = keto && ketoState === 'running';

  const maxProtein = Math.max(1, ...dealSource.map((p) => p.protein_g ?? 0));
  const maxCarbs = Math.max(1, ...dealSource.map((p) => p.carbs_g ?? 0));
  const maxFat = Math.max(1, ...dealSource.map((p) => p.fat_g ?? 0));

  const pickNeedsVerify = (p: Pick): boolean => {
    const flag = p.flag === 'verify_halal' && halalCertified ? null : p.flag;
    return flag === 'verify_halal' || flag === 'contains_allergen' || !!verifyById[p.item_id]?.length;
  };

  /** verify > stretch > spicier > crowd — one badge per card (spec). */
  const badgeFor = (entry: DisplayEntry): BadgeKind => {
    if (entry.kind === 'stretch') return 'stretch';
    if (entry.needsVerify) return 'verify';
    if (entry.pick.flag === 'spicier_than_stated') return 'spice';
    if (crowdMap[entry.item.id]) return 'crowd';
    return null;
  };

  /** Reviewer blurb for a dish, when the loaded crowd favorites include it. */
  const crowdBlurbFor = (item: MenuItem): string | null => {
    const name = crowdMap[item.id];
    if (!name) return null;
    return crowdEntries.find((f) => f.name === name)?.blurb || null;
  };

  /** Everything the amber "ask staff" block should say for one dish. */
  const askStaff = (entry: DisplayEntry): string[] => {
    const out = [...(verifyById[entry.item.id] ?? [])];
    if (entry.kind === 'pick' && sheet === entry && detail) {
      for (const s of detail.safety_detail) if (!out.includes(s)) out.push(s);
    }
    return out;
  };

  const openSheet = (entry: DisplayEntry) => {
    setSheet(entry);
    setDetailError(false);
    if (entry.kind !== 'pick') {
      activeIdRef.current = null;
      setDetail(null);
      setDetailLoading(false);
      return;
    }
    const id = entry.item.id;
    activeIdRef.current = id;
    // Key folds in the profile + answers, so the same dish gets distinct detail
    // under Popular vs a Custom refine — and the same key persists across
    // sessions in the server cache.
    const key = dishDetailKey({
      restaurant: menuContext?.restaurant_name ?? '',
      itemId: id,
      preferences: preferences ?? '',
      answers: activeAnswers,
    });
    // Tier 1: in-memory (this session) — instant.
    const cached = detailCache.current[key];
    if (cached) {
      setDetail(cached);
      setDetailLoading(false);
      return;
    }
    setDetail(null);
    setDetailLoading(true);
    (async () => {
      try {
        // Tier 2: the persistent per-user cache — free, survives reinstall.
        const stored = await loadDishDetail(key);
        if (stored) {
          detailCache.current[key] = stored;
          if (activeIdRef.current === id) {
            setDetail(stored);
            setDetailLoading(false);
          }
          return;
        }
        // Tier 3: the live Haiku call — then seed both caches.
        const d = await callDishDetail({
          pick: entry.pick,
          item: entry.item,
          preferences: preferences ?? '',
          questions: activeQuestions,
          answers: activeAnswers,
        });
        detailCache.current[key] = d;
        saveDishDetail(key, d);
        if (activeIdRef.current === id) setDetail(d);
      } catch {
        if (activeIdRef.current === id) setDetailError(true);
      } finally {
        if (activeIdRef.current === id) setDetailLoading(false);
      }
    })();
  };

  const closeSheet = () => {
    setSheet(null);
    activeIdRef.current = null;
    setDetail(null);
    setDetailLoading(false);
    setDetailError(false);
  };

  const scanAnother = () => {
    session.reset();
    router.replace('/');
  };

  // hasScan guarantees menuContext from here down.
  const o = menuContext!.orientation;
  const restaurantName = menuContext!.restaurant_name.trim();

  // Refinement availability + the deterministic "would questions help?" nudge
  // (the nudge text, when present, becomes the refine link's label).
  const trimmedPool = filterBySpice(candidates, spiceCeiling);
  const refinable = popularReady && nextQuestion(trimmedPool, new Set()) !== null;
  const nudge =
    refinable && !customReady && rankState !== 'running'
      ? refineNudge({ poolSize: trimmedPool.length, preferencesText: preferences ?? '', picks: popularPicks })
      : null;

  // ── Assemble the displayed deal from the ACTIVE view: the keto toggle or the
  // active tune chip re-orders the ranked picks deterministically; the
  // "Surprise me" chip also flips the first contender into the stretch pick.
  const rankedDeal: DealEntry[] = dealSource
    .map((p) => {
      const item = byId.get(p.item_id);
      return item ? { pick: p, item, needsVerify: pickNeedsVerify(p) } : null;
    })
    .filter((e): e is DealEntry => e !== null);
  // Two mutually exclusive lenses: keto (the agent's slate in its own order,
  // or the deterministic low-carb fallback when the call failed) or the
  // active tune chip. Toggling one clears the other.
  const orderedDeal = keto
    ? ketoPicks
      ? [...rankedDeal]
      : ketoOrder(rankedDeal)
    : applyTune(tune, rankedDeal);
  const orderedEntries: DisplayEntry[] = orderedDeal.map((e) => ({ kind: 'pick', ...e }));

  // The "Surprise me" chip IS the adventurous lens: on top of its deep-cut
  // ordering it flips the first contender into a stretch pick — a signature /
  // allowed dish the ranker didn't already place (dashed plum).
  const stretch =
    tune === 'surprise'
      ? bridgePick({ picks: activePicks, candidates, verifyById, signatureIds: o.signature_item_ids, byId })
      : null;
  const hero = orderedEntries[0] ?? null;
  const contenders: DisplayEntry[] = stretch
    ? [{ kind: 'stretch', item: stretch.item, why: stretch.why }, ...orderedEntries.slice(1, 2)]
    : orderedEntries.slice(1, 3);

  // Re-deal the stagger animation whenever the visible set changes.
  const dealKey = `${view}·${orderedDeal.map((e) => e.item.id).join('·')}·${keto}·${!!stretch}`;

  const toggleTune = (id: TuneId) => {
    if (rankState === 'running') return;
    setLocked(false);
    setKeto(false); // keto and tune chips are mutually exclusive lenses
    setTune((t) => (t === id ? null : id));
  };

  // Switching Popular ⇄ Custom is free (both cached). Reset the per-view
  // controls so each set reads cleanly from the top.
  const switchView = (next: 'popular' | 'custom') => {
    if (next === view || rankState === 'running') return;
    if (!reduceMotion) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    closeSheet();
    setTune(null);
    setLocked(false);
    setKeto(false);
    setView(next);
  };

  const toggleKeto = () => {
    if (rankState === 'running') return;
    setLocked(false);
    setTune(null); // keto and tune chips are mutually exclusive lenses
    const next = !keto;
    setKeto(next);
    // First flip on this scan → run the keto agent; afterwards the cached
    // slate makes the toggle instant. (Re-entering during a run is guarded.)
    if (next && ketoPicks === null && ketoState !== 'running') void runKeto();
  };

  const toggleGate = () => {
    if (!reduceMotion) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setGateOpen((g) => !g);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {/* ── Header: eyebrow + restaurant name + mode toggle */}
        <View style={styles.head}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Eyebrow>
              scanned · {items.length} {items.length === 1 ? 'dish' : 'dishes'}
            </Eyebrow>
            <Text style={styles.restaurant} numberOfLines={2}>
              {restaurantName || 'Here’s the place'}
            </Text>
          </View>
          <Pressable
            onPress={toggleKeto}
            style={[styles.modeToggle, keto && styles.modeToggleOn]}
            hitSlop={6}>
            <Text style={[styles.modeToggleText, keto && styles.modeToggleTextOn]}>
              {keto ? '✦ Keto' : 'Keto?'}
            </Text>
          </Pressable>
        </View>

        {/* ── The gate line — trust made visible. Always shown when items are
            blocked; "view" expands the full list with reasons. */}
        {blocked.length > 0 && (
          <View>
            <Pressable style={styles.gateLine} onPress={toggleGate} hitSlop={6}>
              <View style={styles.gateDot} />
              <Text style={styles.gateText} numberOfLines={2}>
                {blocked.length} {blocked.length === 1 ? 'dish' : 'dishes'} hidden for you —{' '}
                {gateSummary(blocked)} ·{' '}
                <Text style={styles.gateView}>{gateOpen ? 'hide' : 'view'}</Text>
              </Text>
            </Pressable>
            {gateOpen && (
              <View style={styles.gateList}>
                {blocked.map((b, i) => (
                  <View key={b.item.id || `blocked-${i}`} style={styles.gateRow}>
                    <Text style={styles.gateName} numberOfLines={1}>{b.item.name}</Text>
                    <Text style={styles.gateReason}>{b.reasons.join(' · ')}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Restaurant-level trust signal (halal/kosher certification) — one
            quiet line per note, same register as the gate line. */}
        {trustNotes.map((note, i) => (
          <View key={i} style={styles.gateLine}>
            <Text style={styles.trustCheck}>✓</Text>
            <Text style={styles.gateText} numberOfLines={2}>{note}</Text>
          </View>
        ))}

        {/* ── Popular ⇄ Custom segmented toggle. Appears once a Custom result
            exists; switching between the two cached sets is free (no re-rank). */}
        {customReady && rankState !== 'running' && (
          <View style={styles.viewToggle}>
            <Pressable
              onPress={() => switchView('popular')}
              style={[styles.viewSeg, view === 'popular' && styles.viewSegOn]}>
              <Text style={[styles.viewSegText, view === 'popular' && styles.viewSegTextOn]}>
                ★ Popular
              </Text>
            </Pressable>
            <Pressable
              onPress={() => switchView('custom')}
              style={[styles.viewSeg, view === 'custom' && styles.viewSegOn]}>
              <Text style={[styles.viewSegText, view === 'custom' && styles.viewSegTextOn]}>
                Custom
              </Text>
            </Pressable>
          </View>
        )}

        {candidates.length === 0 && (
          <Body style={styles.emptyPicks}>
            Nothing on this menu cleared your hard restrictions. Open the gate
            line above to see what was ruled out — ask staff if you want to
            double-check any.
          </Body>
        )}

        {/* Live ranking status — real pipeline events, never a fake timer. */}
        {rankState === 'running' && <RankStatus steps={steps} />}
        {ketoLoading && <RankStatus steps={ketoSteps} />}
        {keto && ketoState === 'error' && (
          <Body style={styles.emptyPicks}>
            The keto agent couldn’t read this menu — showing your picks
            lowest-carb first instead (no swaps).
          </Body>
        )}
        {rankState === 'error' && (
          <View style={styles.rankBox}>
            <Body style={styles.emptyPicks}>
              The menu is read — only the ranking failed. Give it another go.
            </Body>
            <PrimaryButton
              label="Try ranking again"
              onPress={() => lastRank.current && void runRank(lastRank.current)}
            />
          </View>
        )}

        {/* ── The deal: hero + two contenders */}
        {hero && rankState !== 'running' && !ketoLoading && (
          <View key={dealKey} style={styles.deal}>
            <DealIn index={0} reduceMotion={reduceMotion}>
              <HeroCard
                entry={hero}
                badge={badgeFor(hero)}
                locked={locked}
                onLock={() => setLocked(true)}
                onOpen={() => openSheet(hero)}
              />
            </DealIn>
            {contenders.map((entry, i) => (
              <DealIn key={entry.item.id} index={i + 1} reduceMotion={reduceMotion}>
                <ContenderCard entry={entry} badge={badgeFor(entry)} onOpen={() => openSheet(entry)} />
              </DealIn>
            ))}
            {locked && (
              <Text style={styles.lockedNote}>
                Saved to your taste profile · tell us how it was after
              </Text>
            )}
          </View>
        )}

        {/* The narrowing flow as a quiet offer. Before a Custom result exists
            it's the entry point ("refine for a custom order"); after, it lets
            the user re-run the narrowing to rebuild their Custom set. Hidden
            when no facet could split the (spice-trimmed) pool anyway. */}
        {refinable && rankState !== 'running' && (
          <Pressable onPress={() => setRefineOpen(true)} hitSlop={8}>
            <Text style={styles.refineLink}>
              {customReady
                ? 'Redo your custom order →'
                : (nudge ?? 'Want a custom order? Refine my picks') + ' →'}
            </Text>
          </Pressable>
        )}

        {rankState !== 'running' && (
          <Pressable onPress={scanAnother} hitSlop={8}>
            <Text style={styles.scanLink}>‹ Scan another menu</Text>
          </Pressable>
        )}
      </ScrollView>

      {/* ── Persistent tune chips — deterministic re-deals, zero tokens. */}
      {activePicks.length > 1 && rankState !== 'running' && (
        <View style={styles.tuneBar}>
          {TUNES.map((t) => {
            const on = tune === t.id;
            return (
              <Pressable
                key={t.id}
                onPress={() => toggleTune(t.id)}
                style={[styles.tuneChip, on && styles.tuneChipActive]}>
                <Text
                  style={[styles.tuneChipText, on && styles.tuneChipTextActive]}
                  numberOfLines={1}>
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {/* ── Refine sheet — narrowing questions without leaving the page. */}
      <RefineSheet
        visible={refineOpen}
        initialPool={trimmedPool}
        spiceCeiling={spiceCeiling}
        onDone={onRefineDone}
        onClose={() => setRefineOpen(false)}
      />

      {/* ── Detail sheet */}
      <Modal
        visible={sheet !== null}
        transparent
        animationType={reduceMotion ? 'fade' : 'slide'}
        onRequestClose={closeSheet}>
        <Pressable style={styles.sheetBackdrop} onPress={closeSheet}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            {sheet && (
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetBody}>
                <View style={styles.sheetGrabber} />
                <View style={styles.sheetHead}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    {sheet.kind === 'stretch' && (
                      <Eyebrow style={{ color: Plait.color.plum, marginBottom: 4 }}>your stretch</Eyebrow>
                    )}
                    <Text style={styles.sheetName}>{sheet.item.name}</Text>
                    <Text style={styles.sheetMeta}>
                      {sheet.item.price > 0 ? `$${sheet.item.price.toFixed(2)}` : ''}
                      {sheet.kind === 'pick'
                        ? `${sheet.item.price > 0 ? ' · ' : ''}match ${sheet.pick.match_score}`
                        : ''}
                    </Text>
                  </View>
                  <MatchRing
                    value={sheet.kind === 'pick' ? sheet.pick.match_score : null}
                    color={sheet.kind === 'stretch' ? Plait.color.plum : Plait.color.green}
                    size={40}
                  />
                </View>

                {sheet.kind === 'pick' && (
                  <View style={styles.sheetMacros}>
                    {sheet.pick.protein_g != null && (
                      <MacroBar label="protein" value={sheet.pick.protein_g} max={maxProtein} color={Plait.color.green} />
                    )}
                    {sheet.pick.carbs_g != null && (
                      <MacroBar label="carbs" value={sheet.pick.carbs_g} max={maxCarbs} color={Plait.color.inkFaint} />
                    )}
                    {sheet.pick.fat_g != null && (
                      <MacroBar label="fat" value={sheet.pick.fat_g} max={maxFat} color={Plait.color.inkFaint} />
                    )}
                    {(sheet.pick.protein_g ?? sheet.pick.carbs_g ?? sheet.pick.fat_g) != null && (
                      <Text style={styles.confidence}>
                        Est. macros {sheet.pick.confidence ? CONFIDENCE_LABEL[sheet.pick.confidence] : '±15%'} accuracy
                      </Text>
                    )}
                  </View>
                )}

                <Eyebrow style={{ marginBottom: 6 }}>about this dish</Eyebrow>
                {sheet.kind === 'stretch' ? (
                  <>
                    <Text style={styles.sheetWhy}>{sheet.why}</Text>
                    {sheet.item.description !== '' && (
                      <Text style={[styles.sheetWhy, { marginTop: 8 }]}>{sheet.item.description}</Text>
                    )}
                  </>
                ) : (
                  <>
                    <Text style={styles.sheetWhy}>{sheet.pick.why}</Text>
                    {detailLoading && (
                      <View style={styles.detailLoader}>
                        <ActivityIndicator size="small" color={Plait.color.green} />
                        <Text style={styles.detailLoaderText}>Getting the details…</Text>
                      </View>
                    )}
                    {!detailLoading && detailError && (
                      <Pressable onPress={() => openSheet(sheet)} hitSlop={6}>
                        <Text style={styles.errorText}>Couldn’t load extra details — tap to retry.</Text>
                      </Pressable>
                    )}
                    {!detailLoading && detail && detail.why_this_pick !== '' && (
                      <View style={{ marginTop: 8 }}>
                        <ExplainText text={detail.why_this_pick} terms={detail.explain_terms} />
                      </View>
                    )}
                  </>
                )}

                {sheet.kind === 'pick' && sheet.pick.swap && (
                  <View style={styles.swapBlock}>
                    <Eyebrow style={{ color: Plait.color.plum, marginBottom: 4 }}>
                      order it keto
                    </Eyebrow>
                    <Text style={styles.swapBlockText}>⇄ {sheet.pick.swap}</Text>
                  </View>
                )}

                {crowdBlurbFor(sheet.item) && (
                  <View style={styles.crowdBlock}>
                    <Eyebrow style={{ color: Plait.color.green, marginBottom: 4 }}>
                      crowd favorite · from web reviews
                    </Eyebrow>
                    <Text style={styles.crowdBlurb}>“{crowdBlurbFor(sheet.item)}”</Text>
                  </View>
                )}

                {askStaff(sheet).length > 0 && (
                  <View style={styles.askBlock}>
                    <Eyebrow style={{ color: Plait.color.amber, marginBottom: 6 }}>
                      before you order, ask staff
                    </Eyebrow>
                    {askStaff(sheet).map((v, i) => (
                      <View key={i} style={styles.askRow}>
                        <Text style={styles.askBullet}>•</Text>
                        <Text style={styles.askText}>{v}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

/** Hero card — rank 1, "our pick for you", with the hold-to-lock commitment. */
function HeroCard({
  entry,
  badge: badgeKind,
  locked,
  onLock,
  onOpen,
}: {
  entry: DisplayEntry;
  badge: BadgeKind;
  locked: boolean;
  onLock: () => void;
  onOpen: () => void;
}) {
  const stretchy = entry.kind === 'stretch';
  const accent = stretchy ? Plait.color.plum : Plait.color.green;
  return (
    <View style={[styles.hero, stretchy && styles.stretchBorder]}>
      <View style={styles.heroTop}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Eyebrow style={{ color: accent, marginBottom: 6 }}>
            {stretchy ? 'your stretch' : 'our pick for you'}
          </Eyebrow>
          <Pressable onPress={onOpen} hitSlop={4}>
            <Text style={styles.heroName}>{entry.item.name}</Text>
          </Pressable>
        </View>
        <MatchRing value={entry.kind === 'pick' ? entry.pick.match_score : null} color={accent} />
      </View>
      <Text style={styles.heroWhy}>{entry.kind === 'pick' ? entry.pick.why : entry.why}</Text>
      {entry.kind === 'pick' && entry.pick.swap && (
        <Text style={styles.swapLine}>⇄ {entry.pick.swap}</Text>
      )}
      <View style={styles.heroMeta}>
        {entry.item.price > 0 && (
          <Text style={styles.heroPrice}>${entry.item.price.toFixed(2)}</Text>
        )}
        <CardBadge kind={badgeKind} />
        <View style={{ flex: 1 }} />
        <Pressable onPress={onOpen} hitSlop={8}>
          <Text style={styles.whyLink}>details →</Text>
        </Pressable>
      </View>
      <HoldToLock locked={locked} onLock={onLock} />
    </View>
  );
}

/** Compact contender row — rank 2/3 (or the stretch pick in explore mode). */
function ContenderCard({
  entry,
  badge: badgeKind,
  onOpen,
}: {
  entry: DisplayEntry;
  badge: BadgeKind;
  onOpen: () => void;
}) {
  const stretchy = entry.kind === 'stretch';
  const accent = stretchy ? Plait.color.plum : Plait.color.green;
  return (
    <Pressable
      onPress={onOpen}
      style={({ pressed }) => [
        styles.contender,
        stretchy && styles.stretchBorder,
        pressed && { opacity: 0.85 },
      ]}>
      <MatchRing value={entry.kind === 'pick' ? entry.pick.match_score : null} color={accent} size={36} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.contenderTop}>
          <Text style={styles.contenderName} numberOfLines={1}>{entry.item.name}</Text>
          {entry.item.price > 0 && (
            <Text style={styles.contenderPrice}>${entry.item.price.toFixed(2)}</Text>
          )}
        </View>
        <Text style={styles.contenderWhy} numberOfLines={1}>
          {entry.kind === 'pick' ? entry.pick.why : entry.why}
        </Text>
        {entry.kind === 'pick' && entry.pick.swap && (
          <Text style={styles.contenderSwap} numberOfLines={1}>
            ⇄ {entry.pick.swap}
          </Text>
        )}
      </View>
      <CardBadge kind={badgeKind} />
    </Pressable>
  );
}

/**
 * Inline ranking status — one row per real pipeline stage, shown where the
 * pick cards will appear so the page reads "summary now, picks streaming in".
 */
function RankStatus({ steps }: { steps: ProgressStep[] }) {
  // Re-render a few times a second so the per-step timers tick (the timers
  // are real elapsed time — only the redraw is on an interval).
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, []);

  const now = Date.now();
  return (
    <View style={styles.rankBox}>
      {steps.length === 0 && <Text style={styles.rankRow}>🔥 Warming up…</Text>}
      {steps.map((step) => {
        const isDone = step.status === 'done';
        const seconds = (((step.endedAt ?? now) - step.startedAt) / 1000).toFixed(1);
        return (
          <View key={step.id} style={styles.rankLine}>
            <Text style={styles.rankRow} numberOfLines={1}>
              {isDone ? '✓' : step.icon} {step.label}
              {step.detail ? ` — ${step.detail}` : ''}
            </Text>
            <Text style={styles.rankTime}>{seconds}s</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Plait.color.paper },
  list: { gap: Plait.space.sm, paddingHorizontal: Plait.space.md, paddingBottom: Plait.space.lg },

  // Header
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Plait.space.sm,
    paddingTop: Plait.space.sm,
  },
  restaurant: { fontFamily: Plait.font.display, fontSize: 22, color: Plait.color.ink, marginTop: 2 },
  modeToggle: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: Plait.color.plum,
    borderRadius: Plait.radius.pill,
    paddingVertical: 8,
    paddingHorizontal: 13,
    marginTop: 2,
  },
  modeToggleOn: { backgroundColor: Plait.color.plum, borderStyle: 'solid' },
  modeToggleText: { fontFamily: Plait.font.bodyBold, fontSize: 12, color: Plait.color.plum },
  modeToggleTextOn: { color: '#FFFFFF' },

  // Popular ⇄ Custom segmented toggle
  viewToggle: {
    flexDirection: 'row',
    backgroundColor: Plait.color.card,
    borderWidth: 1,
    borderColor: Plait.color.line,
    borderRadius: Plait.radius.pill,
    padding: 3,
    gap: 3,
  },
  viewSeg: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: Plait.radius.pill,
  },
  viewSegOn: { backgroundColor: Plait.color.green },
  viewSegText: { fontFamily: Plait.font.bodySemiBold, fontSize: 13, color: Plait.color.inkSoft },
  viewSegTextOn: { color: '#FFFFFF' },

  // Gate line
  gateLine: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 2 },
  gateDot: { width: 7, height: 7, borderRadius: Plait.radius.pill, backgroundColor: Plait.color.green },
  gateText: { flex: 1, fontFamily: Plait.font.body, fontSize: 12, color: Plait.color.inkSoft },
  gateView: { fontFamily: Plait.font.bodySemiBold, color: Plait.color.green },
  gateList: {
    marginTop: 8,
    backgroundColor: Plait.color.card,
    borderRadius: Plait.radius.md,
    borderWidth: 1,
    borderColor: Plait.color.line,
    padding: Plait.space.sm,
    gap: 10,
  },
  gateRow: { gap: 2 },
  gateName: { fontFamily: Plait.font.bodySemiBold, fontSize: 14, color: Plait.color.ink },
  gateReason: { fontFamily: Plait.font.body, fontSize: 12.5, lineHeight: 17, color: Plait.color.inkSoft },
  trustCheck: { color: Plait.color.green, fontSize: 12, fontFamily: Plait.font.bodyBold },

  // Quiet lines
  refineLink: {
    textAlign: 'center',
    fontFamily: Plait.font.bodySemiBold,
    fontSize: 13,
    color: Plait.color.green,
    paddingVertical: 4,
  },
  scanLink: {
    textAlign: 'center',
    fontFamily: Plait.font.body,
    fontSize: 12.5,
    color: Plait.color.inkFaint,
    paddingVertical: 2,
  },

  // Deal
  deal: { gap: 10 },
  hero: {
    backgroundColor: Plait.color.card,
    borderRadius: Plait.radius.lg,
    borderWidth: 1,
    borderColor: Plait.color.line,
    padding: Plait.space.md,
    gap: 10,
    shadowColor: Plait.color.ink,
    shadowOpacity: 0.07,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  stretchBorder: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: Plait.color.plum },
  heroTop: { flexDirection: 'row', alignItems: 'flex-start', gap: Plait.space.sm },
  heroName: { fontFamily: Plait.font.display, fontSize: 23, lineHeight: 27, color: Plait.color.ink },
  heroWhy: { fontFamily: Plait.font.body, fontSize: 13.5, lineHeight: 20, color: Plait.color.inkSoft },
  heroMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  heroPrice: { fontFamily: Plait.font.monoSemiBold, fontSize: 14, color: Plait.color.ink },
  whyLink: { fontFamily: Plait.font.bodySemiBold, fontSize: 12, color: Plait.color.green },
  lockedNote: {
    textAlign: 'center',
    fontFamily: Plait.font.body,
    fontSize: 12,
    color: Plait.color.inkFaint,
  },
  contender: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Plait.space.sm,
    backgroundColor: Plait.color.card,
    borderRadius: Plait.radius.md,
    borderWidth: 1,
    borderColor: Plait.color.line,
    paddingVertical: 13,
    paddingHorizontal: 15,
  },
  contenderTop: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  contenderName: { flexShrink: 1, fontFamily: Plait.font.display, fontSize: 16.5, color: Plait.color.ink },
  contenderPrice: { fontFamily: Plait.font.mono, fontSize: 12, color: Plait.color.inkSoft },
  contenderWhy: { fontFamily: Plait.font.body, fontSize: 12, color: Plait.color.inkSoft, marginTop: 2 },

  // Detail sheet
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(27,30,27,0.35)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Plait.color.paper,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
  },
  sheetBody: { paddingHorizontal: Plait.space.md, paddingTop: 10, paddingBottom: Plait.space.lg },
  sheetGrabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Plait.color.line,
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Plait.space.sm },
  sheetName: { fontFamily: Plait.font.display, fontSize: 21, color: Plait.color.ink },
  sheetMeta: { fontFamily: Plait.font.mono, fontSize: 13, color: Plait.color.inkSoft, marginTop: 3 },
  sheetMacros: { marginVertical: Plait.space.md, gap: 8 },
  confidence: { fontFamily: Plait.font.mono, fontSize: 10.5, color: Plait.color.inkFaint, marginTop: 2 },
  sheetWhy: { fontFamily: Plait.font.body, fontSize: 13.5, lineHeight: 21, color: Plait.color.inkSoft },
  detailLoader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: Plait.space.sm },
  detailLoaderText: { color: Plait.color.inkSoft, fontSize: 13, fontFamily: Plait.font.body },
  errorText: { color: Plait.color.inkSoft, fontSize: 13, fontFamily: Plait.font.body, paddingVertical: 8 },
  // Keto swap — only the keto agent emits swaps, so plum = "modified order".
  swapLine: { fontFamily: Plait.font.bodySemiBold, fontSize: 12.5, color: Plait.color.plum },
  contenderSwap: {
    fontFamily: Plait.font.bodySemiBold,
    fontSize: 11.5,
    color: Plait.color.plum,
    marginTop: 2,
  },
  swapBlock: {
    marginTop: 16,
    backgroundColor: Plait.color.plumSoft,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  swapBlockText: {
    fontFamily: Plait.font.bodySemiBold,
    fontSize: 13,
    lineHeight: 19,
    color: Plait.color.plum,
  },
  crowdBlock: {
    marginTop: 16,
    backgroundColor: Plait.color.greenSoft,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  crowdBlurb: { fontFamily: Plait.font.body, fontSize: 13, lineHeight: 19, color: Plait.color.ink },
  askBlock: {
    marginTop: 16,
    backgroundColor: Plait.color.amberSoft,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 4,
  },
  askRow: { flexDirection: 'row', gap: 7, alignItems: 'flex-start' },
  askBullet: { color: Plait.color.amber, fontSize: 13, lineHeight: 19 },
  askText: { flex: 1, fontFamily: Plait.font.body, fontSize: 13, lineHeight: 19, color: Plait.color.ink },

  // Ranking status
  rankBox: {
    backgroundColor: Plait.color.card,
    borderRadius: Plait.radius.md,
    borderWidth: 1,
    borderColor: Plait.color.line,
    padding: Plait.space.md,
    gap: Plait.space.sm,
  },
  rankLine: { flexDirection: 'row', alignItems: 'center', gap: Plait.space.sm },
  rankRow: { flex: 1, color: Plait.color.ink, fontSize: 13.5, fontFamily: Plait.font.body },
  rankTime: { color: Plait.color.inkSoft, fontSize: 12, fontFamily: Plait.font.mono },

  // Tune chips (persistent bottom row)
  tuneBar: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: Plait.space.md,
    paddingTop: 10,
    paddingBottom: Plait.space.md,
    borderTopWidth: 1,
    borderTopColor: Plait.color.line,
    backgroundColor: Plait.color.paper,
  },
  tuneChip: {
    flex: 1,
    alignItems: 'center',
    borderRadius: Plait.radius.pill,
    borderWidth: 1.5,
    borderColor: Plait.color.line,
    backgroundColor: Plait.color.card,
    paddingVertical: 9,
    paddingHorizontal: 4,
  },
  tuneChipActive: { backgroundColor: Plait.color.green, borderColor: Plait.color.green },
  tuneChipText: { color: Plait.color.inkSoft, fontSize: 12, fontFamily: Plait.font.bodySemiBold },
  tuneChipTextActive: { color: '#FFFFFF' },

  emptyPicks: { color: Plait.color.inkSoft, fontSize: 14, lineHeight: 20 },
});
