import { forwardRef, useImperativeHandle, useRef } from "react";
import { StyleSheet } from "react-native";
import { WebView } from "react-native-webview";

import { canvas } from "../theme";
import type { PreviewHandle, PreviewViewProps } from "./previewBridge";

/**
 * A dev server, rendered on the phone. Deliberately the *opposite* of
 * TerminalView: that one pins an origin because it carries the pairing token,
 * this one carries nothing and loads whatever the user's own server serves.
 * There is no postMessage, no injectedJavaScript and no config prop here, and
 * that absence is the security design — see previewBridge.ts.
 *
 * Viewport: nothing is overridden. The system WebView already reports a mobile
 * user agent and lays out at the device's own width, so a responsive page
 * renders exactly as it would in the phone's browser — including a page with no
 * `<meta viewport>`, which zooms out the same way Chrome does. Faking a
 * narrower viewport or a different UA would make the preview lie.
 */
export const PreviewView = forwardRef<PreviewHandle, PreviewViewProps>(function PreviewView(
  { url, onNav },
  ref,
) {
  const web = useRef<WebView>(null);

  useImperativeHandle(
    ref,
    () => ({
      back: () => web.current?.goBack(),
      forward: () => web.current?.goForward(),
      reload: () => web.current?.reload(),
    }),
    [],
  );

  return (
    <WebView
      ref={web}
      source={{ uri: url }}
      // The frame's own history is the truth about where it is — a redirect or a
      // link tap moves it somewhere the screen never asked for.
      onNavigationStateChange={(s) => onNav?.({ url: s.url, canGoBack: s.canGoBack, canGoForward: s.canGoForward })}
      // A dev server that calls window.open would otherwise strand a page in a
      // second frame this screen has no chrome for.
      setSupportMultipleWindows={false}
      style={styles.web}
    />
  );
});

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: canvas },
});
