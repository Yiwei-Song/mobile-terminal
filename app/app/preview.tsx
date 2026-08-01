import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import * as Linking from "expo-linking";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  List,
  MonitorSmartphone,
  RefreshCw,
  RotateCw,
  ShieldAlert,
  Wifi,
  WifiOff,
} from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import type { Port } from "@shared/protocol";

import { BackButton } from "../src/components/BackButton";
import { Button } from "../src/components/Button";
import { Card } from "../src/components/Card";
import { EmptyState } from "../src/components/EmptyState";
import { MonoText } from "../src/components/MonoText";
import { PreviewView } from "../src/components/PreviewView";
import type { PreviewHandle } from "../src/components/previewBridge";
import { Screen } from "../src/components/Screen";
import { Text } from "../src/components/Text";
import { demoMode, seedDemo } from "../src/lib/demo";
import { daemonOrigin, loadPairing, pairingUrl, type Pairing } from "../src/lib/pairing";
import { useWorkbench } from "../src/lib/store";
import { color, icon as iconSize, opacity, radius, space, stroke, touch, tracking } from "../src/theme";

/**
 * Preview: your dev server, on the phone that will actually be used to look at
 * it. Pick a listening port, and the WebView loads `http://<your PC>:<port>` at
 * the device's own width — the same thing the phone's browser would show, which
 * is the entire point of checking a site on a phone.
 *
 * SECURITY: this frame loads arbitrary local servers, so unlike the terminal it
 * is never handed the pairing token. There is no config prop, no postMessage
 * and no injected script — see `previewBridge.ts`.
 */
