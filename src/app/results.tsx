import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Loading, PrimaryButton, Subtitle, Title } from '@/components/ui-kit';
import { MY_PROFILE } from '@/config/profile';
import { Plait } from '@/constants/plait-theme';
import type { MenuItem, Pick } from '@/lib/types';
import { useSession } from '@/state/session';

const RANK_COLORS = [Plait.color.coral, Plait.color.teal, '#C9A24B'];

function flagLabel(flag: Pick['flag']): string | null {
  switch (flag) {
    case 'verify_halal':
      return '⚠️ Verify halal';
    case 'contains_allergen':
      return `⚠️ Contains ${MY_PROFILE.allergens.join('/')}`;
    case 'spicier_than_stated':
      return '🌶️ Spicier than stated';
    default:
      return null;
  }
}

export default function ResultsScreen() {
  const router = useRouter();
  const session = useSession();
  const { picks, items } = session;

  useEffect(() => {
    if (picks.length === 0) router.replace('/');
  }, [picks.length, router]);

  if (picks.length === 0) return <Loading message="Loading…" />;

  const byId = new Map(items.map((i) => [i.id, i]));

  const scanAnother = () => {
    session.reset();
    router.replace('/');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.head}>
        <Title style={{ fontSize: 36 }}>Your picks</Title>
        <Subtitle>Ranked for {MY_PROFILE.notes}.</Subtitle>
      </View>

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {picks.map((pick) => {
          const item = byId.get(pick.item_id);
          if (!item) return null;
          return <Card key={pick.item_id} pick={pick} item={item} />;
        })}
        <PrimaryButton label="Scan another menu" variant="ghost" onPress={scanAnother} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Card({ pick, item }: { pick: Pick; item: MenuItem }) {
  const accent = RANK_COLORS[pick.rank - 1] ?? Plait.color.coral;
  const flag = flagLabel(pick.flag);
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={[styles.rankBadge, { backgroundColor: accent }]}>
          <Text style={styles.rankText}>#{pick.rank}</Text>
        </View>
        <Text style={styles.name} numberOfLines={2}>
          {item.name}
        </Text>
        {item.price > 0 && <Text style={styles.price}>${item.price}</Text>}
      </View>

      <View style={styles.scoreRow}>
        <View style={styles.scoreTrack}>
          <View
            style={[styles.scoreFill, { width: `${Math.max(0, Math.min(100, pick.match_score))}%`, backgroundColor: accent }]}
          />
        </View>
        <Text style={styles.scoreText}>{pick.match_score}</Text>
      </View>

      <Body style={styles.why}>{pick.why}</Body>

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
  head: { paddingTop: Plait.space.sm, paddingBottom: Plait.space.md, gap: 6 },
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
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankText: { color: '#111', fontWeight: '800', fontSize: 15, fontFamily: Plait.font.sans },
  name: {
    flex: 1,
    color: Plait.color.text,
    fontSize: 20,
    fontWeight: '700',
    fontFamily: Plait.font.serif,
  },
  price: { color: Plait.color.teal, fontSize: 17, fontWeight: '700', fontFamily: Plait.font.sans },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: Plait.space.sm },
  scoreTrack: {
    flex: 1,
    height: 8,
    backgroundColor: Plait.color.background,
    borderRadius: 4,
    overflow: 'hidden',
  },
  scoreFill: { height: 8, borderRadius: 4 },
  scoreText: { color: Plait.color.textDim, fontSize: 13, width: 28, textAlign: 'right' },
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
