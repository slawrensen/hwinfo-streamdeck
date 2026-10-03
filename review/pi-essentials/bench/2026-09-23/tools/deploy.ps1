# Deploys a plugin folder over the installed com.lawrensen.hwinfo plugin the
# proven bench way: stop through the Elgato CLI, copy every member (logs
# excluded), hash-verify each copied file against its source, start again.
#   deploy.ps1 -From <sdPlugin folder>
# Candidate: <bench worktree>\com.lawrensen.hwinfo.sdPlugin
# Restore:   %USERPROFILE%\hwinfo-bench-backup\2026-09-23-1830\StreamDeck\Plugins\com.lawrensen.hwinfo.sdPlugin
param([Parameter(Mandatory)][string]$From)
$ErrorActionPreference = 'Stop'
$uuid = 'com.lawrensen.hwinfo'
$dest = Join-Path $env:APPDATA "Elgato\StreamDeck\Plugins\$uuid.sdPlugin"
function Get-PluginProcs { @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match [regex]::Escape("Plugins\$uuid.sdPlugin") }) }

"before: plugin pids $((Get-PluginProcs).ProcessId -join ',')"
streamdeck stop $uuid | Out-Null
for ($i = 0; $i -lt 40 -and (Get-PluginProcs).Count -gt 0; $i++) { Start-Sleep -Milliseconds 250 }
if ((Get-PluginProcs).Count -gt 0) { throw "plugin still running after stop; nothing copied" }
"stopped"

$src = (Resolve-Path $From).Path
$files = Get-ChildItem $src -Recurse -File | Where-Object { $_.FullName -notmatch '\\logs\\' }
$bad = @()
foreach ($f in $files) {
	$rel = $f.FullName.Substring($src.Length + 1)
	$target = Join-Path $dest $rel
	New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
	# An identical member is left alone (a just-stopped plugin's hwsm.node can
	# stay locked for a moment); a changed one retries through a short lock.
	if ((Test-Path $target) -and (Get-FileHash $f.FullName).Hash -eq (Get-FileHash $target).Hash) { continue }
	for ($try = 1; $try -le 20; $try++) {
		try { Copy-Item $f.FullName $target -Force -ErrorAction Stop; break } catch { if ($try -eq 20) { throw }; Start-Sleep -Milliseconds 250 }
	}
	if ((Get-FileHash $f.FullName).Hash -ne (Get-FileHash $target).Hash) { $bad += $rel }
}
if ($bad.Count) { throw "hash mismatch after copy: $($bad -join ', ')" }
"copied $($files.Count) files, all hash-verified"

streamdeck restart $uuid | Out-Null
for ($i = 0; $i -lt 40 -and (Get-PluginProcs).Count -eq 0; $i++) { Start-Sleep -Milliseconds 250 }
$p = Get-PluginProcs
"after: plugin pids $($p.ProcessId -join ',')"
$m = Get-Content (Join-Path $dest 'manifest.json') -Raw | ConvertFrom-Json
"installed manifest version $($m.Version); plugin.js $((Get-FileHash (Join-Path $dest 'bin\plugin.js')).Hash.ToLower().Substring(0,16))"
