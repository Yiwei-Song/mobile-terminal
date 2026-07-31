import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { color, space } from "../theme";

export type ScreenProps = {
  children: ReactNode;
  /** Horizontal gutter. Off for edge-to-edge lists that pad their own rows. */
  gutter?: boolean;
};

/** Every screen's root: safe area + app background + the standard gutter. */
export function Screen({ children, gutter = true }: ScreenProps) {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.body, gutter && styles.gutter]}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.bg },
  body: { flex: 1 },
  gutter: { paddingHorizontal: space(4) },
});
