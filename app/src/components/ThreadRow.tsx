import { Animated, Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { Asterisk, GitBranch, SquareTerminal } from "lucide-react-native";
import type { Thread } from "@shared/protocol";

import { relativeTime } from "../lib/groups";
import { resumeCount } from "../lib/projects";
import { usePressScale } from "../lib/motion";
import { color, icon as iconSize, radius, space, stroke, touch } from "../theme";
import { StatusChip } from "./StatusChip";
import { Text } from "./Text";

/**
 * One conversation inside a project.
 *
 * Deliberately lighter than `SessionRow`: that one is a card on the attention
 * screen, where a session has to be findable without reading. Here the project
 * header already carries the folder and the grouping, so a thread only needs its
 * name, its agent, its age and its state — a card per thread would turn sixty
 * threads into sixty boxes and lose the one thing this screen is for, which is
 * seeing a project's work at once.
 *
 * No entrance stagger either: a project expands under the user's own thumb, and
 * animating rows in behind a tap they just made delays the answer they asked for.
 */
export function ThreadRow({ thread }: { thread: Thread }) {
  const press = usePressScale();
  const Glyph = thread.agent === "claude" ? Asterisk : SquareTerminal;
  const resumed = resumeCount(thread);
  const waiting = thread.status === "waiting_on_user";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[
        thread.title,
        thread.agent,
        thread.status.replaceAll("_", " "),
        resumed > 0 ? `resumed ${resumed} ${resumed === 1 ? "time" : "times"}` : "",
      ]
        .filter(Boolean)
        .join(", ")}
      // The newest fork is the only id it is meaningful to open: resuming an
      // older one branches from stale history. The daemon already worked out
      // which that is — see discover.ts.
      onPress={() => router.push({ pathname: "/session/[id]", params: { id: thread.resumeId } })}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: color.surfaceHi }]}
    >
      {/* The scale has to reach a transform to exist. Wiring only the handlers
          ran the animation and threw it away, which left a tap on a thread with
          no press feedback at all — the background flash arrives on press state,
          not on the finger. */}
      <Animated.View style={[styles.face, { transform: [{ scale: press.scale }] }]}>
        {/* The amber rail is the same signal the session card uses, at rail width
            rather than card width — one vocabulary, two densities. */}
        <View style={[styles.rail, waiting && { backgroundColor: color.warn }]} />
        <Glyph size={iconSize.sm} color={waiting ? color.warn : color.text} strokeWidth={stroke.icon} />
        <View style={styles.body}>
          <Text variant="body" numberOfLines={1}>
            {thread.title}
          </Text>
          {resumed > 0 && (
            // Says out loud that several transcript files are one conversation —
            // otherwise the stitching is invisible and reads as missing sessions.
            <View style={styles.forks}>
              <GitBranch size={space(3)} color={color.textMut} strokeWidth={stroke.icon} />
              <Text variant="meta" color="textMut">
                resumed {resumed}×
              </Text>
            </View>
          )}
        </View>
        {/* Idle is the default state of almost every row here; a chip on each one
            would be sixty chips saying nothing. Only a live state earns one.
            Wrapped, because StatusChip sets `alignSelf: flex-start` — right in
            SessionRow's column, but in a centred row it pins the chip to the top
            edge and it floats above the title it belongs to. */}
        {thread.status !== "idle" && (
          <View style={styles.chip}>
            <StatusChip status={thread.status} />
          </View>
        )}
        <Text variant="meta" color="textMut" style={styles.time}>
          {relativeTime(thread.updatedAt, new Date())}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Indented past the project header's own glyph column: without it a thread
  // title started within 2pt of its project's title and the tree read flat, so
  // nothing on screen said which sessions belonged to which folder.
  row: { paddingLeft: space(4), borderRadius: radius.card },
  face: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    minHeight: touch.min,
    paddingRight: space(3),
  },
  // Centres the chip against the parent's alignItems, which StatusChip's own
  // `alignSelf: flex-start` would otherwise win against.
  chip: { justifyContent: "center" },
  // Always present, coloured only when waiting: a rail that appears and
  // disappears would shift every title sideways as statuses change.
  rail: { width: stroke.emphasis, alignSelf: "stretch", marginVertical: space(1), borderRadius: stroke.emphasis },
  body: { flex: 1, gap: space(1) },
  forks: { flexDirection: "row", alignItems: "center", gap: space(1) },
  time: { flexShrink: 0, minWidth: space(8), textAlign: "right" },
});
