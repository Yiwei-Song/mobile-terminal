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

## Terminal

A **real PowerShell on your PC**, on your phone.

1. Tap **Terminal** → type a folder (or leave it blank for the daemon's own) → **New terminal**.
2. The key row above the keyboard has what the soft keyboard buries:
   **Paste · Esc · Tab · Ctrl · ↑ ↓ ← → · / | - ~**
3. **Ctrl is sticky** — tap it, then tap the next character. `Ctrl` then `C` = Ctrl-C.
4. **Terminals stay alive when you close the app.** Come back and it's still there,
   scrollback and all.
5. Killing is **explicit** — the red **Kill** pill, with a confirm. Nothing dies on its own.

---

## Files & changes

**Read-only.** The agents edit; the phone reviews.

1. **What you can browse:** the cwd of every session you've started, plus anything you list
   under `fileRoots` in **`%APPDATA%\workbench\config.json`**:
   ```json
   { "token": "...", "port": 8790, "ntfyTopic": null,
     "fileRoots": ["D:\\projects", "D:\\Mobile-access"] }
   ```
   Backslashes are doubled — it's JSON. Restart the daemon after editing.
2. **Reading:** tap a folder to descend, a file to read it. Line numbers, no wrapping —
   long lines scroll sideways.
3. **Markdown** opens **rendered**; the **Raw** button in the header flips it back.
4. **Diffs:** the **Changes (N) on \<branch\>** button at the top of a git folder, or the
   **Changes** action on a session. Per-file hunks, `+`/`−` counts, exactly what
   `git diff` says.

---

## Preview

1. Tap **Preview** — it lists **everything listening on your PC**, with the process that owns it.
2. **Dev servers first.** Windows' own plumbing (RPC, SMB, WinRM, the ephemeral range) is
   demoted behind **Show all ports (N more)** — one tap, nothing is hidden.
3. Tap a port to open it in a phone-sized frame, with back / forward / reload.
4. The **open-in-external** button hands the URL to your phone's browser instead.

---

## Dev tools

Long-running services you can start and stop from the couch: a docker stack, a vite server,
a headless-browser server.

1. Write **`%APPDATA%\workbench\tools.json`** — an array of `{name, command, args, cwd, port}`
   (`args`, `cwd` and `port` are optional):
   ```json
   [
     { "name": "web dev server", "command": "npm", "args": ["run", "dev"],
       "cwd": "D:\\projects\\web-dashboard", "port": 5173 },
     { "name": "docker", "command": "docker", "args": ["compose", "up", "-d"],
       "cwd": "D:\\projects\\api-server", "port": 5432 }
   ]
   ```
   Full example: `daemon/tools.example.json`.
2. **Args go through a shell and are NOT quoted for you.** An arg with a space splits in two;
   one with `& | >` splits the command. Quote it yourself:
   `"args": ["--dir", "\"C:\\Program Files\\x\""]`.
3. **Read once, at daemon startup.** Edit the file → **restart the daemon**.
4. In the app: **Tools** → **Start**. The row flips to **Running** with its port. **Stop** kills
   it and everything it started, after a confirm.

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

## From anywhere, in a phone browser (Cloudflare Tunnel)

No app install, no Expo Go, no VPN on the phone — and it works where Tailscale is blocked.
The daemon serves the real app UI at `/`, and `cloudflared` puts that on a public https URL.

**PC, once:** [download `cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
(a single .exe) and build the web app:

```
cd daemon
npm run build:app      # expo export --platform web -> app/dist
```

Rerun `npm run build:app` after any change to the app — the daemon serves the build, not the
source.

**Every time, three terminals (or two + the tray):**

```
cd daemon && npm run dev                       # 1. the daemon (prints the token)
cloudflared tunnel --url http://localhost:8790  # 2. prints https://<random>.trycloudflare.com
```

Open that `https://…trycloudflare.com` URL in the phone browser. The pair screen sees it was
served by the daemon, so there is **no host or port to type** — paste the token the daemon
printed and tap Connect.

- The URL is **new every restart** of `cloudflared` (a free quick tunnel), and the browser
  keeps the token per-URL, so a restart means pasting the token again. A named tunnel on your
  own domain keeps one address.
- Anyone with the URL **and** the token is in. The URL alone gets a login screen; the token is
  the secret — don't paste it anywhere else.
- The daemon also lives at `/debug` (raw protocol page) and `/terminal` (the xterm page the
  app embeds).

**Lock it down (recommended while tunnelling).** `cloudflared` connects over loopback, so the
daemon does not need to be on the network at all. In `%APPDATA%\workbench\config.json`:

```json
{ "bindHost": "::1" }
```

…and point the tunnel at that exact address, because `localhost` may resolve to the IPv4 one
the daemon no longer answers on:

```
cloudflared tunnel --url http://[::1]:8790
```

Then the tunnel is the only way in — the LAN and the tailnet stop reaching it, so drop this
line again when you go back to pairing over wifi. (Default is `"::"`: everything.)

---

## Known limits (right now)

- **Claude sessions only.** Codex is coming later.
- **Files are read-only** — the agents edit, the phone reviews. No upload, no download.
- **`tools.json` is read once, at daemon startup.** Restart after editing it.
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
