/**
 * Stage 1 — Orientation. A confident 10-second read of the restaurant. The
 * details live in tappable tiles (Known for / Can't go wrong with / Good to
 * know / First time? Try) that stay collapsed until tapped, so the page is a
 * glanceable summary instead of a wall of text. Reveal progressively.
 */
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
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

import { Loading, PrimaryButton, Subtitle, Title } from '@/components/ui-kit';
import { Plait } from '@/constants/plait-theme';
import { useSession } from '@/state/session';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type TileDef = {
  id: string;
  emoji: string;
  title: string;
  items: string[];
  /** How each item renders inside the expanded tile. */
  variant: 'chips' | 'bullets';
  bullet?: string;
};

export default function OrientationScreen() {
  const router = useRouter();
  const { menuContext, items, candidates } = useSession();
  const [open, setOpen] = useState<Set<string>>(new Set());

  // Guard: no scan in progress → home.
  useEffect(() => {
    if (!menuContext || items.length === 0) router.replace('/');
  }, [menuContext, items.length, router]);

  if (!menuContext || items.length === 0) return <Loading message="Reading the room…" />;

  const o = menuContext.orientation;
  const nameById = new Map(items.map((i) => [i.id, i.name]));
  const signatures = o.signature_item_ids.map((id) => nameById.get(id)).filter(Boolean) as string[];
  const cuisine =
    menuContext.cuisine_type && menuContext.cuisine_type !== 'unknown' ? menuContext.cuisine_type : null;

  const allTiles: TileDef[] = [
    { id: 'known', emoji: '🏆', title: 'Known for', items: o.known_for, variant: 'chips' },
    { id: 'sure', emoji: '⭐', title: "Can't go wrong with", items: signatures, variant: 'bullets', bullet: '⭐' },
    { id: 'facts', emoji: '💡', title: 'Good to know', items: o.interesting_facts, variant: 'bullets', bullet: '•' },
    { id: 'first', emoji: '👋', title: 'First time? Try', items: o.first_timer_tips, variant: 'bullets', bullet: '👉' },
  ];
  const tiles = allTiles.filter((t) => t.items.length > 0);

  const toggle = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          {cuisine && <Text style={styles.kicker}>{cuisine.toUpperCase()}</Text>}
          <Title style={styles.title}>Here&apos;s the place</Title>
          {!!o.summary && <Subtitle style={styles.summary}>{o.summary}</Subtitle>}
        </View>

        {tiles.length > 0 ? (
          <View style={styles.tiles}>
            {tiles.map((t) => {
              const isOpen = open.has(t.id);
              return (
                <Pressable
                  key={t.id}
                  onPress={() => toggle(t.id)}
                  style={[styles.tile, isOpen && styles.tileOpen]}>
                  <View style={styles.tileHead}>
                    <Text style={styles.tileEmoji}>{t.emoji}</Text>
                    <Text style={styles.tileTitle}>{t.title}</Text>
                    <View style={styles.spacer} />
                    {!isOpen && <Text style={styles.count}>{t.items.length}</Text>}
                    <Text style={styles.chevron}>{isOpen ? '⌄' : '›'}</Text>
                  </View>

                  {isOpen && (
                    <View style={styles.tileBody}>
                      {t.variant === 'chips' ? (
                        <View style={styles.chips}>
                          {t.items.map((it, i) => (
                            <View key={i} style={styles.chip}>
                              <Text style={styles.chipText}>{it}</Text>
                            </View>
                          ))}
                        </View>
                      ) : (
                        t.items.map((it, i) => (
                          <Text key={i} style={styles.bullet}>
                            {t.bullet} {it}
                          </Text>
                        ))
                      )}
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        ) : (
          <Subtitle style={styles.summary}>
            I read {items.length} dishes. Let&apos;s narrow them to your perfect order.
          </Subtitle>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Text style={styles.footNote}>{candidates.length} dishes fit your dietary needs.</Text>
        <PrimaryButton label="Help me choose →" onPress={() => router.replace('/questions')} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Plait.color.background },
  scroll: { paddingHorizontal: Plait.space.lg, paddingTop: Plait.space.lg, paddingBottom: Plait.space.lg, gap: Plait.space.lg },
  header: { gap: Plait.space.sm },
  kicker: { color: Plait.color.coral, fontSize: 13, fontWeight: '800', letterSpacing: 1.5, fontFamily: Plait.font.sans },
  title: { fontSize: 36 },
  summary: { fontSize: 17, lineHeight: 25 },

  tiles: { gap: Plait.space.sm },
  tile: {
    backgroundColor: Plait.color.card,
    borderRadius: Plait.radius.md,
    borderWidth: 1,
    borderColor: Plait.color.border,
    paddingHorizontal: Plait.space.md,
    paddingVertical: 16,
  },
  tileOpen: { borderColor: Plait.color.coral, backgroundColor: Plait.color.cardElevated },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: Plait.space.sm },
  tileEmoji: { fontSize: 20 },
  tileTitle: { color: Plait.color.text, fontSize: 17, fontWeight: '700', fontFamily: Plait.font.serif },
  spacer: { flex: 1 },
  count: {
    color: Plait.color.textDim,
    fontSize: 13,
    fontWeight: '700',
    fontFamily: Plait.font.sans,
    backgroundColor: Plait.color.background,
    borderRadius: Plait.radius.pill,
    minWidth: 22,
    textAlign: 'center',
    paddingHorizontal: 7,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  chevron: { color: Plait.color.teal, fontSize: 18, fontWeight: '800' },

  tileBody: { marginTop: 14, gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Plait.space.sm },
  chip: {
    backgroundColor: Plait.color.background,
    borderWidth: 1,
    borderColor: Plait.color.border,
    borderRadius: Plait.radius.pill,
    paddingVertical: 7,
    paddingHorizontal: Plait.space.md,
  },
  chipText: { color: Plait.color.text, fontSize: 14, fontWeight: '600', fontFamily: Plait.font.sans },
  bullet: { color: Plait.color.text, fontSize: 16, lineHeight: 24, fontFamily: Plait.font.sans },

  footer: {
    paddingHorizontal: Plait.space.lg,
    paddingBottom: Plait.space.lg,
    paddingTop: Plait.space.sm,
    gap: Plait.space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Plait.color.border,
  },
  footNote: { color: Plait.color.textDim, fontSize: 13, textAlign: 'center', fontFamily: Plait.font.sans },
});
