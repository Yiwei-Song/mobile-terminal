import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Lock, RotateCcw, ShieldAlert, Trash2, WifiOff, X } from "lucide-react-native";
import type { Proc } from "@shared/protocol";

import { BackButton } from "../src/components/BackButton";
import { Button } from "../src/components/Button";
import { Card } from "../src/components/Card";
import { EmptyState } from "../src/components/EmptyState";
import { Field } from "../src/components/Field";
import { MeterRow } from "../src/components/MeterRow";
import { meterColor } from "../src/components/meters";
import { MonoText } from "../src/components/MonoText";
import { Screen } from "../src/components/Screen";
import { Sparkline } from "../src/components/Sparkline";
import { Text } from "../src/components/Text";
import { DEMO_CPU_HISTORY, demoMode, seedDemo } from "../src/lib/demo";
import { uptime } from "../src/lib/format";
import { useReducedMotion } from "../src/lib/motion";
import { useWorkbench } from "../src/lib/store";
import { color, icon as iconSize, opacity, radius, space, stroke, touch, tracking } from "../src/theme";

// A sane fixed delay for the remote reboot — long enough that the Abort on the
// phone is reachable before the OS actually goes down (the daemon holds the real
// timer; this screen only builds the request).
const REBOOT_DELAY_SEC = 15;

/**
 * System: the "keep my machine healthy while I'm away" screen. Live metrics up
 * top, the process list in the middle, and the serious power controls (weighted
 * heaviest, type-to-confirm on reboot) at the bottom. Every destructive control
 * dies when the PC is unreachable — you cannot manage a box you cannot see.
 */
