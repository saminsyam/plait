import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Loading, PrimaryButton, Subtitle, Title } from '@/components/ui-kit';
import { Plait } from '@/constants/plait-theme';
import { useSession } from '@/state/session';

export default function BudgetScreen() {
  const router = useRouter();
  const { items, hasPrices, setBudget } = useSession();

  const [value, setValue] = useState('');

  // Guard: only meaningful when the scanned menu actually had prices.
  useEffect(() => {
    if (!hasPrices) router.replace('/questions');
  }, [hasPrices, router]);

  // Price range on this menu, to anchor the user's budget.
  const range = useMemo(() => {
    const prices = items.map((i) => i.price).filter((p) => p > 0);
    if (prices.length === 0) return null;
    return { min: Math.min(...prices), max: Math.max(...prices) };
  }, [items]);

  if (!hasPrices) return <Loading message="Loading…" />;

  const parsed = Number(value);
  const canContinue = Number.isFinite(parsed) && parsed > 0;

  const onContinue = () => {
    if (!canContinue) return;
    setBudget(parsed);
    router.replace('/questions');
  };

  const onSkip = () => {
    setBudget(null);
    router.replace('/questions');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.topBar}>
          <Pressable onPress={onSkip} hitSlop={12}>
            <Text style={styles.skip}>Skip →</Text>
          </Pressable>
        </View>

        <View style={styles.body}>
          <Title style={styles.title}>What&apos;s your budget?</Title>
          <Subtitle style={styles.sub}>
            This menu has prices — tell me your per-person budget and I&apos;ll factor
            it into your picks.
          </Subtitle>

          {range && (
            <Text style={styles.range}>
              Dishes here run ${range.min}–${range.max}
            </Text>
          )}

          <View style={styles.inputRow}>
            <Text style={styles.currency}>$</Text>
            <TextInput
              style={styles.input}
              value={value}
              onChangeText={setValue}
              placeholder="30"
              placeholderTextColor={Plait.color.textDim}
              keyboardType="decimal-pad"
              maxLength={6}
              autoFocus
              selectionColor={Plait.color.coral}
            />
          </View>
        </View>

        <View style={styles.footer}>
          <PrimaryButton label="Continue →" onPress={onContinue} disabled={!canContinue} />
          <Text style={styles.hint}>Tap “Skip” if you’d rather not set one.</Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Plait.color.background },
  flex: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: Plait.space.lg,
    paddingTop: Plait.space.sm,
  },
  skip: { color: Plait.color.teal, fontSize: 16, fontWeight: '600', fontFamily: Plait.font.sans },
  body: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Plait.space.lg,
    gap: Plait.space.md,
  },
  title: { fontSize: 36, lineHeight: 44 },
  sub: { fontSize: 16, maxWidth: 340 },
  range: { color: Plait.color.textDim, fontSize: 14, fontFamily: Plait.font.sans },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Plait.color.card,
    borderRadius: Plait.radius.md,
    borderWidth: 1,
    borderColor: Plait.color.border,
    paddingHorizontal: Plait.space.md,
    marginTop: Plait.space.sm,
  },
  currency: { color: Plait.color.text, fontSize: 28, fontWeight: '700', fontFamily: Plait.font.sans },
  input: {
    flex: 1,
    color: Plait.color.text,
    fontFamily: Plait.font.sans,
    fontSize: 28,
    fontWeight: '700',
    paddingVertical: 16,
  },
  footer: {
    paddingHorizontal: Plait.space.lg,
    paddingBottom: Plait.space.lg,
    gap: Plait.space.sm,
  },
  hint: { color: Plait.color.textDim, fontSize: 13, textAlign: 'center', fontFamily: Plait.font.sans },
});
