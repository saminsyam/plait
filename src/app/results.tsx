import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Loading, PrimaryButton, Subtitle, Title } from '@/components/ui-kit';
import { Plait } from '@/constants/plait-theme';
import type { MenuItem, Pick } from '@/lib/types';
import { useProfile } from '@/state/profile';
import { useSession } from '@/state/session';

const RANK_COLORS = [Plait.color.coral, Plait.color.teal, '#C9A24B'];

const CONFIDENCE_LABEL: Record<string, string> = {
  high: '±10%',
  medium: '±15%',
  low: '±25%',
};

function flagLabel(flag: Pick['flag']): string | null {
  switch (flag) {
    case 'verify_halal': return '⚠️ Verify halal';
    case 'contains_allergen': return '⚠️ Possible allergen';
    case 'spicier_than_stated': return '🌶️ Spicier than stated';
    default: return null;
  }
}

/** A single horizontal macro bar. */
function MacroBar({
  emoji,
  label,
  value,
  target,
  color,
}: {
  emoji: string;
  label: string;
  value: number;
  target: number | null; // null = relative mode (no TDEE)
  color: string;
}) {
  // If we have a daily target, fill = value/target capped at 100%.
  // If no target, the parent passes the max value across picks as `target` for
  // relative scaling — so the highest pick always hits 100% width.
  const pct = target != null ? Math.min(1, value / target) : 1;
  return (
    <View style={mb.row}>
      <Text style={mb.emoji}>{emoji}</Text>
      <View style={mb.trackWrap}>
        <View style={mb.track}>
          <View style={[mb.fill, { width: `${Math.round(pct * 100)}%`, backgroundColor: color }]} />
        </View>
      </View>
      <Text style={mb.value}>{value}g</Text>
      {target != null && (
        <Text style={mb.pct}>{Math.round(pct * 100)}%</Text>
      )}
    </View>
  );
}

const mb = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  emoji: { fontSize: 14, width: 20 },
  trackWrap: { flex: 1 },
  track: { height: 6, backgroundColor: Plait.color.background, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  value: { color: Plait.color.textDim, fontSize: 12, fontFamily: Plait.font.sans, width: 34, textAlign: 'right' },
  pct: { color: Plait.color.textDim, fontSize: 11, fontFamily: Plait.font.sans, width: 30, textAlign: 'right' },
});

