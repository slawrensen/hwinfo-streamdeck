# Agent & contributor guide

Windows-only Elgato Stream Deck plugin that renders live [HWiNFO](https://www.hwinfo.com)
sensor readings on keys and Stream Deck + / + XL dials (single or dual key
readouts, a three-row dial overview, rotation sets with named groups,
Legacy/Elite/Custom control presets, themes, alert thresholds, an HWiNFO
Control key action). TypeScript on the Elgato Stream Deck SDK
(`@elgato/streamdeck` v2), the `hwsm` N-API addon (`native/hwsm`) for the
shared-memory reader, dual data source (Shared Memory preferred, Gadget
registry fallback). Solo project, MIT, no ads, no telemetry.

This is the canonical guide for anyone, human or AI agent, working in the repo.

## Requirements

- Windows 10+ (x64), Node 20+, an Elgato Stream Deck install for live testing.
- HWiNFO running (Shared Memory Support or Gadget reporting) for anything that
  reads real sensors: `probe`, live e2e, the image pipelines.

## Build, test, run

| Command | What it does |
| --- | --- |
| `npm run build` | Bundle `src/plugin.ts` to `com.lawrensen.hwinfo.sdPlugin/bin/plugin.js` (rollup) and vendor `hwsm.node` and the legal files (`npm run build:native` builds the addon first; a loaded addon in `bin/` fails the vendor step cleanly with a stop-the-plugin hint) |
| `npm run build:native` | Build the hwsm addon (Node 20 headers, `/W4 /WX`, CFG/CET, reproducible link) plus its test-only variants; see `native/hwsm/TESTING.md` |
| `npm run lint` / `npm run typecheck` | ESLint (zero warnings) / `tsc --noEmit` |
| `npm test` | Unit suites (node:test via tsx): themes, key/dial renderers, shared-memory decode, status screens, series, rotation and groups, gestures, control schemes, devices, stats, diagnostics, density, and replayed gesture traces |
| `npm run test:native` | Windows-only native integration suite: real named mappings/mutexes/registry keys, every wait result, bounds, contract, hygiene soak and loaded-file locking |
| `npm run e2e` | Drive the built plugin over a mock Stream Deck WebSocket |
| `npm run e2e:resilience` | Force every poller state on the built plugin with the synthetic provider (no mapping, a °F flip, a frozen stamp, HWiNFO exiting) and check the faces |
| `npm run e2e:gadget` | The Gadget registry fallback against a synthetic, sparse HKCU key |
| `npm run e2e:gadget-raw` | The native Gadget REG_SZ reader and the renderers over an owned mock host |
| `npm run e2e:dead-fallback` | The free-version 12h DEAD-mapping fallback to the Gadget registry |
| `npm run e2e:native-edge` | Native-boundary edges (missing mutex, layout growth, protocol mismatch) fail closed |
| `npm run e2e:load` | A soak with a key for every live reading plus dials at a 250 ms poll, then a clean exit (`LOAD_SOAK_SEC` sets its length) |
| `npm run e2e:socket-close` | A Stream Deck socket that closes with keys still visible ends the plugin process |
| `npm run e2e:drilldown` | The detail drill-down: the profile switch, pagination, stat cycling, a freeze and recovery, Back |
| `npm run e2e:trend-window` | A key and a two-row dial on a Time window: live, frozen and gap frames |
| `npm run e2e:key-alerts` | Key alerts on the built plugin against the synthetic provider: the warn recolor, an opted-in tap's snooze, Alert after, and a dual key's second reading with its own limit |
| `npm run e2e:reading-links` | Reading links across Shared Memory and Gadget with the native producers, and the panel's pairing writes |
| `npm run e2e:calculated` | Calculated readings on a real named mapping: listing writes nothing, one Save is one shared write in force at once |
| `npm run e2e:strip` | Strip Display on the built plugin with a simulated Stream Deck + XL and +: slices against the plugin's reference frame, seam taps, Control strip commands, Strip Screens (the Screens dial's wipe, Control next, previous and first, the automatic cycle and its hold while a panel is open), leave and return, and the exact settings writes; then one shared Background over keys, dials and a strip (own choices kept, "Use it everywhere" one write per action, reset on appear) |
| `npm run e2e:pi` | The key settings panel in headless Chrome: opening writes nothing and every control keeps unknown fields |
| `npm run e2e:pi-panels` | Every settings panel against a simulated host: observing writes nothing, each edit changes exactly its declared fields |
| `npm run e2e:pi-keys` | The key panel's per-reading alerts against a simulated host, and one action per press: a held Enter, a double click, quick presses on a tile's size and the detail pages, a slow press after the calculated readings editor closes; one disabled button look on the key and dial panels, in normal and forced colors |
| `npm run e2e:pi-dial-alerts` | The dial panel's alert controls and the Control panel's snooze commands against a simulated host |
| `npm run e2e:pi-strip` | The Sensor Dial panel's Strip section in headless Chromium over the real strip runtime: opening and previews write nothing; Make the strip, one edit per change, a stale edit refused, Leave, Rejoin and Restore; Screens, Build screens and Fill's question; one action per press for a held Enter, a double click and quick presses; edits made ahead of a slow answer |
| `npm run e2e:pi-l10n` | The panel string catalog on a 320 px panel in headless Chromium against a simulated host: English changes nothing and writes nothing, the pseudo-locale reaches every marked label, and nothing reaches past the panel's edge |
| `npm run e2e:pi-help` | The help budget: every settings panel against a simulated host at the app's 378 px width, the help lines and height each panel, section and fold shows in its default state and in the states that reveal a block, held to 1.7.1's (`scripts/fixtures/pi-help-baseline.json`); a section 1.7.1 lacked is held to its 1.8.0 measurement |
| `npm run perf:plugin` | A matched plugin-side comparison of two builds (`--subject label=<pack or .sdPlugin>`, e.g. the 1.7.1 release pack against the checkout) under the same mock app, settings documents and producer (`scripts/fake-hwinfo-catalog.mjs` or live HWiNFO), in ABBA order: plugin CPU from the process cycle counter, RSS, private bytes, handles, V8 allocation and GC, and setImage/setFeedback bytes and rates; `--list` names the workloads. It measures the plugin process only, never the Stream Deck app or a device. `HWINFO_E2E_PLUGIN_DIR` points `e2e:load`, `perf-detail.mjs` and the other harnesses that read it at another build |
| `npm run suite:full` | Every suite plus the screenshot pipeline; fails on any leftover process |
| `npm run probe` | Standalone reader smoke test against live HWiNFO (`-- --gadget` forces the registry backend) |
| `npm run l10n` | Write `com.lawrensen.hwinfo.sdPlugin/en.json` (the manifest's strings plus the runtime catalog) and `ui/pi-strings.js` (the panel catalog) from `src/i18n-catalog.ts`; `test/i18n.test.ts` fails until you do (`docs/localization.md`) |
| `npm run changelog:page` | Regenerate the docs-site Changelog page from `CHANGELOG.md` (a committed derived file) |
| `npm run release:validate` | The canonical software qualification, `scripts/qualify.mjs`: prerequisites, lint, typecheck, native build, toolchain record (record-only), bundle, native identity (which native bytes the run qualifies: a local build, or with `--native <dir> --native-manifest <json>` a release's exact files, vendored and held to that manifest, with a Valid signature required when it records one), bundle inventory (`scripts/bundle-inventory.mjs`: the in-memory rollup build equals `bin/plugin.js`, and it renders code only from the packages `NOTICE.md` licenses, never zod), unit, native suite, pack, archive contract + extraction, ABI and producer recovery on the EXTRACTED bytes, native packaging gate, `streamdeck validate`, copy validator, and an unchanged-tree check, in that order from a clean clone. Every stage reports PASS, FAIL, SKIPPED or UNAVAILABLE; a stage that does not pass skips the rest and the exit is nonzero. Needs the MSVC toolset and `npm ci` (the Elgato CLI that packs and validates is a locked devDependency, run from `node_modules`); the copy validator needs the internal release docs (`MARKETPLACE.md`, `docs/release/`), which the public repository does not carry, so on a checkout without them that stage is UNAVAILABLE and only the maintainer's checkout produces a release qualification. The record (stage table, artifact size and SHA-256, member inventory, which bytes the ABI and recovery stages exercised) lands under `release/qualification-<version>/` and is read by nothing |
| `npm run pack` | Emit `release/com.lawrensen.hwinfo.streamDeckPlugin`: the Elgato CLI packs a staged copy of the plugin directory (the CLI rewrites the manifest it packs, and the tracked one must not move), then `scripts/validate-pack.mjs` holds the archive to the shipping contract in `scripts/lib/pack-contract.mjs` and to the checkout. `npm run pack:validate` re-checks an existing archive; `npm test` never reads `release/` |

Gate map (what runs where, and against which bytes):

| Gate | Where | Bytes exercised | How it runs |
|---|---|---|---|
| lint, typecheck, unit (`npm test`) | CI `verify` and locally | source; unit tests never read `release/` | automatic on every push |
| bundle inventory (no zod, NOTICE-covered packages only) | CI `verify` (unit suite and after the build) and locally | the production rollup configuration in memory, held to the built `bin/plugin.js` | automatic |
| native build + toolchain record + `test:native` + `validate-native` | CI `verify` and locally | the addons built in that checkout | automatic |
| `e2e:resilience` on the checkout | CI `verify` and locally | `bin/` of that checkout | automatic |
| pack + archive contract + extraction, ABI and `e2e:resilience` on the extracted bytes | CI `verify` and locally | the archive that run packed | automatic (`qualify.mjs --stages pack,archive,abi,recovery,tree`); the CI pack and record are retained as the `ci-pack-qualification` artifact |
| ABI matrix (Node 20, 22, 24) | CI `abi-matrix` | the CI-built addons, unchanged | automatic |
| copy validator, `streamdeck validate`, the whole sequence with a record | local only (`npm run release:validate`) | the local build and its archive | explicit; ordinary CI does not attest to it |
| `npm run suite:full` (browser and capture suites, process hygiene) | local only | `bin/` of the checkout | explicit; ordinary CI does not attest to it |
| installation through the Stream Deck app, hardware soak | a physical deck | the installed package | by hand; the runbook and PERF.md record the result |

The CI-built addon and a locally built one carry the same source identity
and contract but are not byte-identical (different toolchain images); each
is qualified where it is built. The mock socket does not prove physical
device behavior.

## Native addon (hwsm)

`native/hwsm` is a first-party stable Node-API (version 8, pinned) C addon
with a capability API: `getBuildInfo()`, `openSharedMemory(mapping, mutex)`
returning an opaque session (`byteLength`, `readInto(Buffer)`, `close()`),
and `openGadgetKey(subkey)` returning an opaque HKCU query-only key
(`queryString(name)`, `close()`). No handle, pointer, address, or generic
Win32 call crosses the JavaScript boundary; sessions are type-tagged
`napi_wrap` objects JavaScript cannot forge. Failures carry a stable
`code` (`HWSM_*`), the failing `operation`, and `win32Error`.

Rules that keep it sound:

- The JS/native contract is `HWSM_PROTOCOL_VERSION`, defined in
  `native/hwsm/hwsm-version.h` and mirrored in `src/hwinfo/hwsm-loader.ts`.
  The loader refuses a mismatched addon (fails closed as "bridge-failed").
  Bump BOTH on any API shape/meaning change.
- The native version (`HWSM_NATIVE_VERSION_*`, also the version resource)
  changes only when native source behavior changes. A TypeScript-only
  release keeps the native version and source id; its bytes reproduce
  within one runner image but can move when the image's MSVC toolset
  moves (1.5.1 and 1.6.0 built different bytes from identical source), so
  the release workflow compares each build with the previous release's
  manifest and annotates the run when the bytes drift.
- The consistency mutex is mandatory; there is no unguarded read path. The
  header is re-validated under the mutex on every read against the
  session's exact mapped length (checked arithmetic, 64 MiB bound).
- `hwsm_test.node` (fault-injection hooks) and `hwsm_protomm.node`
  (deliberate protocol mismatch) build alongside for tests and must never
  ship; `scripts/validate-native.mjs` enforces that, protocol/hash
  consistency in the pack, and that the vendored addon was built from the
  tree's native sources.
- Manual host-condition coverage (elevation, sessions, RDP, sleep) lives in
  `native/hwsm/TESTING.md`.

Release evidence and reproducibility, for every shipped binary (the list
lives in `scripts/lib/native-binaries.mjs`):

- `node scripts/native-manifest.mjs` writes `release-native-manifest.json`:
  the version 1 fields for hwsm.node (unchanged), then `manifestVersion` 2
  with a full record per binary (hash, size, PE hardening, imports and
  their hints, section hashes, CodeView path, REPRO hash, versions, source
  id) and the toolchain record. It refuses a binary that lacks a hardening
  flag, names its PDB with a path, or carries bytes after its last
  section. The release workflow attaches it next to the pack and
  re-proves build reproducibility.
- `node scripts/native-toolchain.mjs` records what built the binaries:
  every header and library MSBuild's tracking logs say cl, link and rc
  read, the tool binaries, node.lib and the Node headers, node-gyp's own
  inputs, the Visual Studio build and the Windows SDK servicing build, all
  hashed, with paths reduced to root tokens. It compares the record with
  `native/toolchain-policy.json`, the reviewed toolchain (record-only for
  now: a difference warns; `--enforce` or `"mode": "enforce"` fails). A
  deliberate toolchain update is a reviewed change to that file.
- `node scripts/native-drift.mjs --previous <manifest>` classifies each
  binary against the previous release (identical, new-binary,
  source-changed, toolchain-changed naming every input that moved,
  legacy-previous explained from the previous pack's binaries,
  unrecorded) and fails only on unexplained drift: same source, same
  recorded inputs, different bytes. A signed release is compared by its
  recorded unsigned build, and a binary it carried forward by its rebuild.
- Carry-forward: when a binary's native source id is the one the previous
  public release recorded, the release ships that release's exact unsigned
  file and its PDB instead of the rebuild
  (`scripts/native-carry-forward.mjs`, between the native gates and the
  sign job). The carried file must hash to the previous manifest (signature
  taken off when there is one) and come from a pack held to GitHub's asset
  digest, and the PDB must be the one its CodeView record names; otherwise
  the release stops. The rebuild still passes every gate and is kept as
  evidence: the manifest records `reproducibility` { `carriedFrom`,
  `rebuiltSha256` } for a carried binary, and hwsm.node's version 1
  compiler and SDK fields come from the release that built it. The
  repository variable `NATIVE_CARRY_FORWARD=off` ships every rebuild; any
  value other than `off`, `on` or unset fails the run.

Signing (built, switched off until the signing account exists):

- `scripts/lib/authenticode.mjs` reads a PE's Authenticode layout from the
  bytes alone: the neutral form (CheckSum and the certificate directory
  zeroed, the certificate table removed), the image digest a signature
  commits to, and the digest the embedded signature carries.
  `node scripts/authenticode-strip.mjs compare <signed> <unsigned>` proves a
  signed file is the unsigned build plus a signature and nothing else.
- The release workflow builds and proves the unsigned binaries first. Only
  when the repository variable `SIGNING_MODE` is `required` does a separate
  `sign` job run, in the `release-signing` environment with an OIDC login
  to Azure Artifact Signing (`azure/artifact-signing-action`, pinned by
  commit), sign and timestamp the addon, and verify it
  (`scripts/verify-signed-native.mjs`: signtool `verify /pa`,
  `Get-AuthenticodeSignature`, a timestamp, the pinned signer, and the
  neutral-hash proof). The `package` job vendors those exact bytes through
  `HWSM_VENDOR` (with its `_SHA256`), writes the final
  manifest (`--unsigned`, `--signature`), runs `validate-native` with
  `HWSM_REQUIRE_SIGNED=1`, and qualifies the extracted package. Unset, the
  release ships the unsigned build as before; any other value fails the run.
- A signed binary ships only with a manifest that records its signature and
  its unsigned build: `validate-native` refuses anything else, including a
  recorded unsigned build that is not the shipped file without its
  signature. The pack gate checks each native member's signature layout
  and, when a native manifest exists, that the member is the binary it
  records; in `release:validate` the native gate runs on the staging copy
  the archive stage proves equal to the extracted members. CI's
  `signing-structure` job signs copies with a throwaway
  self-signed certificate on the runner to prove these checks on real
  signtool output: the copies strip back to the unsigned builds, pass
  `validate-native` on structure, and are refused by
  `verify-signed-native` and by `validate-native` with
  `HWSM_REQUIRE_SIGNED=1`. That proves structure, never publisher trust.
- Public copy says the addon is unsigned until a signed release exists.
  Authenticode, Defender, VirusTotal and Smart App Control are separate
  evidence; a signature is not a claim about any of the others.

Dev loop: `streamdeck link com.lawrensen.hwinfo.sdPlugin` once, then
`npm run watch` (rebuilds and restarts the plugin on save).

## Layout

- `src/` plugin source. `src/ui/` renderers (pure functions to SVG), state
  screens, themes, format. `src/hwinfo/` the shared-memory and Gadget readers.
  Dial behavior is layered pure modules: `gestures.ts` (input classification),
  `controls.ts` (preset schemes), `rotation.ts` (step math, rotation groups),
  `stats.ts`, `commands.ts` (the Control key bus), wired by
  `actions/sensor-dial.ts`.
- `com.lawrensen.hwinfo.sdPlugin/` manifest, property inspector (`ui/`), assets
  (`imgs/`), `themes.json`. `bin/` is build output (gitignored).
- `test/` node:test suites; `test/traces/` replayable gesture fixtures in the
  recorder's format, replayed through the production gesture/control/rotation
  code by `gesture-replay.test.ts`. `scripts/` build, e2e harnesses, image
  pipelines.
- `docs/` GitHub Pages site (just-the-docs), served at
  <https://docs.slawrensen.com/hwinfo-streamdeck/>.
- `marketing/` Elgato Marketplace listing images.

## Conventions

- **Public copy is plain and specific.** Lead with what changes for the user,
  the condition under which it works, and any action they need to take. Use
  exact UI labels. Write as Stephen, first person singular when needed, not
  a fictional team. Cut sales language, filler, metaphors and repeated
  explanations. Do not invent anecdotes or imitate another person's voice.
  Mark candidate features as unreleased; distinguish renderer samples,
  settings-panel captures and hardware photographs. Claims need code, tests
  or measured evidence. The maintainer's full checkout has the detailed
  rules in `docs/release/COPY_RULES.md`; run the release-copy validator there.
- **Tabs** for indentation. TypeScript strict: no `any`, explicit boundary
  types, `console.error` only (the probe and build scripts are exempt).
- **No em dashes** in prose or user-facing strings. The lone em dash on an empty
  key face (a "no value" placeholder glyph) is the only exception.
- **User-facing strings** on faces, in status hints and in the 1.8 panel
  sections come from `src/i18n-catalog.ts` through `t()` (`src/i18n.ts`) and
  `hwT()` (`ui/pi-strings.js`), with English built in as the fallback.
  English only in 1.8.0; a language needs a named reviewer
  (`docs/localization.md`). Numbers keep the `.` decimal separator in
  every language.
- **Themes live in `com.lawrensen.hwinfo.sdPlugin/themes.json`** as the single
  source of truth; `src/ui/themes.ts` validates and resolves. Renderer geometry
  is locked by `test/key-renderer.test.ts`: change the test alongside the
  geometry.
- **Marketing and docs images are real output, never mockups**: renderer-drawn
  boards regenerated by scripts, plus one photograph of the plugin running on
  real hardware (see `marketing/README.md`). Keep it that way. The README's
  boards in `.github/readme/` come from `npm run readme-boards`: the hero,
  dial and themes boards render sample values through the production
  renderers, the rest are cut from the docs boards. Rerun it after a renderer
  change or a docs board regeneration.
- **Sensor identity** is HWiNFO's stable `sensor-id : instance : reading-id`,
  never a list position, so keys survive restarts and reordering.
- **Settings are append-only** (fields are added, never renamed or removed),
  and the runtime salvage-parses them: malformed values degrade to safe
  defaults, are never thrown on mid-tick, and are never rewritten back.
- **A version bump touches four files together**: `package.json`, the
  manifest (`X.Y.Z.0`), `CHANGELOG.md`, and `package-lock.json`
  (`npm install --package-lock-only`); CI's `npm ci` fails on a stale lock.
- Performance claims are backed by measurements in `PERF.md`; each entry
  names its harness (`node scripts/perf-report.mjs` for most, plus the e2e
  load test and `scripts/soak-monitor.mjs` for soaks).

## Verifying a change

The renderers are pure functions with geometry-guard tests, so most visual
changes are provable with `npm test` plus a scratch render. Dial gesture or
rotation behavior belongs in a trace under `test/traces/` (the replay layer
proves commands and final state without hardware). Anything touching
the poller, the property-inspector protocol, or the data sources: run the
matching e2e suite. Before calling it done, `npm run suite:full` should be green
with zero orphaned processes.

Deck backgrounds (`src/ui/deck-art.ts`): Stars, Dusk and Nebula are cut per face
from Elgato's published panel layouts. To check that layout on a real
deck, start the plugin with `HWINFO_BG_ALIGNMENT=1` in its environment (a
user environment variable, then restart the Stream Deck app) and set the
shared Background to Stars: every Stars, Dusk or Nebula
face then draws one alignment pattern across the whole panel (1 px lines
at 45 degrees, circles around the panel's center and a center cross)
instead of its art, so a face off its published rect shows as a line that
steps at a bezel or seam. It is read once at plugin start, logged, and no
panel reaches it; `test/deck-art.test.ts` proves the pieces join exactly at
the published rects.

For release soaks, `node scripts/soak-monitor.mjs` watches the live plugin
from outside the process (kernel-level sampling plus a log tail, nothing
in-process, so the soaked build stays the exact shipping configuration) and
prints a PERF.md-ready summary: RSS/handle slopes, restarts, and gaps.
For an adversarial soak, run `node scripts/soak-adversary.mjs` alongside it:
a timed program of real faults against the live stack (consistency-mutex
holds under and past the staleness grace, a plugin kill, an app restart),
each verified from stock-level log markers and process identities, with
verdicts streamed to a JSONL file that the monitor's `--events` flag folds
into its summary. The monitor observes, the adversary injects; keep that
split so soak numbers stay honest.

## Distribution

- **GitHub Releases** (un-DRM'd, direct download): push a `vX.Y.Z` tag and
  `.github/workflows/release.yml` builds, signs when `SIGNING_MODE` is
  `required` (with my approval on the `release-signing` environment),
  packs, qualifies the extracted package, hashes, and stages a draft
  release that I publish by hand after checking the pack against the local
  candidate.
- **Elgato Marketplace** (DRM applied on Elgato's side): a separate submission.
- `CHANGELOG.md` is the release history; `docs/changelog.md` mirrors it on the
  site (`npm run changelog:page` regenerates it).

Some internal release-ops notes are kept out of this public repo by design.
