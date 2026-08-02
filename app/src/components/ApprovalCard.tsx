import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Folder, Terminal } from "lucide-react-native";

import { cwdTail } from "../lib/format";
import { useReducedMotion, usePressScale } from "../lib/motion";
import type { Approval } from "../lib/store";
import { toolLabel } from "../lib/tools";
import { color, easing, icon as iconSize, motion, opacity, radius, space, stroke, touch, type as typeScale } from "../theme";
import { Card } from "./Card";
import { MonoText } from "./MonoText";
import { Text } from "./Text";

// Journey principle 2: approval is the hero. Full context (tool, command, cwd)
// and two big thumb-reachable pills — Deny left, Allow right — pinned above
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
  // 0 = faded (and, unless reduce-motion is on, a hair small), 1 = in place.
  // Mount eases it in; a decision fades it back out before the store drops it,
  // so the resolve reads as an exit, not a vanish. The store removes
  // optimistically, so onDecide is what ends the card.
  const appear = useRef(new Animated.Value(0)).current;
  const [busy, setBusy] = useState<boolean | null>(null);

  useEffect(() => {
    Animated.timing(appear, {
      toValue: 1,
      duration: motion.base,
      easing: easing.out,
      useNativeDriver: true,
    }).start();
  }, [appear]);

  const decide = (allow: boolean) => {
    if (busy !== null) return;
    setBusy(allow);
    // Out faster than in: the decision is already made, so the card should get
    // out of the way quicker than it arrived.
    Animated.timing(appear, { toValue: 0, duration: motion.exit, useNativeDriver: true }).start(() => onDecide(allow));
  };

  const animStyle = {
    opacity: appear,
    // Reduce motion: the fade stays, the scale goes.
    transform: reduced ? [] : [{ scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) }],
  };

  return (
    <Animated.View style={animStyle}>
      <Card accentEdge="warn" style={styles.card}>
        <View style={styles.head}>
          <Terminal size={iconSize.sm} color={color.warn} strokeWidth={stroke.icon} />
          {/* `type.label` carries the uppercase: "Run command" -> RUN COMMAND,
              and an unmapped tool name arrives as its own capitalised self. */}
          <Text variant="label" style={styles.title} numberOfLines={1}>
            {toolLabel(approval.toolName)}
          </Text>
          <Text variant="micro" color="textMut">
            {total > 1 ? `Claude · 1 of ${total}` : "Claude · Waiting"}
          </Text>
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

        <View style={styles.cwd}>
          <Folder size={iconSize.sm} color={color.textMut} strokeWidth={stroke.icon} />
          <MonoText numberOfLines={1} style={styles.flex}>
            {cwdTail(approval.cwd)}
          </MonoText>
        </View>

        <View style={styles.buttons}>
          <Pill label="Deny" loading={busy === false} disabled={busy !== null} onPress={() => decide(false)} />
          <Pill label="Allow" filled loading={busy === true} disabled={busy !== null} onPress={() => decide(true)} />
        </View>
      </Card>
    </Animated.View>
  );
}

// The two answers. Not `Button`: these are the only pills in the app with micro
// labels, and the decision deserves the press-scale the rest of the redesign
// uses rather than the shared button's fade.
function Pill({
  label,
  filled = false,
  loading,
  disabled,
  onPress,
}: {
  label: string;
  filled?: boolean;
  loading: boolean;
  disabled: boolean;
  onPress(): void;
}) {
  const press = usePressScale();
  const role = filled ? "accentText" : "text";
  return (
    <Animated.View style={[styles.pillWrap, { transform: [{ scale: press.scale }] }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled, busy: loading }}
        disabled={disabled}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={[
          styles.pill,
          filled ? styles.filled : styles.outlined,
          disabled && !loading && { opacity: opacity.disabled },
        ]}
      >
        {loading ? (
          <ActivityIndicator size="small" color={color[role]} />
        ) : (
          <Text variant="micro" color={role}>
            {label}
          </Text>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space(3) },
  head: { flexDirection: "row", alignItems: "center", gap: space(2) },
  title: { flex: 1 },
  flex: { flex: 1 },
  codeBox: { backgroundColor: color.bg, borderRadius: radius.card },
  // Eight wrapped mono lines before it scrolls internally: enough to read most
  // commands whole, capped so the card never eats the transcript.
  codeScroll: { maxHeight: typeScale.mono.lineHeight * 8 + space(6) },
  code: { padding: space(3) },
  cwd: { flexDirection: "row", alignItems: "center", gap: space(2) },
  buttons: { flexDirection: "row", gap: space(3) },
  pillWrap: { flex: 1, minHeight: touch.min },
  pill: { minHeight: touch.min, alignItems: "center", justifyContent: "center", borderRadius: radius.pill },
  filled: { backgroundColor: color.accent },
  outlined: { borderWidth: stroke.hairline, borderColor: color.borderHi },
});