export default function System() {
  const connState = useWorkbench((s) => s.connState);
  const machine = useWorkbench((s) => s.machine);
  const metrics = useWorkbench((s) => s.metrics);
  const processes = useWorkbench((s) => s.processes);
  const powerState = useWorkbench((s) => s.powerState);
  const rebootPending = useWorkbench((s) => s.rebootPending);
  const runningCount = useWorkbench((s) => s.sessions.filter((x) => x.status === "running").length);
  const lastError = useWorkbench((s) => s.lastError);
  const refreshMetrics = useWorkbench((s) => s.refreshMetrics);
  const refreshPowerState = useWorkbench((s) => s.refreshPowerState);
  const setKeepAwake = useWorkbench((s) => s.setKeepAwake);
  const killProcess = useWorkbench((s) => s.killProcess);
  const lockMachine = useWorkbench((s) => s.lockMachine);
  const rebootMachine = useWorkbench((s) => s.rebootMachine);
  const abortReboot = useWorkbench((s) => s.abortReboot);

  // The screen owns the poll — a store timer would keep ticking off-screen. Last
  // ~20 cpu samples feed the sparkline; seeded in demo (no socket to grow it).
  const [cpuHist, setCpuHist] = useState<number[]>(() => (demoMode ? DEMO_CPU_HISTORY : []));
  const [killTarget, setKillTarget] = useState<Proc | null>(null);
  const [killNote, setKillNote] = useState<string | null>(null);
  const [lockArm, setLockArm] = useState(false);
  const [rebootArm, setRebootArm] = useState(false);
  const [rebootText, setRebootText] = useState("");

  const offline = connState !== "online";
  const unauthorized = connState === "unauthorized";

  useFocusEffect(
    useCallback(() => {
      if (demoMode) {
        seedDemo();
        return;
      }
      // Both reject when offline-connected — a missed tick must not flash a
      // banner, so every call swallows its own rejection.
      void refreshPowerState().catch(() => {});
      void refreshMetrics().catch(() => {});
      const id = setInterval(() => void refreshMetrics().catch(() => {}), 3_000);
      return () => clearInterval(id);
    }, [refreshMetrics, refreshPowerState]),
  );

  // A fresh metrics object each poll, so this fires on every tick (even a steady
  // cpu) — the sparkline advances at a constant rate rather than only on change.
  useEffect(() => {
    if (metrics === null) return;
    setCpuHist((h) => [...h, metrics.cpuPct].slice(-20));
  }, [metrics]);

  const doKill = (p: Proc) => {
    setKillTarget(null);
    setKillNote(null);
    void killProcess(p.pid)
      // {ok:false} is a refusal (EPERM / already gone) the daemon reports as
      // data; a thrown transport error lands in the store's lastError banner.
      .then((r) => {
        if (!r.ok) setKillNote(`Couldn't kill ${p.name}: ${r.error ?? "refused"}`);
      })
      .catch(() => {});
  };

  const doReboot = () => {
    setRebootArm(false);
    setRebootText("");
    void rebootMachine(REBOOT_DELAY_SEC).catch(() => {});
  };

  const rebootOk = rebootText.trim().toUpperCase() === "REBOOT";
  const disk = metrics?.disks[0];

  return (
    <Screen>
      <View style={styles.header}>
        <BackButton />
        <View style={styles.headText}>
          <Text variant="h2" numberOfLines={1}>
            System
          </Text>
          <Text variant="sub" color="textMut" numberOfLines={1}>
            {machine?.hostname ?? "Your PC"}
          </Text>
        </View>
      </View>

      <ScrollView style={styles.flex} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {unauthorized ? (
          <View style={[styles.banner, styles.repair]}>
            <View style={styles.repairText}>
              <ShieldAlert size={iconSize.sm} color={color.textMut} strokeWidth={stroke.icon} />
              <Text variant="sub" color="textMut" style={styles.flex}>
                This PC turned the phone away — re-pair to manage it again.
              </Text>
            </View>
            <Button label="Re-pair" variant="outline" onPress={() => router.push({ pathname: "/pair", params: { edit: "1" } })} />
          </View>
        ) : offline ? (
          <View style={styles.banner}>
            <View style={styles.repairText}>
              <WifiOff size={iconSize.sm} color={color.textMut} strokeWidth={stroke.icon} />
              <Text variant="sub" color="textMut" style={styles.flex}>
                Offline — last-known readings shown. Controls need a live connection.
              </Text>
            </View>
          </View>
        ) : null}

        {lastError !== null && (
          <Card accentEdge="danger" style={styles.noteCard}>
            <View style={styles.noteRow}>
              <Text variant="sub" color="danger" style={styles.flex}>
                {lastError}
              </Text>
              <Dismiss label="Dismiss error" onPress={() => useWorkbench.setState({ lastError: null })} />
            </View>
          </Card>
        )}

        {killNote !== null && (
          <Card accentEdge="danger" style={styles.noteCard}>
            <View style={styles.noteRow}>
              <Text variant="sub" color="danger" style={styles.flex}>
                {killNote}
              </Text>
              <Dismiss label="Dismiss" onPress={() => setKillNote(null)} />
            </View>
          </Card>
        )}

        {/* Live metrics — greyed when offline: truthful last-known, not live. */}
        <View style={offline && styles.stale}>
          {metrics === null ? (
            <Text variant="sub" color="textMut">
              {offline ? "No readings yet." : "Reading system…"}
            </Text>
          ) : (
            <>
              <MeterRow label="CPU" value={Math.round(metrics.cpuPct)} unit="%" />
              <Sparkline values={cpuHist} />
              <MeterRow label="RAM" value={Math.round(metrics.mem.usedGb)} max={metrics.mem.totalGb} unit={` / ${Math.round(metrics.mem.totalGb)} GB`} />
              {disk !== undefined && (
                <MeterRow
                  label={`Disk ${disk.mount}`}
                  value={Math.round(disk.usedGb)}
                  max={disk.totalGb}
                  unit={` / ${Math.round(disk.totalGb)} GB`}
                />
              )}
              <View style={styles.uptimeRow}>
                <Text variant="sub" color="textMut">
                  Uptime
                </Text>
                <Text variant="sub">{uptime(metrics.uptimeSec)}</Text>
              </View>
            </>
          )}
        </View>

        {/* Processes */}
        <View style={styles.section}>
          <Text variant="sub" color="textMut" style={styles.sectionLabel}>
            PROCESSES
          </Text>
          {processes.length === 0 ? (
            <Text variant="sub" color="textMut">
              No process readings.
            </Text>
          ) : (
            processes.map((p) => (
              <ProcRow key={p.pid} proc={p} disabled={offline} onKill={() => setKillTarget(p)} />
            ))
          )}
        </View>

        {/* Power — the serious group. A rule above it sets it apart. */}
        <View style={[styles.section, styles.powerSection]}>
          <Text variant="sub" color="textMut" style={styles.sectionLabel}>
            POWER
          </Text>

          <View style={styles.toggleRow}>
            <View style={styles.flex}>
              <Text variant="body">Keep PC awake</Text>
              <Text variant="sub" color="textMut">
                Stops sleep while the daemon runs.
              </Text>
            </View>
            <Switch
              accessibilityLabel="Keep PC awake"
              value={powerState?.keepAwake ?? false}
              disabled={offline}
              onValueChange={(on) => void setKeepAwake(on).catch(() => {})}
              trackColor={{ true: color.info, false: color.border }}
              thumbColor={color.text}
            />
          </View>

          <View style={styles.control}>
            <Button label="Lock screen, keep working" variant="outline" icon={Lock} fill disabled={offline} onPress={() => setLockArm(true)} />
            <Text variant="sub" color="textMut" style={styles.controlSub}>
              Blanks the monitor; sessions keep running.
            </Text>
          </View>

          {rebootPending !== null ? (
            <RebootCountdown delaySec={rebootPending.delaySec} offline={offline} onAbort={() => void abortReboot().catch(() => {})} />
          ) : (
            <View style={styles.control}>
              <Button label="Reboot PC" variant="danger" icon={RotateCcw} fill disabled={offline} onPress={() => setRebootArm(true)} />
              <Text variant="sub" color="textMut" style={styles.controlSub}>
                Interrupts running sessions; they resume idle when your PC is back.
              </Text>
            </View>
          )}
        </View>
      </ScrollView>

      {killTarget !== null && (
        <Card accentEdge="danger" raised style={styles.sheet}>
          <Text variant="body">Kill {killTarget.name}?</Text>
          <Text variant="sub" color="textMut">
            PID {killTarget.pid} · {killTarget.memMb} MB. Anything unsaved in it is lost.
          </Text>
          <View style={styles.sheetButtons}>
            <Button label="Cancel" variant="outline" fill onPress={() => setKillTarget(null)} />
            <Button label="Kill" variant="danger" fill onPress={() => doKill(killTarget)} />
          </View>
        </Card>
      )}

      {lockArm && (
        <Card accentEdge="warn" raised style={styles.sheet}>
          <Text variant="body">Lock the screen?</Text>
          <Text variant="sub" color="textMut">
            Blanks the monitor; your sessions keep running.
          </Text>
          <View style={styles.sheetButtons}>
            <Button label="Cancel" variant="ghost" fill onPress={() => setLockArm(false)} />
            <Button
              label="Lock"
              variant="outline"
              fill
              onPress={() => {
                setLockArm(false);
                void lockMachine().catch(() => {});
              }}
            />
          </View>
        </Card>
      )}

      {rebootArm && (
        <Card accentEdge="danger" raised style={styles.sheet}>
          <Text variant="body">Reboot {machine?.hostname ?? "your PC"}?</Text>
          <Text variant="sub" color="textMut">
            {runningCount > 0
              ? `${runningCount} running ${runningCount === 1 ? "session" : "sessions"} will be interrupted — they resume idle when your PC is back.`
              : "No sessions are running right now."}
          </Text>
          <Field
            label="Type REBOOT to confirm"
            value={rebootText}
            onChangeText={setRebootText}
            placeholder="REBOOT"
            autoCapitalize="characters"
            autoCorrect={false}
          />
          <View style={styles.sheetButtons}>
            <Button
              label="Cancel"
              variant="ghost"
              fill
              onPress={() => {
                setRebootArm(false);
                setRebootText("");
              }}
            />
            <Button label="Reboot" variant="danger" fill disabled={!rebootOk} onPress={doReboot} />
          </View>
        </Card>
      )}
    </Screen>
  );
}

