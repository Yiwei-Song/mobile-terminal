import { useMemo, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ArrowDown, ArrowLeft, MessageSquare, StopCircle, WifiOff } from "lucide-react-native";

import { ApprovalCard } from "../../src/components/ApprovalCard";
import { Button } from "../../src/components/Button";
import { Card } from "../../src/components/Card";
import { Composer } from "../../src/components/Composer";
import { EmptyState } from "../../src/components/EmptyState";
import { Screen } from "../../src/components/Screen";
import { StatusChip } from "../../src/components/StatusChip";
import { Text } from "../../src/components/Text";
import { TranscriptItem } from "../../src/components/TranscriptItem";
import { showJump } from "../../src/lib/tools";
import { useWorkbench, type Approval, type TranscriptItem as Item } from "../../src/lib/store";
import { color, icon as iconSize, opacity, radius, space, stroke, touch } from "../../src/theme";

// Stable empties: a fresh `[]` each render would give zustand a new snapshot
// every time and spin the component.
const NO_ITEMS: Item[] = [];
const NO_ASKS: Approval[] = [];

/**
 * The session screen: transcript, the approval hero, and the composer. Task 7.
 */
export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useWorkbench((s) => s.sessions.find((x) => x.sessionId === id));
  const items = useWorkbench((s) => s.transcripts[id] ?? NO_ITEMS);
  const asks = useWorkbench((s) => s.pendingApprovals[id] ?? NO_ASKS);
  const connState = useWorkbench((s) => s.connState);
  const send = useWorkbench((s) => s.send);
  const interrupt = useWorkbench((s) => s.interrupt);
  const approve = useWorkbench((s) => s.approve);

  const listRef = useRef<FlatList<Item>>(null);
  const [jump, setJump] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);

  // Inverted list wants newest first; the store keeps items oldest-first.
  const data = useMemo(() => [...items].reverse(), [items]);
  const status = session?.status;
  const offline = connState !== "online";
  const current = asks[0];

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => setJump(showJump(e.nativeEvent.contentOffset.y));
  const toLatest = () => listRef.current?.scrollToOffset({ offset: 0, animated: true });

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          style={({ pressed }) => [styles.iconBtn, pressed && { opacity: opacity.pressed }]}
        >
          <ArrowLeft size={iconSize.lg} color={color.text} strokeWidth={stroke.icon} />
        </Pressable>
        <View style={styles.headText}>
          <Text variant="h2" numberOfLines={1}>
            {session?.title ?? "Session"}
          </Text>
          {offline && (
            <View style={styles.offlineRow}>
              <WifiOff size={iconSize.sm} color={color.textMut} strokeWidth={stroke.icon} />
              <Text variant="sub" color="textMut">
                Offline
              </Text>
            </View>
          )}
        </View>
        {status !== undefined && <StatusChip status={status} />}
        {status === "running" && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Interrupt the agent"
            onPress={() => setConfirmStop(true)}
            style={({ pressed }) => [styles.iconBtn, pressed && { opacity: opacity.pressed }]}
          >
            <StopCircle size={iconSize.lg} color={color.danger} strokeWidth={stroke.icon} />
          </Pressable>
        )}
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.transcript}>
          {data.length === 0 ? (
            <EmptyState
              icon={MessageSquare}
              title="Waiting for the first response…"
              body="Your prompt is on its way to the agent. Its reply lands here."
            />
          ) : (
            <>
              <FlatList
                ref={listRef}
                inverted
                data={data}
                keyExtractor={(i) => i.id}
                renderItem={({ item }) => <TranscriptItem item={item} />}
                ItemSeparatorComponent={Separator}
                contentContainerStyle={styles.listContent}
                onScroll={onScroll}
                scrollEventThrottle={64}
                keyboardShouldPersistTaps="handled"
              />
              {jump && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Jump to latest"
                  onPress={toLatest}
                  style={({ pressed }) => [styles.jump, pressed && { opacity: opacity.pressed }]}
                >
                  <ArrowDown size={iconSize.sm} color={color.accentText} strokeWidth={stroke.icon} />
                  <Text variant="sub" color="accentText">
                    Latest
                  </Text>
                </Pressable>
              )}
            </>
          )}
        </View>

        {confirmStop && (
          <Card accentEdge="danger" raised style={styles.confirm}>
            <Text variant="body">Stop the agent?</Text>
            <Text variant="sub" color="textMut">
              It finishes the current step, then waits for you.
            </Text>
            <View style={styles.confirmButtons}>
              <Button label="Keep going" variant="outline" fill onPress={() => setConfirmStop(false)} />
              <Button
                label="Stop"
                variant="danger"
                fill
                onPress={() => {
                  setConfirmStop(false);
                  void interrupt(id).catch(() => {});
                }}
              />
            </View>
          </Card>
        )}

        {current !== undefined && (
          <ApprovalCard
            // Keyed by request so the next queued ask mounts fresh (and re-animates
            // in) instead of morphing the resolved one.
            key={current.requestId}
            approval={current}
            index={0}
            total={asks.length}
            onDecide={(allow) => void approve(id, current.requestId, allow).catch(() => {})}
          />
        )}

        {status === "dead" && (
          <View style={styles.banner}>
            <Text variant="sub" color="textMut">
              Session ended — send a message to start it again.
            </Text>
          </View>
        )}

        <Composer
          onSend={(text) => send(id, text)}
          disabled={offline}
          hint={offline ? "Offline — reconnecting to your PC…" : undefined}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}

const Separator = () => <View style={styles.separator} />;

const JUMP = space(9);

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    paddingTop: space(2),
    paddingBottom: space(3),
  },
  // Negative margins claim the 48dp hit box without widening the header bar.
  iconBtn: { width: touch.min, height: touch.min, alignItems: "center", justifyContent: "center", marginVertical: -space(2) },
  headText: { flex: 1, gap: space(0.5) },
  offlineRow: { flexDirection: "row", alignItems: "center", gap: space(1) },
  transcript: { flex: 1 },
  listContent: { paddingVertical: space(2), gap: space(2) },
  separator: { height: space(1) },
  jump: {
    position: "absolute",
    alignSelf: "center",
    bottom: space(3),
    flexDirection: "row",
    alignItems: "center",
    gap: space(1),
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    borderRadius: radius.pill,
    backgroundColor: color.accent,
  },
  confirm: { gap: space(2), marginBottom: space(3) },
  confirmButtons: { flexDirection: "row", gap: space(3), marginTop: space(1) },
  banner: {
    marginBottom: space(2),
    paddingVertical: space(2),
    paddingHorizontal: space(3),
    borderRadius: radius.input,
    backgroundColor: color.surface,
    borderWidth: stroke.hairline,
    borderColor: color.border,
  },
});