export default function Preview() {
  const connState = useWorkbench((s) => s.connState);
  const ports = useWorkbench((s) => s.ports);
  const lastError = useWorkbench((s) => s.lastError);
  const refreshPorts = useWorkbench((s) => s.refreshPorts);
  const connect = useWorkbench((s) => s.connect);

  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [port, setPort] = useState<number | null>(null);
  // Where the frame actually is, which is not always where we sent it (a
  // redirect, a link tap). Seeded with the URL we asked for so the toolbar has
  // something true to show before the first navigation event.
  const [nav, setNav] = useState({ url: "", canGoBack: false, canGoForward: false });
  const frame = useRef<PreviewHandle>(null);

  const offline = connState !== "online";
  const unauthorized = connState === "unauthorized";
  // Demo mode has no pairing (it *is* the connection); point the frame at the
  // host the demo ports pretend to live on so the screen renders end to end.
  const host = pairing !== null ? pairing.host : "localhost";
  // Public address, never the token — the frame is told this so it can refuse to
  // navigate *to* the daemon. Empty until paired, which refuses nothing.
  const origin = pairing !== null ? daemonOrigin(pairing) : "";

  useFocusEffect(
    useCallback(() => {
      if (demoMode) {
        seedDemo();
        return;
      }
      void loadPairing().then(setPairing);
      void refreshPorts().catch(() => {});
    }, [refreshPorts]),
  );

  // The socket can come up while this screen is on top; until it does every
  // read rejects, so focus alone is not enough.
  useEffect(() => {
    if (connState === "online") void refreshPorts().catch(() => {});
  }, [connState, refreshPorts]);

  const open = (p: number) => {
    setPort(p);
    setNav({ url: `http://${host}:${p}`, canGoBack: false, canGoForward: false });
  };

  const retry = () => {
    void loadPairing().then((p) => {
      if (p !== null) {
        setPairing(p);
        connect(pairingUrl(p), p.token);
      }
    });
  };

  const back = () => {
    if (port === null) router.back();
    else setPort(null);
  };

  return (
    <Screen>
      <View style={styles.header}>
        <BackButton onPress={back} />
        <View style={styles.headText}>
          <Text variant="h2" numberOfLines={1}>
            Preview
          </Text>
          {port === null ? (
            <Text variant="sub" color="textMut" numberOfLines={1}>
              Your PC&apos;s dev servers, at phone size
            </Text>
          ) : (
            <MonoText numberOfLines={1}>{nav.url}</MonoText>
          )}
        </View>
        {port === null && (
          <IconButton icon={RefreshCw} label="Refresh ports" onPress={() => void refreshPorts().catch(() => {})} />
        )}
      </View>

      {unauthorized ? (
        <Banner icon={ShieldAlert} text="This PC turned the phone away — re-pair to preview its dev servers.">
          <Button label="Re-pair" variant="outline" onPress={() => router.push({ pathname: "/pair", params: { edit: "1" } })} />
        </Banner>
      ) : offline ? (
        <Banner icon={WifiOff} text="Offline — the port list is last-known, and the page itself needs your PC on the same wifi.">
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

      {port !== null ? (
        <>
          <View style={styles.frame}>
            <PreviewView ref={frame} url={`http://${host}:${port}`} daemonOrigin={origin} onNav={setNav} />
          </View>
          {/* Browser chrome at the bottom, where the thumb is. */}
          <View style={styles.toolbar}>
            <IconButton
              icon={ArrowLeft}
              label="Back"
              disabled={!nav.canGoBack}
              onPress={() => frame.current?.back()}
            />
            <IconButton
              icon={ArrowRight}
              label="Forward"
              disabled={!nav.canGoForward}
              onPress={() => frame.current?.forward()}
            />
            <IconButton icon={RotateCw} label="Reload" onPress={() => frame.current?.reload()} />
            <MonoText numberOfLines={1} style={styles.toolbarUrl}>
              {nav.url}
            </MonoText>
            {/* The escape hatch. A WebView has no devtools, no password manager
                and no share sheet — the real browser has all three, and it is
                one tap away rather than a retyped IP. */}
            <IconButton
              icon={ExternalLink}
              label="Open in browser"
              onPress={() => void Linking.openURL(nav.url).catch(() => {})}
            />
            <IconButton icon={List} label="Choose another port" onPress={() => setPort(null)} />
          </View>
        </>
      ) : ports.length === 0 ? (
        <EmptyState
          icon={MonitorSmartphone}
          title="No dev servers listening"
          body="Start one and it shows up here — anything listening on your PC is one tap from rendering at phone size."
          action={<Button label="Refresh" icon={RefreshCw} variant="outline" onPress={() => void refreshPorts().catch(() => {})} />}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text variant="sub" color="textMut" style={styles.sectionLabel}>
            LISTENING ON {host.toUpperCase()}
          </Text>
          {ports.map((p) => (
            <PortRow key={p.port} port={p} onOpen={() => open(p.port)} />
          ))}
        </ScrollView>
      )}
    </Screen>
  );
}

// One listener: the port is the thing you recognise, the process name is how you
// tell two node servers apart.
function PortRow({ port, onOpen }: { port: Port; onOpen: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Preview port ${port.port}`}
      onPress={onOpen}
      style={({ pressed }) => [styles.portRow, pressed && { opacity: opacity.pressed }]}
    >
      <MonoText color="text" style={styles.portNum}>
        :{port.port}
      </MonoText>
      <Text variant="sub" color="textMut" numberOfLines={1} style={styles.flex}>
        {port.process}
      </Text>
    </Pressable>
  );
}

function IconButton({
  icon: Icon,
  label,
  disabled = false,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.iconBtn, disabled && { opacity: opacity.disabled }, pressed && { opacity: opacity.pressed }]}
    >
      <Icon size={iconSize.md} color={color.text} strokeWidth={stroke.icon} />
    </Pressable>
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

  scroll: { gap: space(2), paddingTop: space(1), paddingBottom: space(6) },
  sectionLabel: { letterSpacing: tracking.label },
  portRow: {
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
  portNum: { minWidth: space(16) },

  // The page gets its own frame so someone else's white canvas reads as a
  // surface inside the app rather than as a hole in it.
  frame: {
    flex: 1,
    overflow: "hidden",
    borderRadius: radius.card,
    borderWidth: stroke.hairline,
    borderColor: color.border,
    backgroundColor: color.bg,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(1),
    marginHorizontal: -space(4),
    paddingHorizontal: space(3),
    paddingVertical: space(1),
    marginTop: space(2),
    borderTopWidth: stroke.hairline,
    borderTopColor: color.border,
    backgroundColor: color.surface,
  },
  toolbarUrl: { flex: 1, marginHorizontal: space(1) },
  iconBtn: { width: touch.min, height: touch.min, alignItems: "center", justifyContent: "center" },
});
