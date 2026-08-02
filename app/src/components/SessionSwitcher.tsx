import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Asterisk, Check, Plus, SquareTerminal } from "lucide-react-native";
import type { SessionRow as Session } from "@shared/protocol";

import { groupSessions } from "../lib/groups";
import { useReducedMotion, usePressScale } from "../lib/motion";
import { useWorkbench } from "../lib/store";
import { color, easing, icon as iconSize, motion, radius, space, stroke, touch } from "../theme";
import { MonoText } from "./MonoText";
import { statusMeta } from "./StatusChip";
import { Text } from "./Text";

// The 300ms entrance is the drawer budget from the redesign spec and is NOT a
// theme token (this task was allowed exactly one theme addition, radius.sheet);
// the 250ms exit is `motion.slow`.
const ENTER_MS = 300;
// A scrim, not a surface: black at 40% is the only thing in the app that isn't
// on the neutral ramp, because the ramp is what it has to dim.
const SCRIM = 0.4;
// Release thresholds. px/ms downward, and how far down it has to have travelled
// for a slow drag to count as "let go of it" rather than "changed my mind".
const FLICK = 0.5;
const DISMISS_AT = 0.4;
// Nearly critical (2*sqrt(300) = 34.6): carries the finger's speed out without
// a bounce, which on a sheet reads as a bug rather than as physics.
const SPRING = { stiffness: 300, damping: 34, mass: 1 } as const;

export type SessionSwitcherProps = {
  open: boolean;
  /** The session the screen behind the sheet is showing — marked, not moved. */
  currentId: string;
  onClose(): void;
};

/**
 * The mobile answer to the desktop sidebar: every session, one thumb-reach from
 * the conversation you are in. Reads the store itself — the header that opens it
 * only knows which session it is.
 *
 * Motion is gesture-first: the sheet tracks the finger 1:1 and a release is
 * answered with a spring that carries the release velocity, so an interrupted
 * drag never cuts. `t` runs 0 (gone) to 1 (open) and drives translate, both
 * opacities and the gesture alike — one value, so nothing can disagree.
 */
export function SessionSwitcher({ open, currentId, onClose }: SessionSwitcherProps) {
  const sessions = useWorkbench((s) => s.sessions);
  const reduced = useReducedMotion();
  const newPress = usePressScale();
  const insets = useSafeAreaInsets();
  const { height: screen } = useWindowDimensions();

  // The modal has to outlive `open` for the exit to be seen at all.
  const [mounted, setMounted] = useState(open);
  // How far the sheet has to travel. Unknown until it has laid out once, which
  // is why the enter waits for it rather than guessing a screen height.
  const [height, setHeight] = useState(0);
  const t = useRef(new Animated.Value(0)).current;
  const cur = useRef(0);
  // Where the sheet was when this drag caught it, and how far it has to travel —
  // both read inside the gesture, so both are refs: a PanResponder rebuilt
  // mid-drag loses its own gestureState and the sheet jumps.
  const startT = useRef(0);
  const heightRef = useRef(0);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const dragging = useRef(false);
  const everOpened = useRef(open);
  // Set when the drag itself dismissed the sheet: the spring already played, so
  // the `open -> false` that follows must not start a second exit over it.
  const selfClosed = useRef(false);

  // The gesture reads the current value; a native-driven value can only be read
  // through a listener, and reading it is what makes an interrupted drag start
  // from where the animation had got to.
  useEffect(() => {
    const id = t.addListener(({ value }) => {
      cur.current = value;
    });
    return () => t.removeListener(id);
  }, [t]);

  // How far the sheet travels is not known until it has laid out once, so the
  // first entrance is started BY the layout, not by an effect waiting on it.
  const enter = useCallback(() => {
    Animated.timing(t, { toValue: 1, duration: ENTER_MS, easing: easing.drawer, useNativeDriver: true }).start();
  }, [t]);

  useEffect(() => {
    if (open) {
      everOpened.current = true;
      setMounted(true);
      // Already measured (every open after the first): go now. The first one is
      // started from onLayout below.
      if (heightRef.current > 0) enter();
      return;
    }
    if (!everOpened.current) return;
    if (selfClosed.current) {
      selfClosed.current = false;
      return;
    }
    Animated.timing(t, { toValue: 0, duration: motion.slow, easing: easing.drawer, useNativeDriver: true }).start(
      ({ finished }) => {
        if (finished) setMounted(false);
      },
    );
  }, [open, enter, t]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Claim on movement, not on touch: a tap on the header is not a drag.
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 2,
        onPanResponderGrant: () => {
          dragging.current = true;
          // Interruptible: whatever was animating stops where it is, and the
          // finger picks the sheet up from exactly there.
          t.stopAnimation();
          startT.current = cur.current;
        },
        onPanResponderMove: (_e, g) => {
          const h = heightRef.current;
          if (h === 0) return;
          // 1:1 with the finger, from wherever the sheet was when it was caught.
          // Clamped at 1: this sheet does not rubber-band upward, it is already
          // as far up as it goes.
          t.setValue(Math.min(1, Math.max(0, startT.current - g.dy / h)));
        },
        onPanResponderRelease: (_e, g) => {
          dragging.current = false;
          const h = heightRef.current;
          // gestureState.vy is px/ms and positive downward; Animated wants the
          // value's own units per second, and down means t decreasing.
          const velocity = h === 0 ? 0 : (-g.vy * 1000) / h;
          const gone = g.vy > FLICK || cur.current < 1 - DISMISS_AT;
          Animated.spring(t, {
            toValue: gone ? 0 : 1,
            velocity,
            ...SPRING,
            useNativeDriver: true,
          }).start(({ finished }) => {
            if (!finished || !gone) return;
            selfClosed.current = true;
            setMounted(false);
            closeRef.current();
          });
        },
        onPanResponderTerminate: () => {
          dragging.current = false;
          Animated.spring(t, { toValue: 1, ...SPRING, useNativeDriver: true }).start();
        },
      }),
    [t],
  );

  // needsYou, then working, then recent — the list screen's own order, and the
  // current session stays where it falls in it. Moving it to the top would make
  // the sheet reorder itself every time you switched.
  const rows = useMemo(() => {
    const g = groupSessions(sessions);
    return [...g.needsYou, ...g.working, ...g.recent];
  }, [sessions]);

  const go = (id: string) => {
    onClose();
    // replace, not push: switching sessions, not stacking them. Going back from
    // the fifth session you looked at should leave the conversation, not walk
    // the four before it.
    if (id !== currentId) router.replace({ pathname: "/session/[id]", params: { id } });
  };

  if (!mounted) return null;
  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose}>
      <View style={styles.fill}>
        <Animated.View style={[styles.scrim, { opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0, SCRIM] }) }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close session switcher"
            style={styles.fill}
            onPress={onClose}
          />
        </Animated.View>

        <Animated.View
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            const first = heightRef.current === 0;
            heightRef.current = h;
            setHeight(h);
            if (first && open) enter();
          }}
          style={[
            styles.sheet,
            { maxHeight: screen * 0.7, paddingBottom: insets.bottom + space(2) },
            // Reduce motion: the sheet arrives by fading, and the handle stops
            // being a drag target — nothing slides.
            reduced
              ? { opacity: t }
              : {
                  // `|| screen` covers the frame before the first layout: at 0
                  // the sheet would sit at rest with t still 0 and flash.
                  transform: [
                    { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [height || screen, 0] }) },
                  ],
                },
          ]}
        >
          <View {...(reduced ? {} : pan.panHandlers)}>
            <View style={styles.handle} />
            <View style={styles.head}>
              <Text variant="h2">Switch session</Text>
              <Text variant="micro" color="textMut">
                {rows.length === 1 ? "1 session" : `${rows.length} sessions`}
              </Text>
            </View>
          </View>

          {/* flexShrink, not flex: the sheet is as tall as its rows until they
              outgrow the 70% cap, and only then does this scroll. */}
          <ScrollView style={styles.list}>
            {rows.map((s) => (
              <Row key={s.sessionId} session={s} current={s.sessionId === currentId} onPress={() => go(s.sessionId)} />
            ))}
          </ScrollView>

          {/* Outside the scroller: starting one is always one thumb away, however
              many sessions are already running. */}
          <Animated.View style={{ transform: [{ scale: newPress.scale }] }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="New session"
              style={styles.row}
              onPressIn={newPress.onPressIn}
              onPressOut={newPress.onPressOut}
              onPress={() => {
                onClose();
                router.push("/new");
              }}
            >
              <View style={styles.tile}>
                <Plus size={iconSize.md} color={color.text} strokeWidth={stroke.icon} />
              </View>
              <Text variant="strong">New session</Text>
            </Pressable>
          </Animated.View>
        </Animated.View>
      </View>
    </Modal>
  );
}

