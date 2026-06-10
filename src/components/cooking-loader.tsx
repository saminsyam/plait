/**
 * Food-themed processing screen showing REAL pipeline status. The hero is a
 * tappable ingredient toy (a pleasant distraction during the wait); the footer
 * lists the actual stages the pipeline has reported — live details ("23 dishes
 * spotted"), per-step timers, checkmarks when each stage truly finishes.
 *
 * Navigation is gated only by the real work: once `done` is true we linger
 * just long enough to show the final checkmarks (never less than a short
 * minimum so a fast API doesn't flash the screen), then call `onReady`.
 * The toy never gates anything; it's thrown away the instant we navigate.
 */
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IngredientToy } from '@/components/ingredient-toy';
import { Title } from '@/components/ui-kit';
import { Plait } from '@/constants/plait-theme';
import type { ProgressStep } from '@/hooks/use-progress-steps';

/** Never show the screen for less than this — a fast API shouldn't flash. */
const MIN_SHOW_MS = 1200;
/** After the work finishes, linger so the final checkmark registers. */
const DONE_LINGER_MS = 450;

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

export function CookingLoader({
  done,
  onReady,
  title = 'Cooking up your picks',
  steps,
}: {
  done: boolean;
  onReady: () => void;
  title?: string;
  /** Real pipeline steps (from useProgressSteps). */
  steps: ProgressStep[];
}) {
  const mountedAt = useRef(Date.now());
  const readyCalled = useRef(false);

  const pulse = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  // Re-render a few times a second so the live per-step timers tick.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 150);
    return () => clearInterval(id);
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

  // Announce stage changes to screen readers (labels only, not the live counts).
  const activeLabel = steps.find((s) => s.status === 'active')?.label;
  useEffect(() => {
    if (activeLabel) AccessibilityInfo.announceForAccessibility(activeLabel);
  }, [activeLabel]);

  // Navigate once the real work is done — no scripted timeline to wait out.
  useEffect(() => {
    if (!done || readyCalled.current) return;
    const elapsed = Date.now() - mountedAt.current;
    const wait = Math.max(MIN_SHOW_MS - elapsed, DONE_LINGER_MS);
    const t = setTimeout(() => {
      readyCalled.current = true;
      onReady();
    }, wait);
    return () => clearTimeout(t);
  }, [done, onReady]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });
  const now = Date.now();
  const totalSec = ((now - mountedAt.current) / 1000).toFixed(1);

  return (
    <SafeAreaView style={styles.safe}>
      <Title style={styles.title}>{title}</Title>

      {/* Hero: the tappable ingredient toy fills the open middle. */}
      <IngredientToy reduceMotion={reduceMotion} />

      {/* Live status footer — one row per real pipeline stage. */}
      <View style={styles.footer}>
        <View style={styles.steps}>
          {steps.length === 0 && (
            <View style={[styles.step, styles.stepLit]}>
              <Animated.Text style={[styles.icon, !reduceMotion && { transform: [{ scale }] }]}>🔥</Animated.Text>
              <Text style={[styles.label, styles.labelOn]}>Warming up…</Text>
            </View>
          )}
          {steps.map((step) => {
            const isDone = step.status === 'done';
            const seconds = (((step.endedAt ?? now) - step.startedAt) / 1000).toFixed(1);
            return (
              <View key={step.id} style={[styles.step, styles.stepLit]}>
                {isDone ? (
                  <Text style={styles.icon}>✅</Text>
                ) : (
                  <Animated.Text style={[styles.icon, !reduceMotion && { transform: [{ scale }] }]}>
                    {step.icon}
                  </Animated.Text>
                )}
                <View style={styles.stepText}>
                  <Text style={[styles.label, isDone ? styles.labelDim : styles.labelOn]} numberOfLines={1}>
                    {step.label}
                  </Text>
                  {!!step.detail && (
                    <Text style={[styles.detail, !isDone && styles.detailOn]} numberOfLines={1}>
                      {step.detail}
                    </Text>
                  )}
                </View>
                <Text style={styles.time}>{seconds}s</Text>
              </View>
            );
          })}
        </View>

        <Text style={styles.sub}>⏱ {totalSec}s · live from the kitchen</Text>
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
  stepText: { flex: 1, gap: 1 },
  label: { fontSize: 14, fontFamily: Plait.font.sans, fontWeight: '600' },
  labelOn: { color: Plait.color.text },
  labelDim: { color: Plait.color.textDim },
  detail: { fontSize: 12, fontFamily: Plait.font.sans, color: Plait.color.textDim },
  detailOn: { color: Plait.color.teal },
  time: {
    fontSize: 12,
    fontFamily: MONO,
    color: Plait.color.textDim,
    minWidth: 44,
    textAlign: 'right',
  },
  sub: {
    color: Plait.color.textDim,
    fontSize: 13,
    fontStyle: 'italic',
    fontFamily: Plait.font.sans,
    paddingLeft: Plait.space.sm,
    marginTop: 4,
  },
});
