import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Loading, PrimaryButton, Subtitle, Title } from '@/components/ui-kit';
import { Plait } from '@/constants/plait-theme';
import { analyzeMenu } from '@/lib/analyzeMenu';
import { buildQuestionSet } from '@/lib/buildQuestionSet';
import { callVision } from '@/lib/callVision';
import { useSession } from '@/state/session';

type Shot = { uri: string; base64: string };

export default function CameraScreen() {
  const router = useRouter();
  const session = useSession();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [shot, setShot] = useState<Shot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Permission gate
  if (!permission) {
    return <Loading message="Starting camera…" />;
  }
  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.gate}>
        <Title style={{ fontSize: 32 }}>Camera access</Title>
        <Subtitle style={{ textAlign: 'center' }}>
          plAIt needs your camera to read the menu in front of you.
        </Subtitle>
        <PrimaryButton label="Allow camera" onPress={requestPermission} />
        <PrimaryButton label="Back" variant="ghost" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }

  // --- Working overlay while Vision reads the menu
  if (busy) {
    return <Loading message="Reading the menu…" />;
  }

  const capture = async () => {
    try {
      const photo = await cameraRef.current?.takePictureAsync({ base64: true, quality: 0.6 });
      if (photo?.base64 && photo.uri) setShot({ uri: photo.uri, base64: photo.base64 });
    } catch {
      setError('Could not take the photo. Try again.');
    }
  };

  const confirm = async () => {
    if (!shot) return;
    setBusy(true);
    setError(null);
    try {
      const { items } = await callVision(shot.base64);
      const questions = buildQuestionSet(analyzeMenu(items));
      session.setScan({ imageUri: shot.uri, items, questions });
      router.replace('/questions');
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : 'Something went wrong reading the menu.');
    }
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
