---
title: Measurement integrity candidate
nav_exclude: true
---

# Measurement integrity, September 7, 2026

This is the historical handoff for the unreleased candidate at
`7320a83436fa153ca37405378ea25367b9cd811e`. Its test and package evidence
does not qualify later changes. The current audit remediation reports live
under `audit/`; the [six-month roadmap](../ROADMAP.md) tracks the remaining
work. Neither document is release approval.

## Starting point and scope

GitHub main and stable v1.6.0 resolved to
`2ca44e95c2d8b3442c3ed411952621b254d4cbf0`. The genuine GitHub stable pack
matched the published SHA-256
`57fdf219a4b33cd006f565ed8e82b0d5c90a01bb84cfbdee78fd8a77a98f6d0d`.
The live Marketplace listing independently reported version 1.6 with
1.6.0.0 release copy, published September 7. Its package bytes were not
verified. PR #20 remained unmerged at
`9e2142315e8638bf78a020ac97689872b715cdc8`; no implementation was imported.

Work is isolated on `fix/measurement-integrity-20260907`. The original main
checkout and other worktrees were preserved. The identity repair is the
first commit, with provider links and evidence/history changes in separate
follow-ons. No themes, action UUIDs or native API changed.

## Findings and resulting behavior

| Finding | Evidence and result |
| --- | --- |
| Duplicate Gadget names silently change identity | Exact v1.6.0 changes the old base key from 40 to 80 when slot 0 disappears. Exact v1.5.1 at `4b1c093a50f8ce699615ce6972b2e3164b44b8b9` stops at the gap. Keep the sparse scan; withhold duplicates and persist observed ambiguity as local name hashes before returning a snapshot. |
| Auto switches providers but saved namespaces differ | Reproduced on the exact v1.6.0 bundle. Explicit, one-to-one `readingLinks` let either saved endpoint resolve the verified measurement. Unit/type mismatch, conflicts and absent endpoints fail closed. No name or value matching. |
| Registry reads lack producer timestamps | An initial or unchanged scan is not proof of liveness. Only changes in the same safe named reading and unit supply Gadget value evidence. Before that evidence, or after its grace expires, the face says Age unknown. |
| Gadget current values masquerade as history | MIN/MAX/AVG become unavailable. Keys and detail tiles show N/A and no historical number. Dial observations are explicitly local, sample-weighted sessions with reset and gap rules. |
| Subsecond changes are omitted from history | 250/500 ms exact-baseline tests fail; 1000 ms passes. Feed changed values within a producer second and steady readings on a new producer stamp. End segments at gaps, unit changes and provider transitions. |

Ordinary unique Gadget keys, including spaces, retain their format. Colons,
tildes and line breaks use a separate unambiguous encoding; their old
selections remain saved and require reselection. Duplicate names cannot
become eligible merely by removing one duplicate or restarting the plugin.
Rename the readings distinctly and select them again.

Incomplete source names or labels are withheld even when their numbers are
valid. A registry slot supplies no persistent identity. Literal producer
labels spelled exactly `Reading 0` through `Reading 1023` receive a tagged
identity distinct from both old key formats, because previous versions
generated those labels for missing registry fields. These readings remain
selectable but require explicit reselection and replacement of any old
cross-source link. This closes first-upgrade collisions without needing
historical observations. Other valid names remain unchanged. The plugin
does not rewrite saved selections or infer replacement identities.

Gadget cannot identify hardware that reuses a name, recover duplicate
history lost before observation, provide atomic multi-field snapshots, or
distinguish an unchanged live reading from abandoned registry data. A value
change in one row is source-level evidence, not proof of every row's age.
Shared Memory is the hardware-identity path. Unpaired selections remain
missing on the other provider. Pairing currently uses the advanced Deck
Config document; a guided picker is the smallest next PR.

