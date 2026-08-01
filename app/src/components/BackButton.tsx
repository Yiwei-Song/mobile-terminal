import { Pressable, StyleSheet } from "react-native";
import { router } from "expo-router";
import { ArrowLeft } from "lucide-react-native";

import { color, icon as iconSize, opacity, stroke, touch } from "../theme";

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
  // No negative margin: Android drops touches that land outside the parent's
  // frame, so a hit box that overhangs the header bar is not a 48 at all.
  btn: { width: touch.min, height: touch.min, alignItems: "center", justifyContent: "center" },
});
