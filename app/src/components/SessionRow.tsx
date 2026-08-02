import { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { Asterisk, SquareTerminal } from "lucide-react-native";
import type { SessionRow as Session } from "@shared/protocol";

import { relativeTime } from "../lib/groups";
import { useReducedMotion, usePressScale } from "../lib/motion";
import { color, easing, icon as iconSize, motion, radius, space, stroke, touch } from "../theme";
import { Card } from "./Card";
import { MonoText } from "./MonoText";
import { StatusChip } from "./StatusChip";
import { Text } from "./Text";

export type SessionRowProps = {
  session: Session;
  /** Moved since you last looked at it — an 8pt dot on the mark, nothing else. */
  unread?: boolean;
  /** First-paint stagger, in ms. Decorative: the row is pressable throughout. */
  delay?: number;
};

/**
 * One session in the list. Journey principle 1: a waiting session has to be
 * findable without reading — the amber edge and the filled chip do that before
 * the eye reaches the words that say so.
 */
export function SessionRow({ session, unread = false, delay = 0 }: SessionRowProps) {
  const waiting = session.status === "waiting_on_user";
  const Glyph = session.agent === "claude" ? Asterisk : SquareTerminal;
  const reduced = useReducedMotion();
  const press = usePressScale();
  // 0 = below and faded, 1 = in place.
  const enter = useRef(new Animated.Value(reduced ? 1 : 0)).current;

  useEffect(() => {
    // `reduced` resolves async (false on the first render), so seeding the value
    // is not enough — snap when it lands true.
    if (reduced) {
      enter.setValue(1);
      return;
    }
    Animated.timing(enter, {
      toValue: 1,
      duration: motion.base,
      delay,
      easing: easing.out,
      useNativeDriver: true,
    }).start();
  }, [reduced, enter, delay]);

  return (
    <Pressable
      accessibilityRole="button"
      // The whole row, not the chip: a thumb aims at the title.
      // replaceAll, not replace: "waiting_on_user" has two underscores, and the
      // single-argument form left a screen reader saying "waiting on_user".
      accessibilityLabel={`${session.title}, ${session.status.replaceAll("_", " ")}${unread ? ", unread" : ""}`}
      onPress={() => router.push({ pathname: "/session/[id]", params: { id: session.sessionId } })}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
    >
      <Animated.View
        style={{
          opacity: enter,
          transform: [
            { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [space(2), 0] }) },
            { scale: press.scale },
          ],
        }}
      >
        <Card accentEdge={waiting ? "warn" : undefined} style={styles.card}>
          <View style={styles.row}>
            <View style={styles.mark}>
              <Glyph size={iconSize.md} color={color.text} strokeWidth={stroke.icon} />
              {unread && <View style={styles.dot} />}
            </View>
            <View style={styles.body}>
              <View style={styles.head}>
                {/* Two lines: the title is the only thing that says what this
                    session is, and one line truncates most real prompts. */}
                <Text variant="strong" numberOfLines={2} style={styles.flex}>
                  {session.title}
                </Text>
                <Text variant="meta" color="textMut" style={styles.time}>
                  {relativeTime(session.updatedAt, new Date())}
                </Text>
              </View>
              <View style={styles.foot}>
                {/* Head-ellipsis: the drive is the same on every row, the tail
                    (…\api-server) is the project. */}
                <MonoText numberOfLines={1} ellipsizeMode="head" style={styles.flex}>
                  {session.cwd}
                </MonoText>
                <StatusChip status={session.status} />
              </View>
            </View>
          </View>
        </Card>
      </Animated.View>
    </Pressable>
  );
}

const MARK = space(10);
const DOT = space(2);

const styles = StyleSheet.create({
  card: { minHeight: touch.min, padding: space(3), justifyContent: "center" },
  row: { flexDirection: "row", gap: space(3) },
  mark: {
    width: MARK,
    height: MARK,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.card,
    borderWidth: stroke.hairline,
    borderColor: color.border,
    backgroundColor: color.surfaceHi,
  },
  dot: {
    position: "absolute",
    top: -space(1),
    right: -space(1),
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: color.info,
  },
  body: { flex: 1, gap: space(2) },
  // Top-aligned: the age belongs to the title's first line, not to the middle
  // of a two-line title.
  head: { flexDirection: "row", alignItems: "flex-start", gap: space(3) },
  // Tighter than the head's gap: every point here is a point of the folder path
  // that survives, and the chip is unmistakable at 8pt of clearance.
  foot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space(2) },
  flex: { flex: 1 },
  // The title gives up width, never the age — "34m" wrapping is what pushes the
  // title's ellipsis in for no reason.
  time: { flexShrink: 0 },
});
