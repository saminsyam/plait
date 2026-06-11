/**
 * Hold-to-lock — the v2 commitment action on the hero card. The button fills
 * left-to-right while pressed (~0.85s, spec default; tune in TestFlight) and
 * fires `onLock` with a success haptic when the fill completes. Releasing
 * early resets — locking is deliberate, not accidental.
 */
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text } from 'react-native';

import { Plait } from '@/constants/plait-theme';

const HOLD_MS = 850;

export function HoldToLock({ locked, onLock }: { locked: boolean; onLock: () => void }) {
  const progress = useRef(new Animated.Value(0)).current;
  const [holding, setHolding] = useState(false);

  useEffect(() => {
    if (!locked) progress.setValue(0);
  }, [locked, progress]);

  const start = () => {
    if (locked) return;
    setHolding(true);
    Animated.timing(progress, {
      toValue: 1,
      duration: HOLD_MS,
      easing: Easing.linear,
      useNativeDriver: false, // animates width
    }).start(({ finished }) => {
      setHolding(false);
      if (!finished) {
        progress.setValue(0);
        return;
      }
      if (Platform.OS !== 'web') {
        // Lazy-require so the web bundle never touches the native module.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Haptics = require('expo-haptics') as typeof import('expo-haptics');
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
      onLock();
    });
  };

  const cancel = () => {
    if (locked) return;
    progress.stopAnimation(() => progress.setValue(0));
    setHolding(false);
  };

  const fillWidth = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <Pressable
      onPressIn={start}
      onPressOut={cancel}
      disabled={locked}
      accessibilityRole="button"
      accessibilityLabel={locked ? 'Locked in' : 'Hold to lock it in'}
      style={[styles.button, locked && styles.buttonLocked]}>
      {!locked && <Animated.View style={[styles.fill, { width: fillWidth }]} />}
      <Text style={[styles.label, locked && styles.labelLocked]}>
        {locked ? '✓ Locked in — enjoy' : holding ? 'Keep holding…' : 'Hold to lock it in'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Plait.color.green,
    backgroundColor: Plait.color.card,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  buttonLocked: {
    backgroundColor: Plait.color.green,
    borderColor: Plait.color.green,
  },
  fill: {
    ...StyleSheet.absoluteFillObject,
    right: undefined,
    backgroundColor: Plait.color.greenSoft,
  },
  label: {
    fontFamily: Plait.font.bodyBold,
    fontSize: 14.5,
    color: Plait.color.green,
  },
  labelLocked: { color: '#FFFFFF' },
});
