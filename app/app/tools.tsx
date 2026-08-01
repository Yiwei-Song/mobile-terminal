import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Play, Square, ShieldAlert, Wifi, WifiOff, Wrench } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import type { ToolStatus } from "@shared/protocol";

import { BackButton } from "../src/components/BackButton";
import { Button } from "../src/components/Button";
import { Card } from "../src/components/Card";
import { EmptyState } from "../src/components/EmptyState";
import { MonoText } from "../src/components/MonoText";
import { Screen } from "../src/components/Screen";
import { Text } from "../src/components/Text";
import { demoMode, seedDemo } from "../src/lib/demo";
import { loadPairing, pairingUrl } from "../src/lib/pairing";
import { useWorkbench } from "../src/lib/store";
import { color, icon as iconSize, radius, space, stroke, touch, tracking } from "../src/theme";

// Where the daemon looks for the file. `%APPDATA%\workbench` is loadConfig's
// default dataDir; a daemon started with WORKBENCH_DATA_DIR set reads that
// instead, which is the one case this line understates.
const TOOLS_FILE = "%APPDATA%\\workbench\\tools.json";

/**
 * Tools: the long-running dev services you would otherwise walk to the desk to
 * start. One row per tool declared in `tools.json`, a dot for whether it is up,
 * and one button that means what it says. Stopping asks first — a stopped
 * container is somebody's afternoon.
 */
export default function Tools() {
  const connState = useWorkbench((s) => s.connState);
  const tools = useWorkbench((s) => s.tools);
  const lastError = useWorkbench((s) => s.lastError);
  const refreshTools = useWorkbench((s) => s.refreshTools);
  const startTool = useWorkbench((s) => s.startTool);
  const stopTool = useWorkbench((s) => s.stopTool);
  const connect = useWorkbench((s) => s.connect);

  // Which row is mid-request, so its button spins instead of the whole screen.
  const [busy, setBusy] = useState<string | null>(null);
  const [stopTarget, setStopTarget] = useState<ToolStatus | null>(null);

  const offline = connState !== "online";
  const unauthorized = connState === "unauthorized";

  useFocusEffect(
    useCallback(() => {
      if (demoMode) {
        seedDemo();
        return;
      }
      void refreshTools().catch(() => {});
    }, [refreshTools]),
  );

  useEffect(() => {
    if (connState === "online") void refreshTools().catch(() => {});
  }, [connState, refreshTools]);

  const run = (name: string, action: (n: string) => Promise<void>) => {
    setBusy(name);
    // The store already put the reason in lastError, rendered below.
    void action(name)
      .catch(() => {})
      .finally(() => setBusy(null));
  };

  const retry = () => {
    void loadPairing().then((p) => {
      if (p !== null) connect(pairingUrl(p), p.token);
    });
  };

  return (
    <Screen>
      <View style={styles.header}>
        <BackButton />
        <View style={styles.headText}>
          <Text variant="h2" numberOfLines={1}>
            Dev tools
          </Text>
          <Text variant="sub" color="textMut" numberOfLines={1}>
            Services you declared on your PC
          </Text>
        </View>
      </View>

      {unauthorized ? (
        <Banner icon={ShieldAlert} text="This PC turned the phone away — re-pair to run its tools.">
          <Button label="Re-pair" variant="outline" onPress={() => router.push({ pathname: "/pair", params: { edit: "1" } })} />
        </Banner>
      ) : offline ? (
        <Banner icon={WifiOff} text="Offline — a running tool keeps running; you just cannot start or stop one.">
          <Button label="Reconnect" variant="outline" icon={Wifi} onPress={retry} />
        </Banner>
      ) : null}

      {lastError !== null && (
        <Card accentEdge="danger" style={styles.note}>
          <Text variant="sub" color="danger">
            {lastError}
          </Text>
        </Card>
      )}

      {tools.length === 0 ? (
        <EmptyState
          icon={Wrench}
          title="No dev tools declared"
          // The path is the whole answer: nothing here works until that file exists.
          body={`Create ${TOOLS_FILE} on your PC — a list of {name, command, args, cwd, port}. Copy daemon/tools.example.json to start, then restart the daemon.`}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text variant="sub" color="textMut" style={styles.sectionLabel}>
            TOOLS
          </Text>
          {tools.map((t) => (
            <ToolRow
              key={t.name}
              tool={t}
              disabled={offline}
              busy={busy === t.name}
              onStart={() => run(t.name, startTool)}
              onStop={() => setStopTarget(t)}
            />
          ))}
          <Text variant="sub" color="textMut" style={styles.footnote}>
            Declared in {TOOLS_FILE}. Edit it on your PC and restart the daemon to pick up changes.
          </Text>
        </ScrollView>
      )}

      {stopTarget !== null && (
        <Card accentEdge="danger" raised style={styles.sheet}>
          <Text variant="body">Stop {stopTarget.name}?</Text>
          <Text variant="sub" color="textMut">
            It and everything it started are killed. Anything mid-flight in it is lost.
          </Text>
          <View style={styles.sheetButtons}>
            <Button label="Cancel" variant="outline" fill onPress={() => setStopTarget(null)} />
            <Button
              label="Stop"
              variant="danger"
              fill
              onPress={() => {
                const name = stopTarget.name;
                setStopTarget(null);
                run(name, stopTool);
              }}
            />
          </View>
        </Card>
      )}
    </Screen>
  );
}

