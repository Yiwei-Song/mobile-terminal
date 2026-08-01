import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import type { LucideIcon } from "lucide-react-native";

import { color, icon as iconSize, space, stroke } from "../theme";
import { Text } from "./Text";

export type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  body: string;
  /** Optional <Button/> — empty states teach, then offer the next step. */
  action?: ReactNode;
  /**
   * Left-align the body. Centring is right for a sentence; a body carrying a
   * file path or a shape to type is instructions, and instructions are read
   * down a left edge.
   */
  bodyLeft?: boolean;
};

export function EmptyState({ icon: Icon, title, body, action, bodyLeft = false }: EmptyStateProps) {
  return (
    <View style={styles.wrap}>
      <Icon size={iconSize.xl} color={color.idle} strokeWidth={stroke.icon} />
      <Text variant="h2" style={styles.center}>
        {title}
      </Text>
      <Text variant="body" color="textMut" style={bodyLeft ? styles.left : styles.center}>
        {body}
      </Text>
      {action && <View style={styles.action}>{action}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: space(3),
    paddingHorizontal: space(6),
  },
  center: { textAlign: "center" },
  left: { alignSelf: "stretch", textAlign: "left" },
  action: { marginTop: space(2) },
});
