// The contract between the screen and whichever TerminalView the platform picks
// (react-native-webview on device, an iframe on web). Shared here rather than in
// either file: a `.web.tsx` importing its own base specifier resolves to itself.

/** What the page needs to attach: the token, and which pty (or where to start one). */
export interface TerminalConfig {
  token: string;
  termId?: string;
  cwd?: string;
}

export interface TerminalHandle {
  /** Type raw bytes into the pty (escape sequences included). */
  send(data: string): void;
  /** Arm/disarm the page's one-shot Ctrl modifier. */
  setCtrl(on: boolean): void;
}

export interface TerminalViewProps {
  /** The daemon's HTTP origin. The page may never navigate off it. */
  origin: string;
  config: TerminalConfig;
  /** The page used up the armed Ctrl — the row's highlight follows this. */
  onCtrlConsumed?: () => void;
}

/** The page's own status messages. Anything unparseable is not ours. */
export const parseHostMessage = (raw: string): { type?: string; on?: boolean } | null => {
  try {
    const v: unknown = JSON.parse(raw);
    return typeof v === "object" && v !== null ? (v as { type?: string; on?: boolean }) : null;
  } catch {
    return null;
  }
};
