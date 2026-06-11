/**
 * Optional refinement (reached from the results screen's "Refine my picks").
 * The deterministic engine drives this entirely on-device: a short series of
 * binary questions, each chosen for maximum information gain against the
 * REMAINING candidates. Spice is no longer asked here — the profile's
 * once-asked heat ceiling pre-trims the pool. When the pool is small enough,
 * reasoning re-runs over just that handful and the refined picks replace the
 * instant ones back on results.
 */
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CookingLoader } from '@/components/cooking-loader';
import { Loading, NavLink, PrimaryButton, Subtitle, Title } from '@/components/ui-kit';
import { Plait } from '@/constants/plait-theme';
import { useProgressSteps } from '@/hooks/use-progress-steps';
import { callReason } from '@/lib/callReason';
import {
  choicesToQA,
  facetChoice,
  filterByFacet,
  filterBySpice,
  nextQuestion,
  shouldStopNarrowing,
  spiceChoice,
  type EngineChoice,
  type EngineOption,
  type EngineQuestion,
} from '@/lib/questionEngine';
import type { MenuItem } from '@/lib/types';
import { useProfile } from '@/state/profile';
import { useSession } from '@/state/session';

export default function QuestionsScreen() {
  const router = useRouter();
  const session = useSession();
  const { preferences, tdee, spiceCeiling } = useProfile();
  const { candidates, verifyById, restaurantNotes, menuContext, crowdFavorites } = session;

  // The profile's heat ceiling silently trims the pool; recording it as a
  // choice keeps the spice answer in the ranking context like it always was.
  const [pool, setPool] = useState<MenuItem[]>(() => filterBySpice(candidates, spiceCeiling));
  const [asked, setAsked] = useState<Set<string>>(new Set());
  const [choices, setChoices] = useState<EngineChoice[]>(() => [spiceChoice(spiceCeiling)]);
  const [dynamicCount, setDynamicCount] = useState(0);

  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { steps, onProgress, resetProgress } = useProgressSteps();

  // Guard: arrived without a scan.
  useEffect(() => {
    if (!menuContext) router.replace('/');
  }, [menuContext, router]);

  // No safe candidates at all → nothing to refine; back to (avoid-only) results.
  useEffect(() => {
    if (menuContext && candidates.length === 0) {
      session.setOutcome({ questions: [], answers: {}, spice: spiceCeiling, picks: [], source: 'refined' });
      router.replace('/results');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuContext, candidates.length]);

  // Entered refine but no facet can split the (pre-trimmed) pool — nothing to
  // ask, so just re-rank directly. Results hides the button in this case; this
  // is the safety net for direct entry. Mount-only by design.
  useEffect(() => {
    if (menuContext && pool.length > 0 && nextQuestion(pool, asked) === null) {
      void runReason(pool, choices);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!menuContext) return <Loading message="Loading…" />;
  if (busy) {
    return (
      // Pop back to results — it re-renders with the refined picks from session.
      <CookingLoader done={done} steps={steps} onReady={() => router.back()} title="Refining your picks" />
    );
  }

  const runReason = async (finalPool: MenuItem[], finalChoices: EngineChoice[]) => {
    setBusy(true);
    setDone(false);
    setError(null);
    resetProgress();
    const { questions, answers } = choicesToQA(finalChoices);
    const verifyForPool = Object.fromEntries(
      Object.entries(verifyById).filter(([id]) => finalPool.some((i) => i.id === id))
    );
    // Review-praised dishes still in the pool — one context line for ranking.
    // (Gate-blocked items were never candidates, so they can't appear here.)
    const crowdNames = finalPool.filter((i) => crowdFavorites[i.id]).map((i) => i.name);
    try {
      const picks = await callReason({
        items: finalPool,
        questions,
        answers,
        userPreferences: preferences ?? '',
        verifyById: verifyForPool,
        tdeeContext: tdee, // daily targets (null when the user hasn't set goals)
        restaurantNotes,
        crowdFavorites: crowdNames,
        onProgress,
      });
      session.setOutcome({ questions, answers, spice: spiceCeiling, picks, source: 'refined' });
      setDone(true);
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : 'Could not get a recommendation.');
    }
  };

  const onAnswer = (question: EngineQuestion, option: EngineOption) => {
    const np = filterByFacet(pool, question.facetId, option.value);
    const nextAsked = new Set(asked).add(question.facetId);
    const nextChoices = [...choices, facetChoice(question, option)];
    const nextDynamic = dynamicCount + 1;
    setPool(np);
    setAsked(nextAsked);
    setChoices(nextChoices);
    setDynamicCount(nextDynamic);
    // Stop & re-rank, or keep narrowing.
    const stop =
      shouldStopNarrowing(np, nextDynamic) || nextQuestion(np, nextAsked) === null;
    if (stop) void runReason(np, nextChoices);
  };

  // ── Reasoning failed → offer a retry instead of a silent dead-end ─────────
  if (error) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.body}>
          <Title style={styles.q}>Hmm, that didn&apos;t work</Title>
          <Subtitle style={styles.qSub}>{error}</Subtitle>
        </View>
        <View style={styles.footer}>
          <PrimaryButton label="Try again" onPress={() => void runReason(pool, choices)} />
          <PrimaryButton label="Start over" variant="ghost" onPress={() => router.replace('/')} />
        </View>
      </SafeAreaView>
    );
  }

  // ── Narrowing ───────────────────────────────────────────────────────────────
  // `onAnswer` kicks reasoning itself when no further question exists, and the
  // mount effect covers a pool with nothing to ask, so `question` is non-null
  // here. The loader is a safe fallback that never calls setState during render.
  const question = nextQuestion(pool, asked);
  if (!question) return <Loading message="Refining your picks…" />;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        {/* Bail out mid-refinement — the instant picks are still on results. */}
        <NavLink label="‹ Back to picks" onPress={() => router.back()} />
        <Text style={styles.progress}>{pool.length} dishes in the running</Text>
      </View>
      <Title style={styles.q}>{question.question}</Title>
      <ScrollView contentContainerStyle={styles.options} showsVerticalScrollIndicator={false}>
        {question.options.map((opt) => (
          <Pressable
            key={opt.value}
            onPress={() => onAnswer(question, opt)}
            style={({ pressed }) => [styles.option, pressed && { opacity: 0.7 }]}>
            <Text style={styles.optionEmoji}>{opt.emoji}</Text>
            <Text style={styles.optionLabel}>{opt.label}</Text>
            <View style={styles.spacer} />
            <Text style={styles.optionCount}>{opt.count}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Plait.color.background, paddingHorizontal: Plait.space.lg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Plait.space.sm,
  },
  progress: { color: Plait.color.textDim, fontSize: 14, fontFamily: Plait.font.sans },
  body: { flex: 1, justifyContent: 'center', gap: Plait.space.md },
  q: { fontSize: 32, lineHeight: 40, marginBottom: Plait.space.sm },
  qSub: { fontSize: 15 },
  options: { gap: Plait.space.sm, paddingBottom: Plait.space.xl, paddingTop: Plait.space.sm },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Plait.space.md,
    backgroundColor: Plait.color.card,
    borderRadius: Plait.radius.md,
    paddingVertical: 18,
    paddingHorizontal: Plait.space.md,
    borderWidth: 1,
    borderColor: Plait.color.border,
  },
  optionEmoji: { fontSize: 24 },
  optionLabel: { color: Plait.color.text, fontSize: 18, fontFamily: Plait.font.sans, fontWeight: '700' },
  spacer: { flex: 1 },
  optionCount: {
    color: Plait.color.textDim,
    fontSize: 13,
    fontWeight: '700',
    fontFamily: Plait.font.sans,
    backgroundColor: Plait.color.background,
    borderRadius: Plait.radius.pill,
    minWidth: 24,
    textAlign: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  footer: { paddingBottom: Plait.space.lg, paddingTop: Plait.space.sm, gap: Plait.space.sm },
});
