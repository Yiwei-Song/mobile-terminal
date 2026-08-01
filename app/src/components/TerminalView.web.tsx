import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";

import { color } from "../theme";
import { parseHostMessage, type TerminalHandle, type TerminalViewProps } from "./terminalBridge";

/**
 * The web build of the same thing: react-native-webview has no web
 * implementation (it renders "does not support this platform"), and the browser
 * already has the primitive — a cross-origin iframe with postMessage. Same
 * contract, so the screen is platform-blind.
 */
export const TerminalView = forwardRef<TerminalHandle, TerminalViewProps>(function TerminalView(
  { origin, config, onCtrlConsumed },
  ref,
) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  // Targeted at the daemon's origin, never "*": this message carries the token.
  const post = useCallback(
    (m: unknown) => frame.current?.contentWindow?.postMessage(JSON.stringify(m), origin),
    [origin],
  );

  useImperativeHandle(
    ref,
    () => ({ send: (data) => post({ send: data }), setCtrl: (on) => post({ ctrl: on }) }),
    [post],
  );

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== origin || typeof e.data !== "string") return;
      const m = parseHostMessage(e.data);
      if (m?.type === "ready") post(config);
      else if (m?.type === "ctrl" && m.on === false) onCtrlConsumed?.();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [origin, config, post, onCtrlConsumed]);

  return (
    <iframe
      ref={frame}
      title="Terminal"
      // The browser enforces the origin pin here: an iframe cannot navigate its
      // parent, and everything it receives is targeted at `origin`.
      src={`${origin}/terminal`}
      onLoad={() => post(config)}
      style={{ flex: 1, width: "100%", border: "none", background: color.bg }}
    />
  );
});
