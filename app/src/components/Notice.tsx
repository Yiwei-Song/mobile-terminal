import { StyleSheet, View } from "react-native";
import { Info, type LucideIcon } from "lucide-react-native";

import { color, icon as iconSize, space, stroke, type ColorRole } from "../theme";
import { Card } from "./Card";
import { Text } from "./Text";

// One carded advisory used everywhere the same low-stakes note appears (e.g. the
// web-preview storage warning). `warn` amber is reserved for waiting_on_user, so
// advisories are `info` or a neutral muted treatment — never amber.
type Tone = "info" | "neutral";

export function Notice({
  title,
  body,
  tone = "info",
  icon: Icon = Info,
}: {
  title?: string;
  body: string;
  tone?: Tone;
  icon?: LucideIcon;
}) {
  const role: ColorRole = tone === "info" ? "info" : "textMut";
  return (
    <Card style={styles.card}>
      <Icon size={iconSize.lg} color={color[role]} strokeWidth={stroke.icon} />
      <View style={styles.body}>
        {title !== undefined && (
          <Text variant="sub" color={role}>
            {title}
          </Text>
        )}
        <Text variant="body" color="textMut" style={title !== undefined && styles.gapTop}>
          {body}
        </Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "flex-start", gap: space(3) },
  body: { flex: 1 },
  gapTop: { marginTop: space(1) },
});
