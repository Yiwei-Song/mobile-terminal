import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import type { LucideIcon } from "lucide-react-native";

import { color, icon as iconSize, space } from "../theme";
import { Text } from "./Text";

export type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  body: string;
  /** Optional <Button/> — empty states teach, then offer the next step. */
  action?: ReactNode;
};

export function EmptyState({ icon: Icon, title, body, action }: EmptyStateProps) {
  return (
    <View style={styles.wrap}>
      <Icon size={iconSize.xl} color={color.idle} strokeWidth={1.5} />
      <Text variant="h2" style={styles.center}>
        {title}
      </Text>
      <Text variant="body" color="textMut" style={styles.center}>
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
  action: { marginTop: space(2) },
});
