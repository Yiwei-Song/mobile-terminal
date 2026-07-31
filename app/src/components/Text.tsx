import { Text as RNText, type TextProps as RNTextProps } from "react-native";

import { color, type ColorRole, type TypeVariant, type as typeScale } from "../theme";

export type TextProps = RNTextProps & {
  variant?: TypeVariant;
  color?: ColorRole;
};

/** The only text primitive: every size/family/color comes from theme.ts. */
export function Text({ variant = "body", color: role = "text", style, ...rest }: TextProps) {
  return <RNText {...rest} style={[typeScale[variant], { color: color[role] }, style]} />;
}
