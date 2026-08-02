import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import {
  ArrowDown,
  ChevronDown,
  Folder,
  GitCompare,
  MessageSquare,
  MoreHorizontal,
  ShieldAlert,
  SquareTerminal,
  StopCircle,
} from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";

import { ApprovalCard } from "../../src/components/ApprovalCard";
import { BackButton } from "../../src/components/BackButton";
import { Button } from "../../src/components/Button";
import { Card } from "../../src/components/Card";
import { Composer } from "../../src/components/Composer";
import { EmptyState } from "../../src/components/EmptyState";
import { Screen } from "../../src/components/Screen";
import { SessionSwitcher } from "../../src/components/SessionSwitcher";
import { statusMeta } from "../../src/components/StatusChip";
import { Text } from "../../src/components/Text";
import { TranscriptItem } from "../../src/components/TranscriptItem";
import { useReducedMotion, usePressScale } from "../../src/lib/motion";
import { runStartIds, showJump } from "../../src/lib/tools";
import { useWorkbench, type Approval, type TranscriptItem as Item } from "../../src/lib/store";
import { color, easing, icon as iconSize, motion, opacity, radius, space, stroke, touch, type ColorRole } from "../../src/theme";

// Stable empties: a fresh `[]` each render would give zustand a new snapshot
// every time and spin the component.
const NO_ITEMS: Item[] = [];
const NO_ASKS: Approval[] = [];

