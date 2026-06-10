import { useRouter } from 'expo-router';
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

import { CookingLoader } from '@/components/cooking-loader';
import { Body, NavLink, PrimaryButton, Subtitle, Title } from '@/components/ui-kit';
import { Plait } from '@/constants/plait-theme';
import { useProgressSteps } from '@/hooks/use-progress-steps';
import { buildScanFromLookup, callLookup, type LookupResult } from '@/lib/callLookup';
import { applyHardGate } from '@/lib/dietaryFilter';
import { useProfile } from '@/state/profile';
import { useSession } from '@/state/session';

type Phase = 'input' | 'searching' | 'result' | 'building';

export default function LookupScreen() {
  const router = useRouter();
  const session = useSession();
  const { hardConstraints } = useProfile();

  const [restaurant, setRestaurant] = useState('');
  const [city, setCity] = useState('');
  const [phase, setPhase] = useState<Phase>('input');
  const [result, setResult] = useState<LookupResult | null>(null);
  const [selectedMeal, setSelectedMeal] = useState<string | null>(null);
  const [buildDone, setBuildDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { steps, onProgress, resetProgress } = useProgressSteps();

  const runSearch = async (name: string, where: string) => {
    setPhase('searching');
    setError(null);
    resetProgress();
    try {
      const r = await callLookup(name.trim(), where.trim(), onProgress);
      setResult(r);
      setSelectedMeal(null);
      setPhase('result');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed. Try again.');
      setPhase('input');
    }
  };

  const proceed = () => {
    if (!result) return;
    setPhase('building');
    setBuildDone(false);
    setError(null);
    resetProgress();
    (async () => {
      try {
        const multiPeriod = result.meal_periods_found.length > 1;
        const filtered =
          multiPeriod && selectedMeal
            ? result.items.filter((i) => i.meal_period === selectedMeal)
            : result.items;
        const useItems = filtered.length > 0 ? filtered : result.items;

        const scan = await buildScanFromLookup(useItems, onProgress);
        if (scan.items.length === 0) throw new Error('Could not read this menu. Try a photo instead.');

        onProgress({ id: 'gate', icon: '🛡️', label: 'Applying your dietary guardrails', status: 'active' });
        const gate = applyHardGate(scan.items, hardConstraints);
        const candidates = [...gate.allowed, ...gate.verify.map((v) => v.item)];
        const verifyById = Object.fromEntries(gate.verify.map((v) => [v.item.id, v.reasons]));
        onProgress({
          id: 'gate',
          icon: '🛡️',
          label: 'Dietary guardrails applied',
          detail:
            `${candidates.length} dishes in play` +
            (gate.blocked.length > 0 ? ` · ${gate.blocked.length} set aside` : ''),
          status: 'done',
        });
        session.setScan({
          imageUri: '',
          items: scan.items,
          menuContext: scan.menu_context,
          candidates,
          verifyById,
          blocked: gate.blocked,
        });
        setBuildDone(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong.');
        setPhase('result');
      }
    })();
  };

  // --- Loaders (the toy is playable while we wait)
  if (phase === 'searching') {
    // done stays false — search status streams in live; we leave this screen
    // by switching phase when the search returns.
    return <CookingLoader done={false} steps={steps} onReady={() => {}} title="Searching the web" />;
  }
  if (phase === 'building') {
    return (
      <CookingLoader
        done={buildDone}
        steps={steps}
        onReady={() => router.replace('/orientation')}
        title="Reading the menu"
      />
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <NavLink label="‹ Back" onPress={() => router.back()} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {phase === 'input' && <InputForm {...{ restaurant, setRestaurant, city, setCity, error, onSubmit: () => runSearch(restaurant, city) }} />}

          {phase === 'result' && result && (
            <ResultView
              result={result}
              selectedMeal={selectedMeal}
              setSelectedMeal={setSelectedMeal}
              error={error}
              onProceed={proceed}
              onPickLocation={(loc) => runSearch(restaurant, loc)}
              onRetake={() => router.replace('/camera')}
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
      <Title style={styles.title}>Find a restaurant</Title>
      <Subtitle style={styles.sub}>I&apos;ll look up the menu online and rank it for you.</Subtitle>

      <Text style={styles.label}>Restaurant name</Text>
      <TextInput
        style={styles.input}
        value={restaurant}
        onChangeText={setRestaurant}
        placeholder="e.g. Berkeley Social Club"
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

      <PrimaryButton label="🔍  Find menu" onPress={onSubmit} disabled={!canSubmit} style={{ marginTop: Plait.space.sm }} />
    </View>
  );
}

function ResultView({
  result,
  selectedMeal,
  setSelectedMeal,
  error,
  onProceed,
  onPickLocation,
  onRetake,
  onSearchAgain,
}: {
  result: LookupResult;
  selectedMeal: string | null;
  setSelectedMeal: (m: string) => void;
  error: string | null;
  onProceed: () => void;
  onPickLocation: (loc: string) => void;
  onRetake: () => void;
  onSearchAgain: () => void;
}) {
  // State 1 — not found
  if (!result.found && !result.needs_location_confirm) {
    return (
      <View style={styles.gap}>
        <Title style={styles.title}>No menu found</Title>
        <Subtitle style={styles.sub}>We couldn&apos;t find this menu online.</Subtitle>
        <PrimaryButton label="📷  Upload a photo instead" variant="teal" onPress={onRetake} />
        <PrimaryButton label="Search again" variant="ghost" onPress={onSearchAgain} />
      </View>
    );
  }

  // State 2 — location confirmation
  if (result.needs_location_confirm && result.locations_found.length > 0) {
    return (
      <View style={styles.gap}>
        <Title style={styles.title}>Which location?</Title>
        <Subtitle style={styles.sub}>We found multiple locations. Pick the one you&apos;re at.</Subtitle>
        {result.locations_found.map((loc, i) => (
          <Pressable key={i} style={styles.locationRow} onPress={() => onPickLocation(loc)}>
            <Text style={styles.locationText}>{loc}</Text>
            <Text style={styles.locationArrow}>›</Text>
          </Pressable>
        ))}
        <PrimaryButton label="Search again" variant="ghost" onPress={onSearchAgain} />
      </View>
    );
  }

  // State 3/4/5 — found
  const multiPeriod = result.meal_periods_found.length > 1;
  return (
    <View style={styles.gap}>
      <Title style={styles.title}>Menu found</Title>
      <Subtitle style={styles.sub}>
        {result.items.length} dishes{result.source_name ? ` · ${result.source_name}` : ''}
      </Subtitle>

      {/* State 3 — freshness warning */}
      {result.freshness_warning && (
        <View style={styles.warnBanner}>
          <Text style={styles.warnText}>
            ⚠️ {result.freshness_warning_reason ?? 'Menu may have changed'} — verify items & prices with staff.
          </Text>
        </View>
      )}

      {/* State 4 — meal period selector */}
      {multiPeriod && (
        <>
          <Text style={styles.label}>Which meal?</Text>
          <View style={styles.chips}>
            {result.meal_periods_found.map((mp) => {
              const sel = selectedMeal === mp;
              return (
                <Pressable
                  key={mp}
                  onPress={() => setSelectedMeal(mp)}
                  style={[styles.chip, sel && styles.chipSel]}>
                  <Text style={[styles.chipText, sel && styles.chipTextSel]}>
                    {mp.charAt(0).toUpperCase() + mp.slice(1)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      {error && <Body style={styles.error}>{error}</Body>}

      <PrimaryButton
        label="Find my picks →"
        onPress={onProceed}
        disabled={multiPeriod && !selectedMeal}
        style={{ marginTop: Plait.space.sm }}
      />
      <PrimaryButton label="Search again" variant="ghost" onPress={onSearchAgain} />
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
  warnBanner: {
    backgroundColor: 'rgba(232,180,74,0.15)',
    borderColor: Plait.color.warn,
    borderWidth: 1,
    borderRadius: Plait.radius.sm,
    padding: Plait.space.sm,
  },
  warnText: { color: Plait.color.warn, fontSize: 13, fontWeight: '600', fontFamily: Plait.font.sans, lineHeight: 18 },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Plait.color.card,
    borderRadius: Plait.radius.md,
    borderWidth: 1,
    borderColor: Plait.color.border,
    paddingVertical: 16,
    paddingHorizontal: Plait.space.md,
  },
  locationText: { flex: 1, color: Plait.color.text, fontSize: 15, fontFamily: Plait.font.sans },
  locationArrow: { color: Plait.color.teal, fontSize: 22, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Plait.space.sm },
  chip: {
    borderRadius: Plait.radius.pill,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: Plait.color.border,
  },
  chipSel: { backgroundColor: Plait.color.coral, borderColor: Plait.color.coral },
  chipText: { color: Plait.color.text, fontSize: 15, fontWeight: '600', fontFamily: Plait.font.sans },
  chipTextSel: { color: '#111111' },
});
