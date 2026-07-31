import Svg, { Polyline, Rect } from "react-native-svg";

import { color, radius, space, stroke } from "../theme";
import { sparklinePoints } from "./meters";

// Re-exported so the pure mapping is reachable from the component too; its home
// is meters.ts, which the tests import without dragging react-native-svg in.
export { sparklinePoints };

// Fixed viewBox — the Svg stretches to the row width, the polyline is mapped in
// these units. preserveAspectRatio="none" lets it fill; a non-scaling stroke
// keeps the line crisp despite the non-uniform scale.
const W = 100;
const H = 32;

export function Sparkline({ values, max = 100 }: { values: number[]; max?: number }) {
  return (
    <Svg width="100%" height={space(8)} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <Rect x={0} y={0} width={W} height={H} rx={radius.chip} fill={color.surfaceHi} />
      {values.length > 0 && (
        <Polyline
          points={sparklinePoints(values, W, H, max)}
          fill="none"
          stroke={color.accent}
          strokeWidth={stroke.emphasis}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </Svg>
  );
}
