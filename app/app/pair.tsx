import { useEffect, useRef, useState } from "react";
import { Platform, ScrollView, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { Camera, Keyboard, ScanLine, X } from "lucide-react-native";

import { Button } from "../src/components/Button";
import { Card } from "../src/components/Card";
import { Field } from "../src/components/Field";
import { MonoText } from "../src/components/MonoText";
import { Notice } from "../src/components/Notice";
import { Screen } from "../src/components/Screen";
import { Text } from "../src/components/Text";
import { loadPairing, parsePairing, savePairing, verify, webInsecureStorage, type Pairing } from "../src/lib/pairing";
import { color, radius, space, stroke } from "../src/theme";

type Mode = "intro" | "manual" | "permission" | "scanning";
type Failure = { title: string; body: string; retry: Pairing | null };

// Camera scanning needs a camera; the web review build does not have one.
const CAN_SCAN = Platform.OS !== "web";

export default function Pair() {
  // Settings' "Server" row sets edit=1 so a re-pair is an edit, not a retype.
  // Only the flag travels: the pairing itself is read from storage here, keeping
  // the token out of the route URL (web address bar, history, nav state).
  const { edit } = useLocalSearchParams<{ edit?: string }>();

  const [mode, setMode] = useState<Mode>(edit === undefined ? "intro" : "manual");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("8790");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  // The camera fires this repeatedly while the QR stays in frame.
  const scanned = useRef(false);

  useEffect(() => {
    if (edit === undefined) return;
    void loadPairing().then((p) => {
      if (p === null) return;
      setHost(p.host);
      setPort(String(p.port));
      setToken(p.token);
    });
  }, [edit]);

  const submit = async (p: Pairing) => {
    setFailure(null);
    setBusy(true);
    const state = await verify(p);
    setBusy(false);
    if (state === "online") {
      try {
        // Home connects itself on focus, so landing there is the whole job.
        await savePairing(p);
        router.replace("/");
        return;
      } catch {
        setMode("manual");
        setFailure({
          title: "Couldn't save the pairing",
          body: "The daemon answered, but this device wouldn't store the token. Try again — if it keeps failing, restart the app.",
          retry: p,
        });
        return;
      }
    }
    setMode("manual");
    setFailure(
      state === "unauthorized"
        ? {
            title: "Token rejected",
            body: "The daemon refused this token — re-scan the QR (did the daemon regenerate it?).",
            retry: null,
          }
        : {
            title: `Can't reach ${p.host}:${p.port}`,
            body: "Same wifi? VPN off? Is the daemon still running on your PC?",
            retry: p,
          },
    );
  };

  const submitManual = () => {
    const n = Number(port);
    if (host.trim() === "" || token.trim() === "" || !Number.isInteger(n) || n < 1 || n > 65535) {
      setFailure({ title: "Check the details", body: "Host and token can't be empty, and the port is 1-65535.", retry: null });
      return;
    }
    void submit({ host: host.trim(), port: n, token: token.trim() });
  };

  const startScan = async () => {
    setFailure(null);
    if (permission?.granted === true) {
      scanned.current = false;
      setMode("scanning");
      return;
    }
    setMode("permission");
  };

  const allowCamera = async () => {
    const r = await requestPermission();
    if (r.granted) {
      scanned.current = false;
      setMode("scanning");
      return;
    }
    setMode("manual");
    setFailure({
      title: "Camera not allowed",
      body: "No camera, no QR — but the daemon prints the host, port and token too. Type them in below.",
      retry: null,
    });
  };

  // Hoisted out of the JSX: a const keeps its narrowing inside the onPress
  // closure, where a `failure.retry` property check would not.
  const retry = failure?.retry ?? null;

  const onBarcode = (r: BarcodeScanningResult) => {
    if (scanned.current) return;
    scanned.current = true;
    // The daemon's QR is JSON: exactly the fields storage holds.
    const p = parsePairing(r.data);
    setMode("manual");
    if (p === null) {
      setFailure({ title: "Not a pairing QR", body: "That code isn't from the workbench daemon. Scan the one your PC printed.", retry: null });
      return;
    }
    setHost(p.host);
    setPort(String(p.port));
    setToken(p.token);
    void submit(p);
  };

  if (mode === "scanning") {
    return (
      <View style={styles.scanner}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={onBarcode}
        />
        <View style={[StyleSheet.absoluteFill, styles.scanHud]}>
          <View style={styles.reticle} />
          <Text variant="body" style={styles.scanHint}>
            Point at the QR code in your terminal
          </Text>
          <Button label="Cancel" variant="outline" icon={X} onPress={() => setMode("intro")} />
        </View>
      </View>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text variant="title">Pair with your PC</Text>

        {failure !== null && (
          <Card accentEdge="danger">
            <Text variant="h2" color="danger">
              {failure.title}
            </Text>
            <Text variant="body" color="textMut" style={styles.gapTop}>
              {failure.body}
            </Text>
            <View style={styles.rowActions}>
              {retry !== null && <Button label="Retry" icon={ScanLine} onPress={() => void submit(retry)} />}
              {CAN_SCAN && <Button label="Re-scan QR" variant="outline" icon={Camera} onPress={() => void startScan()} />}
            </View>
          </Card>
        )}

        {mode === "permission" ? (
          <Card>
            <Text variant="h2">Camera access</Text>
            <Text variant="body" color="textMut" style={styles.gapTop}>
              The camera is used for one thing: reading the pairing QR your daemon prints. Nothing is recorded or sent
              anywhere.
            </Text>
          </Card>
        ) : mode === "manual" ? (
          <>
            <Field
              label="Host"
              value={host}
              onChangeText={setHost}
              placeholder="e.g. 192.168.1.24"
              keyboardType="url"
              inputMode="url"
              mono
            />
            <Field label="Port" value={port} onChangeText={setPort} placeholder="8790" keyboardType="number-pad" mono />
            <Field
              label="Token"
              value={token}
              onChangeText={setToken}
              placeholder="paste from the daemon"
              hint="The daemon prints all three next to the QR code."
              multiline
              mono
            />
          </>
        ) : (
          <>
            <Card>
              <Text variant="h2">1 · Start the daemon</Text>
              <Text variant="body" color="textMut" style={styles.gapTop}>
                Run the Workbench daemon on your PC — it prints a QR code in the terminal.
              </Text>
              <View style={styles.cmd}>
                <MonoText color="text">npm run dev</MonoText>
              </View>
            </Card>
            <Card>
              <Text variant="h2">2 · Scan the QR</Text>
              <Text variant="body" color="textMut" style={styles.gapTop}>
                Your phone talks to the PC directly over your wifi. Nothing goes through the internet.
              </Text>
            </Card>
          </>
        )}

        {webInsecureStorage && (
          <Notice
            title="Web preview storage"
            body="This browser has no keystore, so the pairing token sits in localStorage — less secure than the phone build, which uses the device keystore."
          />
        )}
      </ScrollView>

      {/* Bottom-anchored: the primary action stays under the thumb. */}
      <View style={styles.actions}>
        {mode === "permission" ? (
          <>
            <Button label="Allow camera" icon={Camera} fill onPress={() => void allowCamera()} />
            <Button label="Enter manually instead" variant="ghost" onPress={() => setMode("manual")} />
          </>
        ) : mode === "manual" ? (
          <>
            <Button
              label={busy ? "Connecting…" : "Connect"}
              loading={busy}
              disabled={host.trim() === "" || token.trim() === ""}
              fill
              onPress={submitManual}
            />
            {CAN_SCAN && <Button label="Scan QR instead" variant="ghost" icon={Camera} onPress={() => void startScan()} />}
          </>
        ) : CAN_SCAN ? (
          <>
            <Button label="Scan QR code" icon={Camera} fill loading={busy} onPress={() => void startScan()} />
            <Button label="Enter manually" variant="ghost" icon={Keyboard} onPress={() => setMode("manual")} />
          </>
        ) : (
          // No camera in a web preview: the real action is manual entry, so it
          // gets the primary slot rather than a disabled Scan button as the hero.
          <>
            <Button label="Enter manually" icon={Keyboard} fill onPress={() => setMode("manual")} />
            <Text variant="sub" color="textMut" style={styles.center}>
              No camera in the browser — enter the host, port and token by hand.
            </Text>
          </>
        )}
      </View>
    </Screen>
  );
}

const RETICLE = space(56);

const styles = StyleSheet.create({
  scroll: { gap: space(4), paddingTop: space(4), paddingBottom: space(4) },
  gapTop: { marginTop: space(2) },
  center: { textAlign: "center" },
  cmd: {
    marginTop: space(3),
    padding: space(3),
    borderRadius: radius.chip,
    backgroundColor: color.bg,
    borderWidth: stroke.hairline,
    borderColor: color.border,
  },
  rowActions: { flexDirection: "row", gap: space(2), marginTop: space(3) },
  actions: { gap: space(2), paddingVertical: space(4) },
  scanner: { flex: 1, backgroundColor: color.bg },
  scanHud: { alignItems: "center", justifyContent: "center", gap: space(4), padding: space(4) },
  reticle: {
    width: RETICLE,
    height: RETICLE,
    borderRadius: radius.card,
    borderWidth: stroke.emphasis,
    borderColor: color.accent,
  },
  scanHint: { textAlign: "center" },
});
