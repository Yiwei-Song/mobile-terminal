import type { PushEvent } from "./protocol.js";

// The whole event→push mapping, pure so the privacy rule is testable: a push
// body lands on a lock screen, which is a public surface, so it names the
// session and nothing else. Never the tool summary the in-app prompt shows —
// that is a command line, often with paths, sometimes with secrets. Only the
// two moments worth waking a phone for map to anything; everything else is null.
export function ntfyFor(e: PushEvent, title: string): { title: string; body: string } | null {
  if (e.kind === "session.permission") return { title: "Workbench", body: `Approval needed · ${title}` };
  if (e.kind === "session.done") return { title: "Workbench", body: `Finished · ${title}` };
  return null;
}

// Fire-and-forget phone push. ntfy.sh needs no account and no SDK — a POST is
// the whole protocol, so there is nothing here to abstract or to test.
export function notify(topic: string | null, title: string, body: string): void {
  if (!topic) return;
  // Never awaited and never rethrown: a flaky push must not fail a session.
  // Encoded: a topic is user-typed config and a stray space or `#` would either
  // break the URL or silently post to a different topic than the one configured.
  fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
    method: "POST",
    body,
    headers: { Title: title },
  }).catch(() => {});
}
