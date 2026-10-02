# npm run deploy: build the .snplg, push it, and install it through the
# Supernote Plugin Manager by UI automation (Settings > Apps > Plugins >
# Add Plugin > MyStyle > tacticsboard.snplg > Install).
#
#   -SkipBuild          install the existing build/outputs package
#   -StopAfterPush      push and verify only; install by hand
param(
    [string]$Device,
    [switch]$SkipBuild,
    [switch]$StopAfterPush
)

$ScriptTag = 'deploy'
. (Join-Path $PSScriptRoot 'device.ps1')

$PluginManagerAction = 'com.ratta.settings.application.PluginManagerFragment'
$PluginManagerComponent = 'com.ratta.settings/.SettingsActivity'
$SettingsWindow = 'com.ratta.settings/com.ratta.settings.SettingsActivity'
$PickerWindow = 'com.ratta.supernote.inbox/com.ratta.supernote.explorer.SelectFileActivity'
$InstallTimeoutSeconds = if ($env:INSTALL_TIMEOUT_SECONDS) { [int]$env:INSTALL_TIMEOUT_SECONDS } else { 120 }

Select-Device $Device
Write-Log "Using device $Device"
$config = Get-PluginConfig
$packageName = "$($config.pluginKey).snplg"
$package = Join-Path $ProjectRoot "build\outputs\$packageName"
$devicePackage = "/storage/emulated/0/MyStyle/$packageName"

if (-not $SkipBuild) {
    $started = Get-Date
    Push-Location $ProjectRoot
    try {
        & npm run build:plugin
        if ($LASTEXITCODE -ne 0) { Stop-WithError 'build failed' }
    } finally {
        Pop-Location
    }
    if (-not (Test-Path $package) -or (Get-Item $package).LastWriteTime -lt $started) {
        Stop-WithError "the build did not produce a fresh $package"
    }
}
if (-not (Test-Path $package)) { Stop-WithError "no package at $package; run without -SkipBuild" }

function Get-DeviceHash {
    return ((Invoke-Adb shell sha256sum $devicePackage 2>$null) -join '' -split '\s+')[0]
}
$localHash = (Get-FileHash $package -Algorithm SHA256).Hash.ToLower()
if ((Get-DeviceHash) -eq $localHash) {
    Write-Log "MyStyle already has this $packageName; not pushing"
} else {
    # Slow over wifi (~1 MB/s), hence the check above.
    Write-Log "Pushing $packageName to MyStyle"
    Invoke-Adb push $package $devicePackage | Out-Null
    $remoteHash = Get-DeviceHash
    if ($remoteHash -ne $localHash) {
        Stop-WithError "device copy doesn't match: local $localHash, device $remoteHash"
    }
    Write-Log "Verified SHA-256 $localHash"
}
if ($StopAfterPush) { return }

Invoke-WakeAndUnlock

Write-Log 'Opening the Plugin Manager'
Invoke-Adb shell am start -a $PluginManagerAction -n $PluginManagerComponent | Out-Null
if (-not (Wait-ForForeground $SettingsWindow)) { Stop-WithError 'Settings did not open' }
Start-Sleep -Seconds $UiSettleSeconds
Update-UiDump
# The label varies by firmware.
$addLabels = @('Select Plugin Package', 'Choose Installation Package', 'Add Plugin')
$addLabel = $addLabels | Where-Object { Test-UiNode 'text' $_ } | Select-Object -First 1
if (-not $addLabel) {
    Stop-WithError "the Plugins page has none of: $($addLabels -join ', ') (is the device language English?)"
}
Invoke-TapUiNode 'text' $addLabel

if (-not (Wait-ForForeground $PickerWindow)) { Stop-WithError 'the package picker did not open' }
Update-UiDump
if (-not (Test-UiNode 'text' 'MyStyle')) { Stop-WithError 'the package picker did not open in MyStyle' }
Invoke-TapUiNode 'text' $packageName
Update-UiDump
if (-not (Test-UiNode 'text' 'Install')) { Stop-WithError "no Install button after selecting $packageName" }

$previousPid = Get-PluginHostPid
Invoke-TapUiNode 'text' 'Install'

$deadline = (Get-Date).AddSeconds($InstallTimeoutSeconds)
$installed = $false
while ((Get-Date) -le $deadline -and -not $installed) {
    if ((Get-ForegroundWindow) -match [regex]::Escape($SettingsWindow)) {
        Update-UiDump
        # The plugin's detail page (title and name) or the Plugins list.
        $installed = (@(Get-UiNodes 'text' $config.name).Count -ge 1) -and
            (@(Get-UiNodes 'text' "Installing$([char]0x2026)").Count -eq 0)
    }
    if (-not $installed) { Start-Sleep -Seconds 1 }
}
if (-not $installed) { Stop-WithError "the Plugin Manager did not list $($config.name) within ${InstallTimeoutSeconds}s" }

$currentPid = Get-PluginHostPid
Write-Host "Installed $($config.name) (PluginHost PID $previousPid -> $currentPid)." -ForegroundColor Green
