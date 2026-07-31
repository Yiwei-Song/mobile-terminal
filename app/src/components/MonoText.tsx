import { Text, type TextProps } from "./Text";

/** Machine text: paths, commands, terminal output, diffs. */
export function MonoText({ color = "textMut", ...rest }: Omit<TextProps, "variant">) {
  return <Text variant="mono" color={color} {...rest} />;
}
