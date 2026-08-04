import { useCallback, useMemo, useState } from "react";
import { LayoutAnimation, Platform, Pressable, RefreshControl, SectionList, StyleSheet, UIManager, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { ChevronDown, ChevronRight, FolderTree, Search, SearchX, WifiOff, X } from "lucide-react-native";
import type { Project, Thread } from "@shared/protocol";

import { EmptyState } from "../../src/components/EmptyState";
import { Field } from "../../src/components/Field";
import { MonoText } from "../../src/components/MonoText";
import { Screen, TAB_EDGES } from "../../src/components/Screen";
import { Text } from "../../src/components/Text";
import { ThreadRow } from "../../src/components/ThreadRow";
import { demoMode } from "../../src/lib/demo";
import { useReducedMotion } from "../../src/lib/motion";
import { filterProjects, initialExpanded, previewThreads, projectNeedsYou, projectRunning, splitProjects } from "../../src/lib/projects";
import { useWorkbench } from "../../src/lib/store";
import { color, icon as iconSize, motion, opacity, radius, space, stroke, touch } from "../../src/theme";

// Android opts out of LayoutAnimation by default. Expanding a project is the one
// place in this app where a height change is the *content* of the interaction —
// the user asked to see inside a folder — so it gets the one animation.
if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental !== undefined) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type Row = { kind: "thread"; thread: Thread } | { kind: "more"; path: string; count: number; expandable: boolean };

/**
 * Projects tab: "what exists on my PC", answered the way the desktop apps answer
 * it — every Claude and Codex session, grouped by the folder it runs in.
 *
 * This is the browse surface; the Sessions tab stays the attention surface. They
 * are two different questions ("what needs me" vs "where is that thing I
 * started"), and collapsing them into one list makes both worse — the desktop
 * app has a whole sidebar for the second one.
 */
