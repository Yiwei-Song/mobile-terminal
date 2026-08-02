import { useEffect } from "react";
import { Stack } from "expo-router";
import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_700Bold } from "@expo-google-fonts/inter/700Bold";
import { JetBrainsMono_400Regular } from "@expo-google-fonts/jetbrains-mono/400Regular";

import { color, font } from "../src/theme";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  // Keys are the family names theme.ts refers to.
  const [fontsLoaded, fontError] = useFonts({
    [font.ui]: Inter_400Regular,
    [font.uiBold]: Inter_700Bold,
    [font.mono]: JetBrainsMono_400Regular,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  // Hold the splash rather than flash a fallback-font frame.
  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg } }}
      />
    </SafeAreaProvider>
  );
}
