/**
 * Budget slider — a deterministic, zero-token price ceiling for the picks
 * screen. Dragging it re-deals the already-ranked slate on-device (see
 * applyBudget in src/engine/tunes); it never triggers a model call.
 *
 * Position is computed from the absolute touch `pageX` minus the track's
 * measured window-left — NOT the child-relative `locationX` that made the old
 * spice drag-slider's thumb jump across segment boundaries. Latest props are
 * mirrored into a ref so the once-created PanResponder never reads stale
 * min/max/onChange after a view or keto switch changes the price range.
 */
import { useRef } from 'react';
import { PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { Plait } from '@/constants/plait-theme';

export function BudgetSlider({
  min,
  max,
  value,
  onChange,
  fitLabel,
}: {
  min: number;
  max: number;
  /** Current ceiling in dollars; at or above `max` means "any price" (off). */
  value: number;
  onChange: (dollars: number) => void;
  /** e.g. "5 of 8 picks fit" — rendered under the track. */
  fitLabel: string;
}) {
  const trackRef = useRef<View>(null);
  const geom = useRef({ left: 0, width: 1 });
  // Mirror latest props so the PanResponder closure never goes stale.
  const cfg = useRef({ min, max, onChange });
  cfg.current = { min, max, onChange };

  const measure = (_e: LayoutChangeEvent) => {
    trackRef.current?.measureInWindow((x, _y, w) => {
      geom.current = { left: x, width: w || 1 };
    });
  };

  const setFromPageX = (pageX: number) => {
    const { left, width } = geom.current;
    const { min: lo, max: hi, onChange: cb } = cfg.current;
    const frac = Math.max(0, Math.min(1, (pageX - left) / width));
    cb(Math.round(lo + frac * (hi - lo)));
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => setFromPageX(e.nativeEvent.pageX),
      onPanResponderMove: (e) => setFromPageX(e.nativeEvent.pageX),
    })
  ).current;

  const frac = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 1;
  const atMax = value >= max;

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.label}>💵 Budget</Text>
        <Text style={[styles.value, atMax && styles.valueOff]}>
          {atMax ? 'Any price' : `Under $${value}`}
        </Text>
      </View>
      <View
        ref={trackRef}
        onLayout={measure}
        style={styles.track}
        accessibilityRole="adjustable"
        accessibilityLabel={`Budget ceiling, ${atMax ? 'any price' : `under $${value}`}`}
        {...responder.panHandlers}>
        <View style={styles.trackBase} />
        <View style={[styles.fill, { width: `${frac * 100}%` }]} />
        <View style={[styles.thumb, { left: `${frac * 100}%` }]} />
      </View>
      <View style={styles.foot}>
        <Text style={styles.ends}>${min}</Text>
        <Text style={styles.fit}>{fitLabel}</Text>
        <Text style={styles.ends}>${max}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: Plait.color.card,
    borderRadius: Plait.radius.md,
    borderWidth: 1,
    borderColor: Plait.color.line,
    paddingVertical: Plait.space.sm,
    paddingHorizontal: Plait.space.md,
    gap: 8,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontFamily: Plait.font.bodySemiBold, fontSize: 13, color: Plait.color.ink },
  value: { fontFamily: Plait.font.monoSemiBold, fontSize: 13, color: Plait.color.green },
  valueOff: { color: Plait.color.inkFaint },
  // The track is tall + transparent-padded so the whole row is an easy target.
  track: { height: 28, justifyContent: 'center' },
  trackBase: {
    height: 6,
    borderRadius: 3,
    backgroundColor: Plait.color.line,
  },
  fill: {
    position: 'absolute',
    height: 6,
    borderRadius: 3,
    backgroundColor: Plait.color.green,
  },
  thumb: {
    position: 'absolute',
    width: 22,
    height: 22,
    marginLeft: -11,
    borderRadius: 11,
    backgroundColor: Plait.color.green,
    borderWidth: 3,
    borderColor: Plait.color.card,
    shadowColor: Plait.color.ink,
    shadowOpacity: 0.18,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ends: { fontFamily: Plait.font.mono, fontSize: 10.5, color: Plait.color.inkFaint },
  fit: { fontFamily: Plait.font.body, fontSize: 11.5, color: Plait.color.inkSoft },
});
