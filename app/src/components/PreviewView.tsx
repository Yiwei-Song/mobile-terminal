import { forwardRef, useImperativeHandle, useRef } from "react";
import { StyleSheet } from "react-native";
import { WebView } from "react-native-webview";

import { allowPreviewNav } from "../lib/pairing";
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
  { url, daemonOrigin, onNav },
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
      originWhitelist={["http://*", "https://*"]}
      // The mirror image of the terminal's rule. That frame may go ONLY to the
      // daemon; this one may go anywhere BUT the daemon — its pages are
      // untrusted, and the daemon serves `/terminal`, which asks for the pairing
      // token in a prompt that looks native once it is inside the app.
      onShouldStartLoadWithRequest={(r) => allowPreviewNav(r.url, daemonOrigin)}
      // Someone else's pages, so nothing they store survives the screen — and in
      // particular nothing lands in the cookie/localStorage jar the terminal
      // WebView shares. Costs a re-login inside a preview session; the
      // open-externally button in the toolbar is the way out of that.
      incognito
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
