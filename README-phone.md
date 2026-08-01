# Workbench on your phone

Drive Claude coding sessions on your PC from your Android phone. Start a session, watch it
work, approve what it wants to do, all from the couch.

## What you need

- An **Android phone** and a **Windows PC** on the **same wifi**.
- **Node.js** on the PC (v20+).
- 5 minutes.

---

## 1. PC side (once)

```
cd daemon
npm install
npm run dev
```

`npm run dev` prints a **QR code** plus a host / port / token, and keeps the PC awake while
sessions run. Leave this terminal open. First run, Windows may pop a firewall prompt for
Node — **Allow on Private networks**.

---

## 2. Phone side (Expo Go route)

The app isn't on the Play Store yet, so you run it through **Expo Go** (Expo's dev sandbox).

1. Install **Expo Go** from the Play Store.
2. On the PC, in a **second** terminal:
   ```
   cd app
   npm install
   npx expo start
   ```
   > First run only. The app imports from `daemon/`, so make sure step 1's
   > `cd daemon && npm install` ran too — a clean checkout needs both.
3. Scan the **Metro QR** (the one `expo start` prints) with **Expo Go**. This loads the app
   onto your phone.
4. Now inside the app, scan the **daemon QR** (the one `npm run dev` printed in step 1) — or
   tap **Enter manually** and type the host / port / token. This **pairs** the app to your PC.

> **Two QR codes, different jobs.** The Metro QR *loads the app*. The daemon QR *pairs the
> app to your PC*. You scan Metro with Expo Go; you scan the daemon QR from inside the app.
> Easy to mix up — the daemon one is the pairing one.

You're paired. Start a session, approve when it asks, done.

---

## 3. Push notifications (ntfy)

Get pinged when an agent needs your approval, even with the app closed.

1. Install **ntfy** from the Play Store.
2. In the Workbench app: **Settings → ntfy topic → Generate → Save**.
3. In the ntfy app: **subscribe** to that same topic.

Notifications are generic ("Approval needed") — no commands or paths leave your PC.

---

## Remote reboot & always-on

Want the PC to survive a reboot and come back on its own — restarted from the couch,
sessions restored? Two pieces: a startup task (auto-starts the daemon) and auto-logon
(gets you past the login screen unattended).

**What it buys you:** tap **Reboot** in the app → PC reboots → auto-logs in → the daemon
starts → it **locks the screen** → your sessions come back as **idle** → you tap to
continue each one. The desktop is never left sitting unlocked.

**The tradeoff — read this.** Auto-logon means Windows logs in without you typing a
password, so it has to *store* that password. The registry route stores it in
**plaintext**. Keep **BitLocker on** (full-disk encryption) — that's the mitigation.
No BitLocker, no registry auto-logon.

**1. Install the startup task** (once, elevated PowerShell):
```
cd daemon
npm run build
powershell -ExecutionPolicy Bypass -File scripts\install-startup.ps1
```
This registers a Task Scheduler job that launches the daemon at logon. It then **prints**
the auto-logon steps — it does **not** touch your password.

> **Locking is opt-in.** Only the scheduled (post-reboot) start locks the screen — the task
> sets `WORKBENCH_LOCK_ON_START=1` for exactly that reason. A manual `npm run dev` / `npm run e2e`
> leaves it unset and **never** locks your dev machine.

**2. Enable auto-logon yourself** (the script walks you through both):
- **netplwiz** (preferred): `Win+R` → `netplwiz` → uncheck *"Users must enter a user
  name and password"* → Apply. No visible plaintext password.
- **Registry** (explicit plaintext): `AutoAdminLogon=1` + `DefaultUserName` +
  `DefaultPassword` under `Winlogon`. Only with BitLocker on.

**Undo the task:** `schtasks /delete /tn WorkbenchDaemon /f`

> The daemon keeps the PC awake while it runs (display may sleep, the system won't),
> so sessions keep going even when you're not looking.

---

## Known limits (right now)

- **Claude sessions only.** Codex is coming later.
- **PC must stay awake** with the daemon running.
- **Camera QR** needs camera permission (Expo Go asks the first time).
- **Expo Go is dev mode** — fine for daily use, but it's a sandbox. An installable APK is the
  next step (below).

---

## Making an installable app (APK) — later, your choice

Two ways. Pick one when you're ready; **don't run these yet**.

**EAS cloud build (no Android SDK needed).** Expo builds the APK on their servers. Needs a
free Expo account. One command:
```
cd app
eas build -p android --profile preview
```
When it finishes, it gives you a link to download and install the APK on your phone.

**Local build (no cloud, needs Android SDK).** Builds on your own machine. Needs Android
Studio / the Android SDK installed first, then:
```
cd app
npx expo run:android
```
This compiles and installs straight to a plugged-in phone or emulator.

---

## Troubleshooting

**"Can't reach PC" / won't connect**
1. Phone and PC on the **same wifi**? (Not guest network.)
2. **VPN off** on both?
3. Is the daemon still running (the `npm run dev` terminal)?
4. Did you **Allow** the Windows firewall prompt for Node on **Private networks**? If you
   dismissed it, re-run `npm run dev` and allow it, or add the rule in Windows Defender
   Firewall.

**Paired but nothing happens** — check the daemon terminal for errors; it logs each session.

**Wrong QR** — pairing uses the **daemon** QR (from `npm run dev`), not the Metro QR.
