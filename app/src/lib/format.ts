// Two pure string helpers the list rows and the machine bar both need. They
// live here, not in a component, because they are the only logic on the home
// screen worth a test.

/**
 * Coarse relative time — "just now" / "5m" / "3h" / "2d". A list row answers
 * "how stale is this", never "when exactly", so nothing finer is honest.
 * A future timestamp (the phone's clock running behind the PC's) reads as
 * "just now" rather than a negative age.
 */
export const since = (at: string | number): string => {
  const m = Math.floor((Date.now() - (typeof at === "number" ? at : Date.parse(at))) / 60_000);
  if (!Number.isFinite(m) || m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
};

/**
 * Uptime as its two coarsest units: "3d 4h" past a day, "5h 12m" past an hour,
 * "8m" under one. Seconds never show — a glance wants magnitude, not precision.
 * Negative (phone clock ahead of the PC's) floors at "0m".
 */
export const uptime = (sec: number): string => {
  const m = Math.max(0, Math.floor(sec / 60));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
};

/**
 * The last two segments of a working directory: `D:\projects\api-server` →
 * `…\projects\api-server`. The tail is what names a project; the drive and the
 * home prefix are the same on every row and only cost width on a phone.
 */
export const cwdTail = (cwd: string): string => {
  const parts = cwd.split(/[\\/]/).filter((p) => p !== "");
  if (parts.length <= 2) return cwd;
  const sep = cwd.includes("\\") ? "\\" : "/";
  return `…${sep}${parts.slice(-2).join(sep)}`;
};