export default function ResultsScreen() {
  const router = useRouter();
  const session = useSession();
  const { preferences, tdee } = useProfile();
  const { picks, items } = session;

  useEffect(() => {
    if (picks.length === 0) router.replace('/');
  }, [picks.length, router]);

  if (picks.length === 0) return <Loading message="Loading…" />;

  const byId = new Map(items.map((i) => [i.id, i]));

  // For relative-mode bars (no TDEE): find the max macro value across all picks.
  const maxProtein = Math.max(1, ...picks.map((p) => p.protein_g ?? 0));
  const maxCarbs   = Math.max(1, ...picks.map((p) => p.carbs_g ?? 0));
  const maxFat     = Math.max(1, ...picks.map((p) => p.fat_g ?? 0));

  const scanAnother = () => {
    session.reset();
    router.replace('/');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.head}>
        <Title style={{ fontSize: 36 }}>Your picks</Title>
        <Subtitle numberOfLines={2}>Ranked for {preferences ?? 'your preferences'}.</Subtitle>
      </View>

      {/* TDEE reference panel */}
      {tdee ? (
        <View style={styles.tdeePanel}>
          <Text style={styles.tdeeLine}>
            🔥 {tdee.calories.toLocaleString()} kcal/day
            {'  '}Protein {tdee.protein_g}g · Carbs {tdee.carbs_g}g · Fat {tdee.fat_g}g
          </Text>
        </View>
      ) : (
        <Pressable style={styles.tdeePanel} onPress={() => router.push('/tdee?edit=1')}>
          <Text style={styles.tdeeAdd}>Add your goals →</Text>
        </Pressable>
      )}

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {picks.map((pick) => {
          const item = byId.get(pick.item_id);
          if (!item) return null;
          return (
            <Card
              key={pick.item_id}
              pick={pick}
              item={item}
              tdee={tdee}
              maxProtein={maxProtein}
              maxCarbs={maxCarbs}
              maxFat={maxFat}
            />
          );
        })}
        <PrimaryButton label="Scan another menu" variant="ghost" onPress={scanAnother} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Card({
  pick,
  item,
  tdee,
  maxProtein,
  maxCarbs,
  maxFat,
}: {
  pick: Pick;
  item: MenuItem;
  tdee: { calories: number; protein_g: number; carbs_g: number; fat_g: number } | null;
  maxProtein: number;
  maxCarbs: number;
  maxFat: number;
}) {
  const accent = RANK_COLORS[pick.rank - 1] ?? Plait.color.coral;
  const flag = flagLabel(pick.flag);
  const hasMacros = pick.protein_g != null || pick.carbs_g != null || pick.fat_g != null;
  const confidenceLabel = pick.confidence ? CONFIDENCE_LABEL[pick.confidence] : '±15%';

  return (
    <View style={styles.card}>
      {/* Header row */}
      <View style={styles.cardTop}>
        <View style={[styles.rankBadge, { backgroundColor: accent }]}>
          <Text style={styles.rankText}>#{pick.rank}</Text>
        </View>
        <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
        {item.price > 0 && <Text style={styles.price}>${item.price}</Text>}
      </View>

      {/* Macro bars */}
      {hasMacros && (
        <View style={styles.macroBlock}>
          {pick.protein_g != null && (
            <MacroBar
              emoji="🟠"
              label="Protein"
              value={pick.protein_g}
              target={tdee ? tdee.protein_g : maxProtein}
              color="#E8704A"
            />
          )}
          {pick.carbs_g != null && (
            <MacroBar
              emoji="🟡"
              label="Carbs"
              value={pick.carbs_g}
              target={tdee ? tdee.carbs_g : maxCarbs}
              color="#E8B44A"
            />
          )}
          {pick.fat_g != null && (
            <MacroBar
              emoji="⚪"
              label="Fat"
              value={pick.fat_g}
              target={tdee ? tdee.fat_g : maxFat}
              color="#9A958C"
            />
          )}
          <Text style={styles.confidence}>
            {tdee
              ? `Est. macros ${confidenceLabel} accuracy`
              : `Set goals to see % of daily targets · Est. ${confidenceLabel}`}
          </Text>
        </View>
      )}

      {/* Reasoning */}
      <Body style={styles.why}>{pick.why}</Body>

      {/* Trust badge */}
      {flag && (
        <View style={styles.flag}>
          <Text style={styles.flagText}>{flag}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Plait.color.background, paddingHorizontal: Plait.space.lg },
  head: { paddingTop: Plait.space.sm, paddingBottom: Plait.space.xs, gap: 4 },
  tdeePanel: {
    paddingVertical: 10,
    paddingHorizontal: Plait.space.sm,
    marginBottom: Plait.space.sm,
    backgroundColor: Plait.color.card,
    borderRadius: Plait.radius.sm,
    borderWidth: 1,
    borderColor: Plait.color.border,
  },
  tdeeLine: {
    color: Plait.color.textDim,
    fontSize: 12,
    fontFamily: Plait.font.sans,
    lineHeight: 18,
  },
  tdeeAdd: {
    color: Plait.color.teal,
    fontSize: 13,
    fontWeight: '600',
    fontFamily: Plait.font.sans,
  },
  list: { gap: Plait.space.md, paddingBottom: Plait.space.xl },
  card: {
    backgroundColor: Plait.color.card,
    borderRadius: Plait.radius.lg,
    padding: Plait.space.md,
    borderWidth: 1,
    borderColor: Plait.color.border,
    gap: Plait.space.sm,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: Plait.space.sm },
  rankBadge: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
  },
  rankText: { color: '#111', fontWeight: '800', fontSize: 15, fontFamily: Plait.font.sans },
  name: {
    flex: 1, color: Plait.color.text, fontSize: 20,
    fontWeight: '700', fontFamily: Plait.font.serif,
  },
  price: { color: Plait.color.teal, fontSize: 17, fontWeight: '700', fontFamily: Plait.font.sans },
  macroBlock: {
    backgroundColor: Plait.color.background,
    borderRadius: Plait.radius.sm,
    padding: Plait.space.sm,
    gap: 8,
  },
  confidence: {
    color: Plait.color.textDim,
    fontSize: 11,
    fontFamily: Plait.font.sans,
    marginTop: 2,
  },
  why: { color: Plait.color.text, fontSize: 15, lineHeight: 21 },
  flag: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(232,180,74,0.15)',
    borderColor: Plait.color.warn,
    borderWidth: 1,
    borderRadius: Plait.radius.pill,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  flagText: { color: Plait.color.warn, fontSize: 13, fontWeight: '600', fontFamily: Plait.font.sans },
});
