/** Small shared UI primitives styled with the plAIt tokens. */
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { Plait } from '@/constants/plait-theme';

export function Title({ children, style }: { children: React.ReactNode; style?: object }) {
  return <Text style={[styles.title, style]}>{children}</Text>;
}

export function Subtitle({ children, style }: { children: React.ReactNode; style?: object }) {
  return <Text style={[styles.subtitle, style]}>{children}</Text>;
}

export function Body({ children, style }: { children: React.ReactNode; style?: object }) {
  return <Text style={[styles.body, style]}>{children}</Text>;
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
  variant?: 'coral' | 'teal' | 'ghost';
  style?: ViewStyle;
}) {
  const bg =
    variant === 'coral' ? Plait.color.coral : variant === 'teal' ? Plait.color.teal : 'transparent';
  const fg = variant === 'ghost' ? Plait.color.text : '#111111';
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

export function Loading({ message }: { message: string }) {
  return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color={Plait.color.coral} />
      <Subtitle style={{ marginTop: Plait.space.md, textAlign: 'center' }}>{message}</Subtitle>
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: Plait.font.serif,
    fontSize: 44,
    color: Plait.color.text,
    fontWeight: '600',
  },
  subtitle: {
    fontFamily: Plait.font.sans,
    fontSize: 16,
    color: Plait.color.textDim,
    lineHeight: 22,
  },
  body: {
    fontFamily: Plait.font.sans,
    fontSize: 15,
    color: Plait.color.text,
    lineHeight: 21,
  },
  button: {
    paddingVertical: 18,
    paddingHorizontal: Plait.space.lg,
    borderRadius: Plait.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghost: {
    borderWidth: 1,
    borderColor: Plait.color.border,
  },
  buttonLabel: {
    fontFamily: Plait.font.sans,
    fontSize: 17,
    fontWeight: '700',
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Plait.space.xl,
    backgroundColor: Plait.color.background,
  },
});
