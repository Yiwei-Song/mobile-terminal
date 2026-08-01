import type { ReactNode } from "react";
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { color, space } from "../theme";

/**
 * A sideways scroller whose right edge fades out. Code in this app never wraps
 * — a diff or a source line that runs past 390pt runs off the screen — and a
 * phone shows no scrollbar until you are already scrolling, so nothing on a
 * still screen says there is more to the right. The fade is that signal, and it
 * is the whole reason this component exists over a plain horizontal ScrollView.
 */
export function SideScroll({
  children,
  fade = color.bg,
  style,
  contentContainerStyle,
}: {
  children: ReactNode;
  /** The surface behind the scroller — the colour the last few points resolve to. */
  fade?: string;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
}) {
  // Keyed by colour, not by instance: SVG ids are document-global on web, and
  // two gradients that share a colour are the same gradient. A useId would be a
  // hook and a sanitiser for no gain.
  const id = `edge${fade.replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <View style={style}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={contentContainerStyle}>
        {children}
      </ScrollView>
      {/* pointerEvents none (in `style`, not the deprecated prop): the fade must
          never eat the swipe it advertises. */}
      <Svg style={styles.fade} width="100%" height="100%">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={fade} stopOpacity={0} />
            <Stop offset="1" stopColor={fade} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  fade: { position: "absolute", right: 0, top: 0, bottom: 0, width: space(6), pointerEvents: "none" },
});
