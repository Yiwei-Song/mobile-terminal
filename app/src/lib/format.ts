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

const UNITS = ["KB", "MB", "GB", "TB"] as const;

/**
 * A file size at a glance: `840 B`, `1.2 KB`, `3.4 MB`, `12 GB`. One decimal
 * under ten, none above — the extra digit stops mattering once the magnitude
 * carries the meaning. Binary (1024) units, which is what the fs reports.
 */
export const bytes = (n: number): string => {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${Math.round(n)} B`;
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${UNITS[i]}`;
};

/**
 * The breadcrumb for `dir` under `root`: the root itself, then one crumb per
 * segment below it. A dir that is not under the root (shouldn't happen — the
 * daemon refuses it) degrades to a single crumb rather than lying about a
 * hierarchy. Never produces a crumb above the root: that is the one place the
 * user cannot go.
 */
export const crumbs = (root: string, dir: string): { label: string; path: string }[] => {
  const sep = root.includes("/") && !root.includes("\\") ? "/" : "\\";
  // On a segment boundary only: `D:\work` is not the root of `D:\workspace\x`.
  const base = root.replace(/[\\/]+$/, "");
  const next = dir.charAt(base.length);
  const under = dir.toLowerCase().startsWith(base.toLowerCase()) && (next === "" || next === "\\" || next === "/");
  if (!under) return [{ label: dir, path: dir }];
  const rest = dir.slice(base.length).split(/[\\/]/).filter((p) => p !== "");
  const out = [{ label: root, path: root }];
  let at = base;
  for (const part of rest) {
    at = `${at}${sep}${part}`;
    out.push({ label: part, path: at });
  }
  return out;
};
