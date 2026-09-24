# F01 candidate identity

**Candidate:** commit `34dd1fc496d9c613ff0529110e0ec4ff096ae50d` on
`claude/sweet-shannon-lss3s9` (tree `77825f707ecdacc3dae580fc9c82895ad6ae13bd`),
based on `main` `2ca44e95c2d8b3442c3ed411952621b254d4cbf0` (1.6.0.0). The
commit that adds this file changes nothing else. The branch history was
rewritten once to drop tool attribution from commit messages and authors;
every tree is unchanged (this candidate was `47b34e2` before that), so
the tree hash is the stable identity. Every result in the
review record ran on this code.

This is a **source candidate, not a package**. No `.streamDeckPlugin`
was built: `npm run build` vendors `hwsm.node` (a Windows addon) and
`npm run pack` needs the Elgato CLI, neither available here. Manifest
version is unchanged (`1.6.0.0`); no version bump.

## Bundle

`npx rollup -c` (the first half of `npm run build`), Node v22.22.2,
Linux x64, run twice with byte-identical output:

| File | Bytes | SHA-256 |
| --- | --- | --- |
| `com.lawrensen.hwinfo.sdPlugin/bin/plugin.js` | 188,241 | `8bc22197a646865ad71c394b6e743a86f84dc2b795762306d9cd4f7294863dc3` |

## Shipped panel and manifest files

| File | SHA-256 |
| --- | --- |
| `manifest.json` | `15827568d498b2aeadb59eb31514fa42953e1377c8bcadcc7f55a97b3c14a59c` (unchanged from main) |
| `themes.json` | `df94bd990a76cd6d7d4f36d339e900a7e82d90a26a8ed717b2b27e4bf09f1aa5` (unchanged from main) |
| `ui/control.html` | `a52641fae3d8b06d9ba720d730610bf84bcce5851ceb0082839ee7002a604dc0` |
| `ui/detail-slot.html` | `50bdcd1e4552fdff77b7dafff2a0bf29971fde8ded311a624ffbc630d3996885` |
| `ui/pi-command.js` | `98d76a355df544a19debbc1f63ef7cad6ae5f464949c71819ef1dca2a9072174` |
| `ui/pi-common.js` | `706ea826e0d8ef8c9ff96c22d16b6bc1cd727e7b9858b7543d9da95164d2d51e` |
| `ui/pi-control.js` | `d89104f95624304673995a9d30b64da72b178064fbe49a7234e2b592c816d9f9` |
| `ui/pi-model.js` | `1a5ddc8b604dd5b417d3f71c8402033c29d062a96d34cfc95330dc0ee04a5f88` |
| `ui/pi-shell.js` | `4d506e6a107e717505866cf6b9ce93aa6dfed6c2a5fb6e76bf865627fcb89924` |
| `ui/pi-slot.js` | `4b82c5f37b5f004e6eee2588bc8f2e2c813990a4cdfa2a458fa7d859099f56ea` |
| `ui/pi.css` | `31bd9bbe048335935f405f35cfab205fe313b2a9f3189af1d42a49f67882324e` |
| `ui/sdpi-components.js` | `f6c0dfd2ed68e18084b9952842b86e3850cf837d674704700c2a0718e0a24f6b` (unchanged vendor file) |
| `ui/sensor-dial.html` | `ca456a9cc72feb0cc198dbdde70a5fd4672abc0a3f90e0291bb134dfbb63392b` |
| `ui/sensor-reading.html` | `9c00ea55ce9e241ff9243422418fa20000f7836be6b862ef4c88740c498ea108` |

The panels' cache token is `1.6.0.0-f01` (`PI_BUILD` in `pi-common.js`
and every `?v=` asset reference), so a webview holding the 1.6.0.0
panel files cannot mix them with these.

## Not produced

`hwsm.node` (unchanged native source; not rebuilt), the
`.streamDeckPlugin` pack and its hash, `release-native-manifest.json`.
