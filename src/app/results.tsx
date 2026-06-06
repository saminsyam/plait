import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Loading, PrimaryButton, Subtitle, Title } from '@/components/ui-kit';
import { Plait } from '@/constants/plait-theme';
import { callDishDetail, type DishDetail } from '@/lib/callDishDetail';
import type { MenuItem, Pick } from '@/lib/types';
import { useProfile } from '@/state/profile';
import { useSession } from '@/state/session';

// LayoutAnimation needs to be explicitly enabled on Android.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const RANK_COLORS = [Plait.color.coral, Plait.color.teal, '#C9A24B'];

const CONFIDENCE_LABEL: Record<string, string> = {
  high: '±10%',
  medium: '±15%',
  low: '±25%',
};

/** Halal / allergen flags are liability-grade — give them a stronger treatment. */
function isStrongFlag(flag: Pick['flag']): boolean {
  return flag === 'verify_halal' || flag === 'contains_allergen';
}

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
  value,
  target,
  color,
}: {
  emoji: string;
  value: number;
  target: number | null; // null = relative mode (no TDEE)
  color: string;
}) {
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
      {target != null && <Text style={mb.pct}>{Math.round(pct * 100)}%</Text>}
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

/** Animated chevron that rotates 180° between collapsed/expanded. */
function Chevron({ expanded, reduceMotion }: { expanded: boolean; reduceMotion: boolean }) {
  const v = useRef(new Animated.Value(expanded ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) {
      v.setValue(expanded ? 1 : 0);
      return;
    }
    Animated.timing(v, { toValue: expanded ? 1 : 0, duration: 250, useNativeDriver: true }).start();
  }, [expanded, reduceMotion, v]);
  const rotate = v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
  return <Animated.Text style={[styles.chevron, { transform: [{ rotate }] }]}>▾</Animated.Text>;
}

/** Fades + slides its children in once on mount (skips motion if reduced). */
function FadeInSection({
  children,
  delay,
  reduceMotion,
}: {
  children: React.ReactNode;
  delay: number;
  reduceMotion: boolean;
}) {
  const v = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    Animated.timing(v, { toValue: 1, duration: 280, delay, useNativeDriver: true }).start();
  }, [delay, reduceMotion, v]);
  const translateY = v.interpolate({ inputRange: [0, 1], outputRange: [8, 0] });
  return (
    <Animated.View style={{ opacity: v, transform: [{ translateY }] }}>{children}</Animated.View>
  );
}

