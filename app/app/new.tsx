import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { ArrowLeft, Play } from "lucide-react-native";

import { Button } from "../src/components/Button";
import { Card } from "../src/components/Card";
import { Field } from "../src/components/Field";
import { MonoText } from "../src/components/MonoText";
import { Screen } from "../src/components/Screen";
import { Text } from "../src/components/Text";
import { demoMode, seedDemo } from "../src/lib/demo";
import { loadRecents, pushRecent } from "../src/lib/recents";
import { useWorkbench } from "../src/lib/store";
import { color, icon as iconSize, opacity, radius, space, stroke, touch, tracking } from "../src/theme";

// Two folders so the empty-with-recents state has something to render in demo;
// storage is empty in a web preview.
const DEMO_RECENTS = ["D:\\projects\\api-server", "C:\\Users\\yiwei\\notes"];

/**
 * New session: pick a folder, say what to do, Start. The folder is the loudest
 * thing on the screen on purpose — the SDK can write outside it, so it must be
 * unmistakable which directory the agent is about to touch (Plan-1 note).
 */
export default function NewSession() {
  const connState = useWorkbench((s) => s.connState);
  const newSession = useWorkbench((s) => s.newSession);

  const [cwd, setCwd] = useState("");
  const [prompt, setPrompt] = useState("");
  const [recents, setRecents] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (demoMode) {
      // Demo *is* the connection — seedDemo sets connState (online, or offline
      // under EXPO_PUBLIC_DEMO_STATE) so the disabled-Start state can be shot.
      seedDemo();
      setRecents(DEMO_RECENTS);
      return;
    }
    void loadRecents().then(setRecents);
  }, []);

  const offline = connState !== "online";
  const canStart = cwd.trim() !== "" && prompt.trim() !== "" && !offline;

  const start = async () => {
    setErr(null);
    setStarting(true);
    try {
      const id = await newSession(cwd.trim(), prompt.trim());
      await pushRecent(cwd.trim());
      router.replace(`/session/${id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          style={({ pressed }) => [styles.iconBtn, pressed && { opacity: opacity.pressed }]}
        >
          <ArrowLeft size={iconSize.lg} color={color.text} strokeWidth={stroke.icon} />
        </Pressable>
        <Text variant="h2" numberOfLines={1} style={styles.grow}>
          New session
        </Text>
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Field
            label="Working folder"
            value={cwd}
            onChangeText={setCwd}
            placeholder="D:\projects\api-server"
            hint="The agent works in this folder. Use an absolute path (e.g. D:\projects\api-server)."
            mono
            autoCorrect={false}
            autoCapitalize="none"
          />

          {recents.length > 0 && (
            <View style={styles.recents}>
              <Text variant="sub" color="textMut" style={styles.recentsLabel}>
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

          <AgentSelect />

          <Field
            label="Prompt"
            value={prompt}
            onChangeText={setPrompt}
            placeholder="What should the agent do?"
            hint="Speak it or type it — dictation works here."
            multiline
            autoCapitalize="sentences"
          />

          {err !== null && (
            <Card accentEdge="danger">
              <Text variant="sub" color="danger">
                Couldn't start: {err}
              </Text>
            </Card>
          )}
        </ScrollView>

        <View style={styles.footer}>
          <Button label="Start session" icon={Play} fill loading={starting} disabled={!canStart} onPress={() => void start()} />
          {offline && (
            <Text variant="sub" color="textMut" style={styles.footerHint}>
              Reconnect to start a session.
            </Text>
          )}
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

// Codex is here so the choice is visible, but it lands in Plan 3 — disabled with
// a badge rather than hidden, so the app reads as "more coming" not "this is all".
function AgentSelect() {
  return (
    <View style={styles.agentWrap}>
      <Text variant="sub" color="textMut">
        Agent
      </Text>
      <View style={styles.agentRow}>
        <View style={[styles.agent, styles.agentOn]} accessibilityRole="radio" accessibilityState={{ selected: true }}>
          <Text variant="body" color="text">
            Claude
          </Text>
        </View>
        <View style={[styles.agent, styles.agentOff]} accessibilityRole="radio" accessibilityState={{ disabled: true }}>
          <Text variant="body" color="idle">
            Codex
          </Text>
          <View style={styles.badge}>
            <Text variant="sub" color="textMut">
              Plan 3
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: space(2), paddingTop: space(2), paddingBottom: space(3) },
  iconBtn: { width: touch.min, height: touch.min, alignItems: "center", justifyContent: "center", marginVertical: -space(2) },
  grow: { flex: 1 },
  scroll: { gap: space(4), paddingTop: space(1), paddingBottom: space(4) },

  recents: { gap: space(1.5) },
  recentsLabel: { letterSpacing: tracking.label },
  recentRow: {
    minHeight: touch.min,
    justifyContent: "center",
    paddingHorizontal: space(3),
    borderRadius: radius.input,
    borderWidth: stroke.hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
  },

  agentWrap: { gap: space(1.5) },
  agentRow: { flexDirection: "row", gap: space(2) },
  agent: {
    flex: 1,
    minHeight: touch.min,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space(2),
    borderRadius: radius.input,
    borderWidth: stroke.hairline,
  },
  agentOn: { backgroundColor: color.surfaceHi, borderColor: color.accent },
  agentOff: { backgroundColor: color.surface, borderColor: color.border },
  badge: {
    paddingHorizontal: space(2),
    paddingVertical: space(0.5),
    borderRadius: radius.chip,
    borderWidth: stroke.hairline,
    borderColor: color.border,
  },

  footer: { paddingVertical: space(3), gap: space(2) },
  footerHint: { textAlign: "center" },
});
