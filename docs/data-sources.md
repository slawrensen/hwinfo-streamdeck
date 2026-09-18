---
title: Data sources
nav_order: 8
---

The plugin reads one local HWiNFO source at a time. Auto prefers Shared Memory and can fall back to the Gadget registry. Switching sources does not automatically match saved readings.

> This page describes the **unreleased 1.7 candidate**. Stable 1.6 has no explicit provider links, fills Gadget historical fields with the current value, and uses different freshness and identity handling. See [what changes from 1.6](whats-new-1.7.md).

## Shared Memory vs. Gadget registry

| | **Shared Memory** (preferred) | **Gadget registry** (fallback) |
| --- | --- | --- |
| What it reads | `Global\HWiNFO_SENS_SM2` mapping | `HKCU\Software\HWiNFO64\VSB` registry key |
| Sensor coverage | readings HWiNFO publishes through Shared Memory | only the sensors you tick in HWiNFO |
| Min / max / average | HWiNFO's statistics since start or its last reset | current value only; historical modes display **N/A** |
| Free version | auto-disables after **12 hours** (HWiNFO Pro: unlimited) | ✅ no time limit |
| Windows access | depends on account, session and object permissions | reads the current user's registry; depends on account and key permissions |
| Enable in HWiNFO | Settings → **Shared Memory Support** | **Configure Sensors** → **HWiNFO Gadget** tab → **Report value in Gadget** |

Shared Memory provides hardware identities, a producer timestamp and HWiNFO's statistics. On the free version it switches off after 12 hours. Gadget has no such timer, but provides current values under name-based identities, without a producer timestamp or historical statistics.

> **Note:** Because the Gadget source has no historical stats, a key or detail tile set to **Show: Minimum / Maximum / Average** displays **N/A** with an empty value while reading from it. When a key is on the Gadget source, the settings panel shows a small note explaining this.

### Enabling Shared Memory

In HWiNFO → **Settings** → tick **Shared Memory Support**. This is the recommended setup and gives you full stats. See [Getting started](getting-started.md) for the full first-run checklist.

### Enabling Gadget reporting

In HWiNFO's sensor window click **Configure Sensors**, open the **HWiNFO Gadget** tab, tick **Enable reporting to Gadget**, then tick **Report value in Gadget** for each reading you want. Shift-click selects a whole range at once. Only ticked readings appear to the plugin; an enabled-but-empty Gadget key surfaces a **Tick sensors / in Gadget** screen on the key.

