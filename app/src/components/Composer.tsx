import { useState } from "react";
import { ActivityIndicator, Animated, Pressable, StyleSheet, TextInput, View } from "react-native";
import { ArrowUp } from "lucide-react-native";

import { usePressScale } from "../lib/motion";
import { color, icon as iconSize, radius, space, stroke, touch, type as typeScale } from "../theme";
import { Text } from "./Text";

/**
 * Bottom-anchored input. Dictation-friendly (autoCorrect left on), grows to four
 * lines then scrolls, and never optimistically echoes — the daemon broadcasts
 * the user's text back and that echo is the one source of truth.
 */
export function Composer({
  onSend,
  disabled = false,
  hint,
}: {
  onSend(text: string): Promise<void>;
  /** Offline: the socket can't carry a message, so the input is inert. */
  disabled?: boolean;
  hint?: string;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const press = usePressScale();
  const trimmed = text.trim();
  const canSend = trimmed.length > 0 && !sending && !disabled;

  const submit = () => {
    if (!canSend) return;
    setSending(true);
    // Clear only on success: a rejected send (offline mid-tap) keeps the text so
    // the thumb is not asked to retype it. lastError already reports the reason.
    void onSend(trimmed)
      .then(() => setText(""))
      .catch(() => {})
      .finally(() => setSending(false));
  };

  return (
    <View style={styles.wrap}>
      {hint !== undefined && (
        <Text variant="sub" color="textMut" style={styles.hint}>
          {hint}
        </Text>
      )}
      <View style={styles.row}>
        <TextInput
          accessibilityLabel="Message Claude"
          style={styles.input}
          placeholder="Message Claude…"
          placeholderTextColor={color.textMut}
          value={text}
          onChangeText={setText}
          editable={!disabled}
          multiline
        />
        {/* Filled only when there is something to send: an always-accent button
            is a promise the empty composer can't keep. */}
        <Animated.View style={{ transform: [{ scale: press.scale }] }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: !canSend, busy: sending }}
            disabled={!canSend}
            onPress={submit}
            onPressIn={press.onPressIn}
            onPressOut={press.onPressOut}
            style={[styles.send, canSend ? styles.sendOn : styles.sendOff]}
          >
            {sending ? (
              <ActivityIndicator size="small" color={color.textMut} />
            ) : (
              <ArrowUp
                size={iconSize.md}
                color={canSend ? color.accentText : color.textMut}
                strokeWidth={stroke.icon}
              />
            )}
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space(1.5), paddingTop: space(2), paddingBottom: space(2) },
  hint: { paddingHorizontal: space(1) },
  row: { flexDirection: "row", alignItems: "flex-end", gap: space(2) },
  input: {
    ...typeScale.body,
    flex: 1,
    color: color.text,
    minHeight: touch.min,
    // Four body lines before it scrolls inside — a paragraph of dictation fits
    // without swallowing the transcript.
    maxHeight: typeScale.body.lineHeight * 4 + space(4),
    paddingHorizontal: space(4),
    paddingVertical: space(2),
    backgroundColor: color.surface,
    borderRadius: radius.card,
    borderWidth: stroke.hairline,
    borderColor: color.border,
  },
  send: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  sendOn: { backgroundColor: color.accent },
  sendOff: { backgroundColor: color.surfaceHi },
});
