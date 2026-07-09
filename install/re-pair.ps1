#Requires -RunAsAdministrator
<#
  Re-pair an installed sim-agent with a fresh code — after a clone-kill, an operator revoke,
  or when moving the seat to this machine. Keeps the binary and accounts.json; only the
  pairing (token + machine id) is reset.
    .\re-pair.ps1 -Code ABCD-EFGH               # default task 'sim-agent'
    .\re-pair.ps1 -Name work -Code ABCD-EFGH    # a named instance
#>
param(
    [string]$Name = "sim-agent",
    [string]$Code = $env:AGENT_PAIRING_CODE,
    [switch]$NoAutoUpdate
)

$ErrorActionPreference = "Stop"
if ($Name -notmatch '^[A-Za-z0-9_-]+$') { throw "Invalid -Name (letters, digits, - and _ only)." }
if (-not $Code) { throw "A pairing code is required (-Code, from the sim panel)." }

$InstallDir = Join-Path $env:ProgramFiles "sim-agent"      # shared binary
$StateDir = Join-Path $env:ProgramData $Name               # per-instance state
$Exe = Join-Path $InstallDir "sim-agent.exe"
$StateFile = Join-Path $StateDir "agent-state.json"

if (-not (Test-Path $Exe)) { throw "No sim-agent install found at $Exe. Install it first with install.ps1." }

# 1. Stop the task so it isn't racing us with the dead token.
Stop-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue | Out-Null

# 2. Drop the stale pairing (token + machine id). accounts.json and the binary are untouched;
#    re-pairing rebinds a fresh machine id to the same agent record the code belongs to.
Remove-Item $StateFile -ErrorAction SilentlyContinue

# 3. Pair with the new code — writes a fresh token into this instance's state.
Write-Host "Re-pairing '$Name' ..."
$env:AGENT_PAIR_ONLY = "1"
$env:AGENT_PAIRING_CODE = $Code
$env:AGENT_STATE_PATH = $StateFile
if ($NoAutoUpdate) { $env:AGENT_AUTO_UPDATE = "0" }
& $Exe
Remove-Item Env:AGENT_PAIR_ONLY, Env:AGENT_PAIRING_CODE, Env:AGENT_STATE_PATH -ErrorAction SilentlyContinue
Remove-Item Env:AGENT_AUTO_UPDATE -ErrorAction SilentlyContinue

# 4. Back to work.
Start-ScheduledTask -TaskName $Name

Write-Host "Done. Check: Get-ScheduledTask $Name"
