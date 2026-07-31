import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from "react-native";
import { Send } from "lucide-react-native";

import { color, icon as iconSize, opacity, radius, space, stroke, touch, type as typeScale } from "../theme";
import { Text } from "./Text";

/**
 * Bottom-anchored input. Dictation-friendly (autoCorrect left on), grows to five
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
          accessibilityLabel="Message the agent"
          style={styles.input}
          placeholder="Message the agent…"
          placeholderTextColor={color.idle}
          value={text}
          onChangeText={setText}
          editable={!disabled}
          multiline
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
          accessibilityState={{ disabled: !canSend, busy: sending }}
          disabled={!canSend}
          onPress={submit}
          style={({ pressed }) => [styles.send, { opacity: canSend ? (pressed ? opacity.pressed : opacity.full) : opacity.disabled }]}
        >
          {sending ? (
            <ActivityIndicator size="small" color={color.accentText} />
          ) : (
            <Send size={iconSize.md} color={color.accentText} strokeWidth={stroke.icon} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space(1.5), paddingTop: space(2) },
  hint: { paddingHorizontal: space(1) },
  row: { flexDirection: "row", alignItems: "flex-end", gap: space(2) },
  input: {
    ...typeScale.body,
    flex: 1,
    color: color.text,
    minHeight: touch.min,
    // Five body lines before it scrolls inside — a paragraph of dictation fits
    // without swallowing the transcript.
    maxHeight: typeScale.body.lineHeight * 5 + space(4),
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    backgroundColor: color.surfaceHi,
    borderRadius: radius.input,
    borderWidth: stroke.hairline,
    borderColor: color.border,
  },
  send: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.input,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.accent,
  },
});
