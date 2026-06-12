/**
 * Camera IS home (v2 spec §3): open app → frame the menu → photo → picks.
 * Everything else — just the dietary profile in Sushi 2.1 — lives behind
 * the one corner element (☰) so the golden path stays ≤ 2 taps.
 */
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NarrativeLoader } from '@/components/narrative-loader';
import { Body, Loading, PrimaryButton, Subtitle, Title } from '@/components/ui-kit';
import { Plait } from '@/constants/plait-theme';
import { APP_VERSION } from '@/constants/version';
import { useProgressSteps } from '@/hooks/use-progress-steps';
import { callVision } from '@/engine/callVision';
import { getCachedReviews } from '@/engine/callReviews';
import { applyHardGate } from '@/engine/dietaryFilter';
import { prepareMenuImage } from '@/engine/image';
import { gateCrowdFavorites, matchCrowdFavorites } from '@/engine/matchReviews';
import { filterBySpice } from '@/engine/questionEngine';
import { rankFromPool } from '@/engine/rankFromPool';
import { beginScanTrace, logRankTrace } from '@/lib/scanCorpus';
import { useProfile } from '@/state/profile';
import { useSession } from '@/state/session';

type Shot = { uri: string };

/**
 * The corner element: one ☰ button, one top sheet with everything that is
 * NOT the golden path. `dark` renders the button as an on-camera pill.
 */
function CornerMenu({ dark }: { dark?: boolean }) {
  const router = useRouter();
  const { preferences } = useProfile();
  const [open, setOpen] = useState(false);
  // Hidden developer door: 5 taps on the version label opens token-usage stats.
  const versionTaps = useRef(0);
  const go = (path: string) => {
    setOpen(false);
    router.push(path as Parameters<typeof router.push>[0]);
  };
  const tapVersion = () => {
    versionTaps.current += 1;
    if (versionTaps.current >= 5) {
      versionTaps.current = 0;
      go('/stats');
    }
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Menu"
        style={[menu.button, dark && menu.buttonDark]}>
        <Text style={[menu.buttonIcon, dark && menu.buttonIconDark]}>☰</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={menu.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={menu.sheet} onPress={() => {}}>
            <View style={menu.head}>
              <Text style={menu.logo}>
                pl<Text style={{ color: Plait.color.green }}>AI</Text>t
              </Text>
              <Pressable onPress={tapVersion} hitSlop={8}>
                <Text style={menu.version}>{APP_VERSION}</Text>
              </Pressable>
            </View>
            <MenuRow
              icon="✎"
              label="Dietary profile"
              sub={preferences ?? 'tell me what you avoid'}
              onPress={() => go('/preferences?edit=1')}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function MenuRow({
  icon,
  label,
  sub,
  onPress,
}: {
  icon: string;
  label: string;
  sub: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [menu.row, pressed && { opacity: 0.7 }]}>
      <Text style={menu.rowIcon}>{icon}</Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={menu.rowLabel}>{label}</Text>
        <Text style={menu.rowSub} numberOfLines={1}>
          {sub}
        </Text>
      </View>
      <Text style={menu.rowChevron}>›</Text>
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
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [shot, setShot] = useState<Shot | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { steps, onProgress, resetProgress } = useProgressSteps();

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
        title="Reading your menu"
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
          <CornerMenu />
        </View>
        <View style={styles.gateBody}>
          <Title style={{ fontSize: 32 }}>Camera access</Title>
          <Subtitle style={{ textAlign: 'center' }}>
            plAIt needs your camera to read the menu in front of you — or upload a photo instead.
          </Subtitle>
          <PrimaryButton label="Allow camera" onPress={requestPermission} />
          <PrimaryButton label="🖼  Upload a photo" variant="soft" onPress={pickFromLibrary} />
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

  const confirm = () => {
    if (!shot) return;
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
          imageUri: prepared.uri,
          items,
          menuContext: menu_context,
          candidates,
          verifyById,
          blocked: gate.blocked,
        });
        // Corpus: capture the read + gate split (fire-and-forget telemetry).
        beginScanTrace({
          items,
          menuContext: menu_context,
          candidates,
          verifyById,
          blocked: gate.blocked,
          preferences: preferences ?? '',
          spiceCeiling,
        });

        // Run the instant Popular rank here, under the SAME loader, so the
        // picks screen lands fully formed (no second loading screen). We only
        // fold in CACHED reviews — an uncached review search still happens
        // lazily on the picks screen and folds in ★ badges a beat later ("the
        // swap"). A rank failure degrades to the picks retry path: swallow it
        // and navigate anyway (popularReady stays false there).
        if (candidates.length > 0) {
          try {
            const restaurantName = menu_context.restaurant_name.trim();
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
              restaurantNotes: menu_context.restaurant_notes,
              crowdMap,
              onProgress,
            });
            session.setPopular({ spice: spiceCeiling, picks });
            logRankTrace({
              mode: 'popular',
              restaurant: menu_context.restaurant_name,
              cuisine: menu_context.cuisine_type,
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
      } catch (e) {
        setBusy(false);
        setError(messageForError(e));
      }
    })();
  };

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
          <CornerMenu dark />
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
  gateTop: { flexDirection: 'row', justifyContent: 'flex-end' },
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
    alignSelf: 'flex-end',
    paddingTop: Plait.space.sm,
    paddingRight: Plait.space.lg,
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

const menu = StyleSheet.create({
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
  buttonIcon: { color: Plait.color.ink, fontSize: 16 },
  buttonIconDark: { color: '#FFFFFF' },

  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(27,30,27,0.35)',
    paddingTop: 64,
    paddingHorizontal: Plait.space.md,
  },
  sheet: {
    backgroundColor: Plait.color.paper,
    borderRadius: Plait.radius.lg,
    padding: Plait.space.md,
    gap: 4,
    shadowColor: Plait.color.ink,
    shadowOpacity: 0.15,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: Plait.color.line,
    marginBottom: 6,
  },
  logo: { fontFamily: Plait.font.display, fontSize: 24, color: Plait.color.ink },
  version: { fontFamily: Plait.font.mono, fontSize: 11, color: Plait.color.inkFaint },
  row: { flexDirection: 'row', alignItems: 'center', gap: Plait.space.sm, paddingVertical: 11 },
  rowIcon: { fontSize: 17, width: 26, textAlign: 'center' },
  rowLabel: { fontFamily: Plait.font.bodySemiBold, fontSize: 15, color: Plait.color.ink },
  rowSub: { fontFamily: Plait.font.body, fontSize: 12, color: Plait.color.inkSoft, marginTop: 1 },
  rowChevron: { fontFamily: Plait.font.body, fontSize: 18, color: Plait.color.inkFaint },
});
