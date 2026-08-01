import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { FileX2 } from "lucide-react-native";

import {
  counts,
  fileLabel,
  lineCount,
  parseDiff,
  planRows,
  tooLargeToRender,
  type DiffFile,
  type DiffHunk,
  type DiffLine,
} from "../lib/diff";
import { color, icon as iconSize, opacity, radius, space, stroke, tint, touch } from "../theme";
import { MonoText } from "./MonoText";
import { SideScroll } from "./SideScroll";
import { Text } from "./Text";

/**
 * A unified diff, per file. Adds are accent-tinted, deletes danger-tinted, and
 * every line keeps its number — the three things you need to review a change on
 * a phone. Code never wraps and never clips: each hunk scrolls sideways.
 *
 * A diff past RENDER_LINE_LIMIT lines (a regenerated lockfile, say) drops to
 * per-file totals: laying out tens of thousands of views at once would freeze
 * the screen, and totals are what you can act on from a phone anyway.
 */
export function DiffView({ diff }: { diff: string }) {
  const files = useMemo(() => parseDiff(diff), [diff]);
  const huge = useMemo(() => tooLargeToRender(files), [files]);

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
      {huge && (
        <Text variant="sub" color="warn">
          This diff is too large to render in full ({files.length} {files.length === 1 ? "file" : "files"}, ~
          {lineCount(files)} lines). Showing per-file totals only.
        </Text>
      )}
      {files.map((f, i) => (
        <FileSection key={`${f.oldPath}>${f.newPath}#${i}`} file={f} summaryOnly={huge} />
      ))}
    </View>
  );
}

function FileSection({ file, summaryOnly }: { file: DiffFile; summaryOnly: boolean }) {
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
      ) : summaryOnly ? null : (
        file.hunks.map((h, i) => <Hunk key={`${h.header}#${i}`} hunk={h} />)
      )}
    </View>
  );
}

function Hunk({ hunk }: { hunk: DiffHunk }) {
  // Keyed by the index the run starts at — stable for a given hunk.
  const [open, setOpen] = useState<readonly number[]>([]);

  const rows = useMemo(() => planRows(hunk.lines, open), [hunk.lines, open]);

  return (
    <View style={styles.hunk}>
      {/* One sideways scroll per hunk: the rows stretch to the widest of them,
          so a tint runs the full width of the longest line rather than stopping
          where its own text ends. minWidth keeps short hunks full-bleed too.
          The @@ header rides inside it — outside, it truncated. */}
      <SideScroll fade={color.surface} contentContainerStyle={styles.wide}>
        <View>
          <View style={styles.hunkHead}>
            <MonoText>{hunk.header}</MonoText>
          </View>
          {rows.map((r) =>
            r.kind === "fold" ? (
              <Fold key={`f${r.at}`} n={r.n} onPress={() => setOpen((o) => [...o, r.at])} />
            ) : (
              <Row key={`l${r.at}`} line={r.line} />
            ),
          )}
        </View>
      </SideScroll>
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
  // Wide enough to clear SideScroll's edge fade, so the last character of the
  // longest line is not dimmed once you have scrolled all the way to it.
  code: { paddingRight: space(6) },

  // ≥48 so a thumb can open a collapsed run without a second try.
  fold: { minHeight: touch.min, justifyContent: "center", paddingLeft: space(9), paddingRight: space(4) },
});
