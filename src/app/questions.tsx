import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CookingLoader } from '@/components/cooking-loader';
import { Body, Loading, Subtitle, Title } from '@/components/ui-kit';
import { Plait } from '@/constants/plait-theme';
import { callReason } from '@/lib/callReason';
import type { Answers } from '@/lib/types';
import { useProfile } from '@/state/profile';
import { useSession } from '@/state/session';

export default function QuestionsScreen() {
  const router = useRouter();
  const session = useSession();
  const { preferences, tdee } = useProfile();
  const { questions, items } = session;

  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guard: if we landed here without a scan, go home.
  useEffect(() => {
    if (questions.length === 0) router.replace('/');
  }, [questions.length, router]);

  if (questions.length === 0) return <Loading message="Loading…" />;
  if (busy) return <CookingLoader done={done} onReady={() => router.replace('/results')} title="Finding your top 3" />;

  const question = questions[index];
  const total = questions.length;

  const choose = async (value: string) => {
    const next = { ...answers, [question.id]: value };
    setAnswers(next);

    if (index < total - 1) {
      setIndex(index + 1);
      return;
    }

    // Last question answered → run the reasoning call behind the loader.
    setBusy(true);
    setDone(false);
    setError(null);
    session.setAnswers(next);
    (async () => {
      try {
        const picks = await callReason({
          items,
          questions,
          answers: next,
          userPreferences: preferences ?? '',
          tdeeContext: tdee,
        });
        session.setPicks(picks);
        setDone(true);
      } catch (e) {
        setBusy(false);
        setError(e instanceof Error ? e.message : 'Could not get recommendations.');
      }
    })();
  };

  const goBack = () => {
    if (index === 0) router.back();
    else setIndex(index - 1);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={goBack} hitSlop={12}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <Text style={styles.progress}>
          Question {index + 1} of {total}
        </Text>
      </View>

      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${((index + 1) / total) * 100}%` }]} />
      </View>

      <Title style={styles.q}>{question.question_text}</Title>

      <ScrollView contentContainerStyle={styles.options} showsVerticalScrollIndicator={false}>
        {question.options.map((opt) => {
          const selected = answers[question.id] === opt.value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => choose(opt.value)}
              style={({ pressed }) => [
                styles.option,
                selected && styles.optionSelected,
                pressed && { opacity: 0.7 },
              ]}>
              {opt.emoji && <Text style={styles.optionEmoji}>{opt.emoji}</Text>}
              <Text style={styles.optionLabel}>{opt.label}</Text>
            </Pressable>
          );
        })}
        {error && <Body style={styles.error}>{error}</Body>}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Plait.color.background,
    paddingHorizontal: Plait.space.lg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Plait.space.sm,
  },
  back: { color: Plait.color.textDim, fontSize: 17, fontFamily: Plait.font.sans },
  progress: { color: Plait.color.textDim, fontSize: 14, fontFamily: Plait.font.sans },
  progressBar: {
    height: 4,
    backgroundColor: Plait.color.card,
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: Plait.space.lg,
  },
  progressFill: { height: 4, backgroundColor: Plait.color.coral },
  q: { fontSize: 32, lineHeight: 40, marginBottom: Plait.space.lg },
  options: { gap: Plait.space.sm, paddingBottom: Plait.space.xl },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Plait.space.sm,
    backgroundColor: Plait.color.card,
    borderRadius: Plait.radius.md,
    paddingVertical: 20,
    paddingHorizontal: Plait.space.md,
    borderWidth: 1,
    borderColor: Plait.color.border,
  },
  optionSelected: {
    borderColor: Plait.color.coral,
    backgroundColor: Plait.color.cardElevated,
  },
  optionEmoji: { fontSize: 22 },
  optionLabel: { color: Plait.color.text, fontSize: 18, fontFamily: Plait.font.sans, fontWeight: '600' },
  error: { color: Plait.color.danger, textAlign: 'center', marginTop: Plait.space.md },
});
