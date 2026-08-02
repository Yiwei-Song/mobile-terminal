import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Pressable, RefreshControl, SectionList, StyleSheet, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Plus, Search, SearchX, ShieldAlert, TerminalSquare, WifiOff, X } from "lucide-react-native";
import type { SessionRow as Session } from "@shared/protocol";

import { Button } from "../../src/components/Button";
import { Card } from "../../src/components/Card";
import { EmptyState } from "../../src/components/EmptyState";
import { Field } from "../../src/components/Field";
import { Screen } from "../../src/components/Screen";
import { SessionRow } from "../../src/components/SessionRow";
import { Text } from "../../src/components/Text";
import type { ConnState } from "../../src/lib/client";
import { demoMode, seedDemo } from "../../src/lib/demo";
import { filterSessions, groupSessions, isUnread } from "../../src/lib/groups";
import { usePressScale } from "../../src/lib/motion";
import { loadPairing, pairingUrl, type Pairing } from "../../src/lib/pairing";
import { useWorkbench } from "../../src/lib/store";
import { color, icon as iconSize, motion, opacity, space, stroke, touch, type ColorRole } from "../../src/theme";

type Section = { key: string; title: string; tint: ColorRole; data: Session[] };

/**
 * Sessions tab: "does anything need me?" answered in under a second. Three
 * sections in one glance — what needs you, what is working, what is over — and
 * one FAB below them, nothing else competing. Machine identity, connection state
 * and the utility screens live on the Machine tab.
 */
