/**
 * "Before you go" — lightweight restaurant lookup. ONE web search over
 * reviews (no menu fetch): callReviews returns a blurb + crowd favorites,
 * rendered through the shared RestaurantSummary. Terminal page — the CTA
 * routes to the camera to scan the real menu at the table.
 *
 * The user's hard constraints are string-matched against crowd-favorite
 * NAMES on-device (dietaryFilter patterns, zero tokens) and surface as ⚠️
 * inline warnings. That's a heads-up, not the safety gate — applyHardGate
 * still runs on every scanned menu.
 *
 * The old menu-extraction lookup (callLookup → buildScanFromLookup → full
 * funnel) is retired from this UI but kept in src/lib/callLookup.ts; the
 * eval still exercises its enrichment path and it may return.
 */
import { useRouter } from 'expo-router';
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

import { CookingLoader } from '@/components/cooking-loader';
import {
  RestaurantSummary,
  type CrowdFavoriteEntry,
} from '@/components/restaurant-summary';
import { Body, NavLink, PrimaryButton, Subtitle, Title } from '@/components/ui-kit';
import { Plait } from '@/constants/plait-theme';
import { useProgressSteps } from '@/hooks/use-progress-steps';
import { callReviews, type ReviewsResult } from '@/lib/callReviews';
import { crowdFavoriteWarning } from '@/lib/matchReviews';
import { useProfile } from '@/state/profile';

type Phase = 'input' | 'searching' | 'summary';

export default function LookupScreen() {
  const router = useRouter();
  const { hardConstraints } = useProfile();

  const [restaurant, setRestaurant] = useState('');
  const [city, setCity] = useState('');
  const [phase, setPhase] = useState<Phase>('input');
  const [reviews, setReviews] = useState<ReviewsResult | null>(null);
  const [searchDone, setSearchDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { steps, onProgress, resetProgress } = useProgressSteps();

  const runSearch = async () => {
    setPhase('searching');
    setSearchDone(false);
    setError(null);
    resetProgress();
    try {
      const r = await callReviews(restaurant.trim(), city.trim(), onProgress);
      setReviews(r);
      setSearchDone(true); // the loader navigates via onReady
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed. Try again.');
      setPhase('input');
    }
  };

  if (phase === 'searching') {
    return (
      <CookingLoader
        done={searchDone}
        steps={steps}
        onReady={() => setPhase('summary')}
        title="Reading the reviews"
      />
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <NavLink
            label="‹ Back"
            onPress={() => (phase === 'summary' ? setPhase('input') : router.back())}
          />
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {phase === 'input' && (
            <InputForm
              {...{ restaurant, setRestaurant, city, setCity, error, onSubmit: runSearch }}
            />
          )}
          {phase === 'summary' && reviews && (
            <SummaryView
              restaurant={restaurant.trim()}
              reviews={reviews}
              entries={reviews.crowd_favorites.map(
                (f): CrowdFavoriteEntry => ({
                  name: f.name,
                  blurb: f.blurb,
                  warning: crowdFavoriteWarning(f.name, hardConstraints),
                })
              )}
              onScan={() => router.push('/camera')}
              onSearchAgain={() => setPhase('input')}
            />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function InputForm({
  restaurant,
  setRestaurant,
  city,
  setCity,
  error,
  onSubmit,
}: {
  restaurant: string;
  setRestaurant: (s: string) => void;
  city: string;
  setCity: (s: string) => void;
  error: string | null;
  onSubmit: () => void;
}) {
  const canSubmit = restaurant.trim().length >= 2;
  return (
    <View style={styles.gap}>
      <Title style={styles.title}>Before you go</Title>
      <Subtitle style={styles.sub}>
        I&apos;ll check what reviewers order here — one quick web search, no menu needed.
      </Subtitle>

      <Text style={styles.label}>Restaurant name</Text>
      <TextInput
        style={styles.input}
        value={restaurant}
        onChangeText={setRestaurant}
        placeholder="e.g. Burma Berkeley"
        placeholderTextColor={Plait.color.textDim}
        selectionColor={Plait.color.coral}
        autoFocus
        returnKeyType="next"
      />

      <Text style={styles.label}>City (optional)</Text>
      <TextInput
        style={styles.input}
        value={city}
        onChangeText={setCity}
        placeholder="e.g. Berkeley CA"
        placeholderTextColor={Plait.color.textDim}
        selectionColor={Plait.color.coral}
        returnKeyType="search"
        onSubmitEditing={() => canSubmit && onSubmit()}
      />

      {error && <Body style={styles.error}>{error}</Body>}

      <PrimaryButton
        label="🔎  Check the reviews"
        onPress={onSubmit}
        disabled={!canSubmit}
        style={{ marginTop: Plait.space.sm }}
      />
    </View>
  );
}

function SummaryView({
  restaurant,
  reviews,
  entries,
  onScan,
  onSearchAgain,
}: {
  restaurant: string;
  reviews: ReviewsResult;
  entries: CrowdFavoriteEntry[];
  onScan: () => void;
  onSearchAgain: () => void;
}) {
  if (!reviews.found) {
    return (
      <View style={styles.gap}>
        <Title style={styles.title}>No reviews found</Title>
        <Subtitle style={styles.sub}>
          I couldn&apos;t find reviews for “{restaurant}” online — and I won&apos;t make them up.
          Try adding the city, or just scan the menu when you&apos;re there.
        </Subtitle>
        <PrimaryButton label="📷  Scan the menu instead" variant="teal" onPress={onScan} />
        <PrimaryButton label="Search again" variant="ghost" onPress={onSearchAgain} />
      </View>
    );
  }

  return (
    <View style={styles.gap}>
      <Title style={styles.title}>{restaurant}</Title>
      <RestaurantSummary
        mode="standalone"
        summary={reviews.restaurant_blurb}
        crowdFavorites={{ kind: 'loaded', favorites: entries }}
      />
      <Text style={styles.footNote}>
        Review buzz only — the live menu may differ. Scan it there for picks
        matched to you.
      </Text>
      <PrimaryButton label="Scan the menu when you’re there →" onPress={onScan} />
      <PrimaryButton label="Look up another place" variant="ghost" onPress={onSearchAgain} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Plait.color.background },
  flex: { flex: 1 },
  header: { paddingHorizontal: Plait.space.lg, paddingTop: Plait.space.sm },
  scroll: { flexGrow: 1, paddingHorizontal: Plait.space.lg, paddingTop: Plait.space.md, paddingBottom: Plait.space.xl },
  gap: { gap: Plait.space.md },
  title: { fontSize: 34, lineHeight: 42 },
  sub: { fontSize: 16 },
  label: { color: Plait.color.textDim, fontSize: 14, fontWeight: '600', fontFamily: Plait.font.sans },
  input: {
    backgroundColor: Plait.color.card,
    borderRadius: Plait.radius.md,
    borderWidth: 1,
    borderColor: Plait.color.border,
    color: Plait.color.text,
    fontFamily: Plait.font.sans,
    fontSize: 17,
    paddingVertical: 14,
    paddingHorizontal: Plait.space.md,
  },
  error: { color: Plait.color.danger, fontSize: 14 },
  footNote: { color: Plait.color.textDim, fontSize: 13, fontFamily: Plait.font.sans, lineHeight: 18 },
});
