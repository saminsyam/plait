/**
 * Picks screen — Sushi 2.1 (v2 spec, June 2026).
 *
 * One decision per screen: header + gate line, ONE hero card ("Our pick for
 * you") with hold-to-lock, two compact contenders, a detail sheet, and a
 * persistent tune-chip row. Everything else is a single quiet line — trust
 * notes, the refine offer, crowd favorites — or lives in the detail sheet.
 * The "Adventurous?" toggle flips one contender into a deterministic stretch
 * pick (dashed plum, zero tokens, allowed-only).
 *
 * All v1 engine behavior is preserved: instant rank off the scan, quick-tune
 * chips + budget ceiling (behind the $ chip) pre-trim the gated pool on-device
 * before ONE re-rank call, dish detail is lazily fetched and cached, crowd
 * favorites still feed the ranking context and the card badge, and blocked
 * items live behind the gate line's "view" — never silently dropped.
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

import { BudgetSlider } from '@/components/budget-slider';
import { HoldToLock } from '@/components/hold-to-lock';
import { MatchRing } from '@/components/match-ring';
import type { CrowdFavoritesState } from '@/components/restaurant-summary';
import { Body, Eyebrow, PrimaryButton } from '@/components/ui-kit';
import { Plait } from '@/constants/plait-theme';
import { useCrowdFavorites } from '@/hooks/use-crowd-favorites';
import { useProgressSteps, type ProgressStep } from '@/hooks/use-progress-steps';
import { budgetBounds, budgetRequest, filterByBudget } from '@/lib/budget';
import { callDishDetail, type DishDetail } from '@/lib/callDishDetail';
import { callReason } from '@/lib/callReason';
import type { FilteredItem } from '@/lib/dietaryFilter';
import { proteinValueLabel } from '@/lib/proteinValue';
import { filterBySpice, nextQuestion } from '@/lib/questionEngine';
import { applyQuickTunes, QUICK_TUNES, tuneRequests, type QuickTuneId } from '@/lib/quickTune';
import { refineNudge } from '@/lib/refineNudge';
import { formatUsd, getUsage } from '@/lib/usage';
import type { MenuItem, Pick } from '@/lib/types';
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

/** What the sheet (and the cards) are showing for one slot. */
type DisplayEntry =
  | { kind: 'pick'; pick: Pick; item: MenuItem }
  | { kind: 'stretch'; item: MenuItem; why: string };

/**
 * Deterministic bridge pick for explore mode — zero tokens. An `allowed`-only
 * candidate outside the current picks (verify items never stretch: stretch
 * requires HIGHER confidence, never lower), preferring house signatures and
 * dishes sharing a flavor lane with the hero so the unfamiliar item has a
 * bridge back to something the ranker already matched.
 */
