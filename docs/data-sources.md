---
title: Data sources
nav_order: 8
description: Choose Shared Memory or Gadget and understand reading identity and history.
---

The plugin reads one local HWiNFO source at a time. Auto prefers Shared Memory and can fall back to the Gadget registry. Switching sources does not automatically match saved readings.

For setup, use [Install](installation.md#one-time-hwinfo-setup). This reference covers 1.7 and later; linking from the settings panel and Calculated readings are new in 1.8. [Upgrade changes](whats-new-1.7.md) describe differences from 1.6.

## Shared Memory vs. Gadget registry

| Capability | **Shared Memory** (preferred) | **Gadget registry** (fallback) |
| --- | --- | --- |
| What it reads | `Global\HWiNFO_SENS_SM2` mapping | `HKCU\Software\HWiNFO64\VSB` registry key |
| Sensor coverage | readings HWiNFO publishes through Shared Memory | only the sensors you tick in HWiNFO |
| Min / max / average | HWiNFO's statistics since start or its last reset | current value only; historical modes display **N/A** |
| Free version | auto-disables after **12 hours** (HWiNFO Pro: unlimited) | not timed by me; see below |
| Windows access | depends on account, session and object permissions | reads the current user's registry; depends on account and key permissions |
| Enable in HWiNFO | Settings → **Shared Memory Support** | **Configure Sensors** → **HWiNFO Gadget** tab → **Enable reporting to Gadget**, then **Report value in Gadget** per reading |

Shared Memory provides hardware identities, a producer timestamp and HWiNFO's statistics. On the free version it switches off after 12 hours: HWiNFO's [license page](https://www.hwinfo.com/licenses/) lists the 12-hour limit for Shared Memory Support. I have not run Gadget reporting past 12 hours to check it myself. Gadget provides current values under name-based identities, without a producer timestamp or historical statistics.

> **Note:** Because the Gadget source has no historical stats, a key with **Value shown** set to **Minimum**, **Maximum** or **Average**, or a detail tile showing one of those, displays **N/A** with an empty value while reading from it. While a Gadget source is live, the message under the settings panel's header says "Gadget registry: current values only, no min, max or average." (unless a note about withheld readings takes its place), and the plugin's full note about the source sits under **Advanced → Connection**.

### Enabling Shared Memory

In HWiNFO → **Settings** → tick **Shared Memory Support**. This is the recommended setup and gives you full stats. See [Getting started](getting-started.md) for the full first-run checklist.

A Shared Memory selection uses HWiNFO's `sensor-id : instance : reading-id` identity. If two published rows have the same identity, both are withheld. A row whose sensor owner is missing is also withheld. Labels, units and list order cannot tell those rows apart. Healthy neighboring readings keep serving; a saved unique identity recovers automatically when HWiNFO publishes it unambiguously again, starting a fresh local history and statistics segment after the gap.

Saved settings are not rewritten. A selection saved by an older version with a duplicate suffix (`~n`) or an ownerless positional key (`?:...`) remains missing. Once the producer's identity is valid and unique, select the reading again and update any explicit source link that used the old key.

### Enabling Gadget reporting

In HWiNFO's sensor window click **Configure Sensors**, open the **HWiNFO Gadget** tab, tick **Enable reporting to Gadget**, then tick **Report value in Gadget** for each reading you want. Shift-click selects a whole range at once. Tick the readings you put on the deck: every poll reads the whole ticked list on the plugin's one thread, and with all 554 readings on my bench ticked one scan took about 150 ms, against about 5 ms for the 39-row registry test fixture (measured in [PERF.md](https://github.com/slawrensen/hwinfo-streamdeck/blob/main/PERF.md)). Only ticked readings appear to the plugin. HWiNFO 8.48 creates the registry key only once a reading is ticked: with reporting enabled and nothing ticked, the keys show **Start HWiNFO / not detected** while HWiNFO is running. A key that is there but holds no rows, which unticking everything can leave, shows **Tick sensors / in Gadget**.

HWiNFO gives every ticked reading a numbered slot and leaves that number reserved even while the reading itself is switched off, so the numbering can carry permanent gaps. The plugin reads across them (since 1.6.0; earlier versions stopped at the first gap, see [Troubleshooting](troubleshooting.md#only-some-of-the-readings-i-ticked-in-gadget-show-up)).

The registry carries no sensor ids, so a key picked while on the Gadget source is identified by the source name and reading label as HWiNFO writes them. Ordinary unique names survive reordering and restarts. Renaming either changes that identity. Missing or blank source names and labels are withheld; the plugin never substitutes a registry position for a name.

Two ticked readings that share a source name and label are both withheld while both are ticked: the registry has nothing else to tell them apart, and the plugin does not choose between them. HWiNFO itself reports some readings twice under one name (a GPU fan once in RPM and once in percent, for example), and a shift-click range ticks both. In HWiNFO, untick or relabel the one your key should not show, and the other comes back on its own after two polls; the name then means the reading that is left, so acting on the reading your key was on hands the key to the other. The other readings keep working throughout, the settings panel says that names are withheld, and the plugin log names the slots once. Nothing about this is written to disk or remembered after a plugin restart.

<details markdown="1">
<summary>Selections saved by 1.6 and downgrade limits</summary>

<a id="legacy-gadget-selections"></a>
HWiNFO's standard source names carry a colon (`CPU [#0]: <model>`), and 1.7 stores a reading whose source name or label contains a colon or tilde under a new key format. Most selections saved by 1.6.0 and earlier keep working: the plugin republishes the old `g:<source>:<label>` spelling as a checked alias when exactly one current reading renders to it and no live reading owns that spelling outright, except for the cases below. Keys, dense layouts, dials, rotation sets and groups, custom detail lists, and per-reading names and colors saved under the old spelling resolve through the alias; nothing is inferred from names.

These old selections get no alias and need one reselection:

- A label spelled exactly `Reading 0` through `Reading 1023`. Earlier versions invented those labels when the registry label was missing, so an old selection cannot identify a real producer label. The real named reading remains selectable under a new identity.
- Any literal tilde (`~`) in either the source name or reading label, even in a unique name such as `CPU~Package`, `Hot~Spot` or `Core~`.
- A key carrying the old `~n` duplicate suffix.

The tilde restriction prevents an old duplicate key from being mistaken for a literal name. Reselect these readings in the picker and update any explicit cross-source link that uses the old key. Other names, including `Reading 00` and `Reading 1024`, keep working.

An old spelling that now matches two readings does not resolve while it is ambiguous. That ambiguity is judged on each scan and not remembered, so once one of the two is unticked in HWiNFO the remaining reading answers to the shared spelling. No saved settings are rewritten automatically. A dial still saves the reading it lands on when it rotates or auto cycles, in the new key format, so a Gadget dial without a rotation set needs one reselection if you go back to 1.6.0. The same goes for any Gadget reading you pick in 1.7 whose source name carries a colon, as HWiNFO's standard names do: it is saved in the new key format, which 1.6.0 cannot read.

</details>

A name is all the registry offers. A key saved under a name that two readings shared shows whichever reading still carries it, and the registry cannot distinguish a new device that reuses an old unique name. Use Shared Memory for hardware identity.

## Auto mode

The **Data source** setting defaults to **Auto**, and it's what most setups should stay on. In Auto mode the plugin:

1. Uses **Shared Memory** whenever it's available.
2. **Falls back to the Gadget registry** when Shared Memory isn't usable, for example after the free version's 12-hour timer expires, or if you turned Shared Memory Support off but still have Gadget reporting on.
3. **Switches back to Shared Memory** when it becomes readable, checked roughly every 15 seconds while on Gadget.

There's one exception to the "prefer Shared Memory" rule: if Shared Memory is simply not running *and* the Gadget registry key is there but holds no rows, the plugin shows **Tick sensors / in Gadget** rather than "Start HWiNFO", because ticking readings is the step that fixes it. The same goes for a Gadget key that opened but whose scan was refused: a registry changing during the scan shows **Source busy / retrying**, and a registry value that cannot be read as text shows **Source error / open settings**. A Shared Memory mapping that exists but is switched off is still reported as **Shared Memory / is off**. Gadget reporting enabled with nothing ticked is none of these: HWiNFO writes no key then, so the keys show **Start HWiNFO / not detected**.

> **Note:** When the free version disables Shared Memory it leaves the named mapping behind flagged with a `DEAD` marker rather than removing it. As of 1.1.5/1.1.6 the plugin validates that marker the moment it opens the mapping, so Auto mode falls back to the Gadget registry instead of getting stuck on the **Shared Memory / is off** screen. (Earlier versions could strand there.)

Provider availability and reading identity are separate. Without explicit links, a saved Shared Memory key is missing on Gadget and a saved Gadget key is missing on Shared Memory. Selecting a similarly named reading is not proof of equivalence.

The plugin runs **one reader** across all connected decks, so all keys and dials share the same source.

## Advanced settings

Both the Sensor Reading (key) and Sensor Dial actions expose the same two data-source controls under **Advanced → Connection**, marked **All keys and dials**. They are **global**: one setting for the whole plugin, not per key. Connection also carries the note on [reading links](#link-readings-across-providers), the **HWiNFO setup steps** checklist and, while a Gadget source is live, the plugin's full note about it.

### Data source

| Option | Behavior |
| --- | --- |
| **Auto (Shared Memory, else Gadget)** *(default)* | The fallback/upgrade logic above. Recommended. |
| **Shared Memory only** | Never touches the Gadget registry. If Shared Memory is off or expired, keys show a status screen instead of falling back. |
| **Gadget registry only** | Reads only the registry. Current values only; for the free version's 12-hour limit, see [Shared Memory vs. Gadget registry](#shared-memory-vs-gadget-registry). |

With either single-provider choice, when that provider has no data the message under the settings panel's header says which setting keeps the other provider out, with a **Data source setting** button that opens it.

### Read every

How often the plugin reads the source, from **250 ms** to **5 seconds** (default **1 second**), under *Advanced → Connection* (called **Poll every** before 1.7; the stored setting is unchanged). One reader serves every visible key and dial, so this is the plugin's total read rate, not per-key.

> **Note:** HWiNFO updates its own sensors on a separate poll cycle (default **2 seconds**, set in HWiNFO's own settings). That cycle is the real ceiling on how fast values and sparklines change; reading faster than HWiNFO refreshes re-reads the same numbers. Set **Read every** to HWiNFO's interval or a little shorter to pick up each new value soon after HWiNFO writes it. A longer interval means fewer reads, and less plugin CPU, when you do not need sub-second updates.

## How this shows up elsewhere

- On the Gadget source, a key with **Value shown** on **Minimum**, **Maximum** or **Average** displays N/A; dials use explicitly local session statistics. There is no HWiNFO-provided history on Gadget; see [Sensor Reading](sensor-reading.md) and [Sensor Dial](sensor-dial.md).
- On Shared Memory, if the source stops updating (HWiNFO's Sensors window closed, or HWiNFO stopped polling), keys and dials switch to a **Not updating** screen with **check sharing**. Gadget shows **Age unknown / check Gadget**: steady values look the same as ones a killed or crashed HWiNFO left. The free version's 12-hour expiry is different: it shows **Shared Memory off**, or Auto mode switches to Gadget on its own, where saved Shared Memory readings need [links](#link-readings-across-providers). Full list in [Troubleshooting](troubleshooting.md).

## Link readings across providers

A link marks a Shared Memory reading and a Gadget reading as the same
sensor, so a key or dial keeps showing it when Auto switches source. Links
apply to every HWiNFO key and dial and are kept in the shared settings.

### Link from the settings panel

1. Select a key or dial that shows the reading and open **Advanced >
   Reading links**. The card at the top shows the reading with its source,
   sensor, native unit, value and whether it is live. A key with several
   readings offers them under **Reading to link**.
2. Press **Look on Gadget** (or **Look on Shared Memory**). The plugin reads
   the other source once; it never does this on its own, at most once every
   5 seconds, and not while **Data source** is set to one provider only.
   Readings the plugin saw earlier in the session also count, so after Auto
   fell back to Gadget you can still pair against the Shared Memory
   readings it saw before.
3. Pick the counterpart under **Matching reading**. Readings with the same
   source name, label and unit are listed first as suggestions; nothing is
   picked for you. A reading that cannot be linked says why (another unit,
   already in another link, an older Gadget spelling).
4. Read the line under the list ("Links CPU Package (Shared Memory, °C)
   with CPU Package (Gadget, °C) for every key and dial.") and press
   **Link**.

Each stored link shows both readings, which one is in use, and whether the
other one would take over (seen in this session in the same unit). Rows
the plugin ignores (malformed, conflicting, over the limit) are shown as
stored and left alone. **Unlink** asks for a second press. When a key's
saved reading belongs to the source that is not in use, the status block
under **Reading** offers **Link it to a Gadget reading** (or **Link it to a
Shared Memory reading**), which opens this section on it.

Opening the section, picking, filtering and leaving write nothing. A
**Link** or **Unlink** press changes only its own row: the plugin re-reads
the shared settings, refuses the change if the links were edited in
another panel or document since the list was shown (the list refreshes;
press again), and keeps every other field and row, including ones this
version does not know. A Gadget value read once is shown with "age
unknown": an unchanged Gadget value is never treated as live.

### Link by hand

The panel writes the same `readingLinks` list you can edit in
**Advanced > Configuration documents**. To edit it there, copy each
reading's `readingKey` from **This key's settings** (**This dial's
settings** on a dial) while that source is active (a Gadget reading saved
by 1.6.0 for a source name with a colon must be picked again first: a link
takes only the current key the picker writes), add the rows to the
**Shared settings** document and press **Replace shared settings**, which
asks for a second click because it changes every HWiNFO key and dial.
Replace swaps the whole document, so edit the one the well shows and keep
its other fields. Example only; use your own keys:

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
Clock 6, Usage 7, Other 8 (None 0), as Shared Memory reports them: HWiNFO
types several percent readings as Other, and the type is checked on the
Shared Memory side only, because the Gadget source has no type of its own.
The unit is HWiNFO's native unit, before any display conversion; a Yes/No
reading's unit is `Yes/No` on both sources. A link never converts units. A changed unit or type
leaves the alternate selection missing until you verify and update the
pair. Duplicate endpoints invalidate all conflicting pairs. Malformed rows
are ignored; more than 128 rows disables the whole list. Gadget readings
that share a name cannot be linked while withheld. Names and current values
alone are never used for automatic matching.

Both saved endpoint keys keep working in regular/dense keys, dials and
custom detail lists. Existing labels, colors, ordering and settings remain
as saved, and per-reading names and colors saved under either endpoint
follow the confirmed pair. A pairing edit takes effect at once on every key,
dial and tile; re-applying or reordering the same pairs changes nothing. A
rotation set or group that holds both endpoints of one pair steps through it
as one reading, and a custom detail list shows one cell per measurement. If
the list already contains both keys, the first wins. The duplicate cell and
its own label and color are hidden together, so later readings keep their
labels and stored colors. A pair that makes a listed key the opener's own
reading hides that key's cell the same way. Unlinking restores the original
layout unless you edit the detail list or one of its tiles: that explicit
edit saves the shown layout. A tile plan last saved by 1.7.0 keeps the older
rule until an edit moves it, so its labels can sit one reading off
([Sensor details](sensor-details.md#choosing-the-list)).
Opening the panel, refreshing sensors, or changing other settings does not
rewrite the saved list or tile plan. The
settings panel shows a linked saved key as present, with its label, tick and
color. Removing a pair stops that fallback without rewriting any action. A
dial session or sparkline segment ends for a pairing edit only when its
saved key now stands for a different measurement; adding or removing an
alias for the same measurement resets nothing.

## Calculated readings

**Advanced > Calculated readings** adds a reading the plugin works out
from other readings: a sum, average, lowest or highest of 2 to 8
readings, or a difference (A - B) or ratio (A / B, optionally as a
percentage of B) of two. It is listed under **Calculated (plugin)** in
every reading picker and can be used on keys, dials, rotation sets and
detail lists like any other reading. If HWiNFO can compute the value
itself (a custom sensor in HWiNFO), use that one: it keeps HWiNFO's own
minimum, maximum and average.

- **New calculated reading** opens a draft: an operation, the readings and
  an optional label. The line under it shows what the plugin would publish
  (value, unit, the expression with every input named) before you press
  **Save**. Editing the draft and **Cancel** write nothing.
- All inputs need one unit (°C and °F, and data sizes or rates of one kind,
  convert). Temperatures, clocks, voltages, fan speeds and percentages can
  be averaged, compared or subtracted but not summed. A difference of two
  temperatures is shown in Δ°C (Δ°F with Fahrenheit on), converted by 1.8
  with no offset.
- Without a label the plugin names the reading after its inputs, for
  example "CPU Package Power + GPU Power". A sum of reported powers is what
  those sensors report, not what the PC draws from the wall, so a label on
  a sum of powers cannot name wall, system, total, PSU or outlet power; the
  generated label is used instead.
- A calculated reading can use a calculated reading listed above it, up to
  3 levels deep. Counting one reading twice (directly, through a link, or
  through a nested sum) is refused. At most 32 calculated readings can be
  stored.
- When an input is missing, has no value, changed unit, or a ratio divides
  by zero, the calculated reading has no value and the list says why; it
  never shows 0 in its place. It is as fresh as its inputs: recalculating
  is not new data.
- Calculated readings have no minimum, maximum or average from HWiNFO. A
  changed definition (operation, inputs) starts a new dial session and a
  new trend line; a label change does not. **Delete** asks for a second
  press, and is refused while another calculated reading uses the one you
  delete. A key showing a deleted calculated reading says the reading is
  missing.
- A detail filter matches a calculated reading as "Calculated (plugin)"
  followed by its label, so a saved filter of `*` lists them too once any
  are defined.

Saving works like a link press: the plugin re-reads the shared settings,
refuses the change if the list changed elsewhere since it was shown, and
writes only that row. The definitions are kept in the shared settings as
`calculatedReadings`; editing them by hand is not needed.

## Freshness and local history

The first successful Gadget read establishes a baseline, not a producer
heartbeat. Only an observed value change in the same named reading and unit
provides evidence. New slots and renames advance the rendering revision but
not freshness. After 15 seconds without value evidence, or before the first
change, Gadget displays **Age unknown**. It may be steady or stopped;
the plugin cannot tell. Shared Memory supplies a producer poll timestamp.
Opening a source is never evidence: after a source switch, a page change or
a reopen, the held values keep their real age and source, and the stale
screen names the source the values came from. A Shared Memory timestamp
is aged by the clock HWiNFO wrote it from, so a HWiNFO that stopped
polling, before or while the keys were off screen, shows as not updating
on the first read. The same rule applies after a delayed poll: a newer
timestamp on an unchanged value still carries its producer age, rather
than starting a new 15-second grace period when the plugin reads it.
The Gadget baseline survives a page change, a drill-down
and Back for 15 seconds; after a longer absence Gadget starts again at
**Age unknown** until a value moves. A page you return to more than 15
seconds after its last accepted read can show the stale screen for one poll
when the first read on return is skipped, and dial sessions start again
from the next accepted read.

<details markdown="1">
<summary>How Gadget scans handle partial writes and duplicate rows</summary>

<a id="gadget-scan-consistency"></a>
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

HWiNFO renumbers its Gadget rows after every tick or untick and rewrites
them one at a time, so for a moment one reading can sit in two slots, or in
none. A scan that sees a name on two rows for the first time is withheld
and retried like any other torn read, and the keys hold their values for
that poll. If the next scan shows the name on one row, that scan is
retried the same way, because it can be the moment the other row is in no
slot. A name that appears alone under a different unit than it last
showed is treated as a first sighting for the same reason (HWiNFO writes
the rows in sensor order, so a twin that sorts ahead of the one on your
key lands in its slot first), which means a unit you change in HWiNFO
costs two retried scans before the new unit shows. A name still on two
rows at the next scan belongs to
[two ticked readings](#enabling-gadget-reporting): those rows are withheld
on their own, and released once two scans in a row show the name on one
row, for the same reason.

</details>

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

A [Time window](sensor-reading.md#time-window) of 1, 5 or 15 minutes, on a
key's sparkline or a two-row dial, places those samples at the time the
plugin read them instead. Its line ends at the last sample and breaks where
no sample came in, including a sleep or a pause in polling longer than three
**Read every** intervals (at least 5 seconds). A **Read every** change does
not clear it.

Gadget publishes no timestamp per row, only the values. The plugin knows a
scan is new because some row in it changed, and then records every row of
that scan as a new sample. So when HWiNFO stops updating a block of rows
while other rows still change (one large untick in HWiNFO's Gadget settings
can leave such a block until HWiNFO exits), the frozen rows are recorded as
flat lines instead of gaps, in a time window and in the 36-sample line
alike, and their keys keep showing the frozen values without **Age
unknown**. The plugin cannot tell such a row from a steady reading.
Restarting HWiNFO clears the block.

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