/**
 * The session screen: transcript, the approval hero, and the composer.
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
  const markSeen = useWorkbench((s) => s.markSeen);

  // Twice on purpose: on arrival, and again on the way out. Everything that
  // landed while you were reading is read too — otherwise the list you go back
  // to shows an unread dot on the conversation you just closed.
  useFocusEffect(
    useCallback(() => {
      markSeen(id);
      return () => markSeen(id);
    }, [id, markSeen]),
  );

  const listRef = useRef<FlatList<Item>>(null);
  const [jump, setJump] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [menu, setMenu] = useState(false);
  const [switcher, setSwitcher] = useState(false);
  const insets = useSafeAreaInsets();

  // Inverted list wants newest first; the store keeps items oldest-first.
  const data = useMemo(() => [...items].reverse(), [items]);
  // Attribution is decided on the ORIGINAL order and answered in ids, so the
  // inversion above can never shift it by one. See runStartIds.
  const runs = useMemo(() => runStartIds(items), [items]);
  const status = session?.status;
  const offline = connState !== "online";
  // After a 4001 the client HALTED reconnection, so "reconnecting…" is a lie and
  // there is no path out but re-pairing. Split it from plain offline.
  const unauthorized = connState === "unauthorized";
  const current = asks[0];
  // The prompt this session was started with, as far as the phone can know it:
  // the daemon derives `title` from the prompt's first line. Blank on a dead
  // session — "here is what you asked" is a promise about something still going.
  const opening = status !== undefined && status !== "dead" ? (session?.title ?? null) : null;

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => setJump(showJump(e.nativeEvent.contentOffset.y));
  const toLatest = () => listRef.current?.scrollToOffset({ offset: 0, animated: true });
  // The title is the switcher's handle: which session this is, and the way to
  // any other one.
  const onTitlePress = () => setSwitcher(true);

  // Every route out of the conversation lives behind the one overflow button:
  // the header's job is what this session is and whether it wants you, and a
  // row of verbs next to that competes with the answer.
  const act = (fn: () => void) => () => {
    setMenu(false);
    fn();
  };
  const menuItems: MenuItem[] = [
    ...(session !== undefined
      ? [
          {
            icon: GitCompare,
            label: "Changes",
            onPress: act(() => router.push({ pathname: "/files", params: { diff: session.cwd } })),
          },
        ]
      : []),
    // Plain browse: the files screen only takes `diff`, so there is no cwd to
    // hand it — it opens on the daemon's roots.
    { icon: Folder, label: "Files here", onPress: act(() => router.push("/files")) },
    { icon: SquareTerminal, label: "Terminal here", onPress: act(() => router.push("/terminal")) },
    ...(status === "running"
      ? [{ icon: StopCircle, label: "Interrupt", tint: "danger" as ColorRole, onPress: act(() => setConfirmStop(true)) }]
      : []),
  ];

  return (
    <Screen>
      {/* One row: back, what this is, whether it wants you, everything else.
          Nothing overhangs — each control pays for its own 48. */}
      <View style={styles.header}>
        <BackButton />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={session?.title ?? "Session"}
          accessibilityHint="Opens the session switcher"
          onPress={onTitlePress}
          style={styles.titleBtn}
        >
          <Text variant="strong" numberOfLines={1} style={styles.titleText}>
            {session?.title ?? "Session"}
          </Text>
          <ChevronDown size={iconSize.sm} color={color.textMut} strokeWidth={stroke.icon} />
        </Pressable>
        {status !== undefined && (
          // The word alone, in the status colour: the chip belongs to the list,
          // where six of them have to be told apart at a glance.
          <Text variant="micro" color={statusMeta(status).role} style={styles.status}>
            {statusMeta(status).label}
          </Text>
        )}
        <IconButton icon={MoreHorizontal} label="More actions" onPress={() => setMenu(true)} />
      </View>

      <SessionSwitcher open={switcher} currentId={id} onClose={() => setSwitcher(false)} />

      <OverflowMenu
        open={menu}
        onClose={() => setMenu(false)}
        items={menuItems}
        top={insets.top + space(2) + touch.min + space(1)}
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.transcript}>
          {data.length === 0 ? (
            // A live session always started from something you said, and the
            // transcript is only assembled from pushed events — so a phone that
            // was not connected when it started has nothing, and "No messages
            // yet" reads as if the session were empty. The title *is* the
            // opening prompt (the daemon takes its first line), so show it as
            // sent and say what is being waited for. Only when there is one:
            // a dead session with nothing to show keeps the neutral copy.
            opening !== null ? (
              <View style={styles.opening}>
                <TranscriptItem item={{ id: "opening", kind: "text", role: "user", text: opening }} />
                <Text variant="sub" color="textMut" style={styles.openingNote}>
                  {status === "running" ? "Waiting for the agent's first reply…" : "Nothing back yet."}
                </Text>
              </View>
            ) : (
              <EmptyState
                icon={MessageSquare}
                title="No messages yet"
                body="Anything you and the agent say in this session shows up here."
              />
            )
          ) : (
            <>
              <FlatList
                ref={listRef}
                inverted
                data={data}
                keyExtractor={(i) => i.id}
                renderItem={({ item }) => <TranscriptItem item={item} runStart={runs.has(item.id)} />}
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
                  <ArrowDown size={iconSize.sm} color={color.text} strokeWidth={stroke.icon} />
                  <Text variant="micro">Latest</Text>
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
            total={asks.length}
            onDecide={(allow) => void approve(id, current.requestId, allow).catch(() => {})}
          />
        )}

        {status === "dead" && !unauthorized && (
          <View style={styles.banner}>
            <Text variant="sub" color="textMut">
              Session ended — send a message to start it again.
            </Text>
          </View>
        )}

        {unauthorized && (
          <View style={[styles.banner, styles.repair]}>
            <View style={styles.repairText}>
              <ShieldAlert size={iconSize.sm} color={color.textMut} strokeWidth={stroke.icon} />
              <Text variant="sub" color="textMut" style={styles.flex}>
                This PC turned the phone away — re-pair to answer here again.
              </Text>
            </View>
            <Button
              label="Re-pair"
              variant="outline"
              onPress={() => router.push({ pathname: "/pair", params: { edit: "1" } })}
            />
          </View>
        )}

        <Composer
          onSend={(text) => send(id, text)}
          disabled={offline}
          hint={
            unauthorized
              ? "This PC turned the phone away — re-pair to send."
              : offline
                ? "Offline — reconnecting to your PC…"
                : undefined
          }
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}

type MenuItem = { icon: LucideIcon; label: string; tint?: ColorRole; onPress(): void };

/**
 * The header's overflow. A transparent modal so a tap anywhere else dismisses
 * it, with the card anchored under the button that opened it — it grows from
 * where it came from (0.97, not 0: a menu that inflates from nothing reads as a
 * cartoon) and leaves faster than it arrived.
 */
