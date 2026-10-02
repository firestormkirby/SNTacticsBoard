# npm run logs: stream the plugin's log tags from the device (Ctrl+C to stop).
#   -Clear   clear the device log first
#   -Dump    print what's buffered and exit instead of streaming
param(
    [string]$Device,
    [switch]$Clear,
    [switch]$Dump
)

$ScriptTag = 'logs'
. (Join-Path $PSScriptRoot 'device.ps1')

Select-Device $Device
if ($Clear) { Invoke-Adb logcat -c }
$tags = @('TacticsPalette:V', 'ReactNativeJS:V', 'PluginHost:V', 'SNPlugin:V', '*:S')
if ($Dump) {
    Invoke-Adb logcat -d -v time @tags
} else {
    Invoke-Adb logcat -v time @tags
}