export default function ResultsScreen() {
  const router = useRouter();
  const session = useSession();
  const { preferences, tdee } = useProfile();
  const { picks, items, questions, answers, restaurantNotes } = session;

  // Expand/detail state — only one card open at a time.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DishDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);
  const detailCache = useRef<Record<string, DishDetail>>({});
  const activeIdRef = useRef<string | null>(null);

  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (picks.length === 0) router.replace('/');
  }, [picks.length, router]);

  if (picks.length === 0) return <Loading message="Loading…" />;

  const byId = new Map(items.map((i) => [i.id, i]));

  // A halal/kosher certification note is a positive trust signal — surface it as
  // a banner, and suppress the per-dish "verify halal" flag (cert covers it).
  const halalCertified = restaurantNotes.some((n) => /halal/i.test(n));
  const trustNotes = restaurantNotes.filter((n) => /halal|kosher/i.test(n));

  const maxProtein = Math.max(1, ...picks.map((p) => p.protein_g ?? 0));
  const maxCarbs = Math.max(1, ...picks.map((p) => p.carbs_g ?? 0));
  const maxFat = Math.max(1, ...picks.map((p) => p.fat_g ?? 0));

  const animateLayout = () => {
    if (!reduceMotion) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  };

  const toggle = (pick: Pick, item: MenuItem) => {
    const id = item.id;
    const opening = expandedId !== id;
    animateLayout();

    if (!opening) {
      setExpandedId(null);
      activeIdRef.current = null;
      setDetail(null);
      setDetailError(false);
      setDetailLoading(false);
      return;
    }

    setExpandedId(id);
    activeIdRef.current = id;
    setDetailError(false);

    const cached = detailCache.current[id];
    if (cached) {
      setDetail(cached);
      setDetailLoading(false);
      return;
    }

    setDetail(null);
    setDetailLoading(true);
    (async () => {
      try {
        const otherPicks = picks
          .filter((p) => p.item_id !== pick.item_id)
          .map((p) => ({ name: byId.get(p.item_id)?.name ?? 'Another dish', why: p.why }));
        const d = await callDishDetail({
          pick,
          item,
          preferences: preferences ?? '',
          tdee,
          questions,
          answers,
          otherPicks,
          isTopPick: pick.rank === 1,
        });
        detailCache.current[id] = d;
        if (activeIdRef.current === id) {
          animateLayout();
          setDetail(d);
        }
      } catch {
        if (activeIdRef.current === id) setDetailError(true);
      } finally {
        if (activeIdRef.current === id) setDetailLoading(false);
      }
    })();
  };

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

      {/* Restaurant-level trust signal (halal/kosher certification) */}
      {trustNotes.length > 0 && (
        <View style={styles.trustBanner}>
          {trustNotes.map((note, i) => (
            <Text key={i} style={styles.trustText}>✓ Restaurant note: “{note}”</Text>
          ))}
        </View>
      )}

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {picks.map((pick, i) => {
          const item = byId.get(pick.item_id);
          if (!item) return null;
          const isExpanded = expandedId === item.id;
          return (
            <Card
              key={pick.item_id}
              pick={pick}
              item={item}
              tdee={tdee}
              halalCertified={halalCertified}
              maxProtein={maxProtein}
              maxCarbs={maxCarbs}
              maxFat={maxFat}
              isFirst={i === 0}
              expanded={isExpanded}
              onToggle={() => toggle(pick, item)}
              detail={isExpanded ? detail : null}
              detailLoading={isExpanded && detailLoading}
              detailError={isExpanded && detailError}
              reduceMotion={reduceMotion}
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
  halalCertified,
  maxProtein,
  maxCarbs,
  maxFat,
  isFirst,
  expanded,
  onToggle,
  detail,
  detailLoading,
  detailError,
  reduceMotion,
}: {
  pick: Pick;
  item: MenuItem;
  tdee: { calories: number; protein_g: number; carbs_g: number; fat_g: number } | null;
  halalCertified: boolean;
  maxProtein: number;
  maxCarbs: number;
  maxFat: number;
  isFirst: boolean;
  expanded: boolean;
  onToggle: () => void;
  detail: DishDetail | null;
  detailLoading: boolean;
  detailError: boolean;
  reduceMotion: boolean;
}) {
  const accent = RANK_COLORS[pick.rank - 1] ?? Plait.color.coral;
  // The restaurant's halal certification covers the "verify halal" prompt.
  const effectiveFlag: Pick['flag'] =
    pick.flag === 'verify_halal' && halalCertified ? null : pick.flag;
  const flag = flagLabel(effectiveFlag);
  const hasMacros = pick.protein_g != null || pick.carbs_g != null || pick.fat_g != null;
  const confidenceLabel = pick.confidence ? CONFIDENCE_LABEL[pick.confidence] : '±15%';
  const isTop = pick.rank === 1;
  const strong = isStrongFlag(effectiveFlag);
  const severity = strong ? Plait.color.danger : Plait.color.warn;

  return (
    <Pressable
      onPress={onToggle}
      style={({ pressed }) => [
        styles.card,
        expanded && styles.cardExpanded,
        pressed && !reduceMotion && { transform: [{ scale: 0.98 }] },
      ]}>
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
            <MacroBar emoji="🟠" value={pick.protein_g} target={tdee ? tdee.protein_g : maxProtein} color="#E8704A" />
          )}
          {pick.carbs_g != null && (
            <MacroBar emoji="🟡" value={pick.carbs_g} target={tdee ? tdee.carbs_g : maxCarbs} color="#E8B44A" />
          )}
          {pick.fat_g != null && (
            <MacroBar emoji="⚪" value={pick.fat_g} target={tdee ? tdee.fat_g : maxFat} color="#9A958C" />
          )}
          <Text style={styles.confidence}>
            {tdee
              ? `Est. macros ${confidenceLabel} accuracy`
              : `Set goals to see % of daily targets · Est. ${confidenceLabel}`}
          </Text>
        </View>
      )}

      {/* One-sentence reasoning (always visible) */}
      <Body style={styles.why}>{pick.why}</Body>

      {/* Collapsed trust badge */}
      {flag && (
        <View style={[styles.flag, { borderColor: severity, backgroundColor: strong ? 'rgba(232,90,74,0.15)' : 'rgba(232,180,74,0.15)' }]}>
          <Text style={[styles.flagText, { color: severity }]}>{flag}</Text>
        </View>
      )}

      {/* Expanded detail */}
      {expanded && (
        <View style={styles.detail}>
          {detailLoading && (
            <View style={styles.detailLoader}>
              <ActivityIndicator size="small" color={Plait.color.coral} />
              <Text style={styles.detailLoaderText}>Getting the details…</Text>
            </View>
          )}

          {!detailLoading && detailError && (
            <Text style={styles.errorText}>Couldn’t load extra details — tap again to retry.</Text>
          )}

          {!detailLoading && detail && (
            <>
              {detail.why_this_pick !== '' && (
                <FadeInSection delay={0} reduceMotion={reduceMotion}>
                  <Text style={styles.labelWhy}>Why this pick</Text>
                  <Text style={styles.detailBody}>{detail.why_this_pick}</Text>
                </FadeInSection>
              )}

              {detail.how_to_order.length > 0 && (
                <FadeInSection delay={40} reduceMotion={reduceMotion}>
                  <Text style={styles.labelOrder}>How to order</Text>
                  {detail.how_to_order.map((mod, idx) => (
                    <View key={idx} style={styles.orderRow}>
                      <Text style={styles.orderPlus}>+</Text>
                      <Text style={styles.orderText}>{mod}</Text>
                    </View>
                  ))}
                </FadeInSection>
              )}

              {detail.safety_detail.length > 0 && (
                <FadeInSection delay={80} reduceMotion={reduceMotion}>
                  <Text style={[styles.labelSafety, { color: severity }]}>Safety</Text>
                  <View style={[styles.safetyBox, { borderLeftColor: severity }]}>
                    {detail.safety_detail.map((s, idx) => (
                      <View key={idx} style={styles.safetyRow}>
                        <Text style={styles.safetyIcon}>⚠️</Text>
                        <Text style={[styles.safetyText, strong && styles.safetyTextStrong]}>{s}</Text>
                      </View>
                    ))}
                  </View>
                </FadeInSection>
              )}

              {isTop && detail.why_not_others !== '' && (
                <FadeInSection delay={120} reduceMotion={reduceMotion}>
                  <Text style={styles.whyNot}>{detail.why_not_others}</Text>
                </FadeInSection>
              )}
            </>
          )}
        </View>
      )}

      {/* Footer: tap hint (first card only) + chevron */}
      <View style={styles.cardFooter}>
        {isFirst && !expanded && <Text style={styles.tapHint}>Tap for details</Text>}
        <View style={{ flex: 1 }} />
        <Chevron expanded={expanded} reduceMotion={reduceMotion} />
      </View>
    </Pressable>
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
  tdeeLine: { color: Plait.color.textDim, fontSize: 12, fontFamily: Plait.font.sans, lineHeight: 18 },
  tdeeAdd: { color: Plait.color.teal, fontSize: 13, fontWeight: '600', fontFamily: Plait.font.sans },
  trustBanner: {
    backgroundColor: 'rgba(78,205,196,0.12)',
    borderColor: Plait.color.teal,
    borderWidth: 1,
    borderRadius: Plait.radius.sm,
    paddingVertical: 10,
    paddingHorizontal: Plait.space.sm,
    marginBottom: Plait.space.sm,
    gap: 4,
  },
  trustText: {
    color: Plait.color.teal,
    fontSize: 13,
    fontWeight: '600',
    fontFamily: Plait.font.sans,
    lineHeight: 18,
  },
  list: { gap: Plait.space.md, paddingBottom: Plait.space.xl },
  card: {
    backgroundColor: Plait.color.card,
    borderRadius: Plait.radius.lg,
    padding: Plait.space.md,
    borderWidth: 1,
    borderColor: Plait.color.border,
    gap: Plait.space.sm,
    overflow: 'hidden',
  },
  cardExpanded: { borderColor: Plait.color.cardElevated },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: Plait.space.sm },
  rankBadge: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  rankText: { color: '#111', fontWeight: '800', fontSize: 15, fontFamily: Plait.font.sans },
  name: { flex: 1, color: Plait.color.text, fontSize: 20, fontWeight: '700', fontFamily: Plait.font.serif },
  price: { color: Plait.color.teal, fontSize: 17, fontWeight: '700', fontFamily: Plait.font.sans },
  macroBlock: { backgroundColor: Plait.color.background, borderRadius: Plait.radius.sm, padding: Plait.space.sm, gap: 8 },
  confidence: { color: Plait.color.textDim, fontSize: 11, fontFamily: Plait.font.sans, marginTop: 2 },
  why: { color: Plait.color.text, fontSize: 15, lineHeight: 21 },
  flag: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: Plait.radius.pill,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  flagText: { fontSize: 13, fontWeight: '600', fontFamily: Plait.font.sans },

  // Expanded detail
  detail: { gap: Plait.space.md, marginTop: Plait.space.xs, paddingTop: Plait.space.xs },
  detailLoader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: Plait.space.sm },
  detailLoaderText: { color: Plait.color.textDim, fontSize: 13, fontFamily: Plait.font.sans },
  errorText: { color: Plait.color.textDim, fontSize: 13, fontFamily: Plait.font.sans, paddingVertical: 4 },
  labelWhy: {
    color: Plait.color.coral,
    fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase',
    fontFamily: Plait.font.sans, marginBottom: 4,
  },
  labelOrder: {
    color: Plait.color.teal,
    fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase',
    fontFamily: Plait.font.sans, marginBottom: 6,
  },
  labelSafety: {
    fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase',
    fontFamily: Plait.font.sans, marginBottom: 6,
  },
  detailBody: { color: Plait.color.text, fontSize: 15, lineHeight: 22, fontFamily: Plait.font.serif },
  orderRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginBottom: 4 },
  orderPlus: { color: Plait.color.teal, fontSize: 15, fontWeight: '800', lineHeight: 21 },
  orderText: { flex: 1, color: Plait.color.text, fontSize: 14, lineHeight: 21, fontFamily: Plait.font.sans },
  safetyBox: { borderLeftWidth: 3, paddingLeft: 10, gap: 6 },
  safetyRow: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  safetyIcon: { fontSize: 13, lineHeight: 20 },
  safetyText: { flex: 1, color: Plait.color.text, fontSize: 14, lineHeight: 20, fontFamily: Plait.font.sans },
  safetyTextStrong: { fontWeight: '700' },
  whyNot: { color: Plait.color.textDim, fontSize: 13, lineHeight: 19, fontFamily: Plait.font.sans, fontStyle: 'italic' },

  // Footer
  cardFooter: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  tapHint: { color: Plait.color.textDim, fontSize: 12, fontFamily: Plait.font.sans },
  chevron: { color: Plait.color.textDim, fontSize: 16 },
});
