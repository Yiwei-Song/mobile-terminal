import { StyleSheet, TextInput, View, type TextInputProps } from "react-native";

import { color, font, radius, space, stroke, touch, type as typeScale } from "../theme";
import { Text } from "./Text";

export type FieldProps = Omit<TextInputProps, "style"> & {
  label: string;
  /** One line under the input: what the value is for, or what went wrong. */
  hint?: string;
  /** Machine values (host, port, token, topic) read as mono — at body size. */
  mono?: boolean;
};

/** Labelled text input. The only input primitive; both screens use it. */
export function Field({ label, hint, mono = false, ...rest }: FieldProps) {
  return (
    <View style={styles.wrap}>
      <Text variant="sub" color="textMut">
        {label}
      </Text>
      <TextInput
        // The visual label is a sibling <Text>, which a screen reader does not
        // tie to the input on its own.
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={color.idle}
        // Mono family at body size, never type.mono's 13px: the ≥15px body rule
        // outranks the mono scale for anything the thumb has to type into.
        style={[styles.input, mono && { fontFamily: font.mono }]}
        {...rest}
      />
      {hint !== undefined && (
        <Text variant="sub" color="textMut">
          {hint}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space(1.5) },
  input: {
    ...typeScale.body,
    color: color.text,
    minHeight: touch.min,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    backgroundColor: color.surfaceHi,
    borderRadius: radius.input,
    borderWidth: stroke.hairline,
    borderColor: color.border,
  },
});
