import { StyleSheet, View } from "react-native";
import type { SessionStatus } from "@shared/protocol";

import { color, radius, space, stroke, type ColorRole } from "../theme";
import { Text } from "./Text";

// Color is never the only signal: the label ships with every chip.
const STATUS: Record<SessionStatus, { label: string; role: ColorRole }> = {
  running: { label: "Running", role: "accent" },
  waiting_on_user: { label: "Needs you", role: "warn" },
  idle: { label: "Idle", role: "idle" },
  dead: { label: "Ended", role: "danger" },
};

export function statusMeta(status: SessionStatus) {
  return STATUS[status];
}

export function StatusChip({ status }: { status: SessionStatus }) {
  const { label, role } = STATUS[status];
  return (
    <View style={[styles.chip, { borderColor: color[role] }]}>
      <View style={[styles.dot, { backgroundColor: color[role] }]} />
      {/* Label stays `text`: idle slate and danger red both fall under 4.5:1 on
          surfaceHi. The hue lives in the dot + border, the meaning in the word. */}
      <Text variant="sub">{label}</Text>
    </View>
  );
}

const DOT = space(2);

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: space(1.5),
    paddingVertical: space(1),
    paddingHorizontal: space(2),
    borderRadius: radius.chip,
    borderWidth: stroke.hairline,
    backgroundColor: color.surfaceHi,
  },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
});
