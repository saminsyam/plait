/**
 * The one constant question — a 5-level spice slider. Dependency-free: it uses
 * the RN responder system (locationX over the track) and snaps to 1–5. The fill
 * acts as a heat meter so the control reads at a glance.
 */
import { useState } from 'react';
import { type GestureResponderEvent, Pressable, StyleSheet, Text, View } from 'react-native';

import { Plait } from '@/constants/plait-theme';
import { SPICE_LEVELS, type SpiceLevel } from '@/lib/questionEngine';

const LEVELS: SpiceLevel[] = [1, 2, 3, 4, 5];

export function SpiceSlider({
  value,
  onChange,
}: {
  value: SpiceLevel;
  onChange: (level: SpiceLevel) => void;
}) {
  const [width, setWidth] = useState(0);
  const meta = SPICE_LEVELS.find((s) => s.level === value) ?? SPICE_LEVELS[2];

  const setFromX = (e: GestureResponderEvent) => {
    if (width <= 0) return;
    const ratio = Math.min(1, Math.max(0, e.nativeEvent.locationX / width));
    const level = (Math.min(4, Math.max(0, Math.round(ratio * 4))) + 1) as SpiceLevel;
    if (level !== value) onChange(level);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.readout}>
        <Text style={styles.emoji}>{meta.emoji}</Text>
        <Text style={styles.label}>{meta.label}</Text>
      </View>

      <View
        style={styles.track}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={setFromX}
        onResponderMove={setFromX}>
        {LEVELS.map((l) => (
          <View
            key={l}
            style={[
              styles.segment,
              l === 1 && styles.first,
              l === 5 && styles.last,
              l <= value && styles.segmentFilled,
            ]}
          />
        ))}
      </View>

      {/* Tappable level ticks under the track for precise selection. */}
      <View style={styles.ticks}>
        {LEVELS.map((l) => (
          <Pressable key={l} hitSlop={8} onPress={() => onChange(l)} style={styles.tick}>
            <Text style={[styles.tickText, l === value && styles.tickTextActive]}>{l}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  readout: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center' },
  emoji: { fontSize: 22 },
  label: { color: Plait.color.text, fontSize: 18, fontWeight: '700', fontFamily: Plait.font.sans },
  track: { flexDirection: 'row', gap: 4, height: 16 },
  segment: { flex: 1, backgroundColor: Plait.color.cardElevated, borderRadius: 4 },
  segmentFilled: { backgroundColor: Plait.color.coral },
  first: { borderTopLeftRadius: 8, borderBottomLeftRadius: 8 },
  last: { borderTopRightRadius: 8, borderBottomRightRadius: 8 },
  ticks: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 2 },
  tick: { width: 28, alignItems: 'center' },
  tickText: { color: Plait.color.textDim, fontSize: 13, fontWeight: '700', fontFamily: Plait.font.sans },
  tickTextActive: { color: Plait.color.coral },
});
