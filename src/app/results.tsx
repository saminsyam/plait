import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  LayoutAnimation,
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
import { RestaurantSummary } from '@/components/restaurant-summary';
import { Body, Loading, PrimaryButton, Subtitle, Title } from '@/components/ui-kit';
import { Plait } from '@/constants/plait-theme';
import { useCrowdFavorites } from '@/hooks/use-crowd-favorites';
import { useProgressSteps, type ProgressStep } from '@/hooks/use-progress-steps';
import { budgetBounds, budgetRequest, filterByBudget } from '@/lib/budget';
import { proteinValueLabel } from '@/lib/proteinValue';
import { callDishDetail, type DishDetail } from '@/lib/callDishDetail';
import { callReason } from '@/lib/callReason';
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

const RANK_COLORS = [Plait.color.coral, Plait.color.teal, '#C9A24B'];

const CONFIDENCE_LABEL: Record<string, string> = {
  high: '±10%',
  medium: '±15%',
  low: '±25%',
};

/** Halal / allergen flags are liability-grade — give them a stronger treatment. */
function isStrongFlag(flag: Pick['flag']): boolean {
  return flag === 'verify_halal' || flag === 'contains_allergen';
}

function flagLabel(flag: Pick['flag']): string | null {
  switch (flag) {
    case 'verify_halal': return '⚠️ Verify halal';
    case 'contains_allergen': return '⚠️ Possible allergen';
    case 'spicier_than_stated': return '🌶️ Spicier than stated';
    default: return null;
  }
}

/**
 * A single horizontal macro bar. Width is relative to the largest value among
 * the picks — grams only, no daily-target math (TDEE UI is deferred; its
 * plumbing in profile/callDishDetail stays for later).
 */
function MacroBar({
  emoji,
  label,
  value,
  max,
  color,
}: {
  emoji: string;
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const pct = Math.min(1, value / max);
  return (
    <View style={mb.row}>
      <Text style={mb.label}>
        {emoji} {label}
      </Text>
      <View style={mb.trackWrap}>
        <View style={mb.track}>
          <View style={[mb.fill, { width: `${Math.round(pct * 100)}%`, backgroundColor: color }]} />
        </View>
      </View>
      <Text style={mb.value}>{value}g</Text>
    </View>
  );
}

const mb = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: {
    color: Plait.color.textDim,
    fontSize: 12,
    fontWeight: '600',
    fontFamily: Plait.font.sans,
    width: 78,
  },
  trackWrap: { flex: 1 },
  track: { height: 6, backgroundColor: Plait.color.background, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  value: { color: Plait.color.textDim, fontSize: 12, fontFamily: Plait.font.sans, width: 34, textAlign: 'right' },
});

/** Animated chevron that rotates 180° between collapsed/expanded. */
function Chevron({ expanded, reduceMotion }: { expanded: boolean; reduceMotion: boolean }) {
  const v = useRef(new Animated.Value(expanded ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) {
      v.setValue(expanded ? 1 : 0);
      return;
    }
    Animated.timing(v, { toValue: expanded ? 1 : 0, duration: 250, useNativeDriver: true }).start();
  }, [expanded, reduceMotion, v]);
  const rotate = v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
  return <Animated.Text style={[styles.chevron, { transform: [{ rotate }] }]}>▾</Animated.Text>;
}

