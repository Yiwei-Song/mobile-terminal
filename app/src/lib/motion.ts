import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

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
