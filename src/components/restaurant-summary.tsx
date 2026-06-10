/**
 * Shared restaurant summary, rendered by BOTH faces of the app:
 *
 *   - scan mode        — the orientation screen, after a menu photo is read.
 *   - standalone mode  — the "before you go" lookup page, built from one web
 *                        review search (no menu fetch at all).
 *
 * Honest-labeling rule: every tile carries a provenance label — review-sourced
 * content says "from web reviews", menu-inferred content says "from the menu".
 * The two are never mixed inside one tile, and the crowd-favorites tile only
 * ever shows real search results (its empty state says the search came up dry
 * rather than inventing reviews).
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Subtitle } from '@/components/ui-kit';
import { Plait } from '@/constants/plait-theme';

export type CrowdFavoriteEntry = {
  name: string;
  /** One-line reviewer-sourced blurb. */
  blurb: string;
  /** True when on-device matching tied this review dish to a scanned item. */
  onMenu?: boolean;
  /** Inline hard-constraint conflict (e.g. shellfish allergy), or null. */
  warning?: string | null;
};

/**
 * What the crowd-favorites tile shows is driven entirely by the caller:
 *   loaded  — review dishes are in hand (from cache or a fresh fetch).
 *   offer   — scan mode, nothing cached: a tap-to-fetch row with the cost.
 *   loading — fetch in flight; statusLine is the REAL latest pipeline status.
 *   empty   — the search ran dry (or failed; message says which) — honest,
 *             never papered over with invented reviews.
 *   hidden  — tile not applicable (no fetch wired up).
 */
export type CrowdFavoritesState =
  | { kind: 'loaded'; favorites: CrowdFavoriteEntry[] }
  | { kind: 'offer'; onFetch: () => void }
  | { kind: 'loading'; statusLine: string | null }
  | { kind: 'empty'; message?: string }
  | { kind: 'hidden' };

export function RestaurantSummary({
  mode,
  cuisine,
  summary,
  crowdFavorites,
  menuHighlights,
}: {
  mode: 'scan' | 'standalone';
  /** Cuisine kicker; hidden when null/unknown. */
  cuisine?: string | null;
  /** One-line summary of the place. */
  summary: string;
  crowdFavorites: CrowdFavoritesState;
  /** Names of menu-inferred signature dishes (rendered in scan mode only). */
  menuHighlights?: string[];
}) {
  const showHighlights = mode === 'scan' && (menuHighlights?.length ?? 0) > 0;

  return (
    <View style={styles.wrap}>
      {!!cuisine && cuisine !== 'unknown' && (
        <Text style={styles.kicker}>{cuisine.toUpperCase()}</Text>
      )}
      {!!summary && <Subtitle style={styles.summary}>{summary}</Subtitle>}

      {crowdFavorites.kind !== 'hidden' && (
        <Tile emoji="🌟" title="Crowd favorites" provenance="from web reviews">
          <CrowdFavoritesBody state={crowdFavorites} />
        </Tile>
      )}

      {showHighlights && (
        <Tile emoji="⭐" title="Menu highlights" provenance="from the menu">
          {menuHighlights!.map((name, i) => (
            <Text key={i} style={styles.bullet}>
              ⭐ {name}
            </Text>
          ))}
        </Tile>
      )}
    </View>
  );
}

function CrowdFavoritesBody({ state }: { state: CrowdFavoritesState }) {
  switch (state.kind) {
    case 'loaded':
      return (
        <View style={styles.favList}>
          {state.favorites.map((f, i) => (
            <View key={i} style={styles.fav}>
              <View style={styles.favHead}>
                <Text style={styles.favName}>⭐ {f.name}</Text>
                {f.onMenu && <Text style={styles.onMenu}>on this menu</Text>}
              </View>
              {!!f.blurb && <Text style={styles.favBlurb}>{f.blurb}</Text>}
              {!!f.warning && <Text style={styles.favWarning}>⚠️ {f.warning}</Text>}
            </View>
          ))}
        </View>
      );
    case 'offer':
      return (
        <Pressable
          onPress={state.onFetch}
          hitSlop={8}
          style={({ pressed }) => [styles.offer, pressed && { opacity: 0.7 }]}>
          <Text style={styles.offerText}>See what reviewers order →</Text>
          <Text style={styles.offerCost}>one web search · ~$0.02</Text>
        </Pressable>
      );
    case 'loading':
      return <Text style={styles.statusLine}>{state.statusLine ?? 'Searching reviews…'}</Text>;
    case 'empty':
      return (
        <Text style={styles.statusLine}>
          {state.message ?? 'Couldn’t find reviews for this place online — nothing to show.'}
        </Text>
      );
    default:
      return null;
  }
}

function Tile({
  emoji,
  title,
  provenance,
  children,
}: {
  emoji: string;
  title: string;
  /** Honest source label, e.g. "from web reviews" / "from the menu". */
  provenance: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.tile}>
      <View style={styles.tileHead}>
        <Text style={styles.tileEmoji}>{emoji}</Text>
        <Text style={styles.tileTitle}>{title}</Text>
        <View style={styles.spacer} />
        <Text style={styles.provenance}>{provenance}</Text>
      </View>
      <View style={styles.tileBody}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Plait.space.sm },
  kicker: {
    color: Plait.color.coral,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.5,
    fontFamily: Plait.font.sans,
  },
  summary: { fontSize: 17, lineHeight: 25, marginBottom: Plait.space.xs },

  tile: {
    backgroundColor: Plait.color.card,
    borderRadius: Plait.radius.md,
    borderWidth: 1,
    borderColor: Plait.color.border,
    paddingHorizontal: Plait.space.md,
    paddingVertical: 16,
  },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: Plait.space.sm },
  tileEmoji: { fontSize: 20 },
  tileTitle: {
    color: Plait.color.text,
    fontSize: 17,
    fontWeight: '700',
    fontFamily: Plait.font.serif,
  },
  spacer: { flex: 1 },
  provenance: {
    color: Plait.color.textDim,
    fontSize: 12,
    fontStyle: 'italic',
    fontFamily: Plait.font.sans,
  },
  tileBody: { marginTop: 12, gap: 10 },

  favList: { gap: 12 },
  fav: { gap: 3 },
  favHead: { flexDirection: 'row', alignItems: 'center', gap: Plait.space.sm },
  favName: {
    color: Plait.color.text,
    fontSize: 16,
    fontWeight: '700',
    fontFamily: Plait.font.sans,
  },
  onMenu: {
    color: Plait.color.teal,
    fontSize: 12,
    fontWeight: '700',
    fontFamily: Plait.font.sans,
    borderWidth: 1,
    borderColor: Plait.color.teal,
    borderRadius: Plait.radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  favBlurb: { color: Plait.color.textDim, fontSize: 14, lineHeight: 20, fontFamily: Plait.font.sans },
  favWarning: { color: Plait.color.warn, fontSize: 13, fontWeight: '600', fontFamily: Plait.font.sans },

  offer: { gap: 2 },
  offerText: { color: Plait.color.teal, fontSize: 15, fontWeight: '700', fontFamily: Plait.font.sans },
  offerCost: { color: Plait.color.textDim, fontSize: 12, fontFamily: Plait.font.sans },

  statusLine: { color: Plait.color.textDim, fontSize: 14, fontFamily: Plait.font.sans },
  bullet: { color: Plait.color.text, fontSize: 16, lineHeight: 24, fontFamily: Plait.font.sans },
});
