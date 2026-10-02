# device.ps1: shared helpers for the device scripts. Dot-source it.
#
# Adapted from Ziv-Ink/supernote-plugin-template's scripts for Windows
# PowerShell 5.1 (no pwsh needed). The device comes from, in order:
#   -Device on the calling script, $env:DEVICE_SERIAL, "device" in
#   devconfig.json, or the only device adb has attached.
# A host:port serial (wifi adb) is connected first if it isn't already.
#
# devconfig.json (gitignored, optional):
#   { "device": "192.168.86.52:5555", "adb": "C:/path/to/adb.exe" }

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$PluginHostPackage = 'com.ratta.supernote.pluginhost'
$NoteComponent = 'com.ratta.supernote.note/.view.NoteInsidePagesActivity'
$DeviceUiXml = '/sdcard/tacticsboard-ui.xml'
$UiSettleSeconds = if ($env:UI_SETTLE_SECONDS) { [int]$env:UI_SETTLE_SECONDS } else { 1 }
$UiTimeoutSeconds = if ($env:UI_TIMEOUT_SECONDS) { [int]$env:UI_TIMEOUT_SECONDS } else { 20 }

$DevConfig = $null
$devConfigPath = Join-Path $ProjectRoot 'devconfig.json'
if (Test-Path $devConfigPath) {
    $DevConfig = Get-Content $devConfigPath -Raw | ConvertFrom-Json
}

$AdbBin = 'adb'
if ($env:ADB_BIN) {
    $AdbBin = $env:ADB_BIN
} elseif ($DevConfig -and $DevConfig.adb) {
    $AdbBin = $DevConfig.adb
} elseif (-not (Get-Command adb -ErrorAction SilentlyContinue)) {
    $sdkAdb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
    if (Test-Path $sdkAdb) { $AdbBin = $sdkAdb }
}

function Write-Log([string]$Message) {
    Write-Host "[$ScriptTag] $Message"
}

function Stop-WithError([string]$Message) {
    Write-Host "[$ScriptTag] Error: $Message" -ForegroundColor Red
    exit 1
}

function Invoke-Adb {
    & $AdbBin -s $script:Device @args
}

function Select-Device([string]$Requested) {
    $serial = $Requested
    if (-not $serial) { $serial = $env:DEVICE_SERIAL }
    if (-not $serial -and $DevConfig -and $DevConfig.device) { $serial = $DevConfig.device }

    if ($serial) {
        if ($serial -match '^[\w.-]+:\d+$') {
            $state = (& $AdbBin -s $serial get-state 2>$null) -join ''
            if ($state -ne 'device') {
                Write-Log "Connecting to $serial over wifi..."
                & $AdbBin connect $serial | Out-Null
            }
        }
        $state = (& $AdbBin -s $serial get-state 2>$null) -join ''
        if ($state -ne 'device') {
            Stop-WithError "$serial is not connected and authorized (is the Supernote awake and on wifi?)"
        }
        $script:Device = $serial
        return
    }

    $devices = @(& $AdbBin devices | Where-Object { $_ -match '^(\S+)\s+device$' } | ForEach-Object { ($_ -split '\s+')[0] })
    if ($devices.Count -eq 0) {
        Stop-WithError 'no device attached; set "device" in devconfig.json or pass -Device HOST:PORT'
    } elseif ($devices.Count -gt 1) {
        Stop-WithError "several devices attached ($($devices -join ', ')); pass -Device SERIAL"
    }
    $script:Device = $devices[0]
}

function Get-PluginConfig {
    $path = Join-Path $ProjectRoot 'PluginConfig.json'
    if (-not (Test-Path $path)) { Stop-WithError "missing $path" }
    $config = Get-Content $path -Raw | ConvertFrom-Json
    if (-not $config.pluginID) { Stop-WithError 'PluginConfig.json has no pluginID' }
    if (-not $config.pluginKey) { Stop-WithError 'PluginConfig.json has no pluginKey' }
    return $config
}

function Get-PluginHostPid {
    return ((Invoke-Adb shell pidof $PluginHostPackage) -join '').Trim()
}

# --- UI automation (uiautomator dump + tap by exact attribute) ---

function Get-ForegroundWindow {
    # One mCurrentFocus per display; the idle ones say null.
    $line = Invoke-Adb shell dumpsys window |
        Where-Object { $_ -match 'mCurrentFocus=' -and $_ -notmatch 'mCurrentFocus=null' } |
        Select-Object -First 1
    return "$line".Trim()
}

function Wait-ForForeground([string]$Expected, [int]$TimeoutSeconds = $UiTimeoutSeconds) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -le $deadline) {
        if ((Get-ForegroundWindow) -match [regex]::Escape($Expected)) { return $true }
        Start-Sleep -Seconds 1
    }
    return $false
}

function Invoke-WakeAndUnlock {
    Invoke-Adb shell input keyevent KEYCODE_WAKEUP
    Invoke-Adb shell wm dismiss-keyguard 2>$null | Out-Null
    Start-Sleep -Seconds $UiSettleSeconds
}

function Update-UiDump {
    $deadline = (Get-Date).AddSeconds($UiTimeoutSeconds)
    while ((Get-Date) -le $deadline) {
        $out = (Invoke-Adb shell uiautomator dump $DeviceUiXml 2>&1) -join "`n"
        if ($out -match 'UI hier(chary|archy) dumped to') {
            $xml = (Invoke-Adb exec-out cat $DeviceUiXml) -join "`n"
            if ($xml -match '<hierarchy') {
                $script:UiXml = $xml
                return
            }
        }
        Start-Sleep -Seconds 1
    }
    Stop-WithError "the device's UI hierarchy was unavailable for ${UiTimeoutSeconds}s"
}

function Get-UiNodes([string]$Attribute, [string]$Value) {
    $pattern = '<node[^>]*\s' + [regex]::Escape($Attribute) + '="' + [regex]::Escape($Value) + '"[^>]*>'
    return @([regex]::Matches($script:UiXml, $pattern) | ForEach-Object { $_.Value })
}

function Test-UiNode([string]$Attribute, [string]$Value) {
    return (@(Get-UiNodes $Attribute $Value).Count -eq 1)
}

function Invoke-TapUiNode([string]$Attribute, [string]$Value) {
    $nodes = @(Get-UiNodes $Attribute $Value)
    if ($nodes.Count -ne 1) {
        Stop-WithError "expected one UI node with $Attribute=`"$Value`", found $($nodes.Count)"
    }
    if ($nodes[0] -notmatch 'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"') {
        Stop-WithError "UI node $Attribute=`"$Value`" has no bounds"
    }
    $x = [int](([int]$matches[1] + [int]$matches[3]) / 2)
    $y = [int](([int]$matches[2] + [int]$matches[4]) / 2)
    Write-Log "Tapping $Attribute=`"$Value`" at $x,$y"
    Invoke-Adb shell input tap $x $y
    Start-Sleep -Seconds $UiSettleSeconds
}
