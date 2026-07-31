# Security policy

## Reporting a vulnerability

Report privately through GitHub's vulnerability reporting for this
repository: <https://github.com/slawrensen/hwinfo-streamdeck/security/advisories/new>
(the repository's **Security** tab, then **Report a vulnerability**). I am
the only maintainer; expect a first reply within seven days. Please do not
describe an exploitable problem in a public issue before I have had a
chance to ship a fix.

Fixes ship on the newest release of each line I still maintain (currently
the 1.4.x line; a maintenance branch keeps 1.x patchable after 2.0 exists).
Anything older gets no fixes. The plugin has no update channel of its own;
updates arrive through the Elgato Marketplace or the GitHub release page.

## What the plugin touches

The plugin runs inside Elgato's Stream Deck app on Windows. It reads
HWiNFO's shared-memory region and HWiNFO's Gadget registry keys under HKCU,
both read-only, on the local machine only. It makes no network requests and
has no telemetry. The native piece is `bin/hwsm.node`, a first-party N-API
addon built from `native/hwsm` in this repository by the release workflow;
no handle, pointer, or generic Win32 call crosses its JavaScript boundary.

## The native binary is unsigned

`bin/hwsm.node` has no Authenticode signature: when an antivirus flags it,
there is no publisher certificate to check, only bytes. The bytes are
checkable. Every GitHub release from 1.4.0 on prints the addon's SHA-256 in
its release notes and attaches `release-native-manifest.json` carrying the
same hash plus the build facts (PE hardening flags, imports, toolchain);
releases before 1.4.0 predate the addon and publish the pack hash only. To
verify the copy on your disk, run this in PowerShell and compare it with
the release you installed:

```powershell
Get-FileHash "$env:APPDATA\Elgato\StreamDeck\Plugins\com.lawrensen.hwinfo.sdPlugin\bin\hwsm.node" -Algorithm SHA256
```

A downloaded `.streamDeckPlugin` file checks the same way against the pack
SHA-256 in the release notes:

```powershell
Get-FileHash com.lawrensen.hwinfo.streamDeckPlugin -Algorithm SHA256
```

A GitHub-release install matches its published hash byte for byte.
Marketplace copies are repackaged on Elgato's side; if a Marketplace
install's hash does not match the corresponding release, ask on the issue
tracker before trusting the file.
