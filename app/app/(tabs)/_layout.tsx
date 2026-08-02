import { Tabs } from "expo-router";
import { Cog, MessageCircle } from "lucide-react-native";

import { color, icon as iconSize, space, stroke, touch, type as typeScale } from "../../src/theme";

/**
 * Sessions | Machine. Two tabs, nothing more: Sessions is the product,
 * Machine is the utility belt (system/terminal/files/preview/tools/settings).
 * `animation: "none"` is load-bearing, not decoration — this bar gets tapped
 * 100+ times a day, so a switch animation would be the single most-repeated
 * animation in the app (plan constraint: none).
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        animation: "none",
        tabBarActiveTintColor: color.text,
        tabBarInactiveTintColor: color.textMut,
        tabBarLabelStyle: typeScale.micro,
        tabBarStyle: {
          backgroundColor: color.bg,
          borderTopWidth: stroke.hairline,
          borderTopColor: color.border,
          height: touch.min + space(6),
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Sessions",
          tabBarIcon: ({ color: tint }) => (
            <MessageCircle size={iconSize.md} color={tint} strokeWidth={stroke.icon} />
          ),
        }}
      />
      <Tabs.Screen
        name="machine"
        options={{
          title: "Machine",
          tabBarIcon: ({ color: tint }) => <Cog size={iconSize.md} color={tint} strokeWidth={stroke.icon} />,
        }}
      />
    </Tabs>
  );
}
