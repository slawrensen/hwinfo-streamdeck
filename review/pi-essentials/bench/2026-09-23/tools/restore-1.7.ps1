# Puts the deck back on the frozen 1.7.0.0 payload that ran before this bench
# (plugin.js 3de4d258..., hwsm.node 95ae41e5..., manifest 969f5b25...), using
# the backup taken 2026-09-23 18:30 local, then hash-checks every member
# against that backup's manifest. Profiles and settings are NOT touched:
# edits made while the candidate ran stay (settings are append-only, and
# the candidate keeps every field it does not know).
#   pwsh restore-1.7.ps1
$ErrorActionPreference = 'Stop'
$bk = Join-Path $env:USERPROFILE 'hwinfo-bench-backup\2026-09-23-1830'
& (Join-Path $PSScriptRoot 'deploy.ps1') -From "$bk\StreamDeck\Plugins\com.lawrensen.hwinfo.sdPlugin"
$dest = Join-Path $env:APPDATA 'Elgato\StreamDeck\Plugins\com.lawrensen.hwinfo.sdPlugin'
$bad = @(Import-Csv "$bk\installed-plugin-1.7.0.0-hashes.csv" | Where-Object { (Get-FileHash (Join-Path $dest $_.Rel)).Hash.ToLower() -ne $_.Sha256 })
if ($bad.Count) { throw "not restored: $($bad.Rel -join ', ')" }
$extra = @('ui\pi-command.js', 'ui\pi-model.js', 'ui\pi-shell.js', 'ui\pi-slot.js') | Where-Object { Test-Path (Join-Path $dest $_) }
"all 43 1.7.0.0 members match the backup hashes"
if ($extra.Count) { "inert leftovers from the candidate (1.7.0.0 never loads them): $($extra -join ', ')" }
