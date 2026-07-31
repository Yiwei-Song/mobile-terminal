import type { ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import type { SessionStatus } from "@shared/protocol";
import { Check, FolderGit2, Inbox, Play, Send, Terminal, X } from "lucide-react-native";

import { Button, type ButtonVariant } from "../src/components/Button";
import { Card } from "../src/components/Card";
import { EmptyState } from "../src/components/EmptyState";
import { MonoText } from "../src/components/MonoText";
import { Screen } from "../src/components/Screen";
import { StatusChip } from "../src/components/StatusChip";
import { Text } from "../src/components/Text";
import {
  color,
  radius,
  space,
  stroke,
  tracking,
  type ColorRole,
  type TypeVariant,
} from "../src/theme";

const VARIANTS: TypeVariant[] = ["title", "h2", "body", "sub", "mono"];
const STATUSES: SessionStatus[] = ["waiting_on_user", "running", "idle", "dead"];
const BUTTONS: ButtonVariant[] = ["primary", "outline", "danger", "ghost"];
const SWATCHES = Object.keys(color) as ColorRole[];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="sub" color="textMut" style={styles.sectionTitle}>
        {title.toUpperCase()}
      </Text>
      <View style={styles.stack}>{children}</View>
    </View>
  );
}

export default function DebugGallery() {
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text variant="title">Component gallery</Text>
        <Text variant="sub" color="textMut">
          Every primitive, every state — the rendered-state review surface.
        </Text>

        <Section title="Type scale">
          {VARIANTS.map((v) => (
            <View key={v} style={styles.typeRow}>
              <Text variant={v}>The quick brown fox — {v}</Text>
              <Text variant="sub" color="textMut">
                {v}
              </Text>
            </View>
          ))}
          <Text variant="body" color="textMut">
            Muted body — secondary information.
          </Text>
          <Text variant="body" color="info">
            Info body — links and hints.
          </Text>
        </Section>

        <Section title="Color tokens">
          <View style={styles.swatchWrap}>
            {SWATCHES.map((role) => (
              <View key={role} style={styles.swatch}>
                <View style={[styles.swatchChip, { backgroundColor: color[role] }]} />
                <Text variant="sub" color="textMut">
                  {role}
                </Text>
              </View>
            ))}
          </View>
        </Section>

        <Section title="Status chips">
          <View style={styles.chipRow}>
            {STATUSES.map((s) => (
              <StatusChip key={s} status={s} />
            ))}
          </View>
        </Section>

        <Section title="Buttons — default / icon / loading / disabled">
          {BUTTONS.map((variant) => (
            <View key={variant} style={styles.stack}>
              <Text variant="sub" color="textMut">
                {variant}
              </Text>
              <View style={styles.buttonRow}>
                <Button label="Default" variant={variant} />
                <Button label="With icon" variant={variant} icon={Play} />
              </View>
              <View style={styles.buttonRow}>
                <Button label="Loading" variant={variant} loading />
                <Button label="Disabled" variant={variant} disabled />
              </View>
            </View>
          ))}
          <Text variant="sub" color="textMut">
            full width
          </Text>
          <View style={styles.buttonRow}>
            <Button label="Deny" variant="danger" icon={X} fill />
            <Button label="Allow" variant="primary" icon={Check} fill />
          </View>
        </Section>

        <Section title="Cards">
          <Card>
            <Text variant="h2">Default card</Text>
            <MonoText>~/code/mobile-access</MonoText>
          </Card>
          <Card raised>
            <Text variant="h2">Raised card</Text>
            <MonoText>selected / focused surface</MonoText>
          </Card>
          <Card accentEdge="warn">
            <View style={styles.cardHead}>
              <Text variant="h2">Needs you</Text>
              <StatusChip status="waiting_on_user" />
            </View>
            <MonoText>rm -rf ./build && npm run build</MonoText>
          </Card>
          <Card accentEdge="danger">
            <View style={styles.cardHead}>
              <Text variant="h2">Ended</Text>
              <StatusChip status="dead" />
            </View>
            <MonoText>exit code 1</MonoText>
          </Card>
        </Section>

        <Section title="Mono text">
          <Card>
            <MonoText color="text">$ git status --porcelain</MonoText>
            <MonoText> M daemon/src/protocol.ts</MonoText>
            <MonoText>?? app/src/theme.ts</MonoText>
          </Card>
        </Section>

        <Section title="Empty state — with action">
          <Card style={styles.emptyBox}>
            <EmptyState
              icon={Inbox}
              title="No sessions yet"
              body="Start one from your phone and it shows up here the moment it runs."
              action={<Button label="New session" icon={Send} />}
            />
          </Card>
        </Section>

        <Section title="Empty state — no action">
          <Card style={styles.emptyBox}>
            <EmptyState
              icon={Terminal}
              title="Transcript is empty"
              body="Nothing has been sent to this session yet."
            />
          </Card>
        </Section>

        <Section title="Empty state — offline">
          <Card style={styles.emptyBox}>
            <EmptyState
              icon={FolderGit2}
              title="Can't reach your PC"
              body="Last seen 4 minutes ago. Same wifi? VPN off?"
              action={<Button label="Retry" variant="outline" />}
            />
          </Card>
        </Section>
      </ScrollView>
    </Screen>
  );
}

const SWATCH = space(10);

const styles = StyleSheet.create({
  content: { paddingVertical: space(6), gap: space(2) },
  section: { marginTop: space(7), gap: space(3) },
  sectionTitle: { letterSpacing: tracking.label },
  stack: { gap: space(3) },
  typeRow: { gap: space(1) },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: space(2) },
  buttonRow: { flexDirection: "row", flexWrap: "wrap", gap: space(3) },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space(2),
    marginBottom: space(2),
  },
  swatchWrap: { flexDirection: "row", flexWrap: "wrap", gap: space(3) },
  swatch: { gap: space(1), width: SWATCH * 2 },
  swatchChip: {
    height: SWATCH,
    borderRadius: radius.chip,
    borderWidth: stroke.hairline,
    borderColor: color.border,
  },
  emptyBox: { height: space(60) },
});
