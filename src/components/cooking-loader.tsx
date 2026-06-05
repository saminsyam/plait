/**
 * Food-themed processing screen: four cooking steps that light up one by one,
 * with a rotating flavour-text line underneath. Replaces the plain spinner
 * during the Vision and Reasoning API calls.
 *
 * Navigation is gated: the parent passes `done` (true once the API call
 * resolved) and `onReady` (where to go next). We only call `onReady` once the
 * final step's timer has fired AND the work is done — so the flow never skips
 * ahead and feels broken when the API happens to be fast.
 */
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Title } from '@/components/ui-kit';
import { Plait } from '@/constants/plait-theme';

const STEPS = [
  { icon: '🍽️', label: 'Plating the menu…' },
  { icon: '🔪', label: 'Chopping through the ingredients…' },
  { icon: '🧂', label: 'Seasoning for your taste…' },
  { icon: '✨', label: 'Serving your top picks…' },
];

// When each step becomes the active one (ms from mount).
const ACTIVATE_AT = [0, 1800, 3200, 4500];
const LAST = STEPS.length - 1;

const SUBTEXTS = [
  'Sniffing out hidden allergens…',
  'Tasting the macros…',
  'Checking your halal radar…',
  'Pairing with your goals…',
  'Almost ready to serve…',
  'Final taste test…',
];

export function CookingLoader({
  done,
  onReady,
  title = 'Cooking up your picks',
}: {
  done: boolean;
  onReady: () => void;
  title?: string;
}) {
  const [active, setActive] = useState(0);
  const [lastFired, setLastFired] = useState(false);
  const [subIndex, setSubIndex] = useState(0);
  const readyCalled = useRef(false);

  const pulse = useRef(new Animated.Value(0)).current;
  const subOpacity = useRef(new Animated.Value(1)).current;

  // Step activation timers.
  useEffect(() => {
    const timers = ACTIVATE_AT.map((t, i) =>
      setTimeout(() => {
        setActive(i);
        if (i === LAST) setLastFired(true);
      }, t)
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  // Subtle pulse on the active step's icon.
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 650,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 650,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  // Rotate the flavour-text line every 2s with a fade.
  useEffect(() => {
    const id = setInterval(() => {
      Animated.timing(subOpacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => {
        setSubIndex((s) => (s + 1) % SUBTEXTS.length);
        Animated.timing(subOpacity, { toValue: 1, duration: 300, useNativeDriver: true }).start();
      });
    }, 2000);
    return () => clearInterval(id);
  }, [subOpacity]);

  // Only navigate once the last step has shown AND the work finished.
  useEffect(() => {
    if (lastFired && done && !readyCalled.current) {
      readyCalled.current = true;
      onReady();
    }
  }, [lastFired, done, onReady]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.wrap}>
        <Title style={styles.title}>{title}</Title>

        <View style={styles.steps}>
          {STEPS.map((step, i) => {
            const isActive = i === active;
            const isDone = i < active;
            const lit = isActive || isDone;
            return (
              <View key={step.label} style={[styles.step, lit && styles.stepLit]}>
                {isDone ? (
                  <Text style={styles.icon}>✅</Text>
                ) : (
                  <Animated.Text style={[styles.icon, isActive && { transform: [{ scale }] }]}>
                    {step.icon}
                  </Animated.Text>
                )}
                <Text style={[styles.label, lit ? styles.labelOn : styles.labelOff]}>
                  {step.label}
                </Text>
              </View>
            );
          })}
        </View>

        <Animated.Text style={[styles.sub, { opacity: subOpacity }]}>
          {SUBTEXTS[subIndex]}
        </Animated.Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Plait.color.background },
  wrap: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Plait.space.lg,
    gap: Plait.space.lg,
  },
  title: { fontSize: 30, marginBottom: Plait.space.sm },
  steps: { gap: Plait.space.xs },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Plait.space.md,
    paddingVertical: 14,
    paddingLeft: Plait.space.md,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
  },
  stepLit: { borderLeftColor: Plait.color.coral },
  icon: { fontSize: 26, width: 34, textAlign: 'center' },
  label: { fontSize: 18, fontFamily: Plait.font.sans, fontWeight: '600', flexShrink: 1 },
  labelOn: { color: Plait.color.text },
  labelOff: { color: Plait.color.textDim },
  sub: {
    color: Plait.color.textDim,
    fontSize: 15,
    fontStyle: 'italic',
    fontFamily: Plait.font.sans,
    paddingLeft: Plait.space.md,
    marginTop: Plait.space.sm,
  },
});
