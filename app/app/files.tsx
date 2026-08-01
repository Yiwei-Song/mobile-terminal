import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text as RNText, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { ChevronRight, File as FileIcon, Folder, FolderOpen, GitCompare, ShieldAlert, Wifi, WifiOff } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import type { Entry } from "@shared/protocol";

import { BackButton } from "../src/components/BackButton";
import { Button } from "../src/components/Button";
import { Card } from "../src/components/Card";
import { DiffView } from "../src/components/DiffView";
import { EmptyState } from "../src/components/EmptyState";
import { MonoText } from "../src/components/MonoText";
import { Screen } from "../src/components/Screen";
import { Text } from "../src/components/Text";
import { demoFs, demoMode, seedDemo } from "../src/lib/demo";
import { loadPairing, pairingUrl } from "../src/lib/pairing";
import { bytes, crumbs, cwdTail } from "../src/lib/format";
import { parseMarkdown, type MdBlock, type MdSpan } from "../src/lib/markdown";
import { useWorkbench } from "../src/lib/store";
import { color, font, icon as iconSize, opacity, radius, space, stroke, touch, tracking, type as typeScale } from "../src/theme";

/**
 * Files: browse the PC's allowed roots, read a file, and review what git says
 * changed. Read-only by design — the agents edit, the phone reviews.
 *
 * One screen, three views (browser → viewer → diff) because they are one
 * journey: the back arrow walks it backwards and the breadcrumb walks the tree.
 */
