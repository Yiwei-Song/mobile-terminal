import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { Settings as SettingsIcon } from "lucide-react-native";

import type { ConnState } from "../lib/client";
import { since } from "../lib/format";
import { useWorkbench } from "../lib/store";
import { color, icon as iconSize, opacity, space, stroke, touch, type ColorRole } from "../theme";
import { Text } from "./Text";

// Label first, color second: the dot is the glance, the word is the answer.
const CONN: Record<ConnState, { label: string; role: ColorRole }> = {
  connecting: { label: "Connecting…", role: "info" },
  online: { label: "Online", role: "accent" },
  offline: { label: "Offline", role: "idle" },
  unauthorized: { label: "Not allowed — re-pair", role: "danger" },
};

/**
 * The home screen's header: which PC this is, whether we can reach it, and the
 * way out to settings. Reads the store directly — every screen that shows it
 * shows the same thing.
 */
export function MachineBar() {
  const connState = useWorkbench((s) => s.connState);
  const machine = useWorkbench((s) => s.machine);
  const lastSeen = useWorkbench((s) => s.lastSeen);
  const conn = CONN[connState];
  // Only worth saying while we cannot see the machine: online, "now" is noise.
  const seen = connState === "offline" && lastSeen !== undefined ? ` · last seen ${since(lastSeen)}` : "";

  return (
    <View style={styles.bar}>
      {/* The strip is the door to the System screen: tap the hostname/health to
          reach live metrics, processes and power controls. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="System and power controls"
        onPress={() => router.push("/system")}
        style={({ pressed }) => [styles.identity, pressed && { opacity: opacity.pressed }]}
      >
        <Text variant="h2" numberOfLines={1}>
          {machine?.hostname ?? "Your PC"}
        </Text>
        <View style={styles.state}>
          <View style={[styles.dot, { backgroundColor: color[conn.role] }]} />
          <Text variant="sub" color="textMut" numberOfLines={1}>
            {conn.label}
            {seen}
          </Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Settings"
        onPress={() => router.push("/settings")}
        style={({ pressed }) => [styles.gear, pressed && { opacity: opacity.pressed }]}
      >
        <SettingsIcon size={iconSize.lg} color={color.textMut} strokeWidth={stroke.icon} />
      </Pressable>
    </View>
  );
}

const DOT = space(2.5);

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space(2),
    paddingTop: space(2),
    paddingBottom: space(3),
  },
  // Shrinks so a long hostname ellipsises instead of pushing the gear off-screen.
  identity: { flexShrink: 1, gap: space(1) },
  state: { flexDirection: "row", alignItems: "center", gap: space(2) },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
  gear: { width: touch.min, height: touch.min, alignItems: "center", justifyContent: "center" },
});
