import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import * as Clipboard from "expo-clipboard";
import {
  ArrowDown,
  ArrowLeft as ArrowLeftIcon,
  ArrowRight,
  ArrowUp,
  ClipboardPaste,
  Plus,
  ShieldAlert,
  TerminalSquare,
  Trash2,
  Wifi,
  WifiOff,
} from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import type { TermInfo } from "@shared/protocol";

import { BackButton } from "../src/components/BackButton";
import { Button } from "../src/components/Button";
import { Card } from "../src/components/Card";
import { Field } from "../src/components/Field";
import { MonoText } from "../src/components/MonoText";
import { Screen } from "../src/components/Screen";
import { TerminalView } from "../src/components/TerminalView";
import type { TerminalHandle } from "../src/components/terminalBridge";
import { Text } from "../src/components/Text";
import { demoMode, seedDemo } from "../src/lib/demo";
import { daemonOrigin, loadPairing, pairingUrl, type Pairing } from "../src/lib/pairing";
import { loadRecents, pushRecent } from "../src/lib/recents";
import { useWorkbench } from "../src/lib/store";
import { color, font, icon as iconSize, opacity, radius, space, stroke, touch, tracking } from "../src/theme";

/**
 * Terminal: the list of live shells on the PC, and the one you are looking at.
 * The emulator itself is the daemon's own page in a WebView — this screen owns
 * the token handoff, the list, and the key row that makes a phone terminal
 * usable (Esc/Tab/Ctrl/arrows/punctuation the soft keyboard buries).
 */
