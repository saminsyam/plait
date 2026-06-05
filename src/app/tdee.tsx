import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton, Subtitle, Title } from '@/components/ui-kit';
import { Plait } from '@/constants/plait-theme';
import {
  ACTIVITY_LEVELS,
  computeTdee,
  ftInToCm,
  lbsToKg,
  type ActivityLevel,
  type Sex,
} from '@/lib/tdee';
import { useProfile, type TdeeGoals } from '@/state/profile';

type WeightUnit = 'kg' | 'lbs';
type HeightUnit = 'cm' | 'ft';

/** Outlined when unselected, filled coral when selected. */
function Chip({
  label,
  selected,
  onPress,
  style,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  style?: object;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        pressed && { opacity: 0.7 },
        style,
      ]}>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

export default function TdeeScreen() {
  const router = useRouter();
  const { completeTdee, prefsCompleted } = useProfile();
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const isEditing = edit === '1';

  const [age, setAge] = useState('');
  const [weight, setWeight] = useState('');
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('kg');
  const [heightUnit, setHeightUnit] = useState<HeightUnit>('cm');
  const [heightCm, setHeightCm] = useState('');
  const [heightFt, setHeightFt] = useState('');
  const [heightIn, setHeightIn] = useState('');
  const [sex, setSex] = useState<Sex | null>(null);
  const [activity, setActivity] = useState<ActivityLevel | null>(null);
  const [result, setResult] = useState<TdeeGoals | null>(null);

  const num = (s: string) => {
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  };

  const heightCmValue = () => {
    if (heightUnit === 'cm') return num(heightCm);
    const ft = num(heightFt);
    const inches = heightIn.trim() === '' ? 0 : num(heightIn);
    if (!Number.isFinite(ft) || !Number.isFinite(inches)) return NaN;
    return ftInToCm(ft, inches);
  };

  const weightKgValue = () => {
    const w = num(weight);
    if (!Number.isFinite(w)) return NaN;
    return weightUnit === 'kg' ? w : lbsToKg(w);
  };

  const ageOk = num(age) > 0 && num(age) < 120;
  const weightOk = weightKgValue() > 0;
  const heightOk = heightCmValue() > 0;
  const canCalculate = ageOk && weightOk && heightOk && sex !== null && activity !== null;

  // Editing any input invalidates a stale result so the user re-calculates.
  const invalidate = () => result !== null && setResult(null);

  const onCalculate = () => {
    if (!canCalculate || sex === null || activity === null) return;
    setResult(
      computeTdee({
        age: num(age),
        weightKg: weightKgValue(),
        heightCm: heightCmValue(),
        sex,
        activity,
      })
    );
  };

  const goNext = () => {
    if (isEditing) router.back();
    else if (!prefsCompleted) router.replace('/preferences');
    else router.replace('/');
  };

  const onSave = async () => {
    if (!result) return;
    await completeTdee(result);
    goNext();
  };

  const onSkip = async () => {
    await completeTdee(null);
    goNext();
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Skip — top right */}
        <View style={styles.topBar}>
          <Pressable onPress={onSkip} hitSlop={12}>
            <Text style={styles.skip}>Skip for now →</Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Title style={styles.title}>What are your daily goals?</Title>
            <Subtitle style={styles.sub}>
              We&apos;ll use this to score every dish against your targets.
            </Subtitle>
          </View>

          <Field label="Age">
            <TextInput
              style={styles.input}
              value={age}
              onChangeText={(t) => {
                setAge(t);
                invalidate();
              }}
              placeholder="28"
              placeholderTextColor={Plait.color.textDim}
              keyboardType="number-pad"
              maxLength={3}
              selectionColor={Plait.color.coral}
            />
          </Field>

          <Field label="Weight">
            <View style={styles.row}>
              <TextInput
                style={[styles.input, styles.flexInput]}
                value={weight}
                onChangeText={(t) => {
                  setWeight(t);
                  invalidate();
                }}
                placeholder={weightUnit === 'kg' ? '75' : '165'}
                placeholderTextColor={Plait.color.textDim}
                keyboardType="decimal-pad"
                maxLength={6}
                selectionColor={Plait.color.coral}
              />
              <View style={styles.toggle}>
                <Chip label="kg" selected={weightUnit === 'kg'} onPress={() => { setWeightUnit('kg'); invalidate(); }} style={styles.toggleChip} />
                <Chip label="lbs" selected={weightUnit === 'lbs'} onPress={() => { setWeightUnit('lbs'); invalidate(); }} style={styles.toggleChip} />
              </View>
            </View>
          </Field>

          <Field label="Height">
            <View style={styles.row}>
              {heightUnit === 'cm' ? (
                <TextInput
                  style={[styles.input, styles.flexInput]}
                  value={heightCm}
                  onChangeText={(t) => {
                    setHeightCm(t);
                    invalidate();
                  }}
                  placeholder="178"
                  placeholderTextColor={Plait.color.textDim}
                  keyboardType="decimal-pad"
                  maxLength={5}
                  selectionColor={Plait.color.coral}
                />
              ) : (
                <View style={[styles.row, styles.flexInput]}>
                  <TextInput
                    style={[styles.input, styles.ftInput]}
                    value={heightFt}
                    onChangeText={(t) => {
                      setHeightFt(t);
                      invalidate();
                    }}
                    placeholder="5"
                    placeholderTextColor={Plait.color.textDim}
                    keyboardType="number-pad"
                    maxLength={1}
                    selectionColor={Plait.color.coral}
                  />
                  <Text style={styles.unitHint}>ft</Text>
                  <TextInput
                    style={[styles.input, styles.ftInput]}
                    value={heightIn}
                    onChangeText={(t) => {
                      setHeightIn(t);
                      invalidate();
                    }}
                    placeholder="10"
                    placeholderTextColor={Plait.color.textDim}
                    keyboardType="number-pad"
                    maxLength={2}
                    selectionColor={Plait.color.coral}
                  />
                  <Text style={styles.unitHint}>in</Text>
                </View>
              )}
              <View style={styles.toggle}>
                <Chip label="cm" selected={heightUnit === 'cm'} onPress={() => { setHeightUnit('cm'); invalidate(); }} style={styles.toggleChip} />
                <Chip label="ft+in" selected={heightUnit === 'ft'} onPress={() => { setHeightUnit('ft'); invalidate(); }} style={styles.toggleChip} />
              </View>
            </View>
          </Field>

          <Field label="Biological sex">
            <View style={styles.row}>
              <Chip label="Male" selected={sex === 'male'} onPress={() => { setSex('male'); invalidate(); }} style={styles.flexChip} />
              <Chip label="Female" selected={sex === 'female'} onPress={() => { setSex('female'); invalidate(); }} style={styles.flexChip} />
            </View>
          </Field>

          <Field label="Activity level">
            <View style={styles.activityWrap}>
              {ACTIVITY_LEVELS.map((a) => (
                <Chip
                  key={a.value}
                  label={a.label}
                  selected={activity === a.value}
                  onPress={() => { setActivity(a.value); invalidate(); }}
                />
              ))}
            </View>
          </Field>

          <PrimaryButton label="Calculate" onPress={onCalculate} disabled={!canCalculate} />

          {result && (
            <View style={styles.resultCard}>
              <Text style={styles.resultCalories}>🔥 {result.calories.toLocaleString()} kcal/day</Text>
              <Text style={styles.resultMacros}>
                Protein {result.protein_g}g · Carbs {result.carbs_g}g · Fat {result.fat_g}g
              </Text>
            </View>
          )}

          {result && (
            <PrimaryButton label="Save & continue →" onPress={onSave} style={styles.saveBtn} />
          )}
        </ScrollView>
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
  scroll: {
    paddingHorizontal: Plait.space.lg,
    paddingTop: Plait.space.sm,
    paddingBottom: Plait.space.xl,
    gap: Plait.space.md,
  },
  header: { gap: Plait.space.xs, marginBottom: Plait.space.xs },
  title: { fontSize: 32, lineHeight: 40 },
  sub: { fontSize: 16 },
  field: { gap: Plait.space.sm },
  fieldLabel: {
    color: Plait.color.textDim,
    fontSize: 14,
    fontWeight: '600',
    fontFamily: Plait.font.sans,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Plait.space.sm },
  input: {
    backgroundColor: Plait.color.card,
    borderRadius: Plait.radius.md,
    borderWidth: 1,
    borderColor: Plait.color.border,
    color: Plait.color.text,
    fontFamily: Plait.font.sans,
    fontSize: 18,
    paddingVertical: 14,
    paddingHorizontal: Plait.space.md,
  },
  flexInput: { flex: 1 },
  ftInput: { width: 64, textAlign: 'center' },
  unitHint: { color: Plait.color.textDim, fontSize: 15, fontFamily: Plait.font.sans },
  toggle: {
    flexDirection: 'row',
    gap: 6,
  },
  toggleChip: { minWidth: 52, alignItems: 'center' },
  chip: {
    borderRadius: Plait.radius.pill,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: Plait.color.border,
    backgroundColor: 'transparent',
    alignItems: 'center',
  },
  chipSelected: {
    backgroundColor: Plait.color.coral,
    borderColor: Plait.color.coral,
  },
  chipText: { color: Plait.color.text, fontSize: 15, fontWeight: '600', fontFamily: Plait.font.sans },
  chipTextSelected: { color: '#111111' },
  flexChip: { flex: 1 },
  activityWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Plait.space.sm },
  resultCard: {
    backgroundColor: Plait.color.cardElevated,
    borderRadius: Plait.radius.md,
    borderWidth: 1,
    borderColor: Plait.color.border,
    padding: Plait.space.md,
    gap: 6,
    alignItems: 'center',
    marginTop: Plait.space.xs,
  },
  resultCalories: {
    color: Plait.color.text,
    fontSize: 24,
    fontWeight: '800',
    fontFamily: Plait.font.sans,
  },
  resultMacros: { color: Plait.color.textDim, fontSize: 15, fontFamily: Plait.font.sans },
  saveBtn: { marginTop: Plait.space.xs },
});
