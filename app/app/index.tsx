import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Plus, ShieldAlert, TerminalSquare, WifiOff, X } from "lucide-react-native";

import { Button } from "../src/components/Button";
import { Card } from "../src/components/Card";
import { EmptyState } from "../src/components/EmptyState";
import { MachineBar } from "../src/components/MachineBar";
import { Screen } from "../src/components/Screen";
import { SessionRow } from "../src/components/SessionRow";
import { Text } from "../src/components/Text";
import type { ConnState } from "../src/lib/client";
import { demoMode, seedDemo } from "../src/lib/demo";
import { loadPairing, pairingUrl, type Pairing } from "../src/lib/pairing";
import { useWorkbench } from "../src/lib/store";
import { color, icon as iconSize, opacity, space, touch } from "../src/theme";

/**
 * Home: "does anything need me?" answered in under a second. The list is the
 * screen — machine bar above it, one FAB below it, nothing else competing.
 */
export default function Home() {
  const sessions = useWorkbench((s) => s.sessions);
  const connState = useWorkbench((s) => s.connState);
  const lastError = useWorkbench((s) => s.lastError);
  const connect = useWorkbench((s) => s.connect);
  const refreshSessions = useWorkbench((s) => s.refreshSessions);
  // undefined until storage answers: rendering "not paired" for that frame is a
  // flash of the wrong screen on every cold start. Demo mode never asks storage
  // — it *is* the connection — so it starts already answered.
  const [pairing, setPairing] = useState<Pairing | null | undefined>(demoMode ? null : undefined);
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (demoMode) {
        seedDemo();
        return;
      }
      let alive = true;
      void loadPairing().then((p) => {
        if (!alive) return;
        setPairing(p);
        if (p === null) {
          router.replace("/pair");
          return;
        }
        // Cheap on every focus: the store no-ops when the pairing is unchanged.
        connect(pairingUrl(p), p.token);
      });
      return () => {
        alive = false;
      };
    }, [connect]),
  );

  // connect() on the pairing we are already on means "try now" to the client:
  // it cancels the backoff and opens a socket immediately.
  const retry = () => {
    if (pairing === null || pairing === undefined) return;
    connect(pairingUrl(pairing), pairing.token);
  };

  const refresh = () => {
    setRefreshing(true);
    // Pull-to-refresh is the instinctive gesture on a stale list, and while
    // offline the list cannot recover without a socket — so nudge one first.
    // The reconnect re-lists on its own; this refresh is what covers the online case.
    if (connState === "offline") retry();
    // The rejection is already state (lastError) — the banner below reports it.
    void refreshSessions(true)
      .catch(() => {})
      .finally(() => setRefreshing(false));
  };

  if (pairing === undefined) return null;

  return (
    <Screen>
      <MachineBar />

      {lastError !== null && (
        <Card accentEdge="danger" style={styles.error}>
          <View style={styles.errorRow}>
            <Text variant="sub" color="danger" style={styles.errorText}>
              {lastError}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss error"
              onPress={() => useWorkbench.setState({ lastError: null })}
              style={({ pressed }) => [styles.dismiss, pressed && { opacity: opacity.pressed }]}
            >
              <X size={iconSize.md} color={color.textMut} />
            </Pressable>
          </View>
        </Card>
      )}

      <FlatList
        data={sessions}
        keyExtractor={(s) => s.sessionId}
        renderItem={({ item }) => <SessionRow session={item} />}
        ItemSeparatorComponent={Separator}
        contentContainerStyle={sessions.length === 0 ? styles.emptyList : styles.list}
        ListEmptyComponent={<Empty connState={connState} onRetry={retry} />}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={color.textMut} colors={[color.accent]} />
        }
      />

      {/* Thumb-reachable, and the only primary action on the screen. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="New session"
        onPress={() => router.push("/new")}
        style={({ pressed }) => [styles.fab, pressed && { opacity: opacity.pressed }]}
      >
        <Plus size={iconSize.lg} color={color.accentText} />
      </Pressable>
    </Screen>
  );
}

const Separator = () => <View style={styles.separator} />;

// Nothing dead-ends: every empty list says why it is empty and offers the move
// that fixes it. "connecting" is the one state with nothing useful to say yet.
function Empty({ connState, onRetry }: { connState: ConnState; onRetry: () => void }) {
  if (connState === "unauthorized")
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Your PC turned this phone away"
        body="The token stopped working — the daemon probably made a new one. Pair again to pick it up."
        action={<Button label="Re-pair" onPress={() => router.push({ pathname: "/pair", params: { edit: "1" } })} />}
      />
    );
  if (connState === "offline")
    return (
      <EmptyState
        icon={WifiOff}
        title="Can't reach your PC"
        body="Same wifi? VPN off? Is the daemon still running? It keeps trying in the background."
        action={<Button label="Retry now" onPress={onRetry} />}
      />
    );
  if (connState === "online")
    return (
      <EmptyState
        icon={TerminalSquare}
        title="No sessions yet"
        body="Start one — tap +, pick a folder on your PC and say what you want done."
        action={<Button label="New session" icon={Plus} onPress={() => router.push("/new")} />}
      />
    );
  return null;
}

const FAB = space(14);

const styles = StyleSheet.create({
  list: { paddingBottom: space(24), paddingTop: space(1) },
  // Centres the empty state in the space the list has, rather than at the top.
  emptyList: { flexGrow: 1, paddingBottom: space(24) },
  separator: { height: space(2) },
  error: { marginBottom: space(3) },
  errorRow: { flexDirection: "row", alignItems: "center", gap: space(2) },
  errorText: { flexShrink: 1 },
  dismiss: { width: touch.min, height: touch.min, alignItems: "center", justifyContent: "center", marginVertical: -space(3) },
  fab: {
    position: "absolute",
    // Flush with the content column, not the screen edge: the FAB lines up with
    // the right edge of every card above it.
    right: 0,
    bottom: space(4),
    width: FAB,
    height: FAB,
    borderRadius: FAB / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.accent,
  },
});
