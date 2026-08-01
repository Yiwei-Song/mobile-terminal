import { Pressable, StyleSheet, View } from "react-native";
import { router, type Href } from "expo-router";
import { FolderOpen, MonitorSmartphone, TerminalSquare, Wrench } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";

import { color, icon as iconSize, opacity, radius, space, stroke, touch } from "../theme";
import { Text } from "./Text";

// The four surfaces that are not the session list. Each icon is the one its
// destination already leads with, so the strip and the screen agree.
const ACTIONS: { label: string; icon: LucideIcon; path: Href }[] = [
  { label: "Terminal", icon: TerminalSquare, path: "/terminal" },
  { label: "Files", icon: FolderOpen, path: "/files" },
  { label: "Preview", icon: MonitorSmartphone, path: "/preview" },
  { label: "Tools", icon: Wrench, path: "/tools" },
];

/**
 * Home's utility strip: the way into terminal / files / preview / tools without
 * any of them competing with the session list. One row, four equal columns —
 * four labels fit inside a 390pt gutter with room to spare, so nothing scrolls
 * and no target shrinks below 48.
 *
 * Always navigable, offline included: each destination says its own honest thing
 * about a dead connection and offers Reconnect. Dimming the only door to a screen
 * built for being offline would hide it exactly when it is needed.
 */
export function ActionRow() {
  return (
    <View style={styles.row}>
      {ACTIONS.map(({ label, icon: Icon, path }) => (
        <Pressable
          key={label}
          accessibilityRole="button"
          accessibilityLabel={label}
          onPress={() => router.push(path)}
          style={({ pressed }) => [styles.item, pressed && { opacity: opacity.pressed }]}
        >
          <Icon size={iconSize.md} color={color.text} strokeWidth={stroke.icon} />
          <Text variant="sub" color="textMut" numberOfLines={1}>
            {label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: space(2), marginBottom: space(3) },
  // flex: 1 so the four share the column evenly; the padding keeps the box a
  // comfortable 56pt tall rather than the bare 48 minimum.
  item: {
    flex: 1,
    minHeight: touch.min,
    alignItems: "center",
    justifyContent: "center",
    gap: space(1),
    paddingVertical: space(1.5),
    borderRadius: radius.input,
    borderWidth: stroke.hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
});
