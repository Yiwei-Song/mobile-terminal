import { StyleSheet, View } from "react-native";
import type { SessionStatus } from "@shared/protocol";

import { color, radius, space, stroke, type ColorRole } from "../theme";
import { Text } from "./Text";

// Color is never the only signal: the word ships with every chip.
const STATUS: Record<SessionStatus, { label: string; role: ColorRole }> = {
  running: { label: "Running", role: "accent" },
  waiting_on_user: { label: "Needs you", role: "warn" },
  idle: { label: "Idle", role: "idle" },
  dead: { label: "Ended", role: "danger" },
};

export function statusMeta(status: SessionStatus) {
  return STATUS[status];
}

/**
 * One status, one chip. Only the state that wants a thumb is filled — the other
 * three are outlines, so a list of six sessions has exactly as many loud things
 * in it as there are things to answer.
 */
export function StatusChip({ status }: { status: SessionStatus }) {
  const { label, role } = STATUS[status];
  const filled = status === "waiting_on_user";
  return (
    <View style={[styles.chip, filled ? { backgroundColor: color[role] } : { borderColor: color[role] }]}>
      {/* `type.micro` carries the uppercase and its tracking — nothing here
          restates them. */}
      <Text variant="micro" color={filled ? "accentText" : role}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: "flex-start",
    paddingVertical: space(1),
    paddingHorizontal: space(1.5),
    borderRadius: radius.chip,
    borderWidth: stroke.hairline,
    // Transparent by default: the outlined variant shows the card through it.
    borderColor: "transparent",
  },
});