export default function Files() {
  // `diff=<cwd>` opens straight into the diff — that is how a session's Changes
  // action arrives, and for it Back means "back to the session", not "to a
  // folder this screen never showed".
  const params = useLocalSearchParams<{ diff?: string }>();
  const fromSession = params.diff !== undefined && params.diff !== "";

  const connState = useWorkbench((s) => s.connState);
  const roots = useWorkbench((s) => s.roots);
  const dir = useWorkbench((s) => s.dir);
  const entries = useWorkbench((s) => s.entries);
  const fileText = useWorkbench((s) => s.fileText);
  const diff = useWorkbench((s) => s.diff);
  const git = useWorkbench((s) => s.git);
  const lastError = useWorkbench((s) => s.lastError);
  const refreshRoots = useWorkbench((s) => s.refreshRoots);
  const listDir = useWorkbench((s) => s.listDir);
  const readFile = useWorkbench((s) => s.readFile);
  const loadDiff = useWorkbench((s) => s.loadDiff);
  const loadGitStatus = useWorkbench((s) => s.loadGitStatus);
  const connect = useWorkbench((s) => s.connect);

  // Demo mode has no socket, so the same four calls come from the seeded tree.
  const fs = useMemo(
    () => (demoMode ? demoFs : { refreshRoots, listDir, readFile, loadDiff, loadGitStatus }),
    [refreshRoots, listDir, readFile, loadDiff, loadGitStatus],
  );

  const [root, setRoot] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(fromSession);
  const [rendered, setRendered] = useState(true);
  const [busy, setBusy] = useState(false);

  const offline = connState !== "online";
  const unauthorized = connState === "unauthorized";

  useFocusEffect(
    useCallback(() => {
      if (demoMode) seedDemo();
      void fs.refreshRoots().catch(() => {});
      const cwd = params.diff;
      if (cwd !== undefined && cwd !== "") {
        void fs.loadDiff(cwd).catch(() => {});
        void fs.loadGitStatus(cwd);
      }
      // params.diff is a string from the URL and fs is stable per demo flag;
      // re-running on either is exactly the intent.
    }, [fs, params.diff]),
  );

  // Exactly one root is not a choice — descend into it. More than one and the
  // chips above the list are the picker.
  const activeRoot = root ?? (roots.length === 1 ? roots[0]! : null);

  useEffect(() => {
    if (activeRoot === null || dir !== null || showDiff) return;
    void fs
      .listDir(activeRoot)
      .then(() => void fs.loadGitStatus(activeRoot))
      .catch(() => {});
  }, [activeRoot, dir, showDiff, fs]);

  const openDir = (path: string) => {
    setViewing(null);
    setBusy(true);
    void fs
      .listDir(path)
      .then(() => void fs.loadGitStatus(path))
      .catch(() => {})
      .finally(() => setBusy(false));
  };

  const openFile = (path: string) => {
    setBusy(true);
    setRendered(true);
    void fs
      .readFile(path)
      .then(() => setViewing(path))
      .catch(() => {})
      .finally(() => setBusy(false));
  };

  const openDiff = (cwd: string) => {
    setBusy(true);
    void fs
      .loadDiff(cwd)
      .then(() => setShowDiff(true))
      .catch(() => {})
      .finally(() => setBusy(false));
  };

  // The same "try now" the other screens offer: connect() on the pairing we are
  // already on cancels the backoff and opens a socket immediately.
  const retry = () => {
    void loadPairing().then((p) => {
      if (p !== null) connect(pairingUrl(p), p.token);
    });
  };

  const back = () => {
    if (viewing !== null) return setViewing(null);
    if (showDiff && !fromSession) return setShowDiff(false);
    if (!showDiff && viewing === null && dir !== null && roots.length > 1 && dir === activeRoot) {
      // At the top of a root with siblings to pick from: back means the picker.
      setRoot(null);
      useWorkbench.setState({ dir: null, entries: [] });
      return;
    }
    router.back();
  };

  const trail = useMemo(
    () => (activeRoot === null || dir === null ? [] : crumbs(activeRoot, dir)),
    [activeRoot, dir],
  );

  const title = showDiff
    ? "Changes"
    : viewing !== null
      ? (viewing.split(/[\\/]/).pop() ?? "File")
      : "Files";
  const subtitle = showDiff
    ? `${git?.branch ?? ""}${git === null ? "" : " · "}${cwdTail(diff?.cwd ?? params.diff ?? "")}`
    : viewing !== null
      ? cwdTail(viewing)
      : dir !== null
        ? cwdTail(dir)
        : "On your PC";

  return (
    <Screen>
      <View style={styles.header}>
        <BackButton onPress={back} />
        <View style={styles.headText}>
          <Text variant="h2" numberOfLines={1}>
            {title}
          </Text>
          <MonoText numberOfLines={1}>{subtitle}</MonoText>
        </View>
        {viewing !== null && isMarkdown(viewing) && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={rendered ? "Show raw markdown" : "Show rendered markdown"}
            accessibilityState={{ selected: rendered }}
            onPress={() => setRendered((r) => !r)}
            style={({ pressed }) => [styles.toggle, pressed && { opacity: opacity.pressed }]}
          >
            <Text variant="sub" color={rendered ? "accent" : "textMut"}>
              {rendered ? "Raw" : "Rendered"}
            </Text>
          </Pressable>
        )}
      </View>

      {unauthorized ? (
        <Banner icon={ShieldAlert} text="This PC turned the phone away — re-pair to browse its files.">
          <Button label="Re-pair" variant="outline" onPress={() => router.push({ pathname: "/pair", params: { edit: "1" } })} />
        </Banner>
      ) : offline ? (
        <Banner icon={WifiOff} text="Offline — last-known contents shown. Opening anything new needs a live connection.">
          <Button label="Reconnect" variant="outline" icon={Wifi} onPress={retry} />
        </Banner>
      ) : null}

      {lastError !== null && (
        <Card accentEdge="danger" style={styles.note}>
          <Text variant="sub" color="danger">
            {lastError}
          </Text>
        </Card>
      )}

      {showDiff ? (
        <ScrollView contentContainerStyle={styles.scroll}>
          {git !== null && git.files.length > 0 && (
            <Text variant="sub" color="textMut">
              {git.files.length} changed {git.files.length === 1 ? "file" : "files"} on {git.branch} — paths are from the repo root.
            </Text>
          )}
          <DiffView diff={diff?.text ?? ""} />
        </ScrollView>
      ) : viewing !== null ? (
        <FileViewer
          path={viewing}
          text={fileText?.path === viewing ? fileText.text : ""}
          truncated={fileText?.path === viewing && fileText.truncated}
          rendered={rendered}
        />
      ) : roots.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="No folders yet"
          body="Folders show up here once you start a session in one — or list them under fileRoots in the daemon's config.json (its data folder, next to sessions.json)."
        />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {roots.length > 1 && (
            <View style={styles.section}>
              <Text variant="sub" color="textMut" style={styles.sectionLabel}>
                ROOTS
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                {roots.map((r) => (
                  <Pressable
                    key={r}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${r}`}
                    accessibilityState={{ selected: r === activeRoot }}
                    onPress={() => {
                      setRoot(r);
                      openDir(r);
                    }}
                    style={({ pressed }) => [styles.chip, r === activeRoot && styles.chipOn, pressed && { opacity: opacity.pressed }]}
                  >
                    <MonoText color={r === activeRoot ? "text" : "textMut"}>{cwdTail(r)}</MonoText>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}

          {trail.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.crumbs}>
              {trail.map((c, i) => (
                <View key={c.path} style={styles.crumbRow}>
                  {i > 0 && <ChevronRight size={iconSize.sm} color={color.idle} strokeWidth={stroke.icon} />}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Go to ${c.path}`}
                    onPress={() => openDir(c.path)}
                    style={({ pressed }) => [styles.crumb, pressed && { opacity: opacity.pressed }]}
                  >
                    <MonoText color={i === trail.length - 1 ? "text" : "textMut"}>{c.label}</MonoText>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          )}

          {/* Only when git answered for this folder: a plain directory has no
              changes to show, and an inert button would be a lie. */}
          {git !== null && git.cwd === dir && (
            <Button
              label={`Changes (${git.files.length}) on ${git.branch}`}
              variant="outline"
              icon={GitCompare}
              fill
              disabled={offline}
              onPress={() => openDiff(git.cwd)}
            />
          )}

          {entries.length === 0 ? (
            <Text variant="sub" color="textMut">
              {busy ? "Reading folder…" : dir === null ? "Pick a folder above to start browsing." : "This folder is empty."}
            </Text>
          ) : (
            entries.map((e) => (
              <Row
                key={e.path}
                entry={e}
                // Reading anything not already in hand needs the socket; the
                // banner above says so, and a row that cannot open says it too.
                disabled={offline}
                onPress={() => (e.dir ? openDir(e.path) : openFile(e.path))}
              />
            ))
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

// Folders first, then files — the daemon sorts that way and the icon repeats it,
// so the order never has to be inferred from the names.
function Row({ entry, disabled, onPress }: { entry: Entry; disabled: boolean; onPress: () => void }) {
  const Icon = entry.dir ? Folder : FileIcon;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${entry.dir ? "Open folder" : "Open file"} ${entry.name}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.row, disabled && { opacity: opacity.disabled }, pressed && { opacity: opacity.pressed }]}
    >
      <Icon size={iconSize.md} color={entry.dir ? color.info : color.idle} strokeWidth={stroke.icon} />
      <MonoText color="text" numberOfLines={1} style={styles.rowName}>
        {entry.name}
      </MonoText>
      {entry.dir ? (
        <ChevronRight size={iconSize.md} color={color.idle} strokeWidth={stroke.icon} />
      ) : (
        <Text variant="sub" color="textMut">
          {bytes(entry.size)}
        </Text>
      )}
    </Pressable>
  );
}

const isMarkdown = (p: string): boolean => /\.mdx?$/i.test(p);

// What the daemon's files.read returns instead of bytes it can't show as text.
// It comes back flagged truncated, which without this would read as "the rest
// of this file is not here" — there is no rest.
const BINARY = "(binary file)";

/**
 * The file viewer. Code is two text columns — numbers and source — inside one
 * sideways scroll: nothing wraps, nothing clips, and one <Text> per column
 * beats one per line on a 6000-line file. Markdown gets the rendered pass.
 */
function FileViewer({
  path,
  text,
  truncated,
  rendered,
}: {
  path: string;
  text: string;
  truncated: boolean;
  rendered: boolean;
}) {
  const lines = useMemo(() => text.split(/\r?\n/), [text]);
  const gutter = useMemo(() => lines.map((_, i) => String(i + 1)).join("\n"), [lines]);
  const blocks = useMemo(() => (isMarkdown(path) && rendered ? parseMarkdown(text) : null), [path, rendered, text]);

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      {truncated && (
        <Card accentEdge="warn" style={styles.note}>
          <Text variant="sub" color="textMut">
            {text === BINARY
              ? "This file isn't text — there is nothing to show line by line."
              : "Showing the first 256 KB — the rest of this file is not here."}
          </Text>
        </Card>
      )}
      {blocks !== null ? (
        <View style={styles.md}>
          {blocks.map((b, i) => (
            <Block key={i} block={b} />
          ))}
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.wide}>
          <View style={styles.code}>
            <MonoText style={styles.lineNos}>{gutter}</MonoText>
            <MonoText color="text">{text}</MonoText>
          </View>
        </ScrollView>
      )}
    </ScrollView>
  );
}

// h1, h2, h3. h4-h6 clamp to the h3 style: a fourth size on a 390pt column
// reads as body text, so weight — not size — is what separates h3 and below.
const HEADING = [typeScale.title, typeScale.h2, { ...typeScale.body, fontFamily: font.uiMed }] as const;

function Block({ block }: { block: MdBlock }) {
  if (block.kind === "code")
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.fence}>
        <MonoText color="text">{block.text}</MonoText>
      </ScrollView>
    );
  if (block.kind === "heading")
    return (
      <Text style={[HEADING[Math.min(block.level, HEADING.length) - 1], styles.heading]}>
        <Spans spans={block.spans} />
      </Text>
    );
  if (block.kind === "item")
    return (
      <View style={styles.item}>
        <MonoText color="textMut" style={styles.marker}>
          {block.marker}
        </MonoText>
        <Text style={styles.flex}>
          <Spans spans={block.spans} />
        </Text>
      </View>
    );
  return (
    <Text>
      <Spans spans={block.spans} />
    </Text>
  );
}

