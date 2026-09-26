# B2.4: samples the live plugin process from outside (kernel CPU times,
# like scripts/soak-monitor.mjs) every 10 s for -Minutes, then prints the
# average CPU percent of one core and the total CPU seconds used.
param([int]$Minutes = 10, [Parameter(Mandatory)][string]$Label)
$out = Join-Path (Split-Path -Parent $PSScriptRoot) "cpu-$Label.csv"
$p = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'Plugins\\com\.lawrensen\.hwinfo\.sdPlugin' } | Select-Object -First 1
if (-not $p) { throw 'plugin process not found' }
$proc = Get-Process -Id $p.ProcessId
"t,cpuS,wsMB" | Set-Content $out
$t0 = Get-Date; $c0 = $proc.TotalProcessorTime.TotalSeconds
while (((Get-Date) - $t0).TotalMinutes -lt $Minutes) {
	Start-Sleep -Seconds 10
	$proc.Refresh()
	"{0},{1},{2}" -f ((Get-Date) - $t0).TotalSeconds.ToString('F0'), $proc.TotalProcessorTime.TotalSeconds.ToString('F3'), ($proc.WorkingSet64 / 1MB).ToString('F1') | Add-Content $out
}
$proc.Refresh()
$used = $proc.TotalProcessorTime.TotalSeconds - $c0
$wall = ((Get-Date) - $t0).TotalSeconds
"$Label pid $($p.ProcessId): $([Math]::Round($used,2)) CPU s over $([Math]::Round($wall)) s = $([Math]::Round(100*$used/$wall,3)) % of one core; working set $([Math]::Round($proc.WorkingSet64/1MB,1)) MB"
