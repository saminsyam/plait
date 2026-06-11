import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SpiceSlider } from '@/components/spice-slider';
import { PrimaryButton, Subtitle, Title } from '@/components/ui-kit';
import { Plait } from '@/constants/plait-theme';
import { parsePreferences } from '@/lib/parsePreferences';
import type { SpiceLevel } from '@/lib/questionEngine';
import { useProfile } from '@/state/profile';

const MIN_CHARS = 3;

export default function PreferencesScreen() {
  const router = useRouter();
  const { preferences, savePreferences, saveHardConstraints, spiceCeiling, saveSpiceCeiling } =
    useProfile();
  // `edit` is passed when arriving from the home-screen pencil; otherwise this
  // is first-launch onboarding and we continue forward to the TDEE step.
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const isEditing = edit === '1';

  const [text, setText] = useState(preferences ?? '');
  const [spice, setSpice] = useState<SpiceLevel>(spiceCeiling);
  const [saving, setSaving] = useState(false);

  const canContinue = text.trim().length >= MIN_CHARS && !saving;

  const onContinue = async () => {
    if (!canContinue) return;
    setSaving(true);
    // Smart-parse the free text into structured hard constraints (allergens +
    // halal/kosher) that feed the deterministic safety gate. Soft preferences
    // stay in the text and flow to the model as ranking context. Parsing never
    // throws — on failure we save with no hard gate rather than blocking.
    const constraints = await parsePreferences(text);
    await Promise.all([
      savePreferences(text),
      saveHardConstraints(constraints),
      saveSpiceCeiling(spice),
    ]);
    if (isEditing) router.back();
    else router.replace('/');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Title style={styles.title}>Describe your dietary needs</Title>
            <Subtitle style={styles.sub}>
              Tell me in your own words. I&apos;ll use this to filter and rank every
              menu I read for you.
            </Subtitle>
          </View>

          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="e.g. Halal, allergic to shellfish, high-protein, love spicy food, avoiding gluten"
            placeholderTextColor={Plait.color.textDim}
            multiline
            numberOfLines={4}
            maxLength={400}
            textAlignVertical="top"
            autoFocus={!isEditing}
            selectionColor={Plait.color.coral}
            editable={!saving}
          />

          <Text style={styles.hintInline}>
            🔒 I automatically detect allergies and halal/kosher and never recommend a
            dish that breaks them — just mention them above.
          </Text>

          {/* The one constant taste question, asked once instead of every scan. */}
          <View style={styles.spiceBlock}>
            <Text style={styles.spiceLabel}>Your usual heat ceiling</Text>
            <SpiceSlider value={spice} onChange={setSpice} />
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <PrimaryButton
            label={saving ? 'Saving…' : isEditing ? 'Save' : 'Continue'}
            onPress={onContinue}
            disabled={!canContinue}
          />
          {!isEditing && (
            <Text style={styles.hint}>You can change this anytime from the ☰ menu on the camera.</Text>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Plait.color.background },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: Plait.space.lg,
    paddingTop: Plait.space.xl,
    gap: Plait.space.lg,
  },
  header: { gap: Plait.space.sm },
  title: { fontSize: 34, lineHeight: 42 },
  sub: { fontSize: 16 },
  input: {
    backgroundColor: Plait.color.card,
    borderRadius: Plait.radius.md,
    borderWidth: 1,
    borderColor: Plait.color.border,
    color: Plait.color.text,
    fontFamily: Plait.font.sans,
    fontSize: 17,
    lineHeight: 24,
    padding: Plait.space.md,
    minHeight: 120, // ~4 lines visible
    maxHeight: 160,
  },
  hintInline: {
    color: Plait.color.textDim,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: Plait.font.sans,
  },
  spiceBlock: { gap: Plait.space.sm },
  spiceLabel: {
    color: Plait.color.textDim,
    fontSize: 14,
    fontWeight: '600',
    fontFamily: Plait.font.sans,
  },
  footer: {
    paddingHorizontal: Plait.space.lg,
    paddingBottom: Plait.space.lg,
    paddingTop: Plait.space.sm,
    gap: Plait.space.sm,
  },
  hint: {
    color: Plait.color.textDim,
    fontSize: 13,
    textAlign: 'center',
    fontFamily: Plait.font.sans,
  },
});