// One tool: the dot answers "is it up?" from across the room, the port answers
// "where?", and the single button is whichever action makes sense right now.
function ToolRow({
  tool,
  disabled,
  busy,
  onStart,
  onStop,
}: {
  tool: ToolStatus;
  disabled: boolean;
  busy: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  return (
    <View style={styles.toolRow}>
      <View style={[styles.dot, { backgroundColor: tool.running ? color.accent : color.idle }]} />
      <View style={styles.flex}>
        <Text variant="body" numberOfLines={1}>
          {tool.name}
        </Text>
        <View style={styles.meta}>
          <Text variant="sub" color={tool.running ? "accent" : "textMut"}>
            {tool.running ? "Running" : "Stopped"}
          </Text>
          {tool.port !== undefined && <MonoText>· :{tool.port}</MonoText>}
        </View>
      </View>
      {tool.running ? (
        <Button label="Stop" variant="danger" icon={Square} loading={busy} disabled={disabled} onPress={onStop} />
      ) : (
        <Button label="Start" variant="outline" icon={Play} loading={busy} disabled={disabled} onPress={onStart} />
      )}
    </View>
  );
}

function Banner({ icon: Icon, text, children }: { icon: LucideIcon; text: string; children?: React.ReactNode }) {
  return (
    <View style={styles.banner}>
      <View style={styles.bannerText}>
        <Icon size={iconSize.sm} color={color.textMut} strokeWidth={stroke.icon} />
        <Text variant="sub" color="textMut" style={styles.flex}>
          {text}
        </Text>
      </View>
      {children}
    </View>
  );
}

const DOT = space(2.5);

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: space(2), paddingTop: space(2), paddingBottom: space(3) },
  headText: { flex: 1, gap: space(0.5) },

  banner: {
    paddingVertical: space(2),
    paddingHorizontal: space(3),
    borderRadius: radius.input,
    backgroundColor: color.surface,
    borderWidth: stroke.hairline,
    borderColor: color.border,
    gap: space(2),
    marginBottom: space(3),
  },
  bannerText: { flexDirection: "row", alignItems: "center", gap: space(2) },
  note: { marginBottom: space(3) },

  scroll: { gap: space(2), paddingTop: space(1), paddingBottom: space(6) },
  sectionLabel: { letterSpacing: tracking.label },
  footnote: { marginTop: space(3) },

  toolRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(3),
    minHeight: touch.min,
    paddingVertical: space(2),
    paddingHorizontal: space(3),
    borderRadius: radius.input,
    borderWidth: stroke.hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
  meta: { flexDirection: "row", alignItems: "baseline", gap: space(1.5) },

  sheet: { gap: space(2), marginBottom: space(3) },
  sheetButtons: { flexDirection: "row", gap: space(3), marginTop: space(1) },
});
