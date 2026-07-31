import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import Constants from "expo-constants";
import { ChevronRight, Dices } from "lucide-react-native";

import { BackButton } from "../src/components/BackButton";
import { Button } from "../src/components/Button";
import { Card } from "../src/components/Card";
import { Field } from "../src/components/Field";
import { MonoText } from "../src/components/MonoText";
import { Notice } from "../src/components/Notice";
import { Screen } from "../src/components/Screen";
import { Text } from "../src/components/Text";
import { clearPairing, loadPairing, webInsecureStorage, type Pairing } from "../src/lib/pairing";
import { useWorkbench } from "../src/lib/store";
import { color, icon as iconSize, opacity, space, stroke } from "../src/theme";

const HEX = "0123456789abcdef";
// wb- plus 12 hex: obscure enough that a topic isn't stumbled onto, short enough
// to read off a screen. Math.random is not a CSPRNG — a topic is obscurity, not
// a secret, and the daemon is what actually authenticates.
const randomTopic = (): string =>
  `wb-${Array.from({ length: 12 }, () => HEX[Math.floor(Math.random() * HEX.length)]).join("")}`;

export default function Settings() {
  const machine = useWorkbench((s) => s.machine);
  const connState = useWorkbench((s) => s.connState);
  const lastError = useWorkbench((s) => s.lastError);
  const setNtfyTopic = useWorkbench((s) => s.setNtfyTopic);
  const disconnect = useWorkbench((s) => s.disconnect);

  const [pairing, setPairing] = useState<Pairing | null>(null);
  // null until config.get lands, so an empty box never looks like "no topic set".
  const [topic, setTopic] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    void loadPairing().then(setPairing);
  }, []);

  // config.get already ran on connect and its answer is `machine` — adopt it
  // once, then leave the box alone so a save-in-progress edit is not clobbered.
  useEffect(() => {
    setTopic((t) => (t === null && machine !== null ? (machine.ntfyTopic ?? "") : t));
  }, [machine]);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await setNtfyTopic((topic ?? "").trim() === "" ? null : (topic ?? "").trim());
      setSaved(true);
    } catch {
      // The store already put the reason in lastError, rendered below.
    } finally {
      setSaving(false);
    }
  };

  // edit=1, not the pairing itself: the pair screen reads that from storage, so
  // the token never lands in a URL, browser history or saved nav state.
  const rePair = () => router.push(pairing === null ? "/pair" : { pathname: "/pair", params: { edit: "1" } });

  const doDisconnect = async () => {
    await clearPairing();
    disconnect();
    router.replace("/pair");
  };

  return (
    <Screen>
      <View style={styles.header}>
        <BackButton />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text variant="title">Settings</Text>

        <Card>
          <Text variant="sub" color="textMut">
            Machine
          </Text>
          {machine === null ? (
            <Text variant="body" color="textMut" style={styles.value}>
              {connState === "connecting" ? "Connecting…" : "Not connected"}
            </Text>
          ) : (
            <>
              <Text variant="body" style={styles.value}>
                {machine.hostname}
              </Text>
              <MonoText>daemon v{machine.version}</MonoText>
            </>
          )}
        </Card>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Server — tap to re-pair"
          onPress={rePair}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Card>
            <View style={styles.rowBetween}>
              <View style={styles.grow}>
                <Text variant="sub" color="textMut">
                  Server
                </Text>
                <MonoText color="text" style={styles.value}>
                  {pairing === null ? "not paired" : `${pairing.host}:${pairing.port}`}
                </MonoText>
                <Text variant="sub" color="textMut">
                  Tap to scan a new QR or edit the address.
                </Text>
              </View>
              <ChevronRight size={iconSize.lg} color={color.idle} strokeWidth={stroke.icon} />
            </View>
          </Card>
        </Pressable>

        <Card>
          <Text variant="sub" color="textMut">
            Notifications
          </Text>
          <Text variant="body" color="textMut" style={styles.value}>
            Get pushed when an agent needs you — install the ntfy app and subscribe to this topic.
          </Text>
          <View style={styles.topicRow}>
            <View style={styles.grow}>
              <Field
                label="ntfy topic"
                value={topic ?? ""}
                onChangeText={(v) => {
                  setTopic(v);
                  setSaved(false);
                }}
                placeholder="not set — tap Generate"
                editable={machine !== null}
                mono
              />
            </View>
          </View>
          <View style={styles.rowActions}>
            <Button
              label="Generate"
              variant="outline"
              icon={Dices}
              disabled={machine === null}
              onPress={() => {
                setTopic(randomTopic());
                setSaved(false);
              }}
            />
            <Button label="Save" fill loading={saving} disabled={machine === null} onPress={() => void save()} />
          </View>
          {saved && (
            <Text variant="sub" color="accent" style={styles.value}>
              Saved. Subscribe to it in the ntfy app to start getting pushes.
            </Text>
          )}
          {machine === null && (
            <Text variant="sub" color="textMut" style={styles.value}>
              Connect to the daemon to change this.
            </Text>
          )}
          {lastError !== null && (
            <Text variant="sub" color="danger" style={styles.value}>
              {lastError}
            </Text>
          )}
        </Card>

        {webInsecureStorage && (
          <Notice
            title="Web preview storage"
            body="This browser has no keystore, so the pairing token sits in localStorage — less secure than the phone build, which uses the device keystore."
          />
        )}

        <Card>
          <Text variant="sub" color="textMut">
            App version
          </Text>
          <MonoText color="text" style={styles.value}>
            {Constants.expoConfig?.version ?? "dev"}
          </MonoText>
        </Card>
      </ScrollView>

      <View style={styles.actions}>
        {confirming ? (
          <>
            <Text variant="sub" color="textMut" style={styles.center}>
              Forget this PC? The token is deleted and you'll have to pair again.
            </Text>
            <View style={styles.rowActions}>
              <Button label="Cancel" variant="outline" fill onPress={() => setConfirming(false)} />
              <Button label="Disconnect" variant="danger" fill onPress={() => void doDisconnect()} />
            </View>
          </>
        ) : (
          <Button label="Disconnect" variant="danger" fill onPress={() => setConfirming(true)} />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", paddingTop: space(2) },
  scroll: { gap: space(3), paddingTop: space(2), paddingBottom: space(4) },
  value: { marginTop: space(1) },
  center: { textAlign: "center" },
  grow: { flex: 1 },
  rowBetween: { flexDirection: "row", alignItems: "center", gap: space(3) },
  rowActions: { flexDirection: "row", gap: space(2), marginTop: space(3) },
  topicRow: { marginTop: space(3) },
  actions: { gap: space(2), paddingVertical: space(4) },
  pressed: { opacity: opacity.pressed },
});
