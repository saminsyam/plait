/**
 * Camera IS home (v2 spec §3): open app → frame the menu → photo → picks.
 * Everything else — just the dietary profile in Sushi 2.1 — lives behind
 * the one corner element (☰) so the golden path stays ≤ 2 taps.
 */
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NarrativeLoader } from '@/components/narrative-loader';
import { Body, Loading, PrimaryButton, Subtitle, Title } from '@/components/ui-kit';
import { Plait } from '@/constants/plait-theme';
import { useProgressSteps } from '@/hooks/use-progress-steps';
import { callVision } from '@/engine/callVision';
import { getCachedReviews } from '@/engine/callReviews';
import { applyHardGate } from '@/engine/dietaryFilter';
import { prepareMenuImage } from '@/engine/image';
import { gateCrowdFavorites, matchCrowdFavorites } from '@/engine/matchReviews';
import { filterBySpice } from '@/engine/questionEngine';
import { rankFromPool } from '@/engine/rankFromPool';
import type { MenuItem, VisionMenuContext } from '@/engine/types';
import { ageLabel, loadMenuCache, saveMenuCache, type RecentMenu } from '@/lib/menuCache';
import { beginScanTrace, logRankTrace } from '@/lib/scanCorpus';
import { useProfile } from '@/state/profile';
import { useSession } from '@/state/session';

type Shot = { uri: string };

/** Back to the dashboard. `dark` renders it as an on-camera pill. */
function BackButton({ dark }: { dark?: boolean }) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.back()}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel="Back"
      style={[back.button, dark && back.buttonDark]}>
      <Text style={[back.icon, dark && back.iconDark]}>‹</Text>
    </Pressable>
  );
}

/** Turn an error from the Vision pipeline into a friendly, actionable message. */
function messageForError(e: unknown): string {
  const code = e instanceof Error ? e.message : '';
  switch (code) {
    case 'TRUNCATED':
      return 'This menu is too large to read at once. Try photographing one section at a time (e.g. just the mains).';
    case 'PARSE_FAILED':
      return 'Couldn’t read the menu — please retake the photo with better lighting.';
    default:
      return e instanceof Error ? e.message : 'Something went wrong reading the menu.';
  }
}

