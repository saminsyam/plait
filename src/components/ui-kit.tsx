/** Small shared UI primitives styled with the plAIt v2 (Sushi 2.1) tokens. */
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { Plait } from '@/constants/plait-theme';

type TextProps = { children: React.ReactNode; style?: object; numberOfLines?: number };

export function Title({ children, style, numberOfLines }: TextProps) {
  return (
    <Text style={[styles.title, style]} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}

export function Subtitle({ children, style, numberOfLines }: TextProps) {
  return (
    <Text style={[styles.subtitle, style]} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}

export function Body({ children, style, numberOfLines }: TextProps) {
  return (
    <Text style={[styles.body, style]} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}

/**
 * Eyebrow label — mono, uppercase, letterspaced. The v2 design system's
 * section marker ("our pick for you", "why this pick", …).
 */
export function Eyebrow({ children, style, numberOfLines }: TextProps) {
  return (
    <Text style={[styles.eyebrow, style]} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  variant = 'coral',
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** coral = filled green (primary) · teal = soft-green secondary · ghost = outline */
  variant?: 'coral' | 'teal' | 'ghost';
  style?: ViewStyle;
}) {
  const bg =
    variant === 'coral' ? Plait.color.green : variant === 'teal' ? Plait.color.greenSoft : 'transparent';
  const fg =
    variant === 'coral' ? '#FFFFFF' : variant === 'teal' ? Plait.color.green : Plait.color.inkSoft;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg },
        variant === 'ghost' && styles.ghost,
        (pressed || disabled) && { opacity: 0.6 },
        style,
      ]}>
      <Text style={[styles.buttonLabel, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * Small dim text link for header navigation (back / close / start over).
 * One shared style so every screen's escape hatch looks and feels the same.
 */
export function NavLink({
  label,
  onPress,
  style,
}: {
  label: string;
  onPress: () => void;
  style?: object;
}) {
  return (
    <Pressable onPress={onPress} hitSlop={12} style={({ pressed }) => pressed && { opacity: 0.6 }}>
      <Text style={[styles.navLink, style]}>{label}</Text>
    </Pressable>
  );
}

export function Loading({ message }: { message: string }) {
  return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color={Plait.color.green} />
      <Subtitle style={{ marginTop: Plait.space.md, textAlign: 'center' }}>{message}</Subtitle>
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: Plait.font.display,
    fontSize: 40,
    color: Plait.color.ink,
  },
  subtitle: {
    fontFamily: Plait.font.body,
    fontSize: 16,
    color: Plait.color.inkSoft,
    lineHeight: 22,
  },
  body: {
    fontFamily: Plait.font.body,
    fontSize: 15,
    color: Plait.color.ink,
    lineHeight: 21,
  },
  eyebrow: {
    fontFamily: Plait.font.mono,
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: Plait.color.inkFaint,
  },
  button: {
    paddingVertical: 16,
    paddingHorizontal: Plait.space.lg,
    borderRadius: Plait.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghost: {
    borderWidth: 1,
    borderColor: Plait.color.line,
  },
  buttonLabel: {
    fontFamily: Plait.font.bodyBold,
    fontSize: 15.5,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Plait.space.xl,
    backgroundColor: Plait.color.paper,
  },
  navLink: {
    color: Plait.color.inkSoft,
    fontSize: 16,
    fontFamily: Plait.font.body,
  },
});
