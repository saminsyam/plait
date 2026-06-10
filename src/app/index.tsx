import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Loading, PrimaryButton, Subtitle, Title } from '@/components/ui-kit';
import { Plait } from '@/constants/plait-theme';
import { APP_VERSION } from '@/constants/version';
import { useProfile } from '@/state/profile';

export default function HomeScreen() {
  const router = useRouter();
  const { loaded, prefsCompleted, preferences, tdee } = useProfile();

  // First launch → capture dietary needs once. (TDEE is deferred for now.)
  useEffect(() => {
    if (!loaded) return;
    if (!prefsCompleted) router.replace('/preferences');
  }, [loaded, prefsCompleted, router]);

  if (!loaded || !prefsCompleted) return <Loading message="Loading…" />;

  return (
    <SafeAreaView style={styles.safe}>
      <Text style={styles.version}>{APP_VERSION}</Text>
      <View style={styles.hero}>
        <Title style={styles.logo}>
          pl<Text style={{ color: Plait.color.coral }}>AI</Text>t
        </Title>
        <Subtitle style={styles.tagline}>
          Snap a menu. I&apos;ll be your waiter and walk you to the right dish.
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

        {/* Daily goals (TDEE) — optional; ranking uses them when set. */}
        <Pressable style={styles.prefRow} onPress={() => router.push('/tdee?edit=1')} hitSlop={8}>
          <Text style={styles.prefText} numberOfLines={1}>
            {tdee
              ? `🔥 ${tdee.calories.toLocaleString()} kcal · P${tdee.protein_g} C${tdee.carbs_g} F${tdee.fat_g}`
              : '🔥 Set daily calorie & macro goals'}
          </Text>
          <Text style={styles.pencil}>✎</Text>
        </Pressable>
      </View>

      <View style={styles.footer}>
        <PrimaryButton label="📷  Scan a menu" onPress={() => router.push('/camera')} />
        {/* Restaurant lookup (/lookup) is hidden for now — its web-search call
            costs several times a photo scan (~$0.11/lookup). The flow stays
            fully wired; restore the button here to re-enable. */}
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
  version: {
    color: Plait.color.textDim,
    fontSize: 12,
    fontWeight: '600',
    fontFamily: Plait.font.sans,
    letterSpacing: 0.5,
    textAlign: 'right',
    paddingTop: Plait.space.sm,
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