export default function CameraScreen() {
  const router = useRouter();
  const session = useSession();
  const { hardConstraints, preferences, spiceCeiling } = useProfile();
  // Deep-link params from the dashboard: ?recent=<key>&name=&at= reopens a
  // cached menu (zero vision tokens); ?upload=1 jumps straight to the library.
  const params = useLocalSearchParams<{ recent?: string; name?: string; at?: string; upload?: string }>();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [shot, setShot] = useState<Shot | null>(null);
  // Start in the loader when arriving via a recent-place deep link, so the
  // camera view never flashes before the cache load.
  const [busy, setBusy] = useState(!!params.recent);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { steps, onProgress, resetProgress } = useProgressSteps();
  const [loaderTitle, setLoaderTitle] = useState('Reading your menu');

  // Run a dashboard deep link exactly once on mount.
  const autoRan = useRef(false);
  useEffect(() => {
    if (autoRan.current) return;
    if (params.recent) {
      autoRan.current = true;
      openRecent({
        restaurantKey: params.recent,
        restaurant: params.name ?? 'your spot',
        cuisine: '',
        scannedAt: params.at ?? new Date().toISOString(),
      });
    } else if (params.upload) {
      autoRan.current = true;
      void pickFromLibrary();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pick an existing photo from the library — works even if camera is denied.
  const pickFromLibrary = async () => {
    setError(null);
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
      });
      if (!res.canceled && res.assets[0]?.uri) setShot({ uri: res.assets[0].uri });
    } catch {
      setError('Could not open your photo library. Try again.');
    }
  };

  // --- Live-status loader while Vision reads the menu
  if (busy) {
    return (
      <NarrativeLoader
        done={done}
        steps={steps}
        // Straight to the picks screen — it kicks off the instant ranking
        // itself; no question funnel in between.
        onReady={() => router.replace('/picks')}
        title={loaderTitle}
      />
    );
  }

  // --- Permission gate (still offer upload from library)
  if (!permission) {
    return <Loading message="Starting camera…" />;
  }
  if (!permission.granted && !shot) {
    return (
      <SafeAreaView style={styles.gate}>
        <View style={styles.gateTop}>
          <BackButton />
        </View>
        <View style={styles.gateBody}>
          <Title style={{ fontSize: 32 }}>Camera access</Title>
          <Subtitle style={{ textAlign: 'center' }}>
            plAIt needs your camera to read the menu in front of you — or upload a photo instead.
          </Subtitle>
          <PrimaryButton label="Allow camera" onPress={requestPermission} />
          <PrimaryButton label="🖼  Upload a photo" variant="soft" onPress={pickFromLibrary} />
          {error && <Body style={styles.error}>{error}</Body>}
        </View>
      </SafeAreaView>
    );
  }

  const capture = async () => {
    try {
      const photo = await cameraRef.current?.takePictureAsync({ quality: 0.8 });
      if (photo?.uri) setShot({ uri: photo.uri });
    } catch {
      setError('Could not take the photo. Try again.');
    }
  };

  // Everything after we have a parsed menu — shared by the live vision path
  // and the menu-cache "recent places" path. The hard gate ALWAYS re-runs here
  // against the current profile, so a cached menu is exactly as safe as a
  // fresh scan even after the user edits their constraints.
  async function finishScan(
    items: MenuItem[],
    menuContext: VisionMenuContext,
    imageUri: string,
    source: 'vision' | 'menu_cache'
  ) {
    // Run the deterministic safety gate ONCE: blocked dishes never enter the
    // candidate pool the narrowing engine works on.
    onProgress({ id: 'gate', icon: '🛡️', label: 'Applying your dietary guardrails', status: 'active' });
    const gate = applyHardGate(items, hardConstraints);
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
      imageUri,
      items,
      menuContext,
      candidates,
      verifyById,
      blocked: gate.blocked,
    });
    // Corpus: capture the read + gate split (fire-and-forget telemetry).
    beginScanTrace({
      items,
      menuContext,
      candidates,
      verifyById,
      blocked: gate.blocked,
      preferences: preferences ?? '',
      spiceCeiling,
      source,
    });

    // Run the instant Popular rank here, under the SAME loader, so the
    // picks screen lands fully formed (no second loading screen). We only
    // fold in CACHED reviews — an uncached review search still happens
    // lazily on the picks screen and folds in ★ badges a beat later ("the
    // swap"). A rank failure degrades to the picks retry path: swallow it
    // and navigate anyway (popularReady stays false there).
    if (candidates.length > 0) {
      try {
        const restaurantName = menuContext.restaurant_name.trim();
        let crowdMap: Record<string, string> = {};
        if (restaurantName) {
          const cached = await getCachedReviews(restaurantName);
          if (cached) {
            crowdMap = gateCrowdFavorites(
              matchCrowdFavorites(cached.crowd_favorites, items),
              gate.blocked
            ).rankable;
          }
        }
        const pool = filterBySpice(candidates, spiceCeiling);
        const picks = await rankFromPool({
          pool,
          questions: [],
          answers: {},
          preferences: preferences ?? '',
          verifyById,
          restaurantNotes: menuContext.restaurant_notes,
          crowdMap,
          onProgress,
        });
        session.setPopular({ spice: spiceCeiling, picks });
        logRankTrace({
          mode: 'popular',
          restaurant: menuContext.restaurant_name,
          cuisine: menuContext.cuisine_type,
          pool,
          questions: [],
          answers: {},
          crowdMap,
          picks,
        });
      } catch {
        // Ranking failed — the picks screen will retry with its own status.
      }
    }
    setDone(true);
  }

  const confirm = () => {
    if (!shot) return;
    setLoaderTitle('Reading your menu');
    setBusy(true);
    setDone(false);
    setError(null);
    resetProgress();
    // Run the work alongside the loader, which shows each real stage as it
    // happens and navigates as soon as the work is actually finished.
    (async () => {
      try {
        onProgress({ id: 'prep', icon: '📐', label: 'Prepping the photo', status: 'active' });
        const prepared = await prepareMenuImage(shot.uri);
        onProgress({
          id: 'prep',
          icon: '📐',
          label: 'Photo prepped',
          detail: 'resized for a fast read',
          status: 'done',
        });
        const { items, menu_context } = await callVision(prepared.base64, 'image/jpeg', onProgress);
        // Refresh this restaurant's menu cache (fire-and-forget) so the next
        // visit can skip the vision read entirely.
        saveMenuCache({ items, menuContext: menu_context });
        await finishScan(items, menu_context, prepared.uri, 'vision');
      } catch (e) {
        setBusy(false);
        setError(messageForError(e));
      }
    })();
  };

  // A recent-place chip: load the cached read and re-enter the exact same
  // pipeline — zero vision tokens. Any failure drops back to a fresh scan.
  // (Function declaration: hoisted, so the permission-gate return above the
  // handler block can render the chips too.)
  function openRecent(recent: RecentMenu) {
    setLoaderTitle(`Back at ${recent.restaurant}`);
    setBusy(true);
    setDone(false);
    setError(null);
    resetProgress();
    (async () => {
      try {
        onProgress({
          id: 'cache',
          icon: '📂',
          label: `Loading ${recent.restaurant}`,
          detail: `saved ${ageLabel(recent.scannedAt)}`,
          status: 'active',
        });
        const cached = await loadMenuCache(recent.restaurantKey);
        if (!cached) throw new Error('CACHE_MISS');
        onProgress({
          id: 'cache',
          icon: '📂',
          label: 'Menu loaded',
          detail: `${cached.items.length} dishes, no re-scan needed`,
          status: 'done',
        });
        await finishScan(cached.items, cached.menu_context, '', 'menu_cache');
      } catch {
        setBusy(false);
        setError('Couldn’t load that saved menu — give it a fresh scan.');
      }
    })();
  }

  // --- Preview / retake
  if (shot) {
    return (
      <SafeAreaView style={styles.safe}>
        <Image source={{ uri: shot.uri }} style={styles.preview} contentFit="cover" />
        {error && <Body style={styles.error}>{error}</Body>}
        <View style={styles.controls}>
          <PrimaryButton label="Use this photo" onPress={confirm} />
          <PrimaryButton
            label="Retake"
            variant="ghost"
            onPress={() => {
              setShot(null);
              setError(null);
            }}
          />
        </View>
      </SafeAreaView>
    );
  }

  // --- Live camera
  return (
    <View style={styles.full}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
      <SafeAreaView style={styles.overlay}>
        <View style={styles.overlayTop}>
          <BackButton dark />
        </View>
        <View style={styles.spacer} />
        <Body style={styles.hint}>Frame the whole menu, then tap to capture</Body>
        {error && <Body style={styles.error}>{error}</Body>}
        <View style={styles.shutterRow}>
          <Pressable onPress={capture} style={styles.shutterOuter}>
            <View style={styles.shutterInner} />
          </Pressable>
        </View>
        <Pressable onPress={pickFromLibrary} hitSlop={12} style={styles.uploadLink}>
          <Text style={styles.uploadText}>🖼  Upload from library</Text>
        </Pressable>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  full: { flex: 1, backgroundColor: '#000' },
  safe: {
    flex: 1,
    backgroundColor: Plait.color.paper,
    padding: Plait.space.lg,
  },
  gate: {
    flex: 1,
    backgroundColor: Plait.color.paper,
    padding: Plait.space.lg,
  },
  gateTop: { flexDirection: 'row', justifyContent: 'flex-start' },
  gateBody: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Plait.space.md,
  },
  overlay: {
    flex: 1,
    alignItems: 'center',
    paddingBottom: Plait.space.xl,
    gap: Plait.space.md,
  },
  overlayTop: {
    alignSelf: 'flex-start',
    paddingTop: Plait.space.sm,
    paddingLeft: Plait.space.lg,
  },
  spacer: { flex: 1 },
  hint: {
    color: '#fff',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: Plait.radius.pill,
    overflow: 'hidden',
  },
  shutterRow: { alignItems: 'center' },
  shutterOuter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 4,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: Plait.color.green,
  },
  uploadLink: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: Plait.radius.pill,
    overflow: 'hidden',
  },
  uploadText: { color: '#fff', fontSize: 15, fontWeight: '600', fontFamily: Plait.font.body },
  preview: {
    flex: 1,
    borderRadius: Plait.radius.lg,
    marginBottom: Plait.space.md,
  },
  controls: { gap: Plait.space.sm },
  error: {
    color: Plait.color.danger,
    textAlign: 'center',
    marginBottom: Plait.space.sm,
  },
});

const back = StyleSheet.create({
  button: {
    width: 40,
    height: 40,
    borderRadius: Plait.radius.pill,
    backgroundColor: Plait.color.card,
    borderWidth: 1,
    borderColor: Plait.color.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDark: { backgroundColor: 'rgba(0,0,0,0.5)', borderColor: 'transparent' },
  icon: { color: Plait.color.ink, fontSize: 24, lineHeight: 26, marginTop: -2 },
  iconDark: { color: '#FFFFFF' },
});
