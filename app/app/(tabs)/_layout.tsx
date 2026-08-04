import { Tabs } from "expo-router";
import { Cog, FolderTree, MessageCircle } from "lucide-react-native";

import { color, icon as iconSize, stroke, type as typeScale } from "../../src/theme";

/**
 * Sessions | Projects | Machine. Sessions answers "what needs me" and Projects
 * answers "what exists" — the same split the desktop apps make between the
 * active conversation and the folder sidebar, and the reason they are not one
 * list: an attention feed sorted by urgency and a browse tree sorted by folder
 * cannot both be the same screen without ruining one of them.
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
        // No `height`: React Navigation reads a number as the *total* bar height
        // and still pads insets.bottom inside it, so a fixed one eats the inset —
        // fine under gesture nav, 24pt of content box under 3-button nav. Its
        // default is inset-aware; this bar only says what it looks like.
        tabBarStyle: {
          backgroundColor: color.bg,
          borderTopWidth: stroke.hairline,
          borderTopColor: color.border,
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
        name="projects"
        options={{
          title: "Projects",
          tabBarIcon: ({ color: tint }) => <FolderTree size={iconSize.md} color={tint} strokeWidth={stroke.icon} />,
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
