# Register a Windows Scheduled Task that brings the BidStack production backend
# (API + worker + Cloudflare named tunnel) back up automatically at boot, so a
# reboot doesn't take your live app offline.
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1
#
# Run once, after a successful `node scripts/go-live-selfhost.mjs`. It runs the
# reboot-recovery path (--run-only): start services + tunnel from the existing
# build, no migrate / rebuild / redeploy. Remove with:
#   Unregister-ScheduledTask -TaskName "BidStack360-Prod" -Confirm:$false

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node).Source
$taskName = "BidStack360-Prod"

$action = New-ScheduledTaskAction -Execute $node `
  -Argument "scripts\go-live-selfhost.mjs --run-only" -WorkingDirectory $repo

# At startup, and retry a few times in case the network / Docker isn't ready yet.
$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = "PT30S"

$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 2)

# Run as the current user so it inherits the same profile (cloudflared creds,
# pnpm, etc.). -RunLevel Highest so it can bind ports without a prompt.
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -RunLevel Highest -LogonType S4U

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal -Force `
  -Description "BidStack 360 production API + worker + Cloudflare tunnel (auto-start on boot)"

Write-Host "Registered scheduled task '$taskName'. It runs at boot (30s delay)."
Write-Host "Test it now without rebooting:  Start-ScheduledTask -TaskName $taskName"