/** Fades + slides its children in once on mount (skips motion if reduced). */
function FadeInSection({
  children,
  delay,
  reduceMotion,
}: {
  children: React.ReactNode;
  delay: number;
  reduceMotion: boolean;
}) {
  const v = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    Animated.timing(v, { toValue: 1, duration: 280, delay, useNativeDriver: true }).start();
  }, [delay, reduceMotion, v]);
  const translateY = v.interpolate({ inputRange: [0, 1], outputRange: [8, 0] });
  return (
    <Animated.View style={{ opacity: v, transform: [{ translateY }] }}>{children}</Animated.View>
  );
}

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

  // Expand/detail state — only one card open at a time.
  const [expandedId, setExpandedId] = useState<string | null>(null);
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

  const runRank = useCallback(
    async (tuneIds: QuickTuneId[], ceiling: number | null) => {
      setRankState('running');
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

  const [nudgeDismissed, setNudgeDismissed] = useState(false);

  // Guard: no scan in progress → home.
  useEffect(() => {
    if (!hasScan) router.replace('/');
  }, [hasScan, router]);

  if (!hasScan) return <Loading message="Loading…" />;

  const byId = new Map(items.map((i) => [i.id, i]));

  // A halal/kosher certification note is a positive trust signal — surface it as
  // a banner, and suppress the per-dish "verify halal" flag (cert covers it).
  const halalCertified = restaurantNotes.some((n) => /halal/i.test(n));
  const trustNotes = restaurantNotes.filter((n) => /halal|kosher/i.test(n));

  const maxProtein = Math.max(1, ...picks.map((p) => p.protein_g ?? 0));
  const maxCarbs = Math.max(1, ...picks.map((p) => p.carbs_g ?? 0));
  const maxFat = Math.max(1, ...picks.map((p) => p.fat_g ?? 0));

  const animateLayout = () => {
    if (!reduceMotion) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  };

  const toggle = (pick: Pick, item: MenuItem) => {
    const id = item.id;
    const opening = expandedId !== id;
    animateLayout();

    if (!opening) {
      setExpandedId(null);
      activeIdRef.current = null;
      setDetail(null);
      setDetailError(false);
      setDetailLoading(false);
      return;
    }

    setExpandedId(id);
    activeIdRef.current = id;
    setDetailError(false);

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
          .filter((p) => p.item_id !== pick.item_id)
          .map((p) => ({ name: byId.get(p.item_id)?.name ?? 'Another dish', why: p.why }));
        const d = await callDishDetail({
          pick,
          item,
          preferences: preferences ?? '',
          tdee,
          questions,
          answers,
          otherPicks,
          isTopPick: pick.rank === 1,
        });
        detailCache.current[id] = d;
        if (activeIdRef.current === id) {
          animateLayout();
          setDetail(d);
        }
      } catch {
        if (activeIdRef.current === id) setDetailError(true);
      } finally {
        if (activeIdRef.current === id) setDetailLoading(false);
      }
    })();
  };

  const scanAnother = () => {
    session.reset();
    router.replace('/');
  };

  // hasScan guarantees menuContext from here down.
  const o = menuContext!.orientation;
  const signatures = o.signature_item_ids
    .map((id) => byId.get(id)?.name)
    .filter((n): n is string => !!n);
  const cuisine =
    menuContext!.cuisine_type && menuContext!.cuisine_type !== 'unknown'
      ? menuContext!.cuisine_type
      : null;
  const restaurantName = menuContext!.restaurant_name.trim();

  // Refinement availability + the deterministic "would questions help?" nudge.
  const trimmedPool = filterBySpice(candidates, spiceCeiling);
  // Budget slider range from the spice-trimmed pool's prices (null = no slider).
  const priceBounds = budgetBounds(trimmedPool);
  const refinable = picks.length > 0 && nextQuestion(trimmedPool, new Set()) !== null;
  const nudge =
    refinable && picksSource === 'instant' && !nudgeDismissed && rankState !== 'running'
      ? refineNudge({
          poolSize: trimmedPool.length,
          preferencesText: preferences ?? '',
          picks,
        })
      : null;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        <View style={styles.head}>
          <Title style={{ fontSize: 34 }} numberOfLines={2}>
            {restaurantName || 'Here’s the place'}
          </Title>
          <Subtitle numberOfLines={2}>Ranked for {preferences ?? 'your preferences'}.</Subtitle>
        </View>

        {/* The 10-second restaurant read, shared with the lookup page. */}
        <RestaurantSummary
          mode="scan"
          cuisine={cuisine}
          summary={o.summary}
          knownFor={o.known_for}
          crowdFavorites={crowdState}
          menuHighlights={signatures}
        />

        {/* Restaurant-level trust signal (halal/kosher certification) */}
        {trustNotes.length > 0 && (
          <View style={styles.trustBanner}>
            {trustNotes.map((note, i) => (
              <Text key={i} style={styles.trustText}>✓ Restaurant note: “{note}”</Text>
            ))}
          </View>
        )}

        {candidates.length > 0 && <Text style={styles.picksHeader}>Your top picks</Text>}

        {/* Deterministic nudge — shown only when refinement would plausibly
            sharpen the instant picks; one tap to refine, ✕ to dismiss. */}
        {nudge && (
          <View style={styles.nudgeRow}>
            <Pressable style={styles.nudgeBody} onPress={() => router.push('/questions')} hitSlop={6}>
              <Text style={styles.nudgeText}>💡 {nudge}</Text>
            </Pressable>
            <Pressable onPress={() => setNudgeDismissed(true)} hitSlop={10}>
              <Text style={styles.nudgeClose}>✕</Text>
            </Pressable>
          </View>
        )}

        {/* Budget slider — range derived from THIS menu's prices; commit on
            release → deterministic pool trim + one re-rank (like the chips). */}
        {priceBounds && picksSource !== null && (
          <BudgetSlider
            bounds={priceBounds}
            value={budget}
            disabled={rankState === 'running'}
            onCommit={commitBudget}
          />
        )}

        {/* Quick-tune chips — deterministic pool filters + one context line,
            one re-rank per tap. Far lighter than the full refine flow. */}
        {candidates.length > 1 && picksSource !== null && (
          <View style={styles.tuneRow}>
            {QUICK_TUNES.map((t) => {
              const active = tunes.includes(t.id);
              return (
                <Pressable
                  key={t.id}
                  onPress={() => toggleTune(t.id)}
                  style={[
                    styles.tuneChip,
                    active && styles.tuneChipActive,
                    rankState === 'running' && { opacity: 0.4 },
                  ]}>
                  <Text style={[styles.tuneChipText, active && styles.tuneChipTextActive]}>
                    {t.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {candidates.length === 0 && (
          <Body style={styles.emptyPicks}>
            Nothing on this menu cleared your hard restrictions. The dishes below
            were ruled out for safety — ask staff if you want to double-check any.
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

        {picks.map((pick, i) => {
          const item = byId.get(pick.item_id);
          if (!item) return null;
          const isExpanded = expandedId === item.id;
          return (
            <Card
              key={pick.item_id}
              pick={pick}
              item={item}
              showValue={tunes.includes('protein_value')}
              halalCertified={halalCertified}
              maxProtein={maxProtein}
              maxCarbs={maxCarbs}
              maxFat={maxFat}
              isFirst={i === 0}
              expanded={isExpanded}
              onToggle={() => toggle(pick, item)}
              detail={isExpanded ? detail : null}
              detailLoading={isExpanded && detailLoading}
              detailError={isExpanded && detailError}
              reduceMotion={reduceMotion}
            />
          );
        })}

        {/* The narrowing flow, demoted to an optional refinement — hidden when
            no facet could split the (spice-trimmed) pool anyway. */}
        {refinable && rankState !== 'running' && (
          <PrimaryButton
            label="🎯  Not quite? Refine my picks"
            variant="teal"
            onPress={() => router.push('/questions')}
          />
        )}

        {/* Avoid list — the hard-gate's blocked items, with reasons. Kept
            visually secondary to the top picks above. */}
        {blocked.length > 0 && (
          <View style={styles.avoidSection}>
            <Text style={styles.avoidHeader}>Avoid on this menu</Text>
            {blocked.map((b, i) => (
              <View key={b.item.id || `blocked-${i}`} style={styles.avoidRow}>
                <Text style={styles.avoidName} numberOfLines={1}>
                  {b.item.name}
                </Text>
                <Text style={styles.avoidReason}>{b.reasons.join(' · ')}</Text>
              </View>
            ))}
          </View>
        )}

        <PrimaryButton label="Scan another menu" variant="ghost" onPress={scanAnother} />
        <UsageLine />
      </ScrollView>
    </SafeAreaView>
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

function Card({
  pick,
  item,
  showValue,
  halalCertified,
  maxProtein,
  maxCarbs,
  maxFat,
  isFirst,
  expanded,
  onToggle,
  detail,
  detailLoading,
  detailError,
  reduceMotion,
}: {
  pick: Pick;
  item: MenuItem;
  /** Protein-per-$ tune is active — show the value ratio next to the price. */
  showValue: boolean;
  halalCertified: boolean;
  maxProtein: number;
  maxCarbs: number;
  maxFat: number;
  isFirst: boolean;
  expanded: boolean;
  onToggle: () => void;
  detail: DishDetail | null;
  detailLoading: boolean;
  detailError: boolean;
  reduceMotion: boolean;
}) {
  const accent = RANK_COLORS[pick.rank - 1] ?? Plait.color.coral;
  // The restaurant's halal certification covers the "verify halal" prompt.
  const effectiveFlag: Pick['flag'] =
    pick.flag === 'verify_halal' && halalCertified ? null : pick.flag;
  const flag = flagLabel(effectiveFlag);
  const hasMacros = pick.protein_g != null || pick.carbs_g != null || pick.fat_g != null;
  const confidenceLabel = pick.confidence ? CONFIDENCE_LABEL[pick.confidence] : '±15%';
  const isTop = pick.rank === 1;
  const strong = isStrongFlag(effectiveFlag);
  const severity = strong ? Plait.color.danger : Plait.color.warn;
  // Ratio from the RANKER's protein estimate (sharper than the name-only
  // enrichment guess) over the menu price; null when either side is unknown.
  const valueLabel = showValue ? proteinValueLabel(pick.protein_g, item.price) : null;

  return (
    <Pressable
      onPress={onToggle}
      style={({ pressed }) => [
        styles.card,
        expanded && styles.cardExpanded,
        pressed && !reduceMotion && { transform: [{ scale: 0.98 }] },
      ]}>
      {/* Header row */}
      <View style={styles.cardTop}>
        <View style={[styles.rankBadge, { backgroundColor: accent }]}>
          <Text style={styles.rankText}>#{pick.rank}</Text>
        </View>
        <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
        {item.price > 0 && <Text style={styles.price}>${item.price}</Text>}
      </View>

      {/* Gains-per-dollar badge — only while the Protein per $ tune is on. */}
      {valueLabel && (
        <View style={styles.valueBadge}>
          <Text style={styles.valueBadgeText}>💪 {valueLabel}</Text>
        </View>
      )}

      {/* Macro bars */}
      {hasMacros && (
        <View style={styles.macroBlock}>
          {pick.protein_g != null && (
            <MacroBar emoji="💪" label="Protein" value={pick.protein_g} max={maxProtein} color="#E8704A" />
          )}
          {pick.carbs_g != null && (
            <MacroBar emoji="🍞" label="Carbs" value={pick.carbs_g} max={maxCarbs} color="#E8B44A" />
          )}
          {pick.fat_g != null && (
            <MacroBar emoji="🧈" label="Fat" value={pick.fat_g} max={maxFat} color="#9A958C" />
          )}
          <Text style={styles.confidence}>Est. macros {confidenceLabel} accuracy</Text>
        </View>
      )}

      {/* One-sentence reasoning (always visible) */}
      <Body style={styles.why}>{pick.why}</Body>

      {/* Collapsed trust badge */}
      {flag && (
        <View style={[styles.flag, { borderColor: severity, backgroundColor: strong ? 'rgba(232,90,74,0.15)' : 'rgba(232,180,74,0.15)' }]}>
          <Text style={[styles.flagText, { color: severity }]}>{flag}</Text>
        </View>
      )}

      {/* Expanded detail */}
      {expanded && (
        <View style={styles.detail}>
          {detailLoading && (
            <View style={styles.detailLoader}>
              <ActivityIndicator size="small" color={Plait.color.coral} />
              <Text style={styles.detailLoaderText}>Getting the details…</Text>
            </View>
          )}

          {!detailLoading && detailError && (
            <Text style={styles.errorText}>Couldn’t load extra details — tap again to retry.</Text>
          )}

          {!detailLoading && detail && (
            <>
              {detail.why_this_pick !== '' && (
                <FadeInSection delay={0} reduceMotion={reduceMotion}>
                  <Text style={styles.labelWhy}>Why this pick</Text>
                  <Text style={styles.detailBody}>{detail.why_this_pick}</Text>
                </FadeInSection>
              )}

              {detail.how_to_order.length > 0 && (
                <FadeInSection delay={40} reduceMotion={reduceMotion}>
                  <Text style={styles.labelOrder}>How to order</Text>
                  {detail.how_to_order.map((mod, idx) => (
                    <View key={idx} style={styles.orderRow}>
                      <Text style={styles.orderPlus}>+</Text>
                      <Text style={styles.orderText}>{mod}</Text>
                    </View>
                  ))}
                </FadeInSection>
              )}

              {detail.safety_detail.length > 0 && (
                <FadeInSection delay={80} reduceMotion={reduceMotion}>
                  <Text style={[styles.labelSafety, { color: severity }]}>Safety</Text>
                  <View style={[styles.safetyBox, { borderLeftColor: severity }]}>
                    {detail.safety_detail.map((s, idx) => (
                      <View key={idx} style={styles.safetyRow}>
                        <Text style={styles.safetyIcon}>⚠️</Text>
                        <Text style={[styles.safetyText, strong && styles.safetyTextStrong]}>{s}</Text>
                      </View>
                    ))}
                  </View>
                </FadeInSection>
              )}

              {isTop && detail.why_not_others !== '' && (
                <FadeInSection delay={120} reduceMotion={reduceMotion}>
                  <Text style={styles.whyNot}>{detail.why_not_others}</Text>
                </FadeInSection>
              )}
            </>
          )}
        </View>
      )}

      {/* Footer: tap hint (first card only) + chevron */}
      <View style={styles.cardFooter}>
        {isFirst && !expanded && <Text style={styles.tapHint}>Tap for details</Text>}
        <View style={{ flex: 1 }} />
        <Chevron expanded={expanded} reduceMotion={reduceMotion} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Plait.color.background, paddingHorizontal: Plait.space.lg },
  head: { paddingTop: Plait.space.sm, paddingBottom: Plait.space.xs, gap: 4 },
  trustBanner: {
    backgroundColor: 'rgba(78,205,196,0.12)',
    borderColor: Plait.color.teal,
    borderWidth: 1,
    borderRadius: Plait.radius.sm,
    paddingVertical: 10,
    paddingHorizontal: Plait.space.sm,
    marginBottom: Plait.space.sm,
    gap: 4,
  },
  trustText: {
    color: Plait.color.teal,
    fontSize: 13,
    fontWeight: '600',
    fontFamily: Plait.font.sans,
    lineHeight: 18,
  },
  list: { gap: Plait.space.md, paddingBottom: Plait.space.xl },
  card: {
    backgroundColor: Plait.color.card,
    borderRadius: Plait.radius.lg,
    padding: Plait.space.md,
    borderWidth: 1,
    borderColor: Plait.color.border,
    gap: Plait.space.sm,
    overflow: 'hidden',
  },
  cardExpanded: { borderColor: Plait.color.cardElevated },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: Plait.space.sm },
  rankBadge: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  rankText: { color: '#111', fontWeight: '800', fontSize: 15, fontFamily: Plait.font.sans },
  name: { flex: 1, color: Plait.color.text, fontSize: 20, fontWeight: '700', fontFamily: Plait.font.serif },
  price: { color: Plait.color.teal, fontSize: 17, fontWeight: '700', fontFamily: Plait.font.sans },
  macroBlock: { backgroundColor: Plait.color.background, borderRadius: Plait.radius.sm, padding: Plait.space.sm, gap: 8 },
  confidence: { color: Plait.color.textDim, fontSize: 11, fontFamily: Plait.font.sans, marginTop: 2 },
  why: { color: Plait.color.text, fontSize: 15, lineHeight: 21 },
  flag: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: Plait.radius.pill,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  flagText: { fontSize: 13, fontWeight: '600', fontFamily: Plait.font.sans },

  // Expanded detail
  detail: { gap: Plait.space.md, marginTop: Plait.space.xs, paddingTop: Plait.space.xs },
  detailLoader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: Plait.space.sm },
  detailLoaderText: { color: Plait.color.textDim, fontSize: 13, fontFamily: Plait.font.sans },
  errorText: { color: Plait.color.textDim, fontSize: 13, fontFamily: Plait.font.sans, paddingVertical: 4 },
  labelWhy: {
    color: Plait.color.coral,
    fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase',
    fontFamily: Plait.font.sans, marginBottom: 4,
  },
  labelOrder: {
    color: Plait.color.teal,
    fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase',
    fontFamily: Plait.font.sans, marginBottom: 6,
  },
  labelSafety: {
    fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase',
    fontFamily: Plait.font.sans, marginBottom: 6,
  },
  detailBody: { color: Plait.color.text, fontSize: 15, lineHeight: 22, fontFamily: Plait.font.serif },
  orderRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginBottom: 4 },
  orderPlus: { color: Plait.color.teal, fontSize: 15, fontWeight: '800', lineHeight: 21 },
  orderText: { flex: 1, color: Plait.color.text, fontSize: 14, lineHeight: 21, fontFamily: Plait.font.sans },
  safetyBox: { borderLeftWidth: 3, paddingLeft: 10, gap: 6 },
  safetyRow: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  safetyIcon: { fontSize: 13, lineHeight: 20 },
  safetyText: { flex: 1, color: Plait.color.text, fontSize: 14, lineHeight: 20, fontFamily: Plait.font.sans },
  safetyTextStrong: { fontWeight: '700' },
  whyNot: { color: Plait.color.textDim, fontSize: 13, lineHeight: 19, fontFamily: Plait.font.sans, fontStyle: 'italic' },

  // Footer
  cardFooter: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  tapHint: { color: Plait.color.textDim, fontSize: 12, fontFamily: Plait.font.sans },
  chevron: { color: Plait.color.textDim, fontSize: 16 },

  // Picks section header + inline ranking status
  picksHeader: {
    color: Plait.color.textDim,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    fontFamily: Plait.font.sans,
  },
  rankBox: {
    backgroundColor: Plait.color.card,
    borderRadius: Plait.radius.md,
    borderWidth: 1,
    borderColor: Plait.color.border,
    padding: Plait.space.md,
    gap: Plait.space.sm,
  },
  rankLine: { flexDirection: 'row', alignItems: 'center', gap: Plait.space.sm },
  rankRow: { flex: 1, color: Plait.color.text, fontSize: 14, fontFamily: Plait.font.sans },
  rankTime: { color: Plait.color.textDim, fontSize: 12, fontFamily: Plait.font.sans },

  // Quick-tune chips
  tuneRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Plait.space.sm },
  tuneChip: {
    borderRadius: Plait.radius.pill,
    borderWidth: 1,
    borderColor: Plait.color.border,
    backgroundColor: Plait.color.card,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  tuneChipActive: { backgroundColor: Plait.color.coral, borderColor: Plait.color.coral },
  tuneChipText: { color: Plait.color.text, fontSize: 13, fontWeight: '600', fontFamily: Plait.font.sans },
  tuneChipTextActive: { color: '#111111' },
  valueBadge: {
    alignSelf: 'flex-start',
    backgroundColor: Plait.color.background,
    borderRadius: Plait.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  valueBadgeText: {
    color: Plait.color.teal,
    fontSize: 13,
    fontWeight: '700',
    fontFamily: Plait.font.sans,
  },

  // Refine nudge
  nudgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Plait.space.sm,
    backgroundColor: 'rgba(78,205,196,0.10)',
    borderColor: Plait.color.teal,
    borderWidth: 1,
    borderRadius: Plait.radius.sm,
    paddingVertical: 10,
    paddingHorizontal: Plait.space.sm,
  },
  nudgeBody: { flex: 1 },
  nudgeText: { color: Plait.color.teal, fontSize: 13, fontWeight: '600', fontFamily: Plait.font.sans, lineHeight: 18 },
  nudgeClose: { color: Plait.color.textDim, fontSize: 14, fontWeight: '700', fontFamily: Plait.font.sans },

  // Empty + avoid list (secondary to the picks)
  emptyPicks: { color: Plait.color.textDim, fontSize: 14, lineHeight: 20 },
  avoidSection: {
    backgroundColor: Plait.color.card,
    borderRadius: Plait.radius.md,
    borderWidth: 1,
    borderColor: Plait.color.border,
    padding: Plait.space.md,
    gap: Plait.space.sm,
  },
  avoidHeader: {
    color: Plait.color.textDim,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    fontFamily: Plait.font.sans,
  },
  avoidRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Plait.color.border,
    paddingTop: Plait.space.sm,
    gap: 2,
  },
  avoidName: {
    color: Plait.color.text,
    fontSize: 15,
    fontWeight: '600',
    fontFamily: Plait.font.sans,
  },
  avoidReason: {
    color: Plait.color.textDim,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: Plait.font.sans,
  },
  usageLine: {
    color: Plait.color.textDim,
    fontSize: 12,
    fontFamily: Plait.font.sans,
    textAlign: 'center',
  },
});
