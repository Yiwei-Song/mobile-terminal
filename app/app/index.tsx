import { router } from "expo-router";
import { Plug } from "lucide-react-native";

import { EmptyState } from "../src/components/EmptyState";
import { Button } from "../src/components/Button";
import { Screen } from "../src/components/Screen";

// Placeholder home. Task 6 replaces this with the real session list.
export default function Home() {
  return (
    <Screen>
      <EmptyState
        icon={Plug}
        title="Not paired yet"
        body="Run the workbench daemon on your PC, then pair this device to see your sessions."
        action={
          <Button
            label="Component gallery"
            variant="outline"
            onPress={() => router.push("/_debug-gallery")}
          />
        }
      />
    </Screen>
  );
}
