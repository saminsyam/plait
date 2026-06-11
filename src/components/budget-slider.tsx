/**
 * Budget slider for the results screen — a drag (or tap) track whose range is
 * derived from THIS menu's actual prices (see lib/budget). The right end is
 * "No limit" (null ceiling = no filter).
 *
 * The retired 5-stop spice slider glitched because `locationX` is relative to
 * whatever child sits under the finger. This one does the math in WINDOW
 * coordinates instead: the track measures itself on layout, and the responder
 * uses `pageX − trackLeft`, which stays stable across children. Updates are
 * local while dragging; `onCommit` fires once on release so each gesture costs
 * at most one re-rank.
 */
import { useRef, useState } from 'react';
import { type LayoutChangeEvent, PanResponder, StyleSheet, Text, View } from 'react-native';

import { Plait } from '@/constants/plait-theme';
import type { BudgetBounds } from '@/lib/budget';

export function BudgetSlider({
  bounds,
  value,
  disabled,
  onCommit,
}: {
  bounds: BudgetBounds;
  /** Current ceiling, or null for "No limit" (track at the far right). */
  value: number | null;
  disabled?: boolean;
  /** Fired once per gesture, on release. null means "No limit". */
  onCommit: (ceiling: number | null) => void;
}) {
  const { min, max, step } = bounds;
  // Local position while dragging; falls back to the committed value at rest.
  const [dragValue, setDragValue] = useState<number | null>(null);
  const trackLeft = useRef(0);
  const trackWidth = useRef(1);
  // Refs mirror props so the (once-created) responder always sees fresh values.
  const latest = useRef({ min, max, step, disabled: !!disabled, onCommit });
  latest.current = { min, max, step, disabled: !!disabled, onCommit };
  const lastDrag = useRef<number>(max);

  const shown = dragValue ?? value ?? max;
  const atMax = shown >= max;
  const pct = Math.max(0, Math.min(1, (shown - min) / (max - min)));

  const valueAtPageX = (pageX: number): number => {
    const { min: lo, max: hi, step: st } = latest.current;
    const ratio = Math.max(0, Math.min(1, (pageX - trackLeft.current) / trackWidth.current));
    const raw = lo + ratio * (hi - lo);
    return Math.max(lo, Math.min(hi, Math.round(raw / st) * st));
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !latest.current.disabled,
      onMoveShouldSetPanResponder: () => !latest.current.disabled,
      // Claim the gesture from the parent ScrollView for horizontal drags.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt) => {
        const v = valueAtPageX(evt.nativeEvent.pageX);
        lastDrag.current = v;
        setDragValue(v);
      },
      onPanResponderMove: (evt) => {
        const v = valueAtPageX(evt.nativeEvent.pageX);
        if (v !== lastDrag.current) {
          lastDrag.current = v;
          setDragValue(v);
        }
      },
      onPanResponderRelease: () => {
        const v = lastDrag.current;
        setDragValue(null);
        latest.current.onCommit(v >= latest.current.max ? null : v);
      },
      onPanResponderTerminate: () => setDragValue(null),
    })
  ).current;

  const onTrackLayout = (e: LayoutChangeEvent) => {
    trackWidth.current = Math.max(1, e.nativeEvent.layout.width);
    // react-native-web's layout event has no native handle / measureInWindow.
    e.currentTarget?.measureInWindow?.((x) => {
      trackLeft.current = x;
    });
  };

  return (
    <View style={[styles.wrap, disabled && { opacity: 0.4 }]}>
      <View style={styles.labels}>
        <Text style={styles.caption}>💸 Budget</Text>
        <Text style={[styles.value, atMax && styles.valueDim]}>
          {atMax ? 'No limit' : `Under $${shown}`}
        </Text>
      </View>
      {/* The hit slop wrapper owns the gesture so the thin track is easy to grab. */}
      <View style={styles.hitArea} {...responder.panHandlers}>
        <View style={styles.track} onLayout={onTrackLayout}>
          <View style={[styles.fill, { width: `${Math.round(pct * 100)}%` }]} />
          <View style={[styles.thumb, { left: `${Math.round(pct * 100)}%` }]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: Plait.color.card,
    borderRadius: Plait.radius.md,
    borderWidth: 1,
    borderColor: Plait.color.border,
    paddingHorizontal: Plait.space.md,
    paddingTop: 12,
    paddingBottom: 6,
    gap: 2,
  },
  labels: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  caption: { color: Plait.color.inkSoft, fontSize: 13, fontFamily: Plait.font.bodySemiBold },
  value: { color: Plait.color.green, fontSize: 13, fontFamily: Plait.font.monoSemiBold },
  valueDim: { color: Plait.color.inkSoft },
  hitArea: { paddingVertical: 14, justifyContent: 'center' },
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: Plait.color.line,
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    height: 6,
    borderRadius: 3,
    backgroundColor: Plait.color.green,
  },
  thumb: {
    position: 'absolute',
    top: -7,
    marginLeft: -10,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Plait.color.green,
    borderWidth: 3,
    borderColor: Plait.color.card,
  },
});
