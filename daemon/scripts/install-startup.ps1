<#
  install-startup.ps1 — Workbench daemon auto-start setup (Windows)

  WHAT THIS SCRIPT DOES AUTOMATICALLY:
    Registers a Task Scheduler job ("WorkbenchDaemon") that launches the daemon
    at every user logon, so after a remote reboot the daemon comes back on its own.

  WHAT THIS SCRIPT ONLY PRINTS (does NOT touch):
    The auto-logon setup. Auto-logon can store your Windows password in PLAINTEXT
    in the registry, so this script will NOT do it for you. It prints numbered
    steps you run deliberately, with the security tradeoff spelled out.

  Run from an elevated PowerShell (needed for /rl highest):
    cd daemon
    npm run build            # produces dist\index.js (do this first)
    powershell -ExecutionPolicy Bypass -File scripts\install-startup.ps1

  Uninstall:  schtasks /delete /tn WorkbenchDaemon /f
#>

$ErrorActionPreference = 'Stop'
$TaskName = 'WorkbenchDaemon'

# --- Resolve paths relative to THIS script (scripts\ lives under daemon\) ---
$daemonDir = Split-Path $PSScriptRoot -Parent
$entry     = Join-Path $daemonDir 'dist\index.js'
# Alternative if you prefer no build step: point at 'src\index.ts' and run it
# with tsx, e.g. $tr = "`"$node`" `"$(Join-Path $daemonDir 'node_modules\.bin\tsx.cmd')`" ...".
# The built dist\index.js is the primary path — plain node, nothing to install globally.

if (-not (Test-Path $entry)) {
  Write-Warning "dist\index.js not found at: $entry"
  Write-Warning "Run 'npm run build' in the daemon folder first, then re-run this script."
  exit 1
}

# Full path to node so the task does not depend on PATH at logon.
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'node' }

# schtasks /tr takes ONE string = program + args. Embedded paths may contain
# spaces, so each is wrapped in escaped quotes (\"...\"). PowerShell forwards the
# \" sequences to schtasks, which stores: "<node>" "<entry>"
#
# The scheduled (post-reboot) start is the ONLY start that should lock the
# screen — nobody is at the desk. So run it through `cmd /c` and set
# WORKBENCH_LOCK_ON_START=1 first; the daemon reads that env var and locks +
# pings the phone. A manual `npm run dev` leaves the var unset and never locks.
# Note: no space before `&&` (`set VAR=1&&`) — a trailing space becomes part of
# the value ("1 "), which would fail the `=== "1"` check. Every quote is written
# as \" so PowerShell forwards a real " to schtasks (same convention as before);
# the stored action is:  cmd /c "set WORKBENCH_LOCK_ON_START=1&& "<node>" "<entry>""
# which cmd runs by stripping its outer quotes, setting the var, then launching
# the quoted node + entry.
$tr = 'cmd /c \"set WORKBENCH_LOCK_ON_START=1&& \"' + $node + '\" \"' + $entry + '\"\"'

Write-Host ""
Write-Host "Registering scheduled task '$TaskName'..." -ForegroundColor Cyan
Write-Host "  runs at:  user logon"
Write-Host "  command:  $node `"$entry`""
Write-Host ""

# /f overwrites any existing task with the same name (idempotent re-runs).
schtasks /create /tn "$TaskName" /tr "$tr" /sc onlogon /rl highest /f
if ($LASTEXITCODE -ne 0) {
  Write-Error "schtasks failed (exit $LASTEXITCODE). Are you in an elevated PowerShell?"
  exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Done. '$TaskName' will start the daemon at your next logon." -ForegroundColor Green
Write-Host "Start it now without logging out:  schtasks /run /tn $TaskName"
Write-Host "Remove it later:                   schtasks /delete /tn $TaskName /f"
Write-Host ""

# ---------------------------------------------------------------------------
# AUTO-LOGON: printed only. You do this yourself — it involves your password.
# ---------------------------------------------------------------------------
Write-Host "============================================================" -ForegroundColor Yellow
Write-Host " NEXT: enable auto-logon (manual — this script won't do it)" -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Yellow
Write-Host @'

WHY auto-logon is needed
  A remote reboot (from the phone) brings the PC back to the LOCK SCREEN.
  Your sessions run in YOUR user session, which does not exist until someone
  logs in — so the daemon cannot restore anything while the PC sits locked.
  Auto-logon logs you in automatically after the reboot; the scheduled task
  then starts the daemon; the daemon's FIRST act is to LOCK the screen again.
  Net result: unattended remote reboot + session restore, with the desktop
  never left exposed.

THE TRADEOFF (read this)
  Auto-logon means Windows must have your password to log you in unattended.
  The registry route below stores DefaultPassword in PLAINTEXT under
  HKLM\...\Winlogon. Anyone with disk access can read it. Mitigate by keeping
  BitLocker ON (full-disk encryption) — that is the mitigation this setup
  assumes. No BitLocker => do NOT enable registry auto-logon.

OPTION A — netplwiz (does NOT store a visible plaintext password; preferred)
  1. Press Win+R, type:  netplwiz   and press Enter.
  2. Select your user account.
  3. UNCHECK "Users must enter a user name and password to use this computer".
  4. Click Apply — Windows asks for your password twice to confirm. Done.
  (Note: if that checkbox is missing, disable "For improved security, only allow
   Windows Hello sign-in for Microsoft accounts" in Settings > Accounts >
   Sign-in options, then reopen netplwiz.)

OPTION B — registry (explicit; stores DefaultPassword in PLAINTEXT)
  Run these in an elevated PowerShell, replacing the values:
    $k = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
    Set-ItemProperty $k AutoAdminLogon 1
    Set-ItemProperty $k DefaultUserName 'YOUR_USERNAME'
    Set-ItemProperty $k DefaultPassword 'YOUR_PASSWORD'   # <-- PLAINTEXT
  (For a Microsoft account, DefaultUserName is usually your email.)
  Undo:  Set-ItemProperty $k AutoAdminLogon 0 ; Remove-ItemProperty $k DefaultPassword

AFTER enabling auto-logon
  Test with a normal reboot: the PC should log in on its own, land on a LOCKED
  screen (daemon locked it), and your sessions come back as idle in the app.

'@ -ForegroundColor Gray
