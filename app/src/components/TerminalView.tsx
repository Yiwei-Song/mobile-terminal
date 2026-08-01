import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { StyleSheet } from "react-native";
import { WebView } from "react-native-webview";

import { sameOrigin } from "../lib/pairing";
import { color } from "../theme";
import { parseHostMessage, type TerminalHandle, type TerminalViewProps } from "./terminalBridge";

/**
 * The daemon-served xterm page, hosted. Everything high-volume (keystrokes, pty
 * output) rides the page's own socket; this component only hands over the token
 * and forwards accessory-row keys.
 */
export const TerminalView = forwardRef<TerminalHandle, TerminalViewProps>(function TerminalView(
  { origin, config, onCtrlConsumed },
  ref,
) {
  const web = useRef<WebView>(null);
  const post = useCallback((m: unknown) => web.current?.postMessage(JSON.stringify(m)), []);

  useImperativeHandle(
    ref,
    () => ({ send: (data) => post({ send: data }), setCtrl: (on) => post({ ctrl: on }) }),
    [post],
  );

  // Both, deliberately: `ready` is posted once at script-eval, which is too early
  // if the RN bridge is not installed yet — and onLoadEnd alone races a page that
  // finished evaluating first. The page ignores the duplicate.
  const handshake = useCallback(() => post(config), [post, config]);

  return (
    <WebView
      ref={web}
      source={{ uri: `${origin}/terminal` }}
      originWhitelist={[origin]}
      // The token is in this frame. A navigation off the daemon's origin (a link
      // in output, a redirect) would carry it somewhere else — refuse it.
      onShouldStartLoadWithRequest={(r) => sameOrigin(r.url, origin)}
      // …and the token post is gated on the URL that actually loaded, not on
      // that interception having worked: RNCWebView's Android client allows a
      // navigation after a 250ms timeout, and does not route POSTs through it
      // at all. Whatever loaded, only the daemon's own page gets the token.
      onLoadEnd={(e) => {
        if (sameOrigin(e.nativeEvent.url, origin)) handshake();
      }}
      onMessage={(e) => {
        const m = parseHostMessage(e.nativeEvent.data);
        if (m?.type === "ready") handshake();
        else if (m?.type === "ctrl" && m.on === false) onCtrlConsumed?.();
      }}
      // Nothing in a terminal is a document to zoom, a form to remember, or a
      // link that should open a second window.
      setSupportMultipleWindows={false}
      allowsBackForwardNavigationGestures={false}
      keyboardDisplayRequiresUserAction={false}
      hideKeyboardAccessoryView
      style={styles.web}
    />
  );
});

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: color.bg },
});
