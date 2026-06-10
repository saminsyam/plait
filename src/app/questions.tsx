/**
 * Stage 2 — Preference discovery (narrowing). The deterministic engine drives
 * this entirely on-device: a constant 3-way spice selector, then a short series
 * of binary questions, each chosen for maximum information gain against the
 * REMAINING candidates. When the pool is small enough, Stage 3 (reasoning) runs
 * over just that handful — never the whole menu.
 */
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CookingLoader } from '@/components/cooking-loader';
import { SpiceSlider } from '@/components/spice-slider';
import { Loading, NavLink, PrimaryButton, Subtitle, Title } from '@/components/ui-kit';
import { Plait } from '@/constants/plait-theme';
import { useProgressSteps } from '@/hooks/use-progress-steps';
import { callReason } from '@/lib/callReason';
import {
  choicesToQA,
  DEFAULT_SPICE,
  facetChoice,
  filterByFacet,
  filterBySpice,
  nextQuestion,
  shouldStopNarrowing,
  spiceChoice,
  type EngineChoice,
  type EngineOption,
  type EngineQuestion,
  type SpiceLevel,
} from '@/lib/questionEngine';
import type { MenuItem } from '@/lib/types';
import { useProfile } from '@/state/profile';
import { useSession } from '@/state/session';

type Step = 'spice' | 'narrow';

export default function QuestionsScreen() {
  const router = useRouter();
  const session = useSession();
  const { preferences, tdee } = useProfile();
  const { candidates, verifyById, restaurantNotes, menuContext, crowdFavorites } = session;

  const [step, setStep] = useState<Step>('spice');
  const [spice, setSpice] = useState<SpiceLevel>(DEFAULT_SPICE);
  const [pool, setPool] = useState<MenuItem[]>(candidates);
  const [asked, setAsked] = useState<Set<string>>(new Set());
  const [choices, setChoices] = useState<EngineChoice[]>([]);
  const [dynamicCount, setDynamicCount] = useState(0);

  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { steps, onProgress, resetProgress } = useProgressSteps();

  // Guard: arrived without a scan.
  useEffect(() => {
    if (!menuContext) router.replace('/');
  }, [menuContext, router]);

  // No safe candidates at all → skip straight to the (avoid-only) results.
  useEffect(() => {
    if (menuContext && candidates.length === 0) {
      session.setOutcome({ questions: [], answers: {}, spice: DEFAULT_SPICE, picks: [] });
      router.replace('/results');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuContext, candidates.length]);

  if (!menuContext) return <Loading message="Loading…" />;
  if (busy) {
    return (
      <CookingLoader done={done} steps={steps} onReady={() => router.replace('/results')} title="Finding your match" />
    );
  }

  const runReason = async (finalPool: MenuItem[], finalChoices: EngineChoice[], spiceLevel: SpiceLevel) => {
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
      session.setOutcome({ questions, answers, spice: spiceLevel, picks });
      setDone(true);
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : 'Could not get a recommendation.');
    }
  };

  // Advance from the current pool: stop & reason, or keep narrowing.
  const advance = (nextPool: MenuItem[], nextAsked: Set<string>, nextChoices: EngineChoice[], nextDynamic: number, spiceLevel: SpiceLevel) => {
    const stop = shouldStopNarrowing(nextPool, nextDynamic) || nextQuestion(nextPool, nextAsked) === null;
    if (stop) {
      void runReason(nextPool, nextChoices, spiceLevel);
    } else {
      setStep('narrow');
    }
  };

  const onSpiceContinue = () => {
    const np = filterBySpice(candidates, spice);
    const nextChoices = [spiceChoice(spice)];
    setPool(np);
    setChoices(nextChoices);
    advance(np, new Set(), nextChoices, 0, spice);
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
    advance(np, nextAsked, nextChoices, nextDynamic, spice);
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
          <PrimaryButton label="Try again" onPress={() => void runReason(pool, choices, spice)} />
          <PrimaryButton label="Start over" variant="ghost" onPress={() => router.replace('/')} />
        </View>
      </SafeAreaView>
    );
  }

  // ── Spice step ────────────────────────────────────────────────────────────
  if (step === 'spice') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <NavLink label="‹ Menu intro" onPress={() => router.replace('/orientation')} />
          <Text style={styles.progress}>First, the basics</Text>
        </View>
        <View style={styles.body}>
          <Title style={styles.q}>How much heat do you want?</Title>
          <Subtitle style={styles.qSub}>I&apos;ll keep anything spicier than this off your list.</Subtitle>
          <View style={styles.sliderBox}>
            <SpiceSlider value={spice} onChange={setSpice} />
          </View>
        </View>
        <View style={styles.footer}>
          <PrimaryButton label="Continue →" onPress={onSpiceContinue} />
        </View>
      </SafeAreaView>
    );
  }

  // ── Narrowing step ──────────────────────────────────────────────────────────
  // `advance` only enters this step when a question exists (and otherwise kicks
  // reasoning itself), so `question` is non-null here. The loader is a safe
  // fallback that never calls setState during render.
  const question = nextQuestion(pool, asked);
  if (!question) return <Loading message="Finding your match…" />;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        {/* Re-entering restarts narrowing from the full pool — that's the point. */}
        <NavLink label="‹ Restart" onPress={() => router.replace('/orientation')} />
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
  sliderBox: {
    backgroundColor: Plait.color.card,
    borderRadius: Plait.radius.lg,
    borderWidth: 1,
    borderColor: Plait.color.border,
    padding: Plait.space.lg,
    marginTop: Plait.space.md,
  },
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
