import { useEffect, useRef, useState } from "react";
import { Animated, ScrollView, StyleSheet, View } from "react-native";
import { ShieldAlert } from "lucide-react-native";

import { cwdTail } from "../lib/format";
import { useReducedMotion } from "../lib/motion";
import type { Approval } from "../lib/store";
import { toolLabel } from "../lib/tools";
import { color, icon as iconSize, motion, radius, space, stroke, type as typeScale } from "../theme";
import { Button } from "./Button";
import { Card } from "./Card";
import { MonoText } from "./MonoText";
import { Text } from "./Text";

// Journey principle 2: approval is the hero. Full context (tool, command, cwd)
// and two big thumb-reachable buttons — Deny left, Allow right — pinned above
// the composer so the decision is never buried in the scroll.
export function ApprovalCard({
  approval,
  total,
  onDecide,
}: {
  approval: Approval;
  /** Queue length — shows "1 of N" when several are pending. */
  total: number;
  onDecide(allow: boolean): void;
}) {
  const reduced = useReducedMotion();
  // 0 = off-stage/faded, 1 = in place. Mount slides it in; a decision slides it
  // back out before the store drops it, so the resolve reads as an exit, not a
  // vanish. The store removes optimistically, so onDecide is what ends the card.
  const appear = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const [busy, setBusy] = useState<boolean | null>(null);

  useEffect(() => {
    // reduced resolves async (false on first render), so seeding appear isn't
    // enough — snap to shown when it lands true, otherwise the mount slide-in
    // has already fired.
    if (reduced) {
      appear.setValue(1);
      return;
    }
    Animated.timing(appear, { toValue: 1, duration: motion.base, useNativeDriver: true }).start();
  }, [reduced, appear]);

  const decide = (allow: boolean) => {
    if (busy !== null) return;
    setBusy(allow);
    if (reduced) {
      onDecide(allow);
      return;
    }
    Animated.timing(appear, { toValue: 0, duration: motion.slow, useNativeDriver: true }).start(() => onDecide(allow));
  };

  const animStyle = {
    opacity: appear,
    transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [space(4), 0] }) }],
  };

  return (
    <Animated.View style={animStyle}>
      <Card accentEdge="warn" raised style={styles.card}>
        <View style={styles.head}>
          <ShieldAlert size={iconSize.md} color={color.warn} strokeWidth={stroke.icon} />
          <Text variant="h2" style={styles.title} numberOfLines={1}>
            {toolLabel(approval.toolName)}
          </Text>
          {total > 1 && (
            <Text variant="sub" color="textMut">
              1 of {total}
            </Text>
          )}
        </View>

        {/* The command is the thing being decided: full-strength text, not muted.
            Every character must be reachable, so long lines WRAP — never a
            horizontal clip. Caps at ~8 wrapped lines before scrolling inside so
            the card never eats the transcript. */}
        <View style={styles.codeBox}>
          <ScrollView style={styles.codeScroll} showsVerticalScrollIndicator nestedScrollEnabled>
            <MonoText color="text" style={styles.code}>
              {approval.summary}
            </MonoText>
          </ScrollView>
        </View>

        <MonoText numberOfLines={1}>{cwdTail(approval.cwd)}</MonoText>

        <View style={styles.buttons}>
          <Button
            label="Deny"
            variant="outline"
            fill
            loading={busy === false}
            disabled={busy !== null}
            onPress={() => decide(false)}
          />
          <Button
            label="Allow"
            variant="primary"
            fill
            loading={busy === true}
            disabled={busy !== null}
            onPress={() => decide(true)}
          />
        </View>
      </Card>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space(3) },
  head: { flexDirection: "row", alignItems: "center", gap: space(2) },
  title: { flexShrink: 1 },
  codeBox: {
    backgroundColor: color.bg,
    borderRadius: radius.input,
    borderWidth: stroke.hairline,
    borderColor: color.border,
  },
  // Eight wrapped mono lines before it scrolls internally: enough to read most
  // commands whole, capped so the card never eats the transcript.
  codeScroll: { maxHeight: typeScale.mono.lineHeight * 8 + space(4) },
  code: { padding: space(3) },
  buttons: { flexDirection: "row", gap: space(3) },
});