export default function TerminalScreen() {
  const connState = useWorkbench((s) => s.connState);
  const terminals = useWorkbench((s) => s.terminals);
  const lastError = useWorkbench((s) => s.lastError);
  const refreshTerminals = useWorkbench((s) => s.refreshTerminals);
  const createTerminal = useWorkbench((s) => s.createTerminal);
  const killTerminal = useWorkbench((s) => s.killTerminal);
  const connect = useWorkbench((s) => s.connect);

  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [cwd, setCwd] = useState("");
  const [recents, setRecents] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  const [ctrl, setCtrl] = useState(false);
  const [killTarget, setKillTarget] = useState<TermInfo | null>(null);
  const term = useRef<TerminalHandle>(null);

  const offline = connState !== "online";
  const unauthorized = connState === "unauthorized";
  const open = terminals.find((t) => t.termId === openId) ?? null;

  useFocusEffect(
    useCallback(() => {
      if (demoMode) {
        seedDemo();
        return;
      }
      void loadPairing().then(setPairing);
      void loadRecents().then(setRecents);
      void refreshTerminals().catch(() => {});
    }, [refreshTerminals]),
  );

  // Focus alone is not enough: the socket can come up while this screen is the
  // one on top (a walk back into range, the Reconnect below), and until it does
  // every list read rejects.
  useEffect(() => {
    if (connState === "online") void refreshTerminals().catch(() => {});
  }, [connState, refreshTerminals]);

  const start = async () => {
    setStarting(true);
    try {
      const t = await createTerminal(cwd.trim() === "" ? "." : cwd.trim());
      if (cwd.trim() !== "") void pushRecent(cwd.trim()).catch(() => {});
      setOpenId(t.termId);
    } catch {
      // The store's lastError banner already says why.
    } finally {
      setStarting(false);
    }
  };

  // The same "try now" the other screens offer: connect() on the pairing we are
  // already on cancels the backoff and opens a socket immediately.
  const retry = () => {
    void loadPairing().then((p) => {
      if (p !== null) {
        setPairing(p);
        connect(pairingUrl(p), p.token);
      }
    });
  };

  const back = () => {
    if (openId === null) {
      router.back();
      return;
    }
    // A terminal can have exited while it was on screen (the page says so, the
    // list does not) — the way back is also the way the list gets the truth.
    setOpenId(null);
    setCtrl(false);
    void refreshTerminals().catch(() => {});
  };

  const doKill = (t: TermInfo) => {
    setKillTarget(null);
    if (t.termId === openId) setOpenId(null);
    void killTerminal(t.termId).catch(() => {});
  };

  // Every accessory key clears an armed Ctrl: it modifies the next character
  // typed, and an arrow is not that character.
  const sendKey = (data: string) => {
    term.current?.send(data);
    if (ctrl) {
      setCtrl(false);
      term.current?.setCtrl(false);
    }
  };

  const toggleCtrl = () => {
    const next = !ctrl;
    setCtrl(next);
    term.current?.setCtrl(next);
  };

  // Stable across renders so the WebView is not handed a "new" config (and made
  // to re-post the token) on every keystroke of the cwd field.
  const config = useMemo(
    () => ({ token: pairing?.token ?? "", termId: openId ?? undefined }),
    [pairing, openId],
  );

  return (
    <Screen>
      <View style={styles.header}>
        <BackButton onPress={back} />
        <View style={styles.headText}>
          <Text variant="h2" numberOfLines={1}>
            {open === null ? "Terminals" : open.title}
          </Text>
          {open !== null && (
            <MonoText numberOfLines={1}>{open.cwd}</MonoText>
          )}
        </View>
        {/* Same grammar as Stop on the Tools screen: a labelled pill, not a bare
            glyph. Killing a shell and stopping a service are one act, and the
            product should only have one way of asking for it. */}
        {open !== null && (
          <Button
            label="Kill"
            variant="danger"
            icon={Trash2}
            accessibilityLabel={`Kill ${open.title}`}
            onPress={() => setKillTarget(open)}
          />
        )}
      </View>

      {unauthorized ? (
        <Banner icon={ShieldAlert} text="This PC turned the phone away — re-pair to use its terminals.">
          <Button label="Re-pair" variant="outline" onPress={() => router.push({ pathname: "/pair", params: { edit: "1" } })} />
        </Banner>
      ) : offline ? (
        <Banner icon={WifiOff} text="Offline — a terminal keeps running on your PC; you just cannot type into it.">
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

      {open !== null && pairing !== null ? (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.frame}>
            <TerminalView
              key={open.termId}
              ref={term}
              origin={daemonOrigin(pairing)}
              config={config}
              onCtrlConsumed={() => setCtrl(false)}
            />
          </View>
          <KeyRow ctrl={ctrl} disabled={offline} onKey={sendKey} onCtrl={toggleCtrl} />
        </KeyboardAvoidingView>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.section}>
            <Text variant="sub" color="textMut" style={styles.sectionLabel}>
              RUNNING
            </Text>
            {terminals.length === 0 ? (
              <View style={styles.empty}>
                <TerminalSquare size={iconSize.xl} color={color.idle} strokeWidth={stroke.icon} />
                <Text variant="body" color="textMut" style={styles.center}>
                  No terminals yet. Start one below and it stays alive on your PC — close the app and it is still there.
                </Text>
              </View>
            ) : (
              terminals.map((t) => (
                <TerminalRow
                  key={t.termId}
                  term={t}
                  disabled={offline || pairing === null}
                  onOpen={() => setOpenId(t.termId)}
                  onKill={() => setKillTarget(t)}
                />
              ))
            )}
          </View>

          <View style={styles.section}>
            <Text variant="sub" color="textMut" style={styles.sectionLabel}>
              NEW TERMINAL
            </Text>
            <Field
              label="Working folder"
              value={cwd}
              onChangeText={setCwd}
              placeholder="D:\projects\api-server"
              hint="Where the shell starts. Leave empty for the daemon's own folder."
              mono
              autoCorrect={false}
              autoCapitalize="none"
            />
            {/* Labelled, exactly as new.tsx does it: unlabelled, a filled row
                straight under an empty input reads as a second input rather
                than as a folder you can tap. */}
            {recents.length > 0 && (
              <View style={styles.recents}>
                <Text variant="sub" color="textMut" style={styles.sectionLabel}>
                  RECENT
                </Text>
                {recents.map((r) => (
                  <Pressable
                    key={r}
                    accessibilityRole="button"
                    accessibilityLabel={`Use ${r}`}
                    onPress={() => setCwd(r)}
                    style={({ pressed }) => [styles.recentRow, pressed && { opacity: opacity.pressed }]}
                  >
                    <MonoText color="text" numberOfLines={1}>
                      {r}
                    </MonoText>
                  </Pressable>
                ))}
              </View>
            )}
            <Button
              label="New terminal"
              icon={Plus}
              fill
              loading={starting}
              disabled={offline || pairing === null}
              onPress={() => void start()}
            />
          </View>
        </ScrollView>
      )}

      {killTarget !== null && (
        <Card accentEdge="danger" raised style={styles.sheet}>
          <Text variant="body">Kill {killTarget.title}?</Text>
          <Text variant="sub" color="textMut">
            {killTarget.cwd} — anything running in it stops.
          </Text>
          <View style={styles.sheetButtons}>
            <Button label="Cancel" variant="outline" fill onPress={() => setKillTarget(null)} />
            <Button label="Kill" variant="danger" fill onPress={() => doKill(killTarget)} />
          </View>
        </Card>
      )}
    </Screen>
  );
}

