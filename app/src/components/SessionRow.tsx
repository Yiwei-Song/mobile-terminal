import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import type { SessionRow as Session } from "@shared/protocol";

import { cwdTail, since } from "../lib/format";
import { opacity, space } from "../theme";
import { Card } from "./Card";
import { MonoText } from "./MonoText";
import { StatusChip } from "./StatusChip";
import { Text } from "./Text";

/**
 * One session in the home list. Journey principle 1: a waiting session has to
 * be findable without reading — amber edge and a raised surface do that before
 * the eye reaches the chip that says so in words.
 */
export function SessionRow({ session }: { session: Session }) {
  const waiting = session.status === "waiting_on_user";
  return (
    <Pressable
      accessibilityRole="button"
      // The whole row, not the chip: a thumb aims at the title.
      accessibilityLabel={`${session.title}, ${session.status.replace("_", " ")}`}
      onPress={() => router.push({ pathname: "/session/[id]", params: { id: session.sessionId } })}
      style={({ pressed }) => pressed && { opacity: opacity.pressed }}
    >
      <Card accentEdge={waiting ? "warn" : undefined} raised={waiting} style={styles.card}>
        <View style={styles.line}>
          {/* The row that needs the user is the one that can least afford to
              truncate: give the waiting title a second line, others stay at one. */}
          <Text variant="body" numberOfLines={waiting ? 2 : 1} style={styles.title}>
            {session.title}
          </Text>
          <Text variant="sub" color="textMut" numberOfLines={1} style={styles.time}>
            {since(session.updatedAt)}
          </Text>
        </View>
        <View style={styles.line}>
          {/* Truncated at the head by cwdTail, so what survives is the project. */}
          <MonoText numberOfLines={1} style={styles.cwd}>
            {cwdTail(session.cwd)}
          </MonoText>
          <StatusChip status={session.status} />
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { minHeight: space(14), gap: space(2), justifyContent: "center" },
  line: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space(3) },
  // flexShrink, not flex: the row is title-first, and the time/chip keep their
  // natural width so they never wrap.
  title: { flexShrink: 1 },
  cwd: { flexShrink: 1 },
  // The title gives up width, never the age — "just now" wrapping to two lines
  // is what pushes the title's ellipsis in for no reason.
  time: { flexShrink: 0 },
});
