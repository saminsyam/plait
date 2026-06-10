/**
 * The one constant question — a 3-way spice selector (Mild / Medium / Hot).
 *
 * This used to be a 5-level drag slider built on the raw responder system, but
 * `locationX` is relative to the child under the finger, so dragging across
 * segment boundaries made the thumb jump (and five stops was more precision
 * than the choice deserved anyway). Three big tap targets are glitch-proof:
 * no gesture math, instant feedback, and each option is meaningfully distinct.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Plait } from '@/constants/plait-theme';
import { SPICE_LEVELS, type SpiceLevel } from '@/lib/questionEngine';

export function SpiceSlider({
  value,
  onChange,
}: {
  value: SpiceLevel;
  onChange: (level: SpiceLevel) => void;
}) {
  const selected = SPICE_LEVELS.find((s) => s.level === value) ?? SPICE_LEVELS[1];

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {SPICE_LEVELS.map((s) => {
          const active = s.level === value;
          return (
            <Pressable
              key={s.level}
              onPress={() => onChange(s.level)}
              style={({ pressed }) => [
                styles.option,
                active && styles.optionActive,
                pressed && !active && { transform: [{ scale: 0.96 }] },
              ]}>
              <Text style={styles.emoji}>{s.emoji}</Text>
              <Text style={[styles.label, active && styles.labelActive]}>{s.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.hint}>{selected.hint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Plait.space.sm },
  row: { flexDirection: 'row', gap: Plait.space.sm },
  option: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    paddingVertical: 16,
    borderRadius: Plait.radius.md,
    borderWidth: 1,
    borderColor: Plait.color.border,
    backgroundColor: Plait.color.cardElevated,
  },
  optionActive: {
    backgroundColor: Plait.color.coral,
    borderColor: Plait.color.coral,
  },
  emoji: { fontSize: 26 },
  label: {
    color: Plait.color.text,
    fontSize: 16,
    fontWeight: '700',
    fontFamily: Plait.font.sans,
  },
  labelActive: { color: '#111111' },
  hint: {
    color: Plait.color.textDim,
    fontSize: 14,
    fontFamily: Plait.font.sans,
    textAlign: 'center',
  },
});