/** One session in the sheet. Same glyph rule as the list, so a session looks
 *  like itself wherever you meet it. */
function Row({ session, current, onPress }: { session: Session; current: boolean; onPress(): void }) {
  const press = usePressScale();
  const Glyph = session.agent === "claude" ? Asterisk : SquareTerminal;
  const meta = statusMeta(session.status);
  return (
    <Animated.View style={{ transform: [{ scale: press.scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${session.title}, ${session.status.replaceAll("_", " ")}${current ? ", current session" : ""}`}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={[styles.row, current && styles.rowCurrent]}
      >
        <View style={styles.tile}>
          <Glyph size={iconSize.md} color={color.text} strokeWidth={stroke.icon} />
        </View>
        <View style={styles.body}>
          <Text variant="strong" numberOfLines={1}>
            {session.title}
          </Text>
          {/* Head-ellipsis: the drive is the same on every row, the tail is the
              project — same call the list makes. */}
          <MonoText numberOfLines={1} ellipsizeMode="head">
            {session.cwd}
          </MonoText>
        </View>
        {current ? (
          <View style={styles.tag}>
            <Check size={iconSize.sm} color={color.accent} strokeWidth={stroke.icon} />
            <Text variant="micro" color="accent">
              Current
            </Text>
          </View>
        ) : (
          // The word in the status colour, no chip: the chip is the list's
          // device, where six of them compete. Here you already chose to look.
          <Text variant="micro" color={meta.role} style={styles.status}>
            {meta.label}
          </Text>
        )}
      </Pressable>
    </Animated.View>
  );
}

const TILE = space(8);
const HANDLE = { w: space(9), h: 4 };

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#000000" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: color.surface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingTop: space(2),
  },
  handle: {
    alignSelf: "center",
    width: HANDLE.w,
    height: HANDLE.h,
    borderRadius: radius.pill,
    backgroundColor: color.borderHi,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space(3),
    paddingHorizontal: space(4),
    paddingTop: space(3),
    paddingBottom: space(2),
  },
  list: { flexShrink: 1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(3),
    minHeight: touch.min + space(3),
    paddingHorizontal: space(4),
    paddingVertical: space(2),
    borderTopWidth: stroke.hairline,
    borderTopColor: color.border,
  },
  rowCurrent: { backgroundColor: color.surfaceHi },
  tile: {
    width: TILE,
    height: TILE,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.card,
    borderWidth: stroke.hairline,
    borderColor: color.border,
    backgroundColor: color.surfaceHi,
  },
  body: { flex: 1, gap: space(0.5) },
  tag: { flexDirection: "row", alignItems: "center", gap: space(1), flexShrink: 0 },
  status: { flexShrink: 0 },
});