// One process line: name + pid/mem detail, cpu% (threshold-coloured), and a kill
// hit target ≥44. The trash is inert offline — a kill you cannot deliver.
function ProcRow({ proc, disabled, onKill }: { proc: Proc; disabled: boolean; onKill: () => void }) {
  const role = meterColor(proc.cpuPct);
  return (
    <View style={styles.procRow}>
      <View style={styles.flex}>
        <Text variant="body" numberOfLines={1}>
          {proc.name}
        </Text>
        <View style={styles.procMeta}>
          <MonoText>pid {proc.pid}</MonoText>
          <Text variant="sub" color="textMut">
            · {proc.memMb} MB
          </Text>
        </View>
      </View>
      <Text variant="sub" color={role} style={styles.procCpu}>
        {proc.cpuPct.toFixed(1)}%
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Kill ${proc.name}`}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onKill}
        style={({ pressed }) => [styles.kill, disabled && { opacity: opacity.disabled }, pressed && { opacity: opacity.pressed }]}
      >
        <Trash2 size={iconSize.md} color={color.danger} strokeWidth={stroke.icon} />
      </Pressable>
    </View>
  );
}

// The reboot is scheduled: replace the trigger with a cosmetic countdown (the
// daemon holds the real timer) and a prominent Abort. Reduce-motion drops the
// per-second tick for a static message. At zero — or once the PC drops off — the
// screen says it is coming back; rebootPending clears on the next reconnect.
function RebootCountdown({ delaySec, offline, onAbort }: { delaySec: number; offline: boolean; onAbort: () => void }) {
  const reduced = useReducedMotion();
  const [remaining, setRemaining] = useState(delaySec);

  useEffect(() => {
    setRemaining(delaySec);
    if (reduced) return;
    const id = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1_000);
    return () => clearInterval(id);
  }, [delaySec, reduced]);

  const done = offline || remaining === 0;
  const heading = done
    ? "Rebooting…"
    : reduced
      ? "Your PC is about to restart"
      : `Restarting your PC in ${remaining}s`;

  return (
    <Card accentEdge="danger" raised style={styles.countdown}>
      <Text variant="body">{heading}</Text>
      <Text variant="sub" color="textMut">
        {done ? "The app will reconnect when your PC is back." : "Running sessions resume idle after the restart."}
      </Text>
      {!done && <Button label="Abort reboot" variant="outline" fill onPress={onAbort} />}
    </Card>
  );
}

function Dismiss({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.dismiss, pressed && { opacity: opacity.pressed }]}
    >
      <X size={iconSize.md} color={color.textMut} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: space(2), paddingTop: space(2), paddingBottom: space(3) },
  headText: { flex: 1, gap: space(0.5) },
  scroll: { gap: space(4), paddingTop: space(1), paddingBottom: space(6) },

  banner: {
    paddingVertical: space(2),
    paddingHorizontal: space(3),
    borderRadius: radius.input,
    backgroundColor: color.surface,
    borderWidth: stroke.hairline,
    borderColor: color.border,
    gap: space(2),
  },
  repair: { gap: space(2) },
  repairText: { flexDirection: "row", alignItems: "center", gap: space(2) },

  noteCard: {},
  noteRow: { flexDirection: "row", alignItems: "center", gap: space(2) },
  dismiss: { width: touch.min, height: touch.min, alignItems: "center", justifyContent: "center", marginVertical: -space(3) },

  stale: { opacity: opacity.disabled },
  uptimeRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", paddingTop: space(2) },

  section: { gap: space(2) },
  sectionLabel: { letterSpacing: tracking.label },
  // The rule that sets the serious group apart from the readings above it.
  powerSection: { paddingTop: space(3), borderTopWidth: stroke.hairline, borderTopColor: color.border },

  procRow: { flexDirection: "row", alignItems: "center", gap: space(3), minHeight: touch.min },
  procMeta: { flexDirection: "row", alignItems: "baseline", gap: space(1) },
  procCpu: { minWidth: space(12), textAlign: "right" },
  kill: { width: touch.min, height: touch.min, alignItems: "center", justifyContent: "center", marginRight: -space(2) },

  toggleRow: { flexDirection: "row", alignItems: "center", gap: space(3), minHeight: touch.min },
  control: { gap: space(1.5) },
  controlSub: {},

  countdown: { gap: space(2) },
  sheet: { gap: space(2), marginTop: space(3) },
  sheetButtons: { flexDirection: "row", gap: space(3), marginTop: space(1) },
});