export default function Home() {
  const sessions = useWorkbench((s) => s.sessions);
  const seenAt = useWorkbench((s) => s.seenAt);
  const connState = useWorkbench((s) => s.connState);
  const lastError = useWorkbench((s) => s.lastError);
  const connect = useWorkbench((s) => s.connect);
  const refreshSessions = useWorkbench((s) => s.refreshSessions);
  // undefined until storage answers: rendering "not paired" for that frame is a
  // flash of the wrong screen on every cold start. Demo mode never asks storage
  // — it *is* the connection — so it starts already answered.
  const [pairing, setPairing] = useState<Pairing | null | undefined>(demoMode ? null : undefined);
  const [refreshing, setRefreshing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const fab = usePressScale();
  // The stagger is a first-paint flourish, not a property of a row: a session
  // that arrives later slides in on its own, without waiting out a queue that
  // belongs to a list the user has already read.
  const first = useRef(true);
  const staggered = first.current;

  useFocusEffect(
    useCallback(() => {
      if (demoMode) {
        seedDemo();
        return;
      }
      let alive = true;
      void loadPairing().then((p) => {
        if (!alive) return;
        setPairing(p);
        if (p === null) {
          router.replace("/pair");
          return;
        }
        // Cheap on every focus: the store no-ops when the pairing is unchanged.
        connect(pairingUrl(p), p.token);
      });
      return () => {
        alive = false;
      };
    }, [connect]),
  );

  // Filter first, then group: a search is over every session, and a group that
  // nothing in it matched should disappear rather than sit there empty.
  const sections = useMemo<Section[]>(() => {
    const g = groupSessions(filterSessions(sessions, query));
    const all: Section[] = [
      { key: "needsYou", title: "Needs you", tint: "warn", data: g.needsYou },
      { key: "working", title: "Working", tint: "textMut", data: g.working },
      { key: "recent", title: "Recent", tint: "textMut", data: g.recent },
    ];
    return all.filter((s) => s.data.length > 0);
  }, [sessions, query]);

  // Flat position across sections — SectionList's own index restarts per section,
  // and the stagger has to read down the whole screen.
  const order = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sections) for (const row of s.data) m.set(row.sessionId, m.size);
    return m;
  }, [sections]);

  // Spent once the first populated paint is committed — not on mount, which on a
  // cold start happens while pairing is still being read off disk and there is
  // nothing to stagger.
  useEffect(() => {
    if (sections.length > 0) first.current = false;
  }, [sections.length]);

  // connect() on the pairing we are already on means "try now" to the client:
  // it cancels the backoff and opens a socket immediately.
  const retry = () => {
    if (pairing === null || pairing === undefined) return;
    connect(pairingUrl(pairing), pairing.token);
  };

  const refresh = () => {
    setRefreshing(true);
    // Pull-to-refresh is the instinctive gesture on a stale list, and while
    // offline the list cannot recover without a socket — so nudge one first.
    // The reconnect re-lists on its own; this refresh is what covers the online case.
    if (connState === "offline") retry();
    // The rejection is already state (lastError) — the banner below reports it.
    void refreshSessions(true)
      .catch(() => {})
      .finally(() => setRefreshing(false));
  };

  if (pairing === undefined) return null;

  // A session can only be started against a live (or connecting) PC. Offline or
  // token-rejected, the FAB is dimmed and inert rather than a dead-ending promise.
  const canStart = connState === "online" || connState === "connecting";

  return (
    <Screen>
      <View style={styles.header}>
        <Text variant="title" style={styles.flex}>
          Sessions
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={searching ? "Close search" : "Search sessions"}
          accessibilityState={{ expanded: searching }}
          onPress={() => {
            // Closing clears: a hidden filter is a list that lies about itself.
            setSearching(!searching);
            setQuery("");
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
            placeholder="Title or folder"
            returnKeyType="search"
          />
        </View>
      )}

      {lastError !== null && (
        <Card accentEdge="danger" style={styles.error}>
          <View style={styles.errorRow}>
            <Text variant="sub" color="danger" style={styles.errorText}>
              {lastError}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss error"
              onPress={() => useWorkbench.setState({ lastError: null })}
              style={({ pressed }) => [styles.iconButton, pressed && { opacity: opacity.pressed }]}
            >
              <X size={iconSize.md} color={color.textMut} />
            </Pressable>
          </View>
        </Card>
      )}

      {/* The FAB's clearance is the list's own box, not its content padding:
          content padding only pays off once the list is scrolled to the end,
          and a short list simply stops where it stops — which on a populated
          home screen was under the FAB, clipping the last card's status chip.
          A wrapper rather than a style on the SectionList: react-native-web renders
          a ScrollView as two nested divs and applies `style` to both, which
          doubled the margin. */}
      <View style={styles.listBox}>
        <SectionList
          sections={sections}
          keyExtractor={(s) => s.sessionId}
          renderItem={({ item }) => (
            <SessionRow
              session={item}
              unread={isUnread(item, seenAt)}
              // Capped: past the eighth row the queue is longer than the
              // animation is worth, and nothing should be invisible for a second.
              delay={staggered ? Math.min(order.get(item.sessionId) ?? 0, 8) * motion.stagger : 0}
            />
          )}
          renderSectionHeader={({ section }) => <SectionHead title={section.title} tint={section.tint} />}
          ItemSeparatorComponent={Separator}
          stickySectionHeadersEnabled={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={sections.length === 0 ? styles.emptyList : styles.list}
          ListEmptyComponent={<Empty connState={connState} onRetry={retry} filtered={query.trim() !== ""} />}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={color.textMut} colors={[color.accent]} />
          }
        />
      </View>

      {/* Thumb-reachable, and the only primary action on the screen. Dimmed and
          inert when there is no live PC to start a session on — a disabled FAB
          tells the truth where an enabled one would promise an action that fails. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="New session"
        accessibilityState={{ disabled: !canStart }}
        disabled={!canStart}
        onPress={() => router.push("/new")}
        onPressIn={fab.onPressIn}
        onPressOut={fab.onPressOut}
        style={styles.fab}
      >
        <Animated.View
          style={[styles.fabFace, !canStart && { opacity: opacity.disabled }, { transform: [{ scale: fab.scale }] }]}
        >
          <Plus size={iconSize.lg} color={color.accentText} />
        </Animated.View>
      </Pressable>
    </Screen>
  );
}

/** Section label, then a hairline running out to the edge of the content column. */
function SectionHead({ title, tint }: { title: string; tint: ColorRole }) {
  return (
    <View style={styles.sectionHead}>
      {/* `type.label` carries the uppercase and its tracking. */}
      <Text variant="label" color={tint}>
        {title}
      </Text>
      <View style={styles.rule} />
    </View>
  );
}

const Separator = () => <View style={styles.separator} />;

// Nothing dead-ends: every empty list says why it is empty and offers the move
// that fixes it. "connecting" is the one state with nothing useful to say yet.
function Empty({ connState, onRetry, filtered }: { connState: ConnState; onRetry: () => void; filtered: boolean }) {
  // A search that matched nothing is not an empty app — say the true thing.
  if (filtered)
    return (
      <EmptyState
        icon={SearchX}
        title="Nothing matches"
        body="No session's title or folder contains that. Clear the search to see them all."
      />
    );
  if (connState === "unauthorized")
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Your PC turned this phone away"
        body="The token stopped working — the daemon probably made a new one. Pair again to pick it up."
        action={<Button label="Re-pair" onPress={() => router.push({ pathname: "/pair", params: { edit: "1" } })} />}
      />
    );
  if (connState === "offline")
    return (
      <EmptyState
        icon={WifiOff}
        title="Can't reach your PC"
        body="Same wifi? VPN off? Is the daemon still running? It keeps trying in the background."
        action={<Button label="Retry now" onPress={onRetry} />}
      />
    );
  if (connState === "online")
    return (
      <EmptyState
        icon={TerminalSquare}
        title="No sessions yet"
        body="Start one — tap the + button, pick a folder on your PC and say what you want done."
      />
    );
  return null;
}

const FAB = space(14);
// FAB height + the gap under it + the same gap above it.
const FAB_CLEAR = FAB + space(4) * 2;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: space(2), paddingTop: space(2) },
  iconButton: { width: touch.min, height: touch.min, alignItems: "center", justifyContent: "center" },
  search: { paddingTop: space(2) },
  listBox: { flex: 1, marginBottom: FAB_CLEAR },
  list: { paddingBottom: space(2) },
  // Centres the empty state in the space the list has, rather than at the top.
  emptyList: { flexGrow: 1 },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: space(2), paddingTop: space(4), paddingBottom: space(2) },
  rule: { flex: 1, height: stroke.hairline, backgroundColor: color.border },
  separator: { height: space(2) },
  error: { marginTop: space(2), marginBottom: space(1) },
  errorRow: { flexDirection: "row", alignItems: "center", gap: space(2) },
  errorText: { flexShrink: 1 },
  fab: {
    position: "absolute",
    // Flush with the content column, not the screen edge: the FAB lines up with
    // the right edge of every card above it.
    right: 0,
    bottom: space(4),
    width: FAB,
    height: FAB,
  },
  fabFace: {
    flex: 1,
    borderRadius: FAB / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.accent,
  },
});
