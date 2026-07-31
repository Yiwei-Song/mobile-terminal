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
   npx expo start
   ```
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
