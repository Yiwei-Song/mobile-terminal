import { Pressable, StyleSheet } from "react-native";
import { router } from "expo-router";
import { ArrowLeft } from "lucide-react-native";

import { color, icon as iconSize, opacity, space, stroke, touch } from "../theme";

/** Bare-arrow back control. One pattern for every screen's header. */
export function BackButton({ onPress }: { onPress?: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back"
      onPress={onPress ?? (() => router.back())}
      style={({ pressed }) => [styles.btn, pressed && { opacity: opacity.pressed }]}
    >
      <ArrowLeft size={iconSize.lg} color={color.text} strokeWidth={stroke.icon} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Negative margin claims the 48dp hit box without widening the header bar.
  btn: { width: touch.min, height: touch.min, alignItems: "center", justifyContent: "center", marginVertical: -space(2) },
});
