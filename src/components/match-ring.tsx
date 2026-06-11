/**
 * Match ring — the v2 picks screen's score glyph. A thin arc fills to the
 * match score with the number centered in mono. A null value (stretch picks
 * have no model score — we never fabricate one) renders a dashed full ring
 * with a ✦, echoing the dashed-plum = adventure rule.
 */
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { Plait } from '@/constants/plait-theme';

export function MatchRing({
  value,
  color = Plait.color.green,
  size = 44,
}: {
  value: number | null;
  color?: string;
  size?: number;
}) {
  const stroke = 3;
  const r = (size - stroke * 2) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke={value == null ? color : Plait.color.line}
          strokeWidth={stroke}
          strokeDasharray={value == null ? '3 5' : undefined}
          opacity={value == null ? 0.7 : 1}
        />
        {value != null && (
          <Circle
            cx={c}
            cy={c}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${circ} ${circ}`}
            strokeDashoffset={circ * (1 - pct / 100)}
            transform={`rotate(-90 ${c} ${c})`}
          />
        )}
      </Svg>
      <View style={StyleSheet.absoluteFill}>
        <View style={styles.center}>
          <Text style={[styles.value, { color, fontSize: size >= 44 ? 12 : 10.5 }]}>
            {value == null ? '✦' : Math.round(pct)}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  value: { fontFamily: Plait.font.monoSemiBold },
});
