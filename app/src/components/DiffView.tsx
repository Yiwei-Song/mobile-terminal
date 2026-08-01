import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { FileX2 } from "lucide-react-native";

import { counts, fileLabel, parseDiff, type DiffFile, type DiffHunk, type DiffLine } from "../lib/diff";
import { color, icon as iconSize, opacity, radius, space, stroke, tint, touch } from "../theme";
import { MonoText } from "./MonoText";
import { Text } from "./Text";

// Longer than this and a run of untouched lines is scenery, not context.
const COLLAPSE_OVER = 6;

/**
 * A unified diff, per file. Adds are accent-tinted, deletes danger-tinted, and
 * every line keeps its number — the three things you need to review a change on
 * a phone. Code never wraps and never clips: each hunk scrolls sideways.
 */
export function DiffView({ diff }: { diff: string }) {
  const files = useMemo(() => parseDiff(diff), [diff]);

  if (files.length === 0)
    return (
      <View style={styles.none}>
        <FileX2 size={iconSize.xl} color={color.idle} strokeWidth={stroke.icon} />
        <Text variant="body" color="textMut" style={styles.center}>
          No changes.
        </Text>
      </View>
    );

  return (
    <View style={styles.stack}>
      {files.map((f, i) => (
        <FileSection key={`${f.oldPath}>${f.newPath}#${i}`} file={f} />
      ))}
    </View>
  );
}

function FileSection({ file }: { file: DiffFile }) {
  const { path, note } = fileLabel(file);
  const { add, del } = counts(file);
  return (
    <View style={styles.file}>
      <View style={styles.fileHead}>
        <MonoText color="text" style={styles.flex}>
          {path}
        </MonoText>
        <View style={styles.tallies}>
          <MonoText color="accent">+{add}</MonoText>
          {/* U+2212, not a hyphen: it lines up with the + at mono width. */}
          <MonoText color="danger">−{del}</MonoText>
        </View>
      </View>
      {note !== null && (
        <Text variant="sub" color="textMut">
          {note}
        </Text>
      )}
      {file.binary ? (
        <Text variant="sub" color="textMut">
          Binary file — no line-by-line view.
        </Text>
      ) : (
        file.hunks.map((h, i) => <Hunk key={`${h.header}#${i}`} hunk={h} />)
      )}
    </View>
  );
}

function Hunk({ hunk }: { hunk: DiffHunk }) {
  // Keyed by the index the run starts at — stable for a given hunk.
  const [open, setOpen] = useState<readonly number[]>([]);

  const rows: React.ReactNode[] = [];
  for (let i = 0; i < hunk.lines.length; ) {
    if (hunk.lines[i]!.type !== "ctx") {
      rows.push(<Row key={`l${i}`} line={hunk.lines[i]!} />);
      i++;
      continue;
    }
    // The whole run is one decision: collapsed or not. Deciding per line would
    // re-fold the tail of a run the user just opened.
    let j = i;
    while (j < hunk.lines.length && hunk.lines[j]!.type === "ctx") j++;
    if (j - i > COLLAPSE_OVER && !open.includes(i)) {
      const from = i;
      rows.push(<Fold key={`fold${from}`} n={j - i} onPress={() => setOpen((o) => [...o, from])} />);
    } else {
      for (let k = i; k < j; k++) rows.push(<Row key={`l${k}`} line={hunk.lines[k]!} />);
    }
    i = j;
  }

  return (
    <View style={styles.hunk}>
      <View style={styles.hunkHead}>
        <MonoText numberOfLines={1}>{hunk.header}</MonoText>
      </View>
      {/* One sideways scroll per hunk: the rows stretch to the widest of them,
          so a tint runs the full width of the longest line rather than stopping
          where its own text ends. minWidth keeps short hunks full-bleed too. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.wide}>
        <View>{rows}</View>
      </ScrollView>
    </View>
  );
}

const SIGN: Record<DiffLine["type"], string> = { add: "+", del: "−", ctx: " " };

function Row({ line }: { line: DiffLine }) {
  // One gutter, not two: on a 390pt screen a second number column costs more
  // than it tells. An added line numbers in the new file, a deleted one in the
  // old, and context is the same line in both.
  const no = line.newNo ?? line.oldNo;
  return (
    <View style={[styles.row, line.type === "add" && styles.add, line.type === "del" && styles.del]}>
      <MonoText style={styles.gutter}>{no === undefined ? "" : String(no)}</MonoText>
      <MonoText color={line.type === "ctx" ? "textMut" : "text"} style={styles.code}>
        {SIGN[line.type]}
        {line.text}
      </MonoText>
    </View>
  );
}

function Fold({ n, onPress }: { n: number; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Show ${n} unchanged lines`}
      onPress={onPress}
      style={({ pressed }) => [styles.fold, pressed && { opacity: opacity.pressed }]}
    >
      <MonoText>… {n} unchanged</MonoText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: "center" },
  none: { alignItems: "center", gap: space(3), paddingVertical: space(8) },

  stack: { gap: space(4) },
  file: {
    gap: space(2),
    borderWidth: stroke.hairline,
    borderColor: color.border,
    borderRadius: radius.card,
    backgroundColor: color.surface,
    padding: space(3),
  },
  fileHead: { flexDirection: "row", alignItems: "center", gap: space(2) },
  tallies: { flexDirection: "row", gap: space(2) },

  hunk: { borderTopWidth: stroke.hairline, borderTopColor: color.border, paddingTop: space(1) },
  hunkHead: { paddingVertical: space(1) },
  wide: { minWidth: "100%" },

  row: { flexDirection: "row", alignItems: "center", paddingVertical: space(0.25) },
  add: { backgroundColor: tint.add },
  del: { backgroundColor: tint.del },
  gutter: { width: space(9), textAlign: "right", paddingRight: space(2) },
  code: { paddingRight: space(4) },

  // ≥48 so a thumb can open a collapsed run without a second try.
  fold: { minHeight: touch.min, justifyContent: "center", paddingLeft: space(9), paddingRight: space(4) },
});
