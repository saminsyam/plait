/**
 * Narrative loader (v2 spec §3): the wait is converted into trust by showing
 * the REAL pipeline stages as quiet progress lines — live details ("23 dishes
 * spotted"), per-step timers, checkmarks when each stage truly finishes.
 * Paper-quiet: no mascots, no ambient animation, never a fake timeline.
 *
 * Navigation is gated only by the real work: once `done` is true we linger
 * just long enough for the final checkmark to register (never less than a
 * short minimum so a fast API doesn't flash the screen), then call `onReady`.
 */
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Eyebrow } from '@/components/ui-kit';
import { Plait } from '@/constants/plait-theme';
import type { ProgressStep } from '@/hooks/use-progress-steps';

/** Never show the screen for less than this — a fast API shouldn't flash. */
const MIN_SHOW_MS = 1200;
/** After the work finishes, linger so the final checkmark registers. */
const DONE_LINGER_MS = 450;

export function NarrativeLoader({
  done,
  onReady,
  title = 'Reading your menu',
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

  // Re-render a few times a second so the live per-step timers tick.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, []);

  // Announce stage changes to screen readers (labels only, not live counts).
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

  const now = Date.now();
  const totalSec = ((now - mountedAt.current) / 1000).toFixed(1);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.body}>
        <Eyebrow>live from the kitchen · {totalSec}s</Eyebrow>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.steps}>
          {steps.length === 0 && (
            <View style={styles.step}>
              <Text style={styles.icon}>🔥</Text>
              <Text style={[styles.label, styles.labelOn]}>Warming up…</Text>
            </View>
          )}
          {steps.map((step) => {
            const isDone = step.status === 'done';
            const seconds = (((step.endedAt ?? now) - step.startedAt) / 1000).toFixed(1);
            return (
              <View key={step.id} style={styles.step}>
                <Text style={styles.icon}>{isDone ? '✓' : step.icon}</Text>
                <View style={styles.stepText}>
                  <Text
                    style={[styles.label, isDone ? styles.labelDim : styles.labelOn]}
                    numberOfLines={1}>
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
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Plait.color.paper },
  body: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Plait.space.lg,
    gap: Plait.space.sm,
  },
  title: {
    fontFamily: Plait.font.display,
    fontSize: 28,
    lineHeight: 34,
    color: Plait.color.ink,
    marginBottom: Plait.space.md,
  },
  steps: { gap: 2 },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Plait.space.sm,
    paddingVertical: 8,
    paddingLeft: Plait.space.sm,
    borderLeftWidth: 2,
    borderLeftColor: Plait.color.green,
  },
  icon: { fontSize: 15, width: 24, textAlign: 'center', color: Plait.color.green },
  stepText: { flex: 1, gap: 1 },
  label: { fontSize: 14, fontFamily: Plait.font.bodySemiBold },
  labelOn: { color: Plait.color.ink },
  labelDim: { color: Plait.color.inkSoft },
  detail: { fontSize: 12, fontFamily: Plait.font.body, color: Plait.color.inkSoft },
  detailOn: { color: Plait.color.green },
  time: {
    fontSize: 12,
    fontFamily: Plait.font.mono,
    color: Plait.color.inkFaint,
    minWidth: 44,
    textAlign: 'right',
  },
});
