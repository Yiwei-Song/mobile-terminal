import { useEffect, useRef } from "react";
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

// `danger` is a tinted outline, not a filled red: journey principle 2 wants the
// destructive choice visually quieter than the affirmative one.
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
  // Disabled (but not merely loading) gets a neutral greyed surface and a
  // textMut label — clearly off, yet still legible. A dimmed variant color sank
  // the label near the contrast floor; textMut is ≥4.5:1 on surface.
  const greyed = disabled && !loading;
  const role: ColorRole = greyed ? "textMut" : labelColorFor[variant];

  // Going inert mid-press swallows onPressOut (the Pressable is disabled before
  // it fires), which would strand `fade` at pressed and show a 60% button once
  // the press fade takes over again. Reset it whenever the button goes inert.
  useEffect(() => {
    if (inert) fade.setValue(opacity.full);
  }, [inert, fade]);

  const animate = (to: number) =>
    Animated.timing(fade, {
      toValue: to,
      duration: motion.fast,
      useNativeDriver: true,
    }).start();

  return (
    <Animated.View style={[fill && styles.fill, { opacity: greyed ? opacity.full : loading ? opacity.disabled : fade }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: inert, busy: loading }}
        disabled={inert}
        onPressIn={() => animate(opacity.pressed)}
        onPressOut={() => animate(opacity.full)}
        style={[styles.base, greyed ? styles.greyed : surfaceFor[variant], style]}
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
  greyed: { backgroundColor: color.surface, borderWidth: stroke.hairline, borderColor: color.border },
  // flex:1 alone collapses to 0 height in an auto-sized column (basis 0, no
  // free space to grow into) and the button overflows onto its sibling; the
  // minHeight keeps the wrapper at least as tall as the Pressable it contains.
  fill: { flex: 1, minHeight: touch.min },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space(2),
  },
  label: { fontFamily: font.uiMed },
});
