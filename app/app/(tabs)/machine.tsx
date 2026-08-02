import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { router, type Href } from "expo-router";
import {
  ChevronRight,
  Cpu,
  FolderOpen,
  MonitorSmartphone,
  Settings as SettingsIcon,
  TerminalSquare,
  Wrench,
} from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";

import { Button } from "../../src/components/Button";
import { Card } from "../../src/components/Card";
import { Screen } from "../../src/components/Screen";
import { Text } from "../../src/components/Text";
import type { ConnState } from "../../src/lib/client";
import { since } from "../../src/lib/format";
import { demoMode } from "../../src/lib/demo";
import { loadPairing, pairingUrl, type Pairing } from "../../src/lib/pairing";
import { useWorkbench } from "../../src/lib/store";
import { color, icon as iconSize, opacity, space, stroke, touch, type ColorRole } from "../../src/theme";

// Label first, color second: the dot is the glance, the word is the answer.
// (Carried over from the old MachineBar — same states, same wording.)
const CONN: Record<ConnState, { label: string; role: ColorRole }> = {
  connecting: { label: "Connecting…", role: "info" },
  online: { label: "Online", role: "accent" },
  offline: { label: "Offline", role: "idle" },
  unauthorized: { label: "Not allowed — re-pair", role: "danger" },
};

// The five utility screens, in the order they matter most. Same icons the
// old ActionRow used, so nothing about a destination's identity changes.
const ROWS: { label: string; icon: LucideIcon; path: Href }[] = [
  { label: "System", icon: Cpu, path: "/system" },
  { label: "Terminal", icon: TerminalSquare, path: "/terminal" },
  { label: "Files", icon: FolderOpen, path: "/files" },
  { label: "Preview", icon: MonitorSmartphone, path: "/preview" },
  { label: "Tools", icon: Wrench, path: "/tools" },
];

/**
 * Machine tab: everything that is not the session list. Who this PC is and
 * whether the phone can reach it (what MachineBar used to show up top), then
 * every other screen as a plain nav row. Always navigable, offline included —
 * each destination already says its own honest thing about a dead connection.
 */
export default function Machine() {
  const connState = useWorkbench((s) => s.connState);
  const machine = useWorkbench((s) => s.machine);
  const lastSeen = useWorkbench((s) => s.lastSeen);
  const connect = useWorkbench((s) => s.connect);
  const [pairing, setPairing] = useState<Pairing | null>(null);

  useEffect(() => {
    // Demo mode is never re-paired — Sessions already seeded its fixed state.
    if (demoMode) return;
    void loadPairing().then(setPairing);
  }, []);

  const conn = CONN[connState];
  // Only worth saying while we cannot see the machine: online, "now" is noise.
  const seen = connState === "offline" && lastSeen !== undefined ? ` · last seen ${since(lastSeen)}` : "";

  // Same "try now" semantics as Sessions' pull-to-refresh: cancels the backoff
  // and opens a socket immediately rather than waiting it out.
  const reconnect = () => {
    if (pairing === null) return;
    connect(pairingUrl(pairing), pairing.token);
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text variant="title">Machine</Text>

        <View style={styles.status}>
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
          {connState === "offline" && (
            <Button label="Reconnect" variant="outline" style={styles.statusAction} onPress={reconnect} />
          )}
          {connState === "unauthorized" && (
            <Button
              label="Re-pair"
              variant="outline"
              style={styles.statusAction}
              onPress={() => router.push({ pathname: "/pair", params: { edit: "1" } })}
            />
          )}
        </View>

        <Card>
          {ROWS.map((r, i) => (
            <NavRow key={r.label} {...r} last={i === ROWS.length - 1} onPress={() => router.push(r.path)} />
          ))}
        </Card>

        <Card>
          <NavRow label="Settings" icon={SettingsIcon} last onPress={() => router.push("/settings")} />
        </Card>
      </ScrollView>
    </Screen>
  );
}

function NavRow({
  label,
  icon: Icon,
  onPress,
  last = false,
}: {
  label: string;
  icon: LucideIcon;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.row, !last && styles.rowBorder, pressed && { opacity: opacity.pressed }]}
    >
      <Icon size={iconSize.md} color={color.text} strokeWidth={stroke.icon} />
      <Text variant="body" style={styles.rowLabel}>
        {label}
      </Text>
      <ChevronRight size={iconSize.md} color={color.textMut} strokeWidth={stroke.icon} />
    </Pressable>
  );
}

const DOT = space(2.5);

const styles = StyleSheet.create({
  scroll: { gap: space(3), paddingTop: space(2), paddingBottom: space(4) },
  status: { gap: space(1) },
  state: { flexDirection: "row", alignItems: "center", gap: space(2) },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
  statusAction: { alignSelf: "flex-start", marginTop: space(2) },
  row: { flexDirection: "row", alignItems: "center", gap: space(3), minHeight: touch.min },
  rowBorder: { borderBottomWidth: stroke.hairline, borderBottomColor: color.border },
  rowLabel: { flex: 1 },
});
