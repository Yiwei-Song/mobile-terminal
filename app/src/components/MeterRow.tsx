import { StyleSheet, View, type DimensionValue } from "react-native";

import { color, radius, space, stroke } from "../theme";
import { meterColor } from "./meters";
import { Text } from "./Text";

// Re-exported so the threshold fn is reachable from the component; its home is
// meters.ts, which the tests import without dragging react-native in.
export { meterColor };

export function MeterRow({
  label,
  value,
  max = 100,
  unit,
}: {
  label: string;
  value: number;
  max?: number;
  unit?: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const role = meterColor(pct);
  const fillWidth: DimensionValue = `${pct}%`;
  return (
    <View style={styles.row}>
      <View style={styles.head}>
        <Text variant="sub" color="textMut">{label}</Text>
        <Text variant="sub">{value}{unit ?? ""}</Text>
      </View>
      <View style={styles.barRow}>
        <View style={styles.track}>
          <View style={[styles.fill, { width: fillWidth, backgroundColor: color[role] }]} />
        </View>
        {/* Always shown: the reading a color-blind user relies on instead of the hue. */}
        <Text variant="sub" color="textMut">{Math.round(pct)}%</Text>
      </View>
    </View>
  );
}

const BAR = space(2.5);

const styles = StyleSheet.create({
  row: { gap: space(1.5), paddingVertical: space(1) },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  barRow: { flexDirection: "row", alignItems: "center", gap: space(2) },
  track: {
    flex: 1,
    height: BAR,
    borderRadius: radius.chip,
    backgroundColor: color.surfaceHi,
    borderWidth: stroke.hairline,
    borderColor: color.border,
    overflow: "hidden",
  },
  fill: { height: "100%", borderRadius: radius.chip },
});
