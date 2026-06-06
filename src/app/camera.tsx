import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CookingLoader } from '@/components/cooking-loader';
import { Body, Loading, PrimaryButton, Subtitle, Title } from '@/components/ui-kit';
import { Plait } from '@/constants/plait-theme';
import { callVision } from '@/lib/callVision';
import { prepareMenuImage } from '@/lib/image';
import { buildQuestions } from '@/lib/questions';
import { useSession } from '@/state/session';

type Shot = { uri: string };

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
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [shot, setShot] = useState<Shot | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [nextRoute, setNextRoute] = useState<'/questions' | '/budget'>('/questions');
  const [error, setError] = useState<string | null>(null);

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

  // --- Cooking-steps loader while Vision reads the menu
  if (busy) {
    return <CookingLoader done={done} onReady={() => router.replace(nextRoute)} title="Reading your menu" />;
  }

  // --- Permission gate (still offer upload from library)
  if (!permission) {
    return <Loading message="Starting camera…" />;
  }
  if (!permission.granted && !shot) {
    return (
      <SafeAreaView style={styles.gate}>
        <Title style={{ fontSize: 32 }}>Camera access</Title>
        <Subtitle style={{ textAlign: 'center' }}>
          plAIt needs your camera to read the menu in front of you — or upload a photo instead.
        </Subtitle>
        <PrimaryButton label="Allow camera" onPress={requestPermission} />
        <PrimaryButton label="🖼  Upload a photo" variant="teal" onPress={pickFromLibrary} />
        <PrimaryButton label="Back" variant="ghost" onPress={() => router.back()} />
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
    // Run the work alongside the loader; the loader gates navigation so we
    // never jump to the next screen before its steps have played out.
    (async () => {
      try {
        const prepared = await prepareMenuImage(shot.uri);
        const { items, menu_context } = await callVision(prepared.base64);
        const questions = buildQuestions(menu_context);
        const hasPrices = items.some((i) => i.price > 0);
        session.setScan({
          imageUri: prepared.uri,
          items,
          questions,
          hasPrices,
          restaurantNotes: menu_context.restaurant_notes,
        });
        // If the menu showed prices, collect a budget before ranking.
        setNextRoute(hasPrices ? '/budget' : '/questions');
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
    backgroundColor: Plait.color.background,
    padding: Plait.space.lg,
  },
  gate: {
    flex: 1,
    backgroundColor: Plait.color.background,
    padding: Plait.space.lg,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Plait.space.md,
  },
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: Plait.space.xl,
    gap: Plait.space.md,
  },
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
    backgroundColor: Plait.color.coral,
  },
  uploadLink: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: Plait.radius.pill,
    overflow: 'hidden',
  },
  uploadText: { color: '#fff', fontSize: 15, fontWeight: '600', fontFamily: Plait.font.sans },
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
