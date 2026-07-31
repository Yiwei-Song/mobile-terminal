import type { ReactNode } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";

import { color, radius, space, stroke } from "../theme";

export type CardProps = {
  children: ReactNode;
  /** Raised/selected treatment (e.g. the focused session). */
  raised?: boolean;
  /** Accent left-border for attention states (warn = waiting on user). */
  accentEdge?: "warn" | "danger" | "accent";
  style?: ViewStyle;
};

export function Card({ children, raised, accentEdge, style }: CardProps) {
  return (
    <View
      style={[
        styles.card,
        raised && styles.raised,
        accentEdge && { borderLeftWidth: stroke.emphasis, borderLeftColor: color[accentEdge] },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.card,
    borderWidth: stroke.hairline,
    borderColor: color.border,
    padding: space(4),
  },
  raised: { backgroundColor: color.surfaceHi },
});
