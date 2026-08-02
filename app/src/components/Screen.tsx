import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaView, type SafeAreaViewProps } from "react-native-safe-area-context";

import { color, space } from "../theme";

export type ScreenProps = {
  children: ReactNode;
  /** Horizontal gutter. Off for edge-to-edge lists that pad their own rows. */
  gutter?: boolean;
  /**
   * Which insets to pad. Default is all four. A screen inside the tab navigator
   * passes {@link TAB_EDGES}: the tab bar already pads the bottom inset, and
   * paying it twice leaves a dead band above the bar.
   */
  edges?: SafeAreaViewProps["edges"];
};

/** Every edge but the bottom — for the screens the tab bar sits under. */
export const TAB_EDGES = ["top", "left", "right"] as const;

/** Every screen's root: safe area + app background + the standard gutter. */
export function Screen({ children, gutter = true, edges }: ScreenProps) {
  return (
    <SafeAreaView style={styles.safe} edges={edges}>
      <View style={[styles.body, gutter && styles.gutter]}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.bg },
  body: { flex: 1 },
  gutter: { paddingHorizontal: space(4) },
});