See [Data sources](data-sources.md#link-readings-across-providers) for the
pairing contract, local journal location, sampling and session semantics.

## Reproducible proof

Raw local evidence is retained under `release/integrity-evidence/`, excluded
from the public repository. `HANDOFF.md`, `RESTART.md` and
`gate-results.json` in that directory record the final SHA, exact commands,
exit results, artifact hashes and pending gates. Do not infer a pass merely
from a file name; failed intermediate runs are retained too.

- `exact-baselines.log` compares exact provider source bytes through the
  native Windows registry bridge. The two-slot fixture is GPU / Temperature
  at slots 0=40 and 1=80, then slot 0 is removed.
- `red-exact-v160-all.log` runs new tests against otherwise unchanged
  v1.6.0 production code: eight failures and two passes.
  `red-exact-v160-links-e2e.log` records the actual baseline bundle failing
  to serve a Gadget-saved selection from Shared Memory.
- `test/gadget-provider.test.ts` covers sparse slots through index 1023,
  spaces, reserved delimiters, rename, reorder, restart, separate-process
  ambiguity, journal corruption/write failure and honest value evidence.
- `test/measurement-integrity.test.ts` and `test/poller-series.test.ts`
  refute conflicting/malformed links, wrong units/types, missing readings,
  duplicate observations, topology-only points, gaps and parser resets.
- `scripts/e2e-reading-links.mjs` drives the built plugin over a mocked
  Stream Deck socket with real Windows named mappings and registry keys.
  Different values on each provider prevent cached images from passing.
  It checks both saved namespaces across key densities, dial views and
  personalized detail tiles, then mirror Back and retained settings.
  `traffic.jsonl` and SVG frames are its raw outputs.
- The separate adversarial review found a duplicate-value freshness error
  in the first implementation. The full suite then exposed a parser
  revision reset that briefly refreshed frozen Shared Memory after reopen.
  Both were repaired and regression-tested; the failing logs remain.
  This was a separate self-refutation pass, not an external reviewer run.
- Actual renderer fixtures and browser PI captures are labelled as such.
  They are not physical-device screenshots. The existing marketing-board
  generator includes illustrative synthetic history, so its generated
  boards are not measurements of historical data and are not published.

## Compatibility, migration and rollback

Settings remain append-only and salvage-parsed. No saved action is
rewritten to repair an invalid setting or infer a provider match. Custom
labels, colors, tile order, layouts and profile navigation stay in place.
`readingLinks` is an optional global field. Removing it disables aliases
without editing any action. Old builds ignore the field.

Preserve `%LOCALAPPDATA%\HWiNFO Sensors\gadget-identity-*.jsonl` with this
user's setup. The append-only journal stores name hashes, not values, and
is local only. Corruption or a write failure stops Gadget reads; restore
the journal or use Shared Memory. Deleting it erases the observed history.

An older build ignores this journal and reintroduces the original duplicate
substitution. New `g2:` selections are also unavailable in old builds. A
safe rollback bench must use Shared Memory with the original exact
selections, preserve profiles/settings and retain the journal. Stream Deck
may refuse a lower-version package; downgrade behavior has not been proven
by a genuine installer and must not be described as automatic.

## Exact bench handoff: remaining gates

The automated harness replaces the Stream Deck host socket. A running
StreamDeck.exe or successful native reader proves neither a candidate host
installation nor a physical key or dial result. Those gates remain NOT RUN
until an operator records them on the exact package.

1. Record candidate SHA, package/native/bundle hashes, Windows build,
   Stream Deck app version, HWiNFO version and licensing mode, device models
   and firmware. Back up current profiles/settings and the identity journal.
   Preserve the original installed package and verified hashes for rollback.
2. Use the genuine installer to install the exact candidate pack on a bench
   account, then separately upgrade a preserved stable setup. Record each
   dialog, final installed version and installed artifact hashes. Do not
   treat linking a development folder as installer proof. Do not reset
   profiles to make the test pass.
3. Compare a physical key, each dense layout, dial view, custom detail tile
   and mirrored Back destination with HWiNFO. Include personal labels,
   colors and ordering, two devices and repeated navigation.
4. Configure explicitly verified Shared Memory/Gadget pairs. Exercise both
   saved namespaces through Auto fallback and upgrade. Confirm native units
   and actual changing values. Try missing, renamed and conflicting
   endpoints. Repeat with Celsius/Fahrenheit display preferences.
5. Observe duplicate Gadget names together; remove the first entry, reorder,
   restart HWiNFO and Stream Deck, and verify the old selection stays missing.
   Give each reading a distinct name and reselect. Include spaces, colons,
   tildes and sparse indexes. Do not alter unrelated reporting selections.
6. Use HWiNFO intervals of 250, 500 and 1000 ms where supported, and record
   the actual interval. Verify subsecond history, steady values, stopped
   reporting, missing sensors, short/long mutex holds, source changes and
   local-session reset/gap semantics. Gadget historical modes must never
   display the current value as MIN/MAX/AVG.
7. Follow the release runbook's external soak across a day or two of actual
   desk use, including HWiNFO restart, Stream Deck restart and sleep/wake.
   Record real start/end times and raw CSV/logs. Keep adversary injection
   separate from monitoring; do not count automated-suite intervals as soak.
   Exercise elevation/session/RDP rows from `native/hwsm/TESTING.md`.
8. Prove rollback and personalization retention on the bench, with the
   identity limitations above. Record Marketplace package/install evidence
   separately when explicitly authorized. A verified GitHub pack is not
   Marketplace acceptance or installation evidence.

No merge, tag, release publication, Marketplace submission, profile reset
or permission change is part of this candidate handoff.
