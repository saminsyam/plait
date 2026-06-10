/**
 * Stage 1 — Orientation. A confident 10-second read of the restaurant. The
 * summary, cuisine kicker, and Menu highlights render through the shared
 * <RestaurantSummary> (also used by the standalone lookup page); the
 * menu-specific "Known for" tile stays collapsed until tapped so the page is
 * a glanceable summary instead of a wall of text.
 */
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
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

import {
  RestaurantSummary,
  type CrowdFavoriteEntry,
  type CrowdFavoritesState,
} from '@/components/restaurant-summary';
import { Loading, NavLink, PrimaryButton, Subtitle, Title } from '@/components/ui-kit';
import { Plait } from '@/constants/plait-theme';
import { useProgressSteps } from '@/hooks/use-progress-steps';
import { callReviews, getCachedReviews, type ReviewsResult } from '@/lib/callReviews';
import { matchCrowdFavorites } from '@/lib/matchReviews';
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

/** Where the crowd-favorites tile is in its lifecycle on this screen. */
type ReviewPhase =
  | { status: 'hidden' } // no restaurant name read → nothing to search for
  | { status: 'offer' } // nothing cached → tap-to-fetch
  | { status: 'loading' }
  | { status: 'loaded'; entries: CrowdFavoriteEntry[] }
  | { status: 'empty' } // search ran dry
  | { status: 'error' };

export default function OrientationScreen() {
  const router = useRouter();
  const session = useSession();
  const { menuContext, items, candidates, setCrowdFavorites } = session;
  const [open, setOpen] = useState<Set<string>>(new Set());

  const restaurantName = menuContext?.restaurant_name.trim() ?? '';
  const [reviewPhase, setReviewPhase] = useState<ReviewPhase>({ status: 'hidden' });
  const { steps, onProgress, resetProgress } = useProgressSteps();

  // Fold a fetched/cached review result into the tile + the session map the
  // ranking call reads. Matching is pure string work — zero tokens.
  const applyReviews = useCallback(
    (r: ReviewsResult) => {
      if (!r.found) {
        setReviewPhase({ status: 'empty' });
        return;
      }
      const matches = matchCrowdFavorites(r.crowd_favorites, items);
      setCrowdFavorites(
        Object.fromEntries(
          matches.filter((m) => m.itemId !== null).map((m) => [m.itemId as string, m.favorite.name])
        )
      );
      setReviewPhase({
        status: 'loaded',
        entries: matches.map((m) => ({
          name: m.favorite.name,
          blurb: m.favorite.blurb,
          onMenu: m.itemId !== null,
        })),
      });
    },
    [items, setCrowdFavorites]
  );

  // Cached reviews are free — light the tile up without spending anything.
  // No cache → offer the fetch; the baseline scan stays exactly as cheap.
  useEffect(() => {
    if (!restaurantName) {
      setReviewPhase({ status: 'hidden' });
      return;
    }
    let active = true;
    (async () => {
      const cached = await getCachedReviews(restaurantName);
      if (!active) return;
      if (cached) applyReviews(cached);
      else setReviewPhase({ status: 'offer' });
    })();
    return () => {
      active = false;
    };
  }, [restaurantName, applyReviews]);

  const fetchReviews = () => {
    setReviewPhase({ status: 'loading' });
    resetProgress();
    (async () => {
      try {
        applyReviews(await callReviews(restaurantName, '', onProgress));
      } catch {
        setReviewPhase({ status: 'error' });
      }
    })();
  };

  // Guard: no scan in progress → home.
  useEffect(() => {
    if (!menuContext || items.length === 0) router.replace('/');
  }, [menuContext, items.length, router]);

  if (!menuContext || items.length === 0) return <Loading message="Reading the room…" />;

  // Map the local lifecycle onto the shared component's tile state. While
  // loading, surface the REAL latest pipeline status line — never a fake timer.
  const lastStep = steps.length > 0 ? steps[steps.length - 1] : null;
  const crowdState: CrowdFavoritesState =
    reviewPhase.status === 'offer'
      ? { kind: 'offer', onFetch: fetchReviews }
      : reviewPhase.status === 'loading'
        ? {
            kind: 'loading',
            statusLine: lastStep
              ? `${lastStep.label}${lastStep.detail ? ` — ${lastStep.detail}` : ''}`
              : null,
          }
        : reviewPhase.status === 'loaded'
          ? { kind: 'loaded', favorites: reviewPhase.entries }
          : reviewPhase.status === 'empty'
            ? { kind: 'empty' }
            : reviewPhase.status === 'error'
              ? { kind: 'empty', message: 'Review lookup failed — couldn’t reach the web.' }
              : { kind: 'hidden' };

  const o = menuContext.orientation;
  const nameById = new Map(items.map((i) => [i.id, i.name]));
  const signatures = o.signature_item_ids.map((id) => nameById.get(id)).filter(Boolean) as string[];
  const cuisine =
    menuContext.cuisine_type && menuContext.cuisine_type !== 'unknown' ? menuContext.cuisine_type : null;

  const allTiles: TileDef[] = [
    { id: 'known', emoji: '🏆', title: 'Known for', items: o.known_for, variant: 'chips' },
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
      {/* Abandon this scan and go home — the session is per-scan, so reset. */}
      <View style={styles.topBar}>
        <NavLink
          label="✕ Start over"
          onPress={() => {
            session.reset();
            router.replace('/');
          }}
        />
      </View>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Title style={styles.title}>Here&apos;s the place</Title>
        </View>

        <RestaurantSummary
          mode="scan"
          cuisine={cuisine}
          summary={o.summary}
          crowdFavorites={crowdState}
          menuHighlights={signatures}
        />

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
  topBar: { paddingHorizontal: Plait.space.lg, paddingTop: Plait.space.sm },
  scroll: { paddingHorizontal: Plait.space.lg, paddingTop: Plait.space.md, paddingBottom: Plait.space.lg, gap: Plait.space.lg },
  header: { gap: Plait.space.sm },
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
