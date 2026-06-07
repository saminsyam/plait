import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Loading, PrimaryButton, Subtitle, Title } from '@/components/ui-kit';
import { Plait } from '@/constants/plait-theme';
import { useProfile } from '@/state/profile';

export default function HomeScreen() {
  const router = useRouter();
  const { loaded, tdeeCompleted, prefsCompleted, preferences, tdee } = useProfile();

  // First launch → run onboarding in order: TDEE step, then preferences.
  useEffect(() => {
    if (!loaded) return;
    if (!tdeeCompleted) router.replace('/tdee');
    else if (!prefsCompleted) router.replace('/preferences');
  }, [loaded, tdeeCompleted, prefsCompleted, router]);

  if (!loaded || !tdeeCompleted || !prefsCompleted) return <Loading message="Loading…" />;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.hero}>
        <Title style={styles.logo}>
          pl<Text style={{ color: Plait.color.coral }}>AI</Text>t
        </Title>
        <Subtitle style={styles.tagline}>
          Point your camera at a menu. I&apos;ll find your three best dishes.
        </Subtitle>

        <Pressable
          style={styles.prefRow}
          onPress={() => router.push('/preferences?edit=1')}
          hitSlop={8}>
          <Text style={styles.prefText} numberOfLines={1}>
            {preferences}
          </Text>
          <Text style={styles.pencil}>✎</Text>
        </Pressable>

        <Pressable
          style={styles.prefRow}
          onPress={() => router.push('/tdee?edit=1')}
          hitSlop={8}>
          <Text style={styles.prefText} numberOfLines={1}>
            {tdee
              ? `🔥 ${tdee.calories.toLocaleString()} kcal · P${tdee.protein_g}g C${tdee.carbs_g}g F${tdee.fat_g}g`
              : '🔥 Add daily goals'}
          </Text>
          <Text style={styles.pencil}>✎</Text>
        </Pressable>
      </View>

      <View style={styles.footer}>
        <PrimaryButton label="📷  Scan a menu" onPress={() => router.push('/camera')} />
        <PrimaryButton label="🔍  Find a restaurant" variant="teal" onPress={() => router.push('/lookup')} />
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
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Plait.space.sm,
    maxWidth: 340,
  },
  prefText: {
    flexShrink: 1,
    color: Plait.color.textDim,
    fontSize: 14,
    fontFamily: Plait.font.sans,
  },
  pencil: {
    color: Plait.color.teal,
    fontSize: 15,
  },
  footer: {
    paddingBottom: Plait.space.lg,
    gap: Plait.space.md,
  },
});
