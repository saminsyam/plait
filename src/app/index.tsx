import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, PrimaryButton, Subtitle, Title } from '@/components/ui-kit';
import { MY_PROFILE } from '@/config/profile';
import { Plait } from '@/constants/plait-theme';

const PROFILE_CHIPS = ['Halal', 'Shellfish-free', 'High-protein'];

export default function HomeScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.hero}>
        <Title style={styles.logo}>
          pl<Text style={{ color: Plait.color.coral }}>AI</Text>t
        </Title>
        <Subtitle style={styles.tagline}>
          Point your camera at a menu. I&apos;ll find your three best dishes.
        </Subtitle>
      </View>

      <View style={styles.footer}>
        <View style={styles.chips}>
          {PROFILE_CHIPS.map((c) => (
            <View key={c} style={styles.chip}>
              <Text style={styles.chipText}>{c}</Text>
            </View>
          ))}
        </View>
        <Body style={styles.notes}>Tuned for: {MY_PROFILE.notes}</Body>
        <PrimaryButton label="📷  Scan a menu" onPress={() => router.push('/camera')} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Plait.color.background,
    paddingHorizontal: Plait.space.lg,
  },
  hero: {
    flex: 1,
    justifyContent: 'center',
    gap: Plait.space.md,
  },
  logo: {
    fontSize: 72,
  },
  tagline: {
    fontSize: 18,
    lineHeight: 26,
    maxWidth: 320,
  },
  footer: {
    paddingBottom: Plait.space.lg,
    gap: Plait.space.md,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Plait.space.sm,
  },
  chip: {
    backgroundColor: Plait.color.card,
    borderRadius: Plait.radius.pill,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: Plait.color.border,
  },
  chipText: {
    color: Plait.color.teal,
    fontSize: 14,
    fontWeight: '600',
    fontFamily: Plait.font.sans,
  },
  notes: {
    color: Plait.color.textDim,
    fontSize: 14,
  },
});
