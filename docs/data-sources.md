---
title: Data sources
nav_order: 8
---

The plugin reads HWiNFO through one of two local interfaces. It picks the best one automatically, so most people never touch this, but knowing the trade-offs explains why some keys can't show min/max/avg, and what is needed to preserve a selection after HWiNFO's free 12-hour timer.

## Shared Memory vs. Gadget registry

| | **Shared Memory** (preferred) | **Gadget registry** (fallback) |
| --- | --- | --- |
| What it reads | `Global\HWiNFO_SENS_SM2` mapping | `HKCU\Software\HWiNFO64\VSB` registry key |
| Sensor coverage | **everything** HWiNFO measures (~500+ readings) | only the sensors you tick in HWiNFO |
| Min / max / average | ✅ full stats since HWiNFO started | current value only; historical modes display **N/A** |
| Free version | auto-disables after **12 hours** (HWiNFO Pro: unlimited) | ✅ no time limit |
| Works across privilege levels | usually: fails only when HWiNFO is elevated and Stream Deck is not (see [Troubleshooting](troubleshooting.md)) | ✅ yes |
| Enable in HWiNFO | Settings → **Shared Memory Support** | **Configure Sensors** → **HWiNFO Gadget** tab → **Report value in Gadget** |

Shared Memory is richer in every way except licensing: on the free version it switches itself off after 12 hours of runtime. The Gadget registry has none of that time pressure but only carries the current value of the specific readings you ticked, with no historical min/max/avg.

> **Note:** Because the Gadget source has no historical stats, a key or detail tile set to **Show: Minimum / Maximum / Average** displays **N/A** with an empty value while reading from it. When a key is on the Gadget source, the settings panel shows a small note explaining this.

### Enabling Shared Memory

In HWiNFO → **Settings** → tick **Shared Memory Support**. This is the recommended setup and gives you full stats. See [Getting started](getting-started.md) for the full first-run checklist.

### Enabling Gadget reporting

In HWiNFO's sensor window click **Configure Sensors**, open the **HWiNFO Gadget** tab, tick **Enable reporting to Gadget**, then tick **Report value in Gadget** for each reading you want. Shift-click selects a whole range at once. Only ticked readings appear to the plugin; an enabled-but-empty Gadget key surfaces a **Tick sensors / in Gadget** screen on the key.

HWiNFO gives every ticked reading a numbered slot and leaves that number reserved even while the reading itself is switched off, so the numbering can carry permanent gaps. The plugin reads across them (since 1.6.0; earlier versions stopped at the first gap, see [Troubleshooting](troubleshooting.md#only-some-of-the-readings-i-ticked-in-gadget-show-up)).

The registry carries no sensor ids, so a key picked while on the Gadget source is identified by the source name and reading label as HWiNFO writes them. Ordinary unique names survive reordering and restarts. Renaming either changes that identity. Missing or blank source names and labels are withheld; the plugin never substitutes a registry position for a name. Duplicate names are also withheld, and observed ambiguous names remain blocked across restarts. Check the source names, give readings distinct labels and select them again.

Names containing colons or tildes use a new unambiguous key format; old selections stay saved but need reselection. Genuine producer labels spelled exactly `Reading 0` through `Reading 1023` also need reselection once. Earlier versions invented those same labels when a registry label was missing, so an old selection cannot safely identify a real producer label. The real named reading remains selectable under a new identity, and its explicit cross-source link must be updated if one was configured. Other names, including `Reading 00` and `Reading 1024`, keep their existing identities. No saved settings are rewritten automatically.

The registry cannot reveal ambiguity that vanished before the first observation, or distinguish a new device that reuses an old unique name. Use Shared Memory for hardware identity.

## Auto mode

The **Data source** setting defaults to **Auto**, and it's what most setups should stay on. In Auto mode the plugin:

1. Uses **Shared Memory** whenever it's available.
2. **Falls back to the Gadget registry** when Shared Memory isn't usable, for example after the free version's 12-hour timer expires, or if you turned Shared Memory Support off but still have Gadget reporting on.
3. **Upgrades back to Shared Memory** on its own once it returns (probed roughly every 15 seconds while on the fallback), so restarting HWiNFO or re-enabling sharing quietly restores full stats with no clicks.

There's one exception to the "prefer Shared Memory" rule: if Shared Memory is simply not running *and* you have Gadget reporting enabled but no sensors ticked, the plugin shows the more helpful **Tick sensors / in Gadget** guidance rather than a generic "Start HWiNFO".

> **Note:** When the free version disables Shared Memory it leaves the named mapping behind flagged with a `DEAD` marker rather than removing it. As of 1.1.5/1.1.6 the plugin validates that marker the moment it opens the mapping, so Auto mode reliably falls back to the Gadget registry instead of getting stuck on the **Shared Memory / is off** screen. (Earlier versions could strand there.)

Provider availability and reading identity are separate. Without explicit links, a saved Shared Memory key is missing on Gadget and a saved Gadget key is missing on Shared Memory. Selecting a similarly named reading is not proof of equivalence.

The plugin runs **one reader** for the whole deck regardless of how many keys and dials are visible, so all of them share the same source at any moment.

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
in turn and copy the exact key from its picker. Verify the source, label,
native unit and reading type against HWiNFO. Return to Auto, then add
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
as saved. Removing a pair stops that fallback without rewriting any action.
A picker-based pairing flow is still planned; the Config step is currently
required.

## Freshness and local history

The first successful Gadget read establishes a baseline, not a producer
heartbeat. Only an observed value change in the same named reading and unit
provides evidence. New slots and renames advance the rendering revision but
not freshness. After 15 seconds without value evidence, or before the first
change, Gadget displays **Age unknown**. It may be steady or stopped;
the plugin cannot tell. Shared Memory supplies a producer poll timestamp.

Each occupied Gadget row is read twice. If a field changes between those
observations, the whole scan is withheld and retried on the next poll.
Recognized numeric display precision must also agree with the raw number;
rounding and locale grouping are allowed without selecting a guessed locale.
Boolean/nonnumeric displays retain their existing behavior. These checks
catch observable contradictions; they cannot prove an atomic snapshot
when a writer pauses in an intermediate state. Shared Memory provides the
consistency mutex that Gadget lacks.

Sparklines ingest subsecond changes plus advancing producer timestamps.
Steady observations within the same producer second are not separate known
samples. A skipped read, missing/non-finite reading, stale data, native-unit
change or provider transition clears the segment while retaining the
subscription. A cadence change clears all segments. No line bridges those
gaps and no sample represents elapsed time without producer evidence.

Dial statistics are local, sample-weighted observations for selected and
rotation/view readings. Repeated held frames do not count. Reset, missing or
non-finite readings, stale/unavailable status, provider/unit/link changes
start a new session. Temporary mutex holds within the freshness grace add
no duplicate samples; they do not reset the session until status goes stale.
Hidden dials retain their existing 30-minute session lifetime. These numbers
are not HWiNFO history or time-weighted averages.

The identity deny list lives under `%LOCALAPPDATA%\HWiNFO Sensors\` as
`gadget-identity-<registry-key-hash>.jsonl`. It stores only hashes of names,
never readings, and sends nothing anywhere. Keep it when moving or restoring
this user's setup. Corruption or a write failure stops Gadget reads. Restore
the journal or use Shared Memory; deleting it erases observed ambiguity.
