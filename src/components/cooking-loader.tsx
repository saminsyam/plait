/**
 * Food-themed processing screen. The hero is a tappable ingredient toy (a
 * pleasant distraction during the wait); the cooking-step progress lives in a
 * compact footer so loading is always glanceable underneath.
 *
 * Navigation is gated: the parent passes `done` (true once the API call
 * resolved) and `onReady` (where to go next). We only call `onReady` once the
 * final step's timer has fired AND the work is done — so the flow never skips
 * ahead and feels broken when the API happens to be fast. The toy never gates
 * anything; it's thrown away the instant we navigate.
 */
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IngredientToy } from '@/components/ingredient-toy';
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

  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

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

  // Subtle pulse on the active step's icon (skipped under reduced motion).
  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 650, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 650, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);

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
      <Title style={styles.title}>{title}</Title>

      {/* Hero: the tappable ingredient toy fills the open middle. */}
      <IngredientToy reduceMotion={reduceMotion} />

      {/* Compact progress footer. */}
      <View style={styles.footer}>
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
                  <Animated.Text style={[styles.icon, isActive && !reduceMotion && { transform: [{ scale }] }]}>
                    {step.icon}
                  </Animated.Text>
                )}
                <Text style={[styles.label, lit ? styles.labelOn : styles.labelOff]} numberOfLines={1}>
                  {step.label}
                </Text>
              </View>
            );
          })}
        </View>

        <Animated.Text style={[styles.sub, { opacity: subOpacity }]}>{SUBTEXTS[subIndex]}</Animated.Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Plait.color.background },
  title: {
    fontSize: 30,
    paddingHorizontal: Plait.space.lg,
    paddingTop: Plait.space.lg,
  },
  footer: {
    paddingHorizontal: Plait.space.lg,
    paddingBottom: Plait.space.md,
    gap: Plait.space.xs,
  },
  steps: { gap: 2 },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Plait.space.sm,
    paddingVertical: 7,
    paddingLeft: Plait.space.sm,
    borderLeftWidth: 2,
    borderLeftColor: 'transparent',
  },
  stepLit: { borderLeftColor: Plait.color.coral },
  icon: { fontSize: 17, width: 24, textAlign: 'center' },
  label: { fontSize: 14, fontFamily: Plait.font.sans, fontWeight: '600', flexShrink: 1 },
  labelOn: { color: Plait.color.text },
  labelOff: { color: Plait.color.textDim },
  sub: {
    color: Plait.color.textDim,
    fontSize: 13,
    fontStyle: 'italic',
    fontFamily: Plait.font.sans,
    paddingLeft: Plait.space.sm,
    marginTop: 4,
  },
});