// Spans are raw strings and *delta* styles on RN's own Text — never the app's
// Text primitive. That one applies a full type variant, and a nested variant
// overrides the heading it sits inside, which silently flattens every heading to
// body size.
function Spans({ spans }: { spans: MdSpan[] }) {
  return (
    <>
      {spans.map((s, i) =>
        s.style === undefined ? (
          s.text
        ) : (
          <RNText key={i} style={span[s.style]}>
            {s.text}
          </RNText>
        ),
      )}
    </>
  );
}

function Banner({ icon: Icon, text, children }: { icon: LucideIcon; text: string; children?: React.ReactNode }) {
  return (
    <View style={styles.banner}>
      <View style={styles.bannerText}>
        <Icon size={iconSize.sm} color={color.textMut} strokeWidth={stroke.icon} />
        <Text variant="sub" color="textMut" style={styles.flex}>
          {text}
        </Text>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: space(2), paddingTop: space(2), paddingBottom: space(3) },
  headText: { flex: 1, gap: space(0.5) },
  toggle: { minWidth: touch.min, height: touch.min, alignItems: "center", justifyContent: "center", marginVertical: -space(2) },

  banner: {
    paddingVertical: space(2),
    paddingHorizontal: space(3),
    borderRadius: radius.input,
    backgroundColor: color.surface,
    borderWidth: stroke.hairline,
    borderColor: color.border,
    gap: space(2),
    marginBottom: space(3),
  },
  bannerText: { flexDirection: "row", alignItems: "center", gap: space(2) },
  note: { marginBottom: space(2) },

  scroll: { gap: space(3), paddingBottom: space(6) },
  section: { gap: space(2) },
  sectionLabel: { letterSpacing: tracking.label },

  chips: { gap: space(2), paddingRight: space(4) },
  chip: {
    minHeight: touch.min,
    justifyContent: "center",
    paddingHorizontal: space(3),
    borderRadius: radius.chip,
    borderWidth: stroke.hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  chipOn: { borderColor: color.accent, backgroundColor: color.surfaceHi },

  crumbs: { alignItems: "center", paddingRight: space(4) },
  crumbRow: { flexDirection: "row", alignItems: "center" },
  crumb: { minHeight: touch.min, justifyContent: "center", paddingHorizontal: space(1) },

  row: { flexDirection: "row", alignItems: "center", gap: space(3), minHeight: touch.min, paddingRight: space(1) },
  rowName: { flex: 1 },

  wide: { minWidth: "100%" },
  code: { flexDirection: "row", gap: space(3) },
  lineNos: { textAlign: "right", minWidth: space(7) },

  md: { gap: space(3) },
  heading: { color: color.text, marginTop: space(1) },
  item: { flexDirection: "row", gap: space(2) },
  marker: { minWidth: space(5), textAlign: "right" },
  fence: {
    backgroundColor: color.bg,
    borderRadius: radius.input,
    borderWidth: stroke.hairline,
    borderColor: color.border,
    padding: space(3),
  },
});

const span = StyleSheet.create({
  bold: { fontFamily: font.uiBold },
  italic: { fontStyle: "italic" },
  code: { fontFamily: font.mono },
  link: { color: color.info },
});
