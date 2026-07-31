import { memo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Terminal, Wrench } from "lucide-react-native";

import type { TranscriptItem as Item } from "../lib/store";
import { collapse } from "../lib/tools";
import { color, icon as iconSize, opacity, radius, space, stroke } from "../theme";
import { MonoText } from "./MonoText";
import { Text } from "./Text";

/**
 * One rendered transcript line. The store keeps items as a union so the look of
 * a tool call or a cost is the UI's call, not a string baked in the store.
 */
export const TranscriptItem = memo(function TranscriptItem({ item }: { item: Item }) {
  if (item.kind === "text") return <Bubble role={item.role} text={item.text} />;
  if (item.kind === "tool") return <ToolLine name={item.name} summary={item.summary} />;
  return <DoneMarker ok={item.ok} costUsd={item.costUsd} />;
});

// User text is a right-aligned bubble on a raised, accent-edged surface — "you"
// said this. Assistant text is plain on the background: the transcript is mostly
// the agent talking, and bubbling every line would fence it in for nothing.
function Bubble({ role, text }: { role: "assistant" | "user"; text: string }) {
  if (role === "assistant")
    return (
      <View style={styles.assistantWrap}>
        <Text variant="body">{text}</Text>
      </View>
    );
  return (
    <View style={styles.userRow}>
      <View style={styles.userBubble}>
        <Text variant="body">{text}</Text>
      </View>
    </View>
  );
}

// A tool call is machine text: mono, muted, one wrench (a terminal for Bash). A
// long summary shows its first line and how many it hid until a tap opens it.
function ToolLine({ name, summary }: { name: string; summary: string }) {
  const [open, setOpen] = useState(false);
  const c = collapse(summary);
  const Icon = name === "Bash" ? Terminal : Wrench;
  const body = !c.collapsible || open ? summary : c.first;
  return (
    <Pressable
      accessibilityRole={c.collapsible ? "button" : "text"}
      accessibilityLabel={c.collapsible ? `${name}: ${open ? "collapse" : "expand"}` : undefined}
      disabled={!c.collapsible}
      onPress={() => setOpen((o) => !o)}
      style={({ pressed }) => [styles.toolRow, pressed && c.collapsible && { opacity: opacity.pressed }]}
    >
      <Icon size={iconSize.sm} color={color.textMut} strokeWidth={stroke.icon} style={styles.toolIcon} />
      <View style={styles.toolBody}>
        <MonoText>{body}</MonoText>
        {c.collapsible && !open && (
          <Text variant="sub" color="info">
            …{c.hidden} more lines
          </Text>
        )}
      </View>
    </Pressable>
  );
}

// The end of a turn: a quiet centred rule so the eye can find where one run
// stopped, with the cost when the daemon reported one.
function DoneMarker({ ok, costUsd }: { ok: boolean; costUsd: number | null }) {
  const cost = costUsd !== null ? ` · $${costUsd.toFixed(2)}` : "";
  return (
    <View style={styles.doneRow}>
      <View style={styles.rule} />
      <Text variant="sub" color="textMut">
        {ok ? "Finished" : "Ended"}
        {cost}
      </Text>
      <View style={styles.rule} />
    </View>
  );
}

const styles = StyleSheet.create({
  assistantWrap: { paddingVertical: space(1) },
  userRow: { flexDirection: "row", justifyContent: "flex-end" },
  userBubble: {
    maxWidth: "88%",
    backgroundColor: color.surfaceHi,
    borderWidth: stroke.hairline,
    borderColor: color.accent,
    borderRadius: radius.card,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
  },
  toolRow: { flexDirection: "row", gap: space(2), paddingVertical: space(1) },
  toolIcon: { marginTop: space(0.5) },
  toolBody: { flexShrink: 1, gap: space(0.5) },
  doneRow: { flexDirection: "row", alignItems: "center", gap: space(3), paddingVertical: space(2) },
  rule: { flex: 1, height: stroke.hairline, backgroundColor: color.border },
});
