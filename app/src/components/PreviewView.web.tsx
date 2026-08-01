import { forwardRef, useImperativeHandle, useState } from "react";

import { canvas } from "../theme";
import type { PreviewHandle, PreviewViewProps } from "./previewBridge";

/**
 * The web build of the same thing: react-native-webview has no web
 * implementation, and the browser already has the primitive. Same contract, so
 * the screen is platform-blind — and, as on device, nothing is posted into it.
 */
export const PreviewView = forwardRef<PreviewHandle, PreviewViewProps>(function PreviewView({ url }, ref) {
  const [nonce, setNonce] = useState(0);

  useImperativeHandle(
    ref,
    () => ({
      // A cross-origin iframe exposes postMessage and location to its parent,
      // never its history — so back/forward genuinely cannot work here and are
      // honest no-ops (the screen keeps them disabled: onNav never fires, so
      // canGoBack/canGoForward stay false). Reload is a remount.
      back: () => {},
      forward: () => {},
      reload: () => setNonce((n) => n + 1),
    }),
    [],
  );

  return (
    <iframe
      key={nonce}
      title="Preview"
      src={url}
      // No allow-top-navigation: a hostile preview page must not be able to
      // steer the app window itself. Omitting allow-same-origin is what makes
      // the rest of the list safe to grant — the page runs in an opaque origin,
      // so nothing it stores can reach the app's.
      sandbox="allow-scripts allow-forms allow-popups"
      style={{ flex: 1, width: "100%", border: "none", background: canvas }}
    />
  );
});
