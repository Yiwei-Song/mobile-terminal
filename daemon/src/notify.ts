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
