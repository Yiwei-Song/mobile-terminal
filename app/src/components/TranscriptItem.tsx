import { memo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Asterisk, ChevronRight } from "lucide-react-native";

import type { TranscriptItem as Item } from "../lib/store";
import { collapse } from "../lib/tools";
import { color, icon as iconSize, opacity, radius, space, stroke, touch } from "../theme";
import { MonoText } from "./MonoText";
import { Text } from "./Text";

export type TranscriptItemProps = {
  item: Item;
  /** First agent item of a run — carries the CLAUDE attribution row. */
  runStart?: boolean;
};

/**
 * One rendered transcript line. The store keeps items as a union so the look of
 * a tool call or a cost is the UI's call, not a string baked in the store.
 *
 * Everything the agent produces is full-width prose on the background: the
 * transcript is mostly the agent talking, and bubbling every line would fence
 * in the one thing you came here to read. Only what YOU said is a block, and
 * only the run's first line is signed.
 */
export const TranscriptItem = memo(function TranscriptItem({ item, runStart = false }: TranscriptItemProps) {
  if (item.kind === "done") return <DoneMarker ok={item.ok} costUsd={item.costUsd} />;
  if (item.kind === "text" && item.role === "user") return <UserBlock text={item.text} />;
  return (
    <View style={styles.run}>
      {runStart && <Attribution />}
      {item.kind === "tool" ? (
        <ToolLine name={item.name} summary={item.summary} />
      ) : (
        <Text variant="body">{item.text}</Text>
      )}
    </View>
  );
});

// Who is talking, once per run rather than once per line. A mark and a word:
// the same tile the sessions list uses, one size down.
function Attribution() {
  return (
    <View style={styles.attribution}>
      <View style={styles.mark}>
        <Asterisk size={iconSize.sm} color={color.text} strokeWidth={stroke.icon} />
      </View>
      <Text variant="micro" color="textMut">
        Claude
      </Text>
    </View>
  );
}

// What you said, right-aligned on a raised block. No accent edge: in a
// conversation of two, the side of the screen already says who spoke.
function UserBlock({ text }: { text: string }) {
  return (
    <View style={styles.userRow}>
      <View style={styles.userBlock}>
        <Text variant="body">{text}</Text>
      </View>
    </View>
  );
}

// A tool call is machine text on its own chip: mono, prefixed with a chevron
// that doubles as the disclosure. A long summary shows its first line and how
// many it hid until a tap opens it.
function ToolLine({ name, summary }: { name: string; summary: string }) {
  const [open, setOpen] = useState(false);
  const c = collapse(summary);
  const body = !c.collapsible || open ? summary : c.first;
  return (
    <Pressable
      accessibilityRole={c.collapsible ? "button" : "text"}
      accessibilityLabel={c.collapsible ? `${name}: ${open ? "collapse" : "expand"}` : undefined}
      disabled={!c.collapsible}
      onPress={() => setOpen((o) => !o)}
      style={({ pressed }) => [styles.toolChip, pressed && c.collapsible && { opacity: opacity.pressed }]}
    >
      <ChevronRight size={iconSize.sm} color={color.textMut} strokeWidth={stroke.icon} style={styles.toolIcon} />
      <MonoText style={styles.toolBody}>
        {name}{" "}
        <MonoText color="text">{body}</MonoText>
        {c.collapsible && !open ? ` · ${c.hidden} more lines` : ""}
      </MonoText>
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
      <Text variant="meta" color="textMut">
        {ok ? "Finished" : "Ended"}
        {cost}
      </Text>
      <View style={styles.rule} />
    </View>
  );
}

const MARK = space(5);

const styles = StyleSheet.create({
  run: { gap: space(2) },
  attribution: { flexDirection: "row", alignItems: "center", gap: space(2) },
  mark: {
    width: MARK,
    height: MARK,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.card,
    backgroundColor: color.surfaceHi,
  },
  userRow: { flexDirection: "row", justifyContent: "flex-end" },
  userBlock: {
    maxWidth: "85%",
    backgroundColor: color.surfaceHi,
    borderRadius: radius.card,
    paddingHorizontal: space(4),
    paddingVertical: space(3),
  },
  toolChip: {
    flexDirection: "row",
    // center, not flex-start: collapsed single-line rows are the common state
    // and must sit on the chip's optical center; a tall expanded summary
    // floating its chevron is the rarer, cheaper compromise.
    alignItems: "center",
    gap: space(2),
    minHeight: touch.min,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    backgroundColor: color.surface,
    borderRadius: radius.card,
    borderWidth: stroke.hairline,
    borderColor: color.border,
  },
  toolIcon: { flexShrink: 0 },
  toolBody: { flexShrink: 1 },
  doneRow: { flexDirection: "row", alignItems: "center", gap: space(3), paddingVertical: space(2) },
  rule: { flex: 1, height: stroke.hairline, backgroundColor: color.border },
});
