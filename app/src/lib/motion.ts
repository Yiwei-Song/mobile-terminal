import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated } from "react-native";

import { easing, motion } from "../theme";

/**
 * Journey principle 5: motion respects the OS "reduce motion" switch. One hook,
 * so a component only asks "should I animate?" and never wires the listener.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (alive) setReduced(v);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

/** How far a pressable gives under a thumb. Enough to feel, not enough to see. */
const PRESSED = 0.97;

/**
 * The press feedback every tappable surface shares: a 0.97 dip in and back out
 * at `motion.fast`. Spread the handlers onto a Pressable and put `scale` in its
 * transform. Not gated on reduce-motion — it is direct manipulation, the same
 * class of thing as a scroll following your finger, not decoration.
 */
export function usePressScale(): {
  scale: Animated.Value;
  onPressIn: () => void;
  onPressOut: () => void;
} {
  const scale = useRef(new Animated.Value(1)).current;
  const to = (toValue: number) => {
    Animated.timing(scale, { toValue, duration: motion.fast, easing: easing.out, useNativeDriver: true }).start();
  };
  return { scale, onPressIn: () => to(PRESSED), onPressOut: () => to(1) };
}
