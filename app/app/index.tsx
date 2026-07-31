import { useCallback, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Settings as SettingsIcon } from "lucide-react-native";

import { Button } from "../src/components/Button";
import { Card } from "../src/components/Card";
import { MonoText } from "../src/components/MonoText";
import { Screen } from "../src/components/Screen";
import { Text } from "../src/components/Text";
import type { ConnState } from "../src/lib/client";
import { loadPairing, pairingUrl, type Pairing } from "../src/lib/pairing";
import { useWorkbench } from "../src/lib/store";
import { color, space, type ColorRole } from "../src/theme";

const CONN: Record<ConnState, { label: string; role: ColorRole }> = {
  connecting: { label: "Connecting…", role: "info" },
  online: { label: "Online", role: "accent" },
  offline: { label: "Offline — retrying", role: "idle" },
  unauthorized: { label: "Token rejected", role: "danger" },
};

// Placeholder home. Task 6 replaces this with the real session list; what it
// owns for now is the routing rule: no pairing stored → the pair screen.
export default function Home() {
  const connState = useWorkbench((s) => s.connState);
  const machine = useWorkbench((s) => s.machine);
  const connect = useWorkbench((s) => s.connect);
  // undefined until storage answers: rendering "not paired" for that frame is a
  // flash of the wrong screen on every cold start.
  const [pairing, setPairing] = useState<Pairing | null | undefined>(undefined);
  // The token we already handed the store. Re-running connect() on every focus
  // would tear down a live socket (or restart a retry backoff) for nothing.
  const wired = useRef<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void loadPairing().then((p) => {
        if (!alive) return;
        setPairing(p);
        if (p === null) {
          router.replace("/pair");
          return;
        }
        if (wired.current === p.token) return;
        wired.current = p.token;
        connect(pairingUrl(p), p.token);
      });
      return () => {
        alive = false;
      };
    }, [connect]),
  );

  const conn = CONN[connState];

  if (pairing === undefined) return null;

  return (
    <Screen>
      <View style={styles.header}>
        <Text variant="title">Workbench</Text>
        <Button label="Settings" variant="ghost" icon={SettingsIcon} onPress={() => router.push("/settings")} />
      </View>

      <View style={styles.body}>
        <Card>
          <View style={styles.row}>
            <View style={[styles.dot, { backgroundColor: color[conn.role] }]} />
            <Text variant="body">{conn.label}</Text>
          </View>
          <MonoText style={styles.value}>
            {pairing === null ? "not paired" : `${pairing.host}:${pairing.port}`}
            {machine === null ? "" : `  ·  ${machine.hostname}  ·  v${machine.version}`}
          </MonoText>
        </Card>

        {connState === "unauthorized" && (
          <Card accentEdge="danger">
            <Text variant="h2" color="danger">
              Token rejected
            </Text>
            <Text variant="body" color="textMut" style={styles.value}>
              The daemon refused this token — re-scan the QR (did the daemon regenerate it?).
            </Text>
            <View style={styles.actions}>
              <Button label="Re-pair" onPress={() => router.push("/pair")} />
            </View>
          </Card>
        )}

        <Text variant="sub" color="textMut">
          Session list lands in the next task.
        </Text>
      </View>
    </Screen>
  );
}

const DOT = space(2.5);

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: space(2) },
  body: { flex: 1, gap: space(3), paddingTop: space(3) },
  row: { flexDirection: "row", alignItems: "center", gap: space(2) },
  value: { marginTop: space(2) },
  actions: { flexDirection: "row", marginTop: space(3) },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
});
