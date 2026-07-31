import { StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ArrowLeft } from "lucide-react-native";

import { Button } from "../../src/components/Button";
import { Screen } from "../../src/components/Screen";
import { StatusChip } from "../../src/components/StatusChip";
import { Text } from "../../src/components/Text";
import { useWorkbench } from "../../src/lib/store";
import { space } from "../../src/theme";

// Stub: Task 7 builds the transcript, approvals and composer. It exists now so
// tapping a row on Home goes somewhere instead of 404-ing.
export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useWorkbench((s) => s.sessions.find((x) => x.sessionId === id));

  return (
    <Screen>
      <View style={styles.body}>
        <Text variant="title">{session?.title ?? "Session"}</Text>
        {session !== undefined && <StatusChip status={session.status} />}
        <Text variant="body" color="textMut">
          Transcript, approvals and composer land in Task 7.
        </Text>
        <Button label="Back" variant="outline" icon={ArrowLeft} onPress={() => router.back()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, gap: space(3), paddingTop: space(4), alignItems: "flex-start" },
});