HWiNFO gives every ticked reading a numbered slot and leaves that number reserved even while the reading itself is switched off, so the numbering can carry permanent gaps. The plugin reads across them (since 1.6.0; earlier versions stopped at the first gap, see [Troubleshooting](troubleshooting.md#only-some-of-the-readings-i-ticked-in-gadget-show-up)).

The registry carries no sensor ids, so a key picked while on the Gadget source is identified by the source name and reading label as HWiNFO writes them. Ordinary unique names survive reordering and restarts. Renaming either changes that identity. Missing or blank source names and labels are withheld; the plugin never substitutes a registry position for a name. Duplicate names are also withheld, and a name seen twice stays withheld for this Windows account across restarts: the plugin never lets the remaining reading adopt a name it once shared. To use those readings again, give both readings new distinct labels in HWiNFO and select them again; the reading that keeps the old name stays withheld. Deleting the [identity journal](#freshness-and-local-history) is the only reset.

HWiNFO's standard source names carry a colon (`CPU [#0]: <model>`), and 1.7 stores a reading whose source name or label contains a colon or tilde under a new key format. Selections saved by 1.6.0 and earlier keep working: the plugin republishes the old `g:<source>:<label>` spelling as a checked alias when exactly one current reading renders to it and no live reading owns that spelling outright. Keys, dense layouts, dials, rotation sets and groups, custom detail lists, and per-reading names and colors saved under the old spelling resolve through the alias; nothing is inferred from names. An old spelling that now matches two readings resolves to nothing until you reselect; that ambiguity is judged on each scan and not remembered, so once one of the two is unticked in HWiNFO the remaining reading answers to the shared spelling. Two kinds of old selection get no alias and need one reselection: a label spelled exactly `Reading 0` through `Reading 1023` (earlier versions invented those labels for a missing registry label, so an old selection cannot safely identify a real producer label; the real reading remains selectable under a new identity, and an explicit cross-source link to it must be updated), and a key carrying the old `~n` duplicate suffix. Other names, including `Reading 00` and `Reading 1024`, keep their existing identities. No saved settings are rewritten automatically.

The registry cannot reveal ambiguity that vanished before the first observation, or distinguish a new device that reuses an old unique name. Use Shared Memory for hardware identity.

## Auto mode

The **Data source** setting defaults to **Auto**, and it's what most setups should stay on. In Auto mode the plugin:

1. Uses **Shared Memory** whenever it's available.
2. **Falls back to the Gadget registry** when Shared Memory isn't usable, for example after the free version's 12-hour timer expires, or if you turned Shared Memory Support off but still have Gadget reporting on.
3. **Switches back to Shared Memory** when it becomes readable, checked roughly every 15 seconds while on Gadget.

There's one exception to the "prefer Shared Memory" rule: if Shared Memory is simply not running *and* you have Gadget reporting enabled but no sensors ticked, the plugin shows the more helpful **Tick sensors / in Gadget** guidance rather than a generic "Start HWiNFO". The same goes for a Gadget key that opened but whose scan was refused: a registry changing during the scan shows **Source busy / retrying**, and an identity journal that could not be read or saved shows **Source error / open settings**. A Shared Memory mapping that exists but is switched off is still reported as **Shared Memory / is off**.

> **Note:** When the free version disables Shared Memory it leaves the named mapping behind flagged with a `DEAD` marker rather than removing it. As of 1.1.5/1.1.6 the plugin validates that marker the moment it opens the mapping, so Auto mode reliably falls back to the Gadget registry instead of getting stuck on the **Shared Memory / is off** screen. (Earlier versions could strand there.)

Provider availability and reading identity are separate. Without explicit links, a saved Shared Memory key is missing on Gadget and a saved Gadget key is missing on Shared Memory. Selecting a similarly named reading is not proof of equivalence.

The plugin runs **one reader** across all connected decks, so all keys and dials share the same source.

## Advanced settings

Both the Sensor Reading (key) and Sensor Dial actions expose the same two data-source controls under **Advanced** (on dials the section is labelled **Dial gestures & advanced**). They are **global**: one setting for the whole plugin, not per key.

### Data source

| Option | Behavior |
| --- | --- |
| **Auto (Shared Memory, else Gadget)** *(default)* | The fallback/upgrade logic above. Recommended. |
| **Shared Memory only** | Never touches the Gadget registry. If Shared Memory is off or expired, keys show a status screen instead of falling back. |
| **Gadget registry only** | Reads only the registry. Current values only, but immune to the 12-hour limit. |

### Poll every

How often the plugin reads the source, from **250 ms** to **5 seconds** (default **1 second**). One reader serves every visible key and dial, so this is the plugin's total read rate, not per-key.

> **Note:** HWiNFO updates its own sensors on a separate poll cycle (default **2 seconds**, set in HWiNFO's own settings). That cycle is the real ceiling on how fast values and sparklines change; polling the plugin faster than HWiNFO refreshes just re-reads the same numbers. Match or slightly under-run HWiNFO's interval for the freshest data without wasted reads. A slower plugin poll is a fine way to trim CPU further if you don't need sub-second updates.

## How this shows up elsewhere

- On the Gadget source, key **Show: Min/Max/Average** modes display N/A; dials use explicitly local session statistics. There is no HWiNFO-provided history on Gadget; see [Sensor Reading](sensor-reading.md) and [Sensor Dial](sensor-dial.md).
- On Shared Memory, if the source stops updating (HWiNFO's Sensors window closed, or HWiNFO stopped polling), keys switch to a **Not updating** screen with **check sharing**. Gadget shows **Age unknown / check Gadget**: steady values and an old registry left after exit cannot be distinguished. The free version's 12-hour expiry is different: it shows **Shared Memory off**, or Auto mode falls back to Gadget on its own. Full list in [Troubleshooting](troubleshooting.md).

## Link readings across providers

This is an advanced, explicit pairing step. Set the source to each provider
in turn, select the reading on that provider, then open **Advanced > Config >
This key**, press **Copy** and take the `readingKey` value (the key before
the appended friendly name; the picker itself never shows keys). Select the
reading afresh on the Gadget source first: a key saved by 1.6.0 for a source
name with a colon is an alias spelling, and a link only accepts the current
key the picker writes. Verify the
source, label, native unit and reading type against HWiNFO. Return to Auto,
then add
`readingLinks` to the existing **Advanced > Config > Deck** document and
Apply. Preserve its other fields. Example only; use your own keys:

```json
{
  "readingLinks": [
    {
      "sharedMemory": "f0001234:0:1000001",
      "gadget": "g:Test Source:Test Temp",
      "unit": "°C",
      "sensorType": 1
    }
  ]
}
```

The type numbers are Temperature 1, Voltage 2, Fan 3, Current 4, Power 5,
Clock 6, Usage 7, Other 8 (None 0). The unit is HWiNFO's native unit, before
any display conversion. A link never converts units. A changed unit or type
leaves the alternate selection missing until you verify and update the
pair. Duplicate endpoints invalidate all conflicting pairs. Malformed rows
are ignored; more than 128 rows disables the whole list. Ambiguous Gadget
readings cannot be linked while withheld. Names and current values alone
are never used for automatic matching.

Both saved endpoint keys keep working in regular/dense keys, dials and
custom detail lists. Existing labels, colors, ordering and settings remain
as saved, and per-reading names and colors saved under either endpoint
follow the confirmed pair. A pairing edit takes effect at once on every key,
dial and tile; re-applying or reordering the same pairs changes nothing. A
rotation set or group that holds both endpoints of one pair steps through it
as one reading, and a custom detail list shows one tile per measurement. The
settings panel shows a linked saved key as present, with its label, tick and
color. Removing a pair stops that fallback without rewriting any action. A
dial session or sparkline segment ends for a pairing edit only when its
saved key now stands for a different measurement; adding or removing an
alias for the same measurement resets nothing. A picker-based pairing flow
is still planned; the Config step is currently required.

## Freshness and local history

The first successful Gadget read establishes a baseline, not a producer
heartbeat. Only an observed value change in the same named reading and unit
provides evidence. New slots and renames advance the rendering revision but
not freshness. After 15 seconds without value evidence, or before the first
change, Gadget displays **Age unknown**. It may be steady or stopped;
the plugin cannot tell. Shared Memory supplies a producer poll timestamp.
Opening a source is never evidence: after a source switch, a page return or
a reopen whose first reads are skipped, the held values keep their real age
and source, and the stale screen names the source the values came from.
So a page you return to more than 15 seconds after its last accepted read
can show the stale screen for one poll when the first read on return is
skipped, and dial sessions start again from the next accepted read.

Each occupied Gadget row is read twice. If a field changes between those
observations, the whole scan is withheld and retried on the next poll. A
recognized numeric display must also agree with the raw number (rounding
and locale grouping are allowed without selecting a guessed locale); a row
whose formatted value contradicts its raw value skips that scan once (one
sighting cannot be told from a read that landed between HWiNFO's two writes
for the row); a row that contradicts itself on consecutive scans is withheld
on its own, the other rows keep working, the plugin log names the slot, and
the settings panel says so. A Yes/No display carries no numeric unit; its raw flip counts as
value evidence. These checks
catch observable contradictions; they cannot prove an atomic snapshot
when a writer pauses in an intermediate state. Shared Memory provides the
consistency mutex that Gadget lacks.

Sparklines collect changed values between producer timestamps as well as
advancing timestamps. Repeated held frames do not add points. A skipped
read, missing or non-finite reading, stale data, reading-type or native-unit
change, or provider transition clears the segment while retaining the
subscription. A poll-interval change clears all segments. A pairing edit
clears only the segment of a saved key that now stands for a different
measurement.

With no Sensor Reading key or Sensor Dial visible, polling stops and history
stays in memory. Returning can append to those retained samples; a period
without observations is not a measured continuous history. The line is spaced
by samples, not elapsed time.

Dial statistics are local, sample-weighted observations for selected and
rotation/view readings. Repeated held frames do not count. Reset, missing or
non-finite readings, stale or unavailable status, and provider, unit or type
changes start a new session; the first live frame after a stale or
unavailable tick shows **stats reset: data gap** once. A pairing edit starts
a new session only for a saved key that now stands for a different
measurement. Temporary mutex holds within the freshness grace add
no duplicate samples; they do not reset the session until status goes stale.
Hidden dials retain their existing 30-minute session lifetime. These numbers
are not HWiNFO history or time-weighted averages.

The identity deny list lives under `%LOCALAPPDATA%\HWiNFO Sensors\` as
`gadget-identity-<registry-key-hash>.jsonl`. It stores only hashes of names,
never readings, and sends nothing anywhere. Keep it when moving or restoring
this user's setup. The journal is append-only and capped at 1 MiB.
Corruption, a write failure or a journal over that cap stops Gadget reads
with **Source error** (in Auto mode only while Shared Memory is not running;
a switched-off mapping is reported as **Shared Memory is off** instead), and
the plugin log names the identity journal. Restore the journal from a backup
or use Shared Memory. Deleting the journal is the only reset: it erases every
observed ambiguity, so a reading that once shared a name can adopt it again.
