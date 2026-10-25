# Release and source accuracy audit

Audited 24 October 2026 (user timezone). This is documentation evidence, not a new plugin release qualification or physical-device test.

## Identity

- Audited `main`: `bb4aedecbce499e199df8af63793a1490c0fb6ed`.
- Latest public stable release: **v1.7.1**, manifest **1.7.1.0**, published `2026-10-24T07:06:56Z`.
- Annotated tag object `b45a986716585b9b9dd9e4aa3f30c462181aca72` resolves to the same commit as audited main. Main and stable happen to match at this audit; that was checked, not presumed.
- Release: https://github.com/slawrensen/hwinfo-streamdeck/releases/tag/v1.7.1
- Direct stable package: https://github.com/slawrensen/hwinfo-streamdeck/releases/download/v1.7.1/com.lawrensen.hwinfo.streamDeckPlugin
- Package size: **388,579 bytes**. Published SHA-256: `f6f5c28d47c4baf72deb6c05cf0cbaa4f424c4c66709136e2a0ef78a8baf3d17`.
- Native addon published SHA-256: `7aa0d75a88f0b70fa0ac1568b1810f499769a73d1def413adb89cab86a3e784f`.
- Those are published hashes, not independent local downloads or a new malware analysis.

## Channel difference, checked separately

The current Elgato listing shows **Version 1.7**, dated **Oct 13, 2026**, with release copy explicitly headed **1.7.0.0**. It lists Windows and Stream Deck 6.9 or later. Its captured listing does not advertise 1.7.1 dial backgrounds. Do not imply that the channels currently install identical versions or bytes.

https://marketplace.elgato.com/product/hwinfo-sensors-82436166-3d61-4527-9034-8fdf16d92c54

Suggested compact installation copy: “GitHub: 1.7.1. Marketplace: 1.7, checked 24 October 2026. Use the GitHub download for transparent dial backgrounds.”

`SECURITY.md` says `bin/hwsm.node` has no Authenticode signature. A GitHub install can be compared with its release package/addon hashes. Marketplace copies are repackaged on Elgato's side, so do not use GitHub package hashes as proof of their parity or safety.

https://github.com/slawrensen/hwinfo-streamdeck/blob/v1.7.1/SECURITY.md

## Claim and qualification map

| Claim to preserve | Evidence | Required qualification |
| --- | --- | --- |
| Windows 10+ x64, Stream Deck 6.9+, local running HWiNFO | `com.lawrensen.hwinfo.sdPlugin/manifest.json`, `docs/installation.md`, `src/hwinfo/hwsm-loader.ts` at v1.7.1 | No macOS or Windows-on-ARM plugin build. HWiNFO is installed and run separately. |
| Free HWiNFO Shared Memory switches off after 12 hours | `docs/data-sources.md`; official https://www.hwinfo.com/licenses/ (table and footnote 4) | Re-enable manually or restart; Pro removes this limit. Gadget fallback requires reporting configured. |
| Shared Memory vs Gadget | `src/hwinfo/provider.ts`, `src/poller.ts`, `docs/data-sources.md` | One local reader/source for all decks. Shared Memory includes hardware identities, producer timestamp, HWiNFO min/max/avg. Gadget current values only, name identity, no producer timestamp. |
| Gadget Age unknown | `src/poller.ts` (initial baseline and 15,000 ms freshness threshold), `test/poller-provenance.test.ts` | First successful read alone is not evidence of freshness. Before first value change, and after 15 s without another, unchanged and stopped cannot be distinguished. |
| Source fallback is not identity matching | `src/hwinfo/reading-links.ts`, `docs/data-sources.md#link-readings-across-providers` | Explicit user-confirmed pairing required across providers. No name/value inference. Unit/type restrictions and unique endpoints apply. |
| Dial statistics are session observations | `src/stats.ts`, `test/stats.test.ts`, `docs/sensor-dial.md#session-stats-are-the-dials-own-per-reading` | Distinct from HWiNFO statistics. New source/unit/type/binding or data gap resets affected sessions. Held frames are not counted repeatedly. |
| Dial transparency in 1.7.1 | `src/ui/dial-background.ts`, `docs/sensor-dial.md#transparent-background` | Display > Background: Theme, Glass, Tint, Outline, Clear. Theme default. Glass 80% panel, Tint 50% panel plus outline; Outline 1 px; Clear no background/outline. |
| Words in the accent color | `src/ui/dial-background.ts` | Glass, Tint, Outline only. Values, alert colors, individual reading colors and Custom text color are not overwritten. |
| Contrast qualifications | `src/ui/dial-background.ts`, `docs/sensor-dial.md#transparent-background` | Built-in text floor is a calculation, not measured hardware accessibility. Clear depends on wallpaper. Custom text/reading colors can fall below the floor. Outline filter checked on Stream Deck 7.4 and 7.6, not newly proven on 6.9. |
| Per-dial output | `com.lawrensen.hwinfo.sdPlugin/layouts/sensor-dial.json` | Canvas is `[0,0,200,100]` per encoder. A shared background picture does not create a full-strip or half-strip graph. Neither is a shipped capability to advertise. |
| Hardware compatibility | `docs/hardware.md`, `src/devices.ts` | + XL physical dates are historical recorded claims. + and standard key mock coverage is not physical. Other fixture/expected devices retain qualifiers. Studio and Galleon support is unclaimed; headless devices are Control-only. |
| Read cadence in stable release | `src/poller.ts`, `docs/data-sources.md#read-every` | **Read every** still exists, 250 ms to 5 s, default 1 s. Open PR #36's cadence removal is not released. |

