/**
 * Dashboard — the opening screen (Sushi 2.1, June 2026 UX revision). Replaces
 * camera-as-home: the app now opens on a calm hub that frames the one action
 * (scan a menu) and surrounds it with context — recent places (free re-opens
 * from the menu cache, zero vision tokens) and the dietary profile. The camera
 * is now a pure capture screen pushed from here.
 *
 * Profile + the hidden stats door (5 taps on the version label) live here now,
 * so the camera screen carries only a back control.
 */
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Eyebrow } from '@/components/ui-kit';
import { Plait } from '@/constants/plait-theme';
import { APP_VERSION } from '@/constants/version';
import { ageLabel, listRecentMenus, type RecentMenu } from '@/lib/menuCache';
import { useProfile } from '@/state/profile';

const HEAT_LABEL: Record<number, string> = { 1: 'mild', 2: 'medium', 3: 'hot' };

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function DashboardScreen() {
  const router = useRouter();
  const { preferences, spiceCeiling } = useProfile();
  const go = (path: string) => router.push(path as Parameters<typeof router.push>[0]);

  // Recent places — cached menus that re-enter the flow with ZERO vision
  // tokens. Empty (section hidden) when Supabase is unconfigured or offline.
  const [recents, setRecents] = useState<RecentMenu[]>([]);
  useEffect(() => {
    listRecentMenus(4).then(setRecents).catch(() => {});
  }, []);

  // Hidden developer door: 5 taps on the version label opens token-usage stats.
  const versionTaps = useRef(0);
  const tapVersion = () => {
    versionTaps.current += 1;
    if (versionTaps.current >= 5) {
      versionTaps.current = 0;
      go('/stats');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {/* Wordmark + hidden stats door */}
        <View style={styles.head}>
          <Text style={styles.logo}>
            pl<Text style={{ color: Plait.color.green }}>AI</Text>t
          </Text>
          <Pressable onPress={tapVersion} hitSlop={8}>
            <Text style={styles.version}>{APP_VERSION}</Text>
          </Pressable>
        </View>

        <Text style={styles.greeting}>{greeting()}.</Text>
        <Text style={styles.prompt}>What are we eating?</Text>

        {/* The one action — scan a menu. */}
        <Pressable
          onPress={() => go('/camera')}
          accessibilityRole="button"
          accessibilityLabel="Scan a menu"
          style={({ pressed }) => [styles.scanCard, pressed && { opacity: 0.92 }]}>
          <Text style={styles.scanIcon}>📷</Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.scanTitle}>Scan a menu</Text>
            <Text style={styles.scanSub}>Point at the menu — I’ll pick your dishes</Text>
          </View>
          <Text style={styles.scanChevron}>→</Text>
        </Pressable>

        <Pressable onPress={() => go('/camera?upload=1')} hitSlop={8} style={styles.uploadRow}>
          <Text style={styles.uploadText}>🖼  Upload a photo instead</Text>
        </Pressable>

        {/* Recent places — free re-opens (no vision read). */}
        {recents.length > 0 && (
          <View style={styles.section}>
            <Eyebrow>recent places</Eyebrow>
            <View style={styles.recentList}>
              {recents.map((r) => (
                <Pressable
                  key={r.restaurantKey}
                  onPress={() =>
                    go(
                      `/camera?recent=${encodeURIComponent(r.restaurantKey)}` +
                        `&name=${encodeURIComponent(r.restaurant)}` +
                        `&at=${encodeURIComponent(r.scannedAt)}`
                    )
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Reopen the saved ${r.restaurant} menu`}
                  style={({ pressed }) => [styles.recentRow, pressed && { opacity: 0.8 }]}>
                  <Text style={styles.recentReuse}>⟳</Text>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.recentName} numberOfLines={1}>
                      {r.restaurant}
                    </Text>
                    <Text style={styles.recentMeta} numberOfLines={1}>
                      {r.cuisine ? `${r.cuisine} · ` : ''}saved {ageLabel(r.scannedAt)} · no re-scan
                    </Text>
                  </View>
                  <Text style={styles.recentChevron}>›</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {/* Dietary profile — the one persistent setting. */}
        <View style={styles.section}>
          <Eyebrow>your profile</Eyebrow>
          <Pressable
            onPress={() => go('/preferences?edit=1')}
            accessibilityRole="button"
            accessibilityLabel="Edit your dietary profile"
            style={({ pressed }) => [styles.profileCard, pressed && { opacity: 0.85 }]}>
            <Text style={styles.profileIcon}>✎</Text>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.profileText} numberOfLines={2}>
                {preferences?.trim() || 'Tell me what you avoid'}
              </Text>
              <Text style={styles.profileMeta}>heat ceiling · {HEAT_LABEL[spiceCeiling] ?? 'medium'}</Text>
            </View>
            <Text style={styles.recentChevron}>›</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Plait.color.paper },
  list: {
    paddingHorizontal: Plait.space.lg,
    paddingTop: Plait.space.sm,
    paddingBottom: Plait.space.xl,
    gap: Plait.space.sm,
  },

  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingTop: Plait.space.sm,
  },
  logo: { fontFamily: Plait.font.display, fontSize: 30, color: Plait.color.ink },
  version: { fontFamily: Plait.font.mono, fontSize: 11, color: Plait.color.inkFaint },

  greeting: { fontFamily: Plait.font.body, fontSize: 16, color: Plait.color.inkSoft, marginTop: Plait.space.md },
  prompt: { fontFamily: Plait.font.display, fontSize: 30, color: Plait.color.ink, marginBottom: Plait.space.sm },

  scanCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Plait.space.md,
    backgroundColor: Plait.color.green,
    borderRadius: Plait.radius.lg,
    paddingVertical: Plait.space.lg,
    paddingHorizontal: Plait.space.md,
    shadowColor: Plait.color.ink,
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  scanIcon: { fontSize: 30 },
  scanTitle: { fontFamily: Plait.font.display, fontSize: 22, color: '#FFFFFF' },
  scanSub: { fontFamily: Plait.font.body, fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 2 },
  scanChevron: { fontFamily: Plait.font.body, fontSize: 22, color: '#FFFFFF' },

  uploadRow: { alignSelf: 'center', paddingVertical: Plait.space.sm },
  uploadText: { fontFamily: Plait.font.bodySemiBold, fontSize: 14, color: Plait.color.green },

  section: { gap: Plait.space.sm, marginTop: Plait.space.md },
  recentList: { gap: 8 },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Plait.space.sm,
    backgroundColor: Plait.color.card,
    borderRadius: Plait.radius.md,
    borderWidth: 1,
    borderColor: Plait.color.line,
    paddingVertical: 13,
    paddingHorizontal: 15,
  },
  recentReuse: { fontSize: 17, color: Plait.color.green, width: 22, textAlign: 'center' },
  recentName: { fontFamily: Plait.font.bodySemiBold, fontSize: 15.5, color: Plait.color.ink },
  recentMeta: { fontFamily: Plait.font.body, fontSize: 12, color: Plait.color.inkSoft, marginTop: 1 },
  recentChevron: { fontFamily: Plait.font.body, fontSize: 18, color: Plait.color.inkFaint },

  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Plait.space.sm,
    backgroundColor: Plait.color.card,
    borderRadius: Plait.radius.md,
    borderWidth: 1,
    borderColor: Plait.color.line,
    paddingVertical: 14,
    paddingHorizontal: 15,
  },
  profileIcon: { fontSize: 17, width: 22, textAlign: 'center', color: Plait.color.ink },
  profileText: { fontFamily: Plait.font.body, fontSize: 14.5, color: Plait.color.ink, lineHeight: 20 },
  profileMeta: { fontFamily: Plait.font.mono, fontSize: 11, color: Plait.color.inkFaint, marginTop: 3 },
});
