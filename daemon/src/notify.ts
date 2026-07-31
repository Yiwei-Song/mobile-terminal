// Fire-and-forget phone push. ntfy.sh needs no account and no SDK — a POST is
// the whole protocol, so there is nothing here to abstract or to test.
export function notify(topic: string | null, title: string, body: string): void {
  if (!topic) return;
  // Never awaited and never rethrown: a flaky push must not fail a session.
  fetch(`https://ntfy.sh/${topic}`, { method: "POST", body, headers: { Title: title } }).catch(() => {});
}
