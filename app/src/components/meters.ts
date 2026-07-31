// The pure math behind Sparkline and MeterRow, split out from the .tsx so it can
// be unit-tested under node — importing anything that pulls in react-native (or
// react-native-svg) crashes vitest on its Flow syntax. The components re-export
// these, so callers can still reach them from Sparkline.tsx / MeterRow.tsx.
import type { ColorRole } from "../theme";

const round = (n: number): number => Math.round(n * 100) / 100;

// Values run 0..max, read left→right oldest→newest, mapped into a w×h box with 0
// at the bottom and max at the top. Empty → "" (nothing to draw); a single value
// yields one coord (a Polyline of one point simply draws nothing). Out-of-range
// values are clamped rather than allowed to escape the box.
export function sparklinePoints(values: number[], w: number, h: number, max = 100): string {
  if (values.length === 0) return "";
  const stepX = values.length > 1 ? w / (values.length - 1) : 0;
  return values
    .map((v, i) => {
      const clamped = Math.max(0, Math.min(max, v));
      const y = h - (max > 0 ? clamped / max : 0) * h;
      return `${round(i * stepX)},${round(y)}`;
    })
    .join(" ");
}

// Color is a second signal, never the only one (the numeric % ships alongside).
// Thresholds: healthy < 70, warm < 90, hot ≥ 90.
export function meterColor(pct: number): ColorRole {
  if (pct >= 90) return "danger";
  if (pct >= 70) return "warn";
  return "accent";
}
