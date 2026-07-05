#Requires -RunAsAdministrator
<#
  Install sim-agent as a Windows scheduled task (runs at boot as SYSTEM, auto-restarts).
    .\install.ps1 -Code ABCD-EFGH                       # download latest + pair + start
    .\install.ps1 -Binary .\sim-agent-win-x64.exe       # use a local binary
    .\install.ps1 -Name work -Code ABCD-EFGH            # a second, independent agent
#>
param(
    [string]$Name = "sim-agent",
    [string]$Code = $env:AGENT_PAIRING_CODE,
    [string]$Binary = ""
)

$ErrorActionPreference = "Stop"
if ($Name -notmatch '^[A-Za-z0-9_-]+$') { throw "Invalid -Name (letters, digits, - and _ only)." }

$Repo = "Blake870/sim-agent"
$InstallDir = Join-Path $env:ProgramFiles "sim-agent"      # shared binary
$StateDir = Join-Path $env:ProgramData $Name               # per-instance state
$Exe = Join-Path $InstallDir "sim-agent.exe"

New-Item -ItemType Directory -Force -Path $InstallDir, $StateDir | Out-Null

# 1. Obtain the binary.
if ($Binary) {
    Copy-Item $Binary $Exe -Force
} else {
    $url = "https://github.com/$Repo/releases/latest/download/sim-agent-win-x64.exe"
    Write-Host "Downloading $url ..."
    Invoke-WebRequest -Uri $url -OutFile $Exe
}

# 2. Pair (writes the token into this instance's state) if a code was provided.
if ($Code) {
    Write-Host "Pairing '$Name' ..."
    $env:AGENT_PAIR_ONLY = "1"
    $env:AGENT_PAIRING_CODE = $Code
    $env:AGENT_STATE_PATH = (Join-Path $StateDir "agent-state.json")
    & $Exe
    Remove-Item Env:AGENT_PAIR_ONLY, Env:AGENT_PAIRING_CODE, Env:AGENT_STATE_PATH
}

# 3. Register the scheduled task (boot start, SYSTEM, restart on failure).
$action = New-ScheduledTaskAction -Execute $Exe -WorkingDirectory $StateDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $Name -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $Name

Write-Host "sim-agent '$Name' installed. Check: Get-ScheduledTask $Name ; Stop: Unregister-ScheduledTask $Name"
