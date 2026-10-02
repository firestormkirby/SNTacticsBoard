# npm run run: open NOTE and launch the plugin from its toolbar popup.
param(
    [string]$Device
)

$ScriptTag = 'run'
. (Join-Path $PSScriptRoot 'device.ps1')

Select-Device $Device
$config = Get-PluginConfig
$label = if ($env:PLUGIN_LAUNCH_LABEL) { $env:PLUGIN_LAUNCH_LABEL } else { $config.name }

Invoke-WakeAndUnlock
Write-Log 'Opening NOTE'
Invoke-Adb shell am start -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n $NoteComponent | Out-Null
if (-not (Wait-ForForeground 'com.ratta.supernote.note/' 8)) {
    # Usually another plugin's panel (e.g. Modulanner's) is open over the note.
    if ((Get-ForegroundWindow) -match [regex]::Escape($PluginHostPackage)) {
        Write-Log 'A plugin panel is in front of NOTE; closing it with Back'
        Invoke-Adb shell input keyevent KEYCODE_BACK
    }
    if (-not (Wait-ForForeground 'com.ratta.supernote.note/')) { Stop-WithError 'NOTE did not come to the foreground' }
}
Start-Sleep -Seconds $UiSettleSeconds

Update-UiDump
Invoke-TapUiNode 'content-desc' 'plugins'
Update-UiDump
if (-not (Test-UiNode 'text' $label)) { Stop-WithError "the plugin popup doesn't list '$label' exactly once" }
Invoke-TapUiNode 'text' $label

Start-Sleep -Seconds 2
$hostPid = Get-PluginHostPid
if (-not $hostPid) { Stop-WithError 'PluginHost exited while launching the plugin' }
Write-Host "Launched $label (PluginHost PID $hostPid)." -ForegroundColor Green