function OverflowMenu({ open, onClose, items, top }: { open: boolean; onClose(): void; items: MenuItem[]; top: number }) {
  const reduced = useReducedMotion();
  // The modal has to outlive `open` for the exit to be seen at all.
  const [mounted, setMounted] = useState(open);
  const anim = useRef(new Animated.Value(0)).current;
  // Tracks whether the menu has actually opened, so first mount (open === false)
  // doesn't play the exit tween for a menu that was never shown.
  const everOpened = useRef(open);

  useEffect(() => {
    if (open) {
      everOpened.current = true;
      setMounted(true);
      Animated.timing(anim, { toValue: 1, duration: motion.base, easing: easing.out, useNativeDriver: true }).start();
      return;
    }
    if (!everOpened.current) return;
    Animated.timing(anim, { toValue: 0, duration: motion.exit, useNativeDriver: true }).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [open, anim]);

  if (!mounted) return null;
  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close menu" style={styles.backdrop} onPress={onClose} />
      <Animated.View
        style={[
          styles.menu,
          { top },
          {
            opacity: anim,
            // Reduce motion: the fade stays, the scale goes.
            transform: reduced ? [] : [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) }],
          },
        ]}
      >
        {items.map((it) => (
          <MenuRow key={it.label} item={it} />
        ))}
      </Animated.View>
    </Modal>
  );
}

function MenuRow({ item }: { item: MenuItem }) {
  const press = usePressScale();
  const Icon = item.icon;
  const role = item.tint ?? "text";
  return (
    <Animated.View style={{ transform: [{ scale: press.scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={item.label}
        onPress={item.onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={styles.menuRow}
      >
        <Icon size={iconSize.md} color={color[role]} strokeWidth={stroke.icon} />
        <Text variant="body" color={role}>
          {item.label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

// A bare 48pt glyph button. No negative margin: a hit box that hangs outside the
// header's frame is not delivered touches on Android.
function IconButton({ icon: Icon, label, onPress }: { icon: LucideIcon; label: string; onPress(): void }) {
  const press = usePressScale();
  return (
    <Animated.View style={{ transform: [{ scale: press.scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={styles.iconBtn}
      >
        <Icon size={iconSize.lg} color={color.text} strokeWidth={stroke.icon} />
      </Pressable>
    </Animated.View>
  );
}

const Separator = () => <View style={styles.separator} />;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingTop: space(2) },
  titleBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: space(1),
    minHeight: touch.min,
    paddingHorizontal: space(1),
  },
  titleText: { flexShrink: 1 },
  status: { flexShrink: 0, paddingHorizontal: space(1) },
  iconBtn: { width: touch.min, height: touch.min, alignItems: "center", justifyContent: "center" },
  backdrop: { flex: 1 },
  menu: {
    position: "absolute",
    right: space(4),
    minWidth: space(44),
    paddingVertical: space(1),
    backgroundColor: color.surface,
    borderRadius: radius.card,
    borderWidth: stroke.hairline,
    borderColor: color.border,
  },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(3),
    minHeight: touch.min,
    paddingHorizontal: space(4),
  },
  transcript: { flex: 1 },
  opening: { paddingVertical: space(2), gap: space(1) },
  openingNote: { textAlign: "right" },
  listContent: { paddingVertical: space(2) },
  separator: { height: space(4) },
  jump: {
    position: "absolute",
    alignSelf: "center",
    bottom: space(3),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    minHeight: touch.min,
    gap: space(2),
    paddingHorizontal: space(4),
    borderRadius: radius.pill,
    backgroundColor: color.surfaceHi,
    borderWidth: stroke.hairline,
    borderColor: color.border,
  },
  confirm: { gap: space(2), marginBottom: space(3) },
  confirmButtons: { flexDirection: "row", gap: space(3), marginTop: space(1) },
  banner: {
    marginBottom: space(2),
    paddingVertical: space(2),
    paddingHorizontal: space(3),
    borderRadius: radius.card,
    backgroundColor: color.surface,
    borderWidth: stroke.hairline,
    borderColor: color.border,
  },
  repair: { gap: space(2) },
  repairText: { flexDirection: "row", alignItems: "center", gap: space(2) },
});
