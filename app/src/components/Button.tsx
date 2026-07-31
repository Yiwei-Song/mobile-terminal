import { useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type ViewStyle,
} from "react-native";
import type { LucideIcon } from "lucide-react-native";

import {
  color,
  font,
  icon as iconSize,
  motion,
  opacity,
  radius,
  space,
  stroke,
  touch,
  type ColorRole,
} from "../theme";
import { Text } from "./Text";

export type ButtonVariant = "primary" | "outline" | "danger" | "ghost";

export type ButtonProps = Omit<PressableProps, "style" | "children"> & {
  label: string;
  variant?: ButtonVariant;
  icon?: LucideIcon;
  loading?: boolean;
  /** Stretch to fill the row (default: hug content). */
  fill?: boolean;
  style?: ViewStyle;
};

// `danger` is a tinted outline, not a filled red: white-on-#EF4444 is only ~3.7:1,
// and journey principle 2 wants the destructive choice visually quieter than Allow.
const surfaceFor: Record<ButtonVariant, ViewStyle> = {
  primary: { backgroundColor: color.accent },
  outline: { borderWidth: stroke.hairline, borderColor: color.border },
  danger: { borderWidth: stroke.hairline, borderColor: color.danger },
  ghost: {},
};

const labelColorFor: Record<ButtonVariant, ColorRole> = {
  primary: "accentText",
  outline: "text",
  danger: "danger",
  ghost: "info",
};

export function Button({
  label,
  variant = "primary",
  icon: Icon,
  loading = false,
  fill = false,
  disabled = false,
  style,
  ...rest
}: ButtonProps) {
  const fade = useRef(new Animated.Value(opacity.full)).current;
  const inert = disabled || loading;
  const role = labelColorFor[variant];

  const animate = (to: number) =>
    Animated.timing(fade, {
      toValue: to,
      duration: motion.fast,
      useNativeDriver: true,
    }).start();

  return (
    <Animated.View style={[fill && styles.fill, { opacity: inert ? opacity.disabled : fade }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: inert, busy: loading }}
        disabled={inert}
        onPressIn={() => animate(opacity.pressed)}
        onPressOut={() => animate(opacity.full)}
        style={[styles.base, surfaceFor[variant], style]}
        {...rest}
      >
        <View style={styles.row}>
          {loading ? (
            <ActivityIndicator size="small" color={color[role]} />
          ) : (
            Icon && <Icon size={iconSize.md} color={color[role]} />
          )}
          <Text variant="body" color={role} style={styles.label}>
            {label}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: touch.min,
    justifyContent: "center",
    paddingHorizontal: space(5),
    borderRadius: radius.pill,
  },
  fill: { flex: 1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space(2),
  },
  label: { fontFamily: font.uiMed },
});
