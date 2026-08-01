// The contract between the preview screen and whichever PreviewView the
// platform picks (react-native-webview on device, an iframe on web). Shared
// here for the same reason terminalBridge.ts is: a `.web.tsx` importing its own
// base specifier resolves to itself.
//
// Note what is NOT in this contract: a token, a config, a postMessage channel.
// The preview frame loads whatever the user's dev server serves, so it is the
// one WebView in the app that must never be handed the pairing secret.

export interface PreviewNav {
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface PreviewHandle {
  back(): void;
  forward(): void;
  reload(): void;
}

export interface PreviewViewProps {
  /** `http://<daemon host>:<port>` — the dev server the user picked. */
  url: string;
  /**
   * The daemon's own HTTP origin — a public address, not a secret. Passed in so
   * the frame can REFUSE to navigate there: the daemon serves the terminal page,
   * and a hostile preview page must not be able to put it in front of the user.
   */
  daemonOrigin: string;
  /** Where the frame actually ended up, so the toolbar can tell the truth. */
  onNav?: (n: PreviewNav) => void;
}
