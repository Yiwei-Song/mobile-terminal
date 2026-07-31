import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { ArrowLeft } from "lucide-react-native";

import { Button } from "../src/components/Button";
import { Screen } from "../src/components/Screen";
import { Text } from "../src/components/Text";
import { space } from "../src/theme";

// Stub: Task 8 builds the real form (cwd picker, prompt, agent). It exists now
// so Home's FAB goes somewhere instead of 404-ing.
export default function NewSession() {
  return (
    <Screen>
      <View style={styles.body}>
        <Text variant="title">New session</Text>
        <Text variant="body" color="textMut">
          Folder, prompt and Start land in Task 8.
        </Text>
        <Button label="Back" variant="outline" icon={ArrowLeft} onPress={() => router.back()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, gap: space(3), paddingTop: space(4), alignItems: "flex-start" },
});