Each repository file above can be opened under `https://github.com/slawrensen/hwinfo-streamdeck/blob/v1.7.1/` plus its path.

## Concrete content corrections

1. **High accuracy issue: blanket hardware claim.** `docs/installation.md` says “Any Stream Deck hardware works” for Sensor Reading. This conflicts with its own hardware matrix and source table. Say “Sensor Reading uses display keys on supported models” and link the matrix; explain +/+ XL dial requirement and Control-only headless models separately.
2. **Keep version boundaries explicit.** Transparency is 1.7.1, although much of the dial guide describes 1.7 generally. A website preview marker must not imply an unreleased plugin package.
3. **Keep exact failure messages searchable.** Especially `Age unknown / check Gadget`, `Sensor missing / pick again`, `Shared Memory / is off`, `Not updating / check sharing`, and `Access denied / open settings`.
4. **Do not amplify external listing overclaims.** Marketplace's summary says fallback “keeps data flowing”; the docs must retain explicit identity linking and freshness restrictions beside fallback advice.
5. **Do not imply global strip graphs.** Use “six dials over one strip picture” in app-capture captions.

## Concurrent work inspected

Open PRs at audit: #58 (combined 1.7.1 preview qualification, an older candidate), #57–#53 dependency updates, #36 (new cadence model, including overlapping docs), #34 (performance harness), #20 (workspace-pages draft spike). No branch was modified by this audit. Keep their claims, pending tests and candidate code distinct from released v1.7.1.

https://github.com/slawrensen/hwinfo-streamdeck/pull/36
https://github.com/slawrensen/hwinfo-streamdeck/pull/58

## Checks and limits

- PASS: main/ref/release identity comparison; direct published stable package metadata; separate Marketplace listing read; public source/docs comparison; official HWiNFO 12-hour statement.
- UNAVAILABLE: fresh Windows/HWiNFO physical execution, installed package verification, fresh manual VirusTotal validation, private release-only copy/runbook qualification inputs. They are not required to qualify this documentation-only preview and are not represented as passed.
# Direct Marketplace recheck before publication

A normal-certificate HTTPS GET of the public Marketplace URL returned HTTP 200 with server Date `Sat, 24 Oct 2026 21:44:59 GMT` and `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate`. The returned HTML independently contains visible **Version 1.7**, structured `softwareVersion: "1.7"`, **Oct 13, 2026**, and release notes beginning **HWiNFO Sensors 1.7.0.0**. This recheck did not use cached search snippets. Compact evidence: `/tmp/hwinfo-marketplace-fresh.json`; raw public HTML: `/tmp/hwinfo-marketplace-fresh.html`.


## Asset provenance

See [the asset manifest](../docs/assets/img/showcase/provenance.json) for source and output SHA-256 hashes, release identity, crop coordinates, dimensions and capture types. All promoted images are faithful derivatives of repository assets present at v1.7.1. Original masters are unchanged. App captures, renderer samples and the older hardware photograph remain explicitly labelled.