export default function Projects() {
  const projects = useWorkbench((s) => s.projects);
  const connState = useWorkbench((s) => s.connState);
  const refreshProjects = useWorkbench((s) => s.refreshProjects);
  const [refreshing, setRefreshing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  // null = "nobody has touched a disclosure yet", so the screen can still follow
  // the data (a project that starts waiting opens itself). The first manual
  // toggle takes ownership and the automatic rule stops fighting the user.
  const [open, setOpen] = useState<Set<string> | null>(null);
  const [showGenerated, setShowGenerated] = useState(false);
  // Projects the user asked to see in full. Without this, expanding a 63-thread
  // folder pushed every other project off the screen and the browse surface
  // stopped being browsable at the first busy one.
  const [showAll, setShowAll] = useState<Set<string>>(new Set());
  const reduced = useReducedMotion();

  useFocusEffect(
    useCallback(() => {
      if (demoMode) return;
      void refreshProjects().catch(() => {});
    }, [refreshProjects]),
  );

  const searchingNow = query.trim() !== "";
  const visible = useMemo(() => filterProjects(projects, query), [projects, query]);
  const { real, generated } = useMemo(() => splitProjects(visible), [visible]);
  const auto = useMemo(() => initialExpanded(visible, searchingNow), [visible, searchingNow]);
  const expanded = open ?? auto;

  const shown = useMemo(() => (showGenerated ? [...real, ...generated] : real), [real, generated, showGenerated]);

  const sections = useMemo(
    () =>
      shown.map((p) => ({
        project: p,
        // A collapsed project contributes no rows — SectionList renders the
        // header alone, which is exactly what a closed disclosure is.
        data: expanded.has(p.path) ? rowsOf(p, showAll.has(p.path)) : [],
      })),
    [shown, expanded, showAll],
  );

  const toggle = (path: string) => {
    if (!reduced) LayoutAnimation.configureNext({ duration: motion.fast, update: { type: "easeInEaseOut" } });
    const next = new Set(expanded);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setOpen(next);
  };

  const refresh = () => {
    setRefreshing(true);
    void refreshProjects(true)
      .catch(() => {})
      .finally(() => setRefreshing(false));
  };

  return (
    <Screen edges={TAB_EDGES}>
      <View style={styles.header}>
        <Text variant="title" style={styles.flex}>
          Projects
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={searching ? "Close search" : "Search projects"}
          accessibilityState={{ expanded: searching }}
          onPress={() => {
            setSearching(!searching);
            setQuery("");
            // Searching force-expands; leaving it must not strand every project
            // open. Handing control back to the automatic rule is the honest reset.
            setOpen(null);
          }}
          style={({ pressed }) => [styles.iconButton, pressed && { opacity: opacity.pressed }]}
        >
          {searching ? (
            <X size={iconSize.lg} color={color.text} strokeWidth={stroke.icon} />
          ) : (
            <Search size={iconSize.lg} color={color.text} strokeWidth={stroke.icon} />
          )}
        </Pressable>
      </View>

      {searching && (
        <View style={styles.search}>
          <Field
            label="Search"
            autoFocus
            value={query}
            onChangeText={setQuery}
            placeholder="Project, folder or session"
            returnKeyType="search"
          />
        </View>
      )}

      <SectionList
        sections={sections}
        keyExtractor={(row, i) => (row.kind === "thread" ? row.thread.threadId : `more-${i}`)}
        renderSectionHeader={({ section }) => (
          <ProjectHead
            project={section.project}
            expanded={expanded.has(section.project.path)}
            onPress={() => toggle(section.project.path)}
          />
        )}
        renderItem={({ item }) =>
          item.kind === "thread" ? (
            <ThreadRow thread={item.thread} />
          ) : item.expandable ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Show ${item.count} more sessions`}
              onPress={() => {
                if (!reduced) LayoutAnimation.configureNext({ duration: motion.fast, update: { type: "easeInEaseOut" } });
                setShowAll(new Set(showAll).add(item.path));
              }}
              style={({ pressed }) => [styles.more, pressed && { opacity: opacity.pressed }]}
            >
              <Text variant="label" color="info">
                Show {item.count} more
              </Text>
            </Pressable>
          ) : (
            // Nothing left to expand — the remainder is still on the PC, behind
            // the daemon's own cap. One folder here holds 1532 automation
            // sessions, and letting fifty read as everything would be a lie.
            <Text variant="meta" color="textMut" style={styles.more}>
              + {item.count} older on your PC — search to find one
            </Text>
          )
        }
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={sections.length === 0 ? styles.emptyList : styles.list}
        ListEmptyComponent={<Empty connState={connState} filtered={searchingNow} />}
        ListFooterComponent={
          generated.length > 0 && !searchingNow ? (
            <GeneratedToggle count={generated.length} shown={showGenerated} onPress={() => setShowGenerated(!showGenerated)} />
          ) : null
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={color.textMut} colors={[color.accent]} />
        }
      />
    </Screen>
  );
}

/** A preview of the project's threads, then one line owning up to the rest. */
function rowsOf(p: Project, all: boolean): Row[] {
  const { shown, rest, expandable } = previewThreads(p, all);
  const rows: Row[] = shown.map((thread) => ({ kind: "thread" as const, thread }));
  return rest > 0 ? [...rows, { kind: "more", path: p.path, count: rest, expandable }] : rows;
}

/**
 * A project's disclosure row: folder name, what is happening inside it, and the
 * path. The counts are what make a *collapsed* project still worth reading —
 * without them a closed row says nothing and every project has to be opened.
 */
function ProjectHead({ project, expanded, onPress }: { project: Project; expanded: boolean; onPress: () => void }) {
  const needsYou = projectNeedsYou(project);
  const running = projectRunning(project);
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={`${project.name}, ${project.threadCount} ${project.threadCount === 1 ? "session" : "sessions"}${needsYou ? ", needs you" : ""}`}
      onPress={onPress}
      style={({ pressed }) => [styles.head, pressed && { backgroundColor: color.surface }]}
    >
      <Chevron size={iconSize.md} color={color.textMut} strokeWidth={stroke.icon} />
      <View style={styles.headBody}>
        <View style={styles.headTop}>
          <Text variant="strong" numberOfLines={1} style={styles.flex}>
            {project.name}
          </Text>
          {/* Amber dot over a chip: at header level this is a summary of what is
              inside, and a full chip would out-shout the threads' own. */}
          {needsYou && <View style={styles.needsDot} />}
          {running > 0 && (
            <Text variant="meta" color="accent">
              {running} running
            </Text>
          )}
          <Text variant="meta" color="textMut">
            {project.threadCount}
          </Text>
        </View>
        <MonoText numberOfLines={1} ellipsizeMode="head" style={styles.path}>
          {project.path}
        </MonoText>
      </View>
    </Pressable>
  );
}

/** Scratchpads, worktrees and per-agent workspace copies: real, reachable, and
 *  not what the list should open on. Hidden behind one line, never dropped. */
function GeneratedToggle({ count, shown, onPress }: { count: number; shown: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: shown }}
      onPress={onPress}
      style={({ pressed }) => [styles.generated, pressed && { opacity: opacity.pressed }]}
    >
      <FolderTree size={iconSize.sm} color={color.textMut} strokeWidth={stroke.icon} />
      <Text variant="label" color="textMut">
        {shown ? "Hide" : "Show"} {count} generated
      </Text>
    </Pressable>
  );
}

function Empty({ connState, filtered }: { connState: string; filtered: boolean }) {
  if (filtered)
    return (
      <EmptyState
        icon={SearchX}
        title="Nothing matches"
        body="No project or session name contains that. Clear the search to see them all."
      />
    );
  if (connState === "offline")
    return (
      <EmptyState
        icon={WifiOff}
        title="Can't reach your PC"
        body="This list is read from your PC's own Claude and Codex folders, so it needs the daemon running."
      />
    );
  return (
    <EmptyState
      icon={FolderTree}
      title="No sessions found"
      body="Nothing from Claude or Codex on this PC yet. Start one from the Sessions tab and it'll appear here under its folder."
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: space(2), paddingTop: space(2) },
  iconButton: { width: touch.min, height: touch.min, alignItems: "center", justifyContent: "center" },
  search: { paddingTop: space(2) },
  list: { paddingBottom: space(6) },
  emptyList: { flexGrow: 1 },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    minHeight: touch.min,
    marginTop: space(3),
    paddingHorizontal: space(1),
    borderRadius: radius.card,
    borderBottomWidth: stroke.hairline,
    borderBottomColor: color.border,
  },
  headBody: { flex: 1, gap: space(1), paddingVertical: space(2) },
  headTop: { flexDirection: "row", alignItems: "center", gap: space(2) },
  needsDot: { width: space(2), height: space(2), borderRadius: space(1), backgroundColor: color.warn },
  path: { opacity: opacity.disabled },
  more: { justifyContent: "center", minHeight: touch.min, paddingLeft: space(7) },
  generated: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space(2),
    minHeight: touch.min,
    marginTop: space(4),
  },
});
