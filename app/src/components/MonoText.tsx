import { noLigatures } from "../theme";
import { Text, type TextProps } from "./Text";

/** Machine text: paths, commands, terminal output, diffs. Ligatures off — see
 *  `noLigatures`: what is on screen has to be what is in the file. */
export function MonoText({ color = "textMut", style, ...rest }: Omit<TextProps, "variant">) {
  return <Text variant="mono" color={color} style={[noLigatures, style]} {...rest} />;
}