// The keys a phone keyboard hides or does not have at all. Horizontally
// scrollable so the set can grow without shrinking any target below 48.
function KeyRow({
  ctrl,
  disabled,
  onKey,
  onCtrl,
}: {
  ctrl: boolean;
  disabled: boolean;
  onKey: (data: string) => void;
  onCtrl: () => void;
}) {
  return (
    <View style={styles.keyRow}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.keys} keyboardShouldPersistTaps="always">
        {/* First, because it is the reason a phone terminal is usable at all:
            tokens, paths and commands are pasted, not typed. Same path as every
            other key — the clipboard text is just a longer "keystroke". */}
        <Key
          label="Paste"
          icon={ClipboardPaste}
          disabled={disabled}
          onPress={() => void Clipboard.getStringAsync().then((t) => t !== "" && onKey(t)).catch(() => {})}
        />
        <Key label="Esc" disabled={disabled} onPress={() => onKey("\x1b")} />
        <Key label="Tab" disabled={disabled} onPress={() => onKey("\t")} />
        {/* Sticky: armed here, applied by the page to the next character the
            soft keyboard types (Ctrl then C = \x03). */}
        <Key label="Ctrl" on={ctrl} disabled={disabled} onPress={onCtrl} />
        <Key label="Up" icon={ArrowUp} disabled={disabled} onPress={() => onKey("\x1b[A")} />
        <Key label="Down" icon={ArrowDown} disabled={disabled} onPress={() => onKey("\x1b[B")} />
        <Key label="Left" icon={ArrowLeftIcon} disabled={disabled} onPress={() => onKey("\x1b[D")} />
        <Key label="Right" icon={ArrowRight} disabled={disabled} onPress={() => onKey("\x1b[C")} />
        <Key label="/" disabled={disabled} onPress={() => onKey("/")} />
        <Key label="|" disabled={disabled} onPress={() => onKey("|")} />
        <Key label="-" disabled={disabled} onPress={() => onKey("-")} />
        <Key label="~" disabled={disabled} onPress={() => onKey("~")} />
      </ScrollView>
    </View>
  );
}

function Key({
  label,
  icon: Icon,
  on = false,
  disabled,
  onPress,
}: {
  label: string;
  icon?: LucideIcon;
  on?: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected: on }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.key,
        on && styles.keyOn,
        disabled && { opacity: opacity.disabled },
        pressed && { opacity: opacity.pressed },
      ]}
    >
      {Icon !== undefined ? (
        <Icon size={iconSize.md} color={color.text} strokeWidth={stroke.icon} />
      ) : (
        <Text variant="body" color={on ? "accent" : "text"} style={styles.keyLabel}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

// One live shell: what it is running and where, plus a kill target ≥48.
function TerminalRow({
  term,
  disabled,
  onOpen,
  onKill,
}: {
  term: TermInfo;
  disabled: boolean;
  onOpen: () => void;
  onKill: () => void;
}) {
  return (
    <View style={styles.termRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${term.title}`}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onOpen}
        style={({ pressed }) => [styles.termOpen, pressed && { opacity: opacity.pressed }]}
      >
        <TerminalSquare size={iconSize.md} color={color.info} strokeWidth={stroke.icon} />
        <View style={styles.flex}>
          <Text variant="body" numberOfLines={1}>
            {term.title}
          </Text>
          <MonoText numberOfLines={1}>{term.cwd}</MonoText>
        </View>
      </Pressable>
      <Button
        label="Kill"
        variant="danger"
        icon={Trash2}
        accessibilityLabel={`Kill ${term.title}`}
        disabled={disabled}
        onPress={onKill}
      />
    </View>
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
  center: { textAlign: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: space(2), paddingTop: space(2), paddingBottom: space(3) },
  headText: { flex: 1, gap: space(0.5) },

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
  note: { marginBottom: space(3) },

  scroll: { gap: space(5), paddingTop: space(1), paddingBottom: space(6) },
  section: { gap: space(2) },
  sectionLabel: { letterSpacing: tracking.label },
  empty: { alignItems: "center", gap: space(3), paddingVertical: space(6), paddingHorizontal: space(4) },

  termRow: { flexDirection: "row", alignItems: "center", gap: space(2) },
  termOpen: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: space(3),
    minHeight: touch.min,
    paddingHorizontal: space(3),
    borderRadius: radius.input,
    borderWidth: stroke.hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
  },

  recents: { gap: space(1.5) },
  recentRow: {
    minHeight: touch.min,
    justifyContent: "center",
    paddingHorizontal: space(3),
    borderRadius: radius.input,
    borderWidth: stroke.hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
  },

  // The emulator gets its own frame so the black page reads as a surface rather
  // than as a hole in the screen.
  frame: {
    flex: 1,
    overflow: "hidden",
    borderRadius: radius.card,
    borderWidth: stroke.hairline,
    borderColor: color.border,
    backgroundColor: color.bg,
  },
  // Visually distinct from the terminal above it: a rule, a raised surface, and
  // it sits above the keyboard rather than under it.
  keyRow: {
    borderTopWidth: stroke.hairline,
    borderTopColor: color.border,
    backgroundColor: color.surface,
    marginHorizontal: -space(4),
    paddingVertical: space(1.5),
    marginTop: space(2),
  },
  keys: { paddingHorizontal: space(4), gap: space(2) },
  key: {
    minWidth: touch.min,
    height: touch.min,
    paddingHorizontal: space(3),
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.chip,
    borderWidth: stroke.hairline,
    borderColor: color.border,
    backgroundColor: color.surfaceHi,
  },
  keyOn: { borderColor: color.accent },
  keyLabel: { fontFamily: font.mono },

  sheet: { gap: space(2), marginBottom: space(3) },
  sheetButtons: { flexDirection: "row", gap: space(3), marginTop: space(1) },
});
