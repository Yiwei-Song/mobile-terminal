<#
  allow-firewall.ps1 — let the phone reach the daemon through Windows Defender Firewall

  WHY THIS IS NEEDED
    Windows Defender Firewall blocks inbound TCP to the daemon's port by
    default, and it is a SEPARATE gate from Mullvad's firewall — getting
    Tailscale working does not get you past this one. Without this rule the
    phone's connection is silently dropped and it looks like "Tailscale is
    broken".

  SCOPE
    The rule is restricted to the two Tailscale address ranges, so the port is
    NOT opened to the coffee-shop wifi you join tomorrow:
      100.64.0.0/10        Tailscale IPv4 (blocked by Mullvad by design, but
                           still allowed here for a Mullvad-free machine)
      fd7a:115c:a1e0::/48  Tailscale IPv6 — the range that actually works
                           behind Mullvad's always-on firewall
    Add your LAN subnet to -RemoteIp if you also want same-wifi pairing to work
    with the firewall on.

  Run from an ELEVATED PowerShell (firewall changes need admin):
    powershell -ExecutionPolicy Bypass -File scripts\allow-firewall.ps1
    powershell -ExecutionPolicy Bypass -File scripts\allow-firewall.ps1 -Port 8790

  Remove it later:
    netsh advfirewall firewall delete rule name="Workbench daemon"
#>

param([int]$Port = 8790)

$ErrorActionPreference = 'Stop'
$RuleName = 'Workbench daemon'
$RemoteIp = '100.64.0.0/10,fd7a:115c:a1e0::/48'

# netsh, not New-NetFirewallRule: it is present on every Windows edition and its
# syntax is the one the docs (and every StackOverflow answer) use.
# Deleting first makes a re-run idempotent instead of stacking duplicate rules;
# a missing rule makes delete exit non-zero, which is fine and not an error here.
netsh advfirewall firewall delete rule name="$RuleName" | Out-Null

netsh advfirewall firewall add rule name="$RuleName" dir=in action=allow protocol=TCP localport=$Port remoteip=$RemoteIp
if ($LASTEXITCODE -ne 0) {
  Write-Error "netsh failed (exit $LASTEXITCODE). Are you in an ELEVATED PowerShell?"
  exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Added inbound firewall rule '$RuleName'." -ForegroundColor Green
Write-Host "  protocol:  TCP"
Write-Host "  port:      $Port"
Write-Host "  remote:    $RemoteIp  (Tailscale ranges only — not open to other networks)"
Write-Host ""
Write-Host "Check it:   netsh advfirewall firewall show rule name=`"$RuleName`""
Write-Host "Remove it:  netsh advfirewall firewall delete rule name=`"$RuleName`""
Write-Host ""