function bridgePick({
  picks,
  candidates,
  verifyById,
  signatureIds,
  byId,
}: {
  picks: Pick[];
  candidates: MenuItem[];
  verifyById: Record<string, string[]>;
  signatureIds: string[];
  byId: Map<string, MenuItem>;
}): { item: MenuItem; why: string } | null {
  const picked = new Set(picks.map((p) => p.item_id));
  const hero = picks.length > 0 ? byId.get(picks[0].item_id) : undefined;
  const sigs = new Set(signatureIds);
  const pool = candidates.filter((c) => !picked.has(c.id) && !(verifyById[c.id]?.length));
  if (pool.length === 0) return null;

  const shared = (c: MenuItem) =>
    hero ? c.flavor_profile.filter((f) => hero.flavor_profile.includes(f)) : [];
  const score = (c: MenuItem) => (sigs.has(c.id) ? 2 : 0) + Math.min(2, shared(c).length);
  const sorted = [...pool].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
  const item = sorted[0];

  const bridge = shared(item);
  const why =
    hero && bridge.length > 0
      ? `New to you — shares the ${bridge[0]} lane of the ${hero.name}, a low-risk doorway.`
      : sigs.has(item.id)
        ? 'New to you — a house signature that still clears your gate.'
        : 'New to you — a different lane on this menu that still clears your gate.';
  return { item, why };
}

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
function CardBadge({ kind }: { kind: 'verify' | 'stretch' | 'crowd' | 'spice' | null }) {
  if (kind === 'verify')
    return <Text style={[badge.base, badge.verify]}>ask staff</Text>;
  if (kind === 'stretch')
    return <Text style={[badge.base, badge.stretch]}>stretch pick</Text>;
  if (kind === 'crowd')
    return <Text style={[badge.base, badge.crowd]}>★ crowd favorite</Text>;
  if (kind === 'spice')
    return <Text style={[badge.base, badge.spice]}>🌶 spicier than stated</Text>;
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

export default function ResultsScreen() {
  const router = useRouter();
  const session = useSession();
  const { preferences, tdee, spiceCeiling } = useProfile();
  const {
    picks,
    items,
    questions,
    answers,
    restaurantNotes,
    blocked,
    candidates,
    verifyById,
    menuContext,
    crowdFavorites,
    picksSource,
    setOutcome,
  } = session;
  const { crowdState, crowdReady } = useCrowdFavorites();


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

  // ── Instant ranking — the scan lands here directly; picks arrive without
  // questions. The narrowing flow is an optional refinement (button below).
  const { steps, onProgress, resetProgress } = useProgressSteps();
  const [rankState, setRankState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [tunes, setTunes] = useState<QuickTuneId[]>([]);
  // Per-menu price ceiling from the budget slider; null = no limit.
  const [budget, setBudget] = useState<number | null>(null);
  const rankStarted = useRef(false);

  // ── v2 picks-screen state: mode toggle, hold-to-lock, gate-line view,
  // and the budget panel folded behind the $ chip in the tune bar.
  const [adventurous, setAdventurous] = useState(false);
  const [locked, setLocked] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);

  const runRank = useCallback(
    async (tuneIds: QuickTuneId[], ceiling: number | null) => {
      setRankState('running');
      setLocked(false);
      resetProgress();
      try {
        // Profile heat ceiling + budget ceiling + active chips pre-trim the
        // pool on-device — zero tokens, and only ever over the gate's survivors.
        const pool = applyQuickTunes(
          filterByBudget(filterBySpice(candidates, spiceCeiling), ceiling),
          tuneIds
        );
        // One short context line for review-praised dishes still in the pool.
        // (Gate-blocked items were never candidates, so they can't appear here.)
        const crowdNames = pool.filter((i) => crowdFavorites[i.id]).map((i) => i.name);
        const ranked = await callReason({
          items: pool,
          questions: [],
          answers: {},
          userPreferences: preferences ?? '',
          verifyById,
          tdeeContext: tdee,
          restaurantNotes,
          crowdFavorites: crowdNames,
          tuneRequests: [
            ...tuneRequests(tuneIds),
            ...(budgetRequest(ceiling) ? [budgetRequest(ceiling)!] : []),
          ],
          onProgress,
        });
        setOutcome({ questions: [], answers: {}, spice: spiceCeiling, picks: ranked, source: 'instant' });
        setRankState('done');
      } catch {
        setRankState('error');
      }
    },
    [candidates, spiceCeiling, crowdFavorites, preferences, verifyById, tdee, restaurantNotes, onProgress, resetProgress, setOutcome]
  );

  const hasScan = !!menuContext && items.length > 0;
  useEffect(() => {
    if (rankStarted.current) return;
    if (!hasScan || candidates.length === 0) return;
    // Wait for the (local, fast) review-cache check so cached crowd favorites
    // make it into the very first ranking call instead of racing it.
    if (!crowdReady) return;
    // A ranking already ran for this scan (e.g. returning from refine).
    if (picks.length > 0 || picksSource !== null) return;
    rankStarted.current = true;
    void runRank([], null);
  }, [hasScan, candidates.length, picks.length, picksSource, crowdReady, runRank]);

  // One-tap corrections: toggle a chip → one re-rank with the new set.
  const toggleTune = (id: QuickTuneId) => {
    if (rankState === 'running') return;
    const next = tunes.includes(id) ? tunes.filter((t) => t !== id) : [...tunes, id];
    setTunes(next);
    void runRank(next, budget);
  };

  // Budget slider release → one re-rank with the new ceiling (null = no limit).
  const commitBudget = (ceiling: number | null) => {
    if (rankState === 'running' || ceiling === budget) return;
    setBudget(ceiling);
    void runRank(tunes, ceiling);
  };

  // Guard: no scan in progress → home. <Redirect> (not router.replace in an
  // effect) is safe on a cold web load, before the root navigator mounts.
  if (!hasScan) return <Redirect href="/" />;

  const byId = new Map(items.map((i) => [i.id, i]));

  // A halal/kosher certification note is a positive trust signal — surface it
  // as a banner, and suppress the per-dish "verify halal" flag (cert covers it).
  const halalCertified = restaurantNotes.some((n) => /halal/i.test(n));
  const trustNotes = restaurantNotes.filter((n) => /halal|kosher/i.test(n));

  const maxProtein = Math.max(1, ...picks.map((p) => p.protein_g ?? 0));
  const maxCarbs = Math.max(1, ...picks.map((p) => p.carbs_g ?? 0));
  const maxFat = Math.max(1, ...picks.map((p) => p.fat_g ?? 0));

  /** verify > stretch > spicier > crowd — one badge per card (spec). */
  const badgeFor = (entry: DisplayEntry): 'verify' | 'stretch' | 'crowd' | 'spice' | null => {
    const id = entry.item.id;
    if (entry.kind === 'stretch') return 'stretch';
    const flag = entry.pick.flag === 'verify_halal' && halalCertified ? null : entry.pick.flag;
    if (flag === 'verify_halal' || flag === 'contains_allergen' || verifyById[id]?.length)
      return 'verify';
    if (flag === 'spicier_than_stated') return 'spice';
    if (crowdFavorites[id]) return 'crowd';
    return null;
  };

  /** Reviewer blurb for a dish, when the loaded crowd favorites include it. */
  const crowdBlurbFor = (item: MenuItem): string | null => {
    const name = crowdFavorites[item.id];
    if (!name || crowdState.kind !== 'loaded') return null;
    return crowdState.favorites.find((f) => f.name === name)?.blurb || null;
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
    const cached = detailCache.current[id];
    if (cached) {
      setDetail(cached);
      setDetailLoading(false);
      return;
    }
    setDetail(null);
    setDetailLoading(true);
    (async () => {
      try {
        const otherPicks = picks
          .filter((p) => p.item_id !== entry.pick.item_id)
          .map((p) => ({ name: byId.get(p.item_id)?.name ?? 'Another dish', why: p.why }));
        const d = await callDishDetail({
          pick: entry.pick,
          item: entry.item,
          preferences: preferences ?? '',
          tdee,
          questions,
          answers,
          otherPicks,
          isTopPick: entry.pick.rank === 1,
        });
        detailCache.current[id] = d;
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
  const cuisine =
    menuContext!.cuisine_type && menuContext!.cuisine_type !== 'unknown'
      ? menuContext!.cuisine_type
      : null;
  const restaurantName = menuContext!.restaurant_name.trim();

  // Refinement availability + the deterministic "would questions help?" nudge
  // (the nudge text, when present, becomes the refine link's label).
  const trimmedPool = filterBySpice(candidates, spiceCeiling);
  // Budget range from the spice-trimmed pool's prices (null = no $ chip).
  const priceBounds = budgetBounds(trimmedPool);
  const refinable = picks.length > 0 && nextQuestion(trimmedPool, new Set()) !== null;
  const nudge =
    refinable && picksSource === 'instant' && rankState !== 'running'
      ? refineNudge({
          poolSize: trimmedPool.length,
          preferencesText: preferences ?? '',
          picks,
        })
      : null;

  // ── Assemble the displayed deal: hero + two contenders. Adventurous mode
  // flips the first contender into the deterministic stretch pick.
  const rankedEntries: DisplayEntry[] = picks
    .map((p) => {
      const item = byId.get(p.item_id);
      return item ? ({ kind: 'pick', pick: p, item } as DisplayEntry) : null;
    })
    .filter((e): e is DisplayEntry => e !== null);
  const stretch = adventurous
    ? bridgePick({ picks, candidates, verifyById, signatureIds: o.signature_item_ids, byId })
    : null;
  const hero = rankedEntries[0] ?? null;
  const contenders: DisplayEntry[] = stretch
    ? [{ kind: 'stretch', item: stretch.item, why: stretch.why }, ...rankedEntries.slice(1, 2)]
    : rankedEntries.slice(1, 3);

  // Re-deal the stagger animation whenever the visible set changes.
  const dealKey = `${picks.map((p) => p.item_id).join('·')}·${adventurous}`;

  const toggleAdventurous = () => {
    setLocked(false);
    setAdventurous((a) => !a);
  };

  const toggleGate = () => {
    if (!reduceMotion) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setGateOpen((g) => !g);
  };

  const toggleBudget = () => {
    if (!reduceMotion) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setBudgetOpen((b) => !b);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {/* ── Header: eyebrow + restaurant name + mode toggle */}
        <View style={styles.head}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Eyebrow>
              scanned{cuisine ? ` · ${cuisine}` : ''} · {items.length}{' '}
              {items.length === 1 ? 'dish' : 'dishes'}
            </Eyebrow>
            <Text style={styles.restaurant} numberOfLines={2}>
              {restaurantName || 'Here’s the place'}
            </Text>
          </View>
          <Pressable
            onPress={toggleAdventurous}
            style={[styles.modeToggle, adventurous && styles.modeToggleOn]}
            hitSlop={6}>
            <Text style={[styles.modeToggleText, adventurous && styles.modeToggleTextOn]}>
              {adventurous ? '✦ Adventurous' : 'Adventurous?'}
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
                {gateSummary(blocked)} · <Text style={styles.gateView}>{gateOpen ? 'hide' : 'view'}</Text>
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

        {candidates.length === 0 && (
          <Body style={styles.emptyPicks}>
            Nothing on this menu cleared your hard restrictions. Open the gate
            line above to see what was ruled out — ask staff if you want to
            double-check any.
          </Body>
        )}

        {/* Live ranking status — real pipeline events, never a fake timer. */}
        {rankState === 'running' && <RankStatus steps={steps} />}
        {rankState === 'error' && (
          <View style={styles.rankBox}>
            <Body style={styles.emptyPicks}>
              The menu is read — only the ranking failed. Give it another go.
            </Body>
            <PrimaryButton label="Try ranking again" onPress={() => void runRank(tunes, budget)} />
          </View>
        )}

        {/* ── The deal: hero + two contenders */}
        {hero && (
          <View key={dealKey} style={styles.deal}>
            <DealIn index={0} reduceMotion={reduceMotion}>
              <HeroCard
                entry={hero}
                badge={badgeFor(hero)}
                valueLabel={
                  tunes.includes('protein_value') && hero.kind === 'pick'
                    ? proteinValueLabel(hero.pick.protein_g, hero.item.price)
                    : null
                }
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

        {/* The narrowing flow, demoted to one quiet offer — the deterministic
            nudge supplies the label when it fires; hidden when no facet could
            split the (spice-trimmed) pool anyway. */}
        {refinable && rankState !== 'running' && (
          <Pressable onPress={() => router.push('/questions')} hitSlop={8}>
            <Text style={styles.refineLink}>{nudge ?? 'Not quite? Refine my picks'} →</Text>
          </Pressable>
        )}

        {/* Crowd favorites, compressed to one honest line. Loaded names still
            feed the ranking context + card badges; blurbs live in the sheet. */}
        <CrowdLine state={crowdState} />

        <PrimaryButton label="Scan another menu" variant="ghost" onPress={scanAnother} />
        <UsageLine />
      </ScrollView>

      {/* ── Persistent tune chips — deterministic re-deals, zero tokens until
          the single re-rank call. The $ chip unfolds the menu-priced budget
          slider; everything else on the screen stays put. */}
      {candidates.length > 1 && picksSource !== null && (
        <View style={styles.tuneBar}>
          {budgetOpen && priceBounds && (
            <BudgetSlider
              bounds={priceBounds}
              value={budget}
              disabled={rankState === 'running'}
              onCommit={commitBudget}
            />
          )}
          <View style={styles.tuneRow}>
            {priceBounds && (
              <Pressable
                onPress={toggleBudget}
                style={[
                  styles.tuneChip,
                  styles.tuneChipBudget,
                  budgetOpen && styles.tuneChipOpen,
                  budget !== null && styles.tuneChipActive,
                  rankState === 'running' && { opacity: 0.4 },
                ]}>
                <Text
                  style={[styles.tuneChipText, budget !== null && styles.tuneChipTextActive]}
                  numberOfLines={1}>
                  {budget !== null ? `≤ $${budget}` : '💸 $'}
                </Text>
              </Pressable>
            )}
            {QUICK_TUNES.map((t) => {
              const on = tunes.includes(t.id);
              return (
                <Pressable
                  key={t.id}
                  onPress={() => toggleTune(t.id)}
                  style={[
                    styles.tuneChip,
                    on && styles.tuneChipActive,
                    rankState === 'running' && { opacity: 0.4 },
                  ]}>
                  <Text style={[styles.tuneChipText, on && styles.tuneChipTextActive]} numberOfLines={1}>
                    {t.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

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
                      {sheet.kind === 'pick' ? `${sheet.item.price > 0 ? ' · ' : ''}match ${sheet.pick.match_score}` : ''}
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

                <Eyebrow style={{ marginBottom: 6 }}>why this pick</Eyebrow>
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
                    {!detailLoading && detail && (
                      <>
                        {detail.why_this_pick !== '' && (
                          <Text style={[styles.sheetWhy, { marginTop: 8 }]}>{detail.why_this_pick}</Text>
                        )}
                        {detail.how_to_order.length > 0 && (
                          <>
                            <Eyebrow style={{ color: Plait.color.green, marginTop: 16, marginBottom: 6 }}>
                              how to order
                            </Eyebrow>
                            {detail.how_to_order.map((m, i) => (
                              <View key={i} style={styles.orderRow}>
                                <Text style={styles.orderPlus}>+</Text>
                                <Text style={styles.orderText}>{m}</Text>
                              </View>
                            ))}
                          </>
                        )}
                        {sheet.pick.rank === 1 && detail.why_not_others !== '' && (
                          <Text style={styles.whyNot}>{detail.why_not_others}</Text>
                        )}
                      </>
                    )}
                  </>
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
  valueLabel,
  locked,
  onLock,
  onOpen,
}: {
  entry: DisplayEntry;
  badge: 'verify' | 'stretch' | 'crowd' | 'spice' | null;
  valueLabel: string | null;
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
      <View style={styles.heroMeta}>
        {entry.item.price > 0 && (
          <Text style={styles.heroPrice}>${entry.item.price.toFixed(2)}</Text>
        )}
        <CardBadge kind={badgeKind} />
        {valueLabel && <Text style={styles.valueLabel}>💪 {valueLabel}</Text>}
        <View style={{ flex: 1 }} />
        <Pressable onPress={onOpen} hitSlop={8}>
          <Text style={styles.whyLink}>why? →</Text>
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
  badge: 'verify' | 'stretch' | 'crowd' | 'spice' | null;
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
      </View>
      <CardBadge kind={badgeKind} />
    </Pressable>
  );
}

/**
 * Inline ranking status — one row per real pipeline stage (same events the
 * full-screen CookingLoader consumes elsewhere), shown where the pick cards
 * will appear so the page reads "summary now, picks streaming in".
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
              {isDone ? '✅' : step.icon} {step.label}
              {step.detail ? ` — ${step.detail}` : ''}
            </Text>
            <Text style={styles.rankTime}>{seconds}s</Text>
          </View>
        );
      })}
    </View>
  );
}

/**
 * Crowd favorites, compressed from the v1 tile to one honest line. The offer
 * keeps its price tag; loading shows the REAL latest pipeline status; loaded
 * lists the reviewer-cited names (⚠️ = conflicts with your hard constraints);
 * a dry search says so instead of inventing reviews.
 */
function CrowdLine({ state }: { state: CrowdFavoritesState }) {
  if (state.kind === 'hidden') return null;
  if (state.kind === 'offer') {
    return (
      <Pressable onPress={state.onFetch} hitSlop={8}>
        <Text style={styles.crowdLine}>
          <Text style={styles.crowdLink}>★ See what reviewers order</Text> · one search · ~$0.02
        </Text>
      </Pressable>
    );
  }
  if (state.kind === 'loading') {
    return <Text style={styles.crowdLine}>★ {state.statusLine ?? 'Searching reviews…'}</Text>;
  }
  if (state.kind === 'empty') {
    return (
      <Text style={styles.crowdLine}>
        ★ {state.message ?? 'No reviews found for this place — nothing to cite.'}
      </Text>
    );
  }
  const names = state.favorites.map((f) => (f.warning ? `⚠️ ${f.name}` : f.name));
  return (
    <Text style={styles.crowdLine} numberOfLines={2}>
      ★ Reviewers love: {names.join(', ')} · from web reviews
    </Text>
  );
}

/** Dim one-liner with the app-session API spend — taps through to /stats. */
function UsageLine() {
  const router = useRouter();
  const { totals } = getUsage();
  if (totals.calls === 0) return null;
  const tokens = totals.inputTokens + totals.outputTokens;
  return (
    <Pressable onPress={() => router.push('/stats')} hitSlop={8}>
      <Text style={styles.usageLine}>
        ⚡ {totals.calls} API calls · {(tokens / 1000).toFixed(1)}k tokens ·{' '}
        {formatUsd(totals.costUsd)} this session ›
      </Text>
    </Pressable>
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

  // Quiet lines (trust note · refine offer · crowd favorites)
  trustCheck: { color: Plait.color.green, fontSize: 12, fontFamily: Plait.font.bodyBold },
  refineLink: {
    textAlign: 'center',
    fontFamily: Plait.font.bodySemiBold,
    fontSize: 13,
    color: Plait.color.green,
    paddingVertical: 4,
  },
  crowdLine: {
    textAlign: 'center',
    fontFamily: Plait.font.body,
    fontSize: 12,
    lineHeight: 17,
    color: Plait.color.inkSoft,
    paddingVertical: 2,
  },
  crowdLink: { fontFamily: Plait.font.bodySemiBold, color: Plait.color.green },

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
  valueLabel: { fontFamily: Plait.font.bodySemiBold, fontSize: 11, color: Plait.color.green },
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
  orderRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginBottom: 4 },
  orderPlus: { color: Plait.color.green, fontSize: 15, fontFamily: Plait.font.bodyBold, lineHeight: 21 },
  orderText: { flex: 1, color: Plait.color.ink, fontSize: 14, lineHeight: 21, fontFamily: Plait.font.body },
  whyNot: {
    color: Plait.color.inkFaint,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: Plait.font.body,
    fontStyle: 'italic',
    marginTop: 12,
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

  // Tune chips (persistent bottom row; budget slider unfolds above the chips)
  tuneBar: {
    gap: 10,
    paddingHorizontal: Plait.space.md,
    paddingTop: 10,
    paddingBottom: Plait.space.md,
    borderTopWidth: 1,
    borderTopColor: Plait.color.line,
    backgroundColor: Plait.color.paper,
  },
  tuneRow: { flexDirection: 'row', gap: 8 },
  tuneChipBudget: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto', paddingHorizontal: 14 },
  tuneChipOpen: { borderColor: Plait.color.green },
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
  usageLine: {
    color: Plait.color.inkFaint,
    fontSize: 11.5,
    fontFamily: Plait.font.mono,
    textAlign: 'center',
  },
});
