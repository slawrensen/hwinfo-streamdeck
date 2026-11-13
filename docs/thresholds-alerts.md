---
title: Thresholds & alerts
nav_order: 7
description: Set warning and critical limits for readings on keys and dials.
---

Set **Warn at** and/or **Critical at** to change the display when the current value reaches a limit: amber for warning, red for critical.

Open **Alerts** in the key or dial settings. Thresholds use the current value, even while the face displays MIN, MAX or AVG.

Both fields are optional and independent: set one, the other, or neither. A key with no thresholds just shows its themed value.

## The two fields

| Field | Effect on a **key** | Effect on a **dial** |
| --- | --- | --- |
| **Warn at** | Whole face flips to amber field / black text | Range bar fill turns amber (single view), or the alerting row's value (overview views) |
| **Critical at** | Whole face flips to red field / white text | Range bar fill turns red (single view), or the alerting row's value (overview views) |
| **Alert when the value drops to or below these numbers** (the direction checkbox) | Flips the comparison so a *low* value is the alarm | Same |

Thresholds have a second, quieter effect on any face that draws a range. A key whose **Graph under the value** is set to **Bar** or **Ring** (a one-reading-layout setting) marks the same limits on its track: muted amber from **Warn at** and muted red from **Critical at**, running toward the alarmed end, the low end when the direction checkbox alerts on a drop. The dial's range bar marks them the same way. The zones are blended toward the face background and the live fill draws over them in full color, and a key's range, which is always automatic, widens just enough to keep a zone visible. A dial pinned with **Bar from** / **Bar to** is never widened; a zone outside those bounds is clipped. See [Display: sparkline, bar, ring](sensor-reading.md#display-sparkline-bar-ring).

<details markdown="1">
<summary>See the Alerts controls in the settings panel</summary>

<a class="image-link" data-image-viewer href="{{ '/assets/img/settings-panel.png' | relative_url }}" aria-label="Enlarge image"><img src="{{ '/assets/img/settings-panel.png' | relative_url }}" width="800" height="4800" loading="lazy" decoding="async" alt="The whole settings panel with every section open, Alerts among them: Warn at 80, Critical at 89 and the checkbox that alerts on a drop, with the help line under them and the Timing group (Alert after, Clear by and Snooze lasts)."></a>

</details>

## How the comparison works

Use the correct unit and comparison:

**1. Thresholds are in the *displayed* unit.** The value compared against your thresholds is the **live (current) reading in whatever unit the key shows**, after the °C→°F conversion, not before. So if you tick **°F**, a **Warn at** of `100` fires on a 40 °C core (which displays as 104 °F). Leave °F off and the same sensor is compared in °C. Match your numbers to the unit on the face.

On a key or a dial, the panel saves the unit with the numbers when you type them, so a later **°F** switch converts them instead of changing what they mean: a **Warn at** of `80` typed while the face shows °C fires at 176 °F once you tick **°F**, and a dial's range bar marks its zones there too. The Alerts title line then prints the numbers in the unit they were typed in, and on a key a note under the fields says the key converts them. Numbers saved by 1.7.1 or earlier have no saved unit and are compared in the unit the face shows until you edit one of them; that edit saves the unit they are compared in at that moment, so the numbers you did not touch keep their meaning. The saved unit covers only the exact numbers it was saved with: if you go back to 1.7.1 and change **Warn at** or **Critical at** there, this version compares the numbers in the unit the face shows, as 1.7.1 does, until you edit one of them here again.

One exception: the shared **Data units** setting re-tiers byte and rate readings for display only. Thresholds still compare against the number HWiNFO reports, so a `12345.6 MB` reading is compared as `12345.6` while the key shows `12.3 GB` (`12.1 GiB` under Binary), and a `12000000 B/s` reading is compared as `12000000` while the key shows `96.0 Mbps`. Switching Decimal to Binary never re-arms an alert. A fixed unit under **Unit and decimals per reading**, on a key, a dial or a strip, changes the display only too: the strip's band labels show the limit in the reading's unit, and the limit is still typed in HWiNFO's. See [Data units](sensor-reading.md#advanced-shared-by-all-keys-and-dials).

A fixed unit under [Unit and decimals per reading](sensor-reading.md#unit-and-decimals-per-reading) (new in 1.8) works the same way. **Auto** picks the face's unit from the size of the value; a fixed unit keeps one unit at any value. Either way the comparison uses HWiNFO's own number and unit: a reading HWiNFO reports as `12100 MB` is compared as `12100` while the key shows `12.10 GB`, so its limits are typed in MB. KB to TB rescale HWiNFO's number by 1000 per step, so the GB on the face is HWiNFO's figure in thousands; KiB to TiB read HWiNFO's MB and GB as the 1024-based units they are. Changing a reading's unit or decimals never re-arms or silences an alert, and the panel keeps saving HWiNFO's unit with new limits.

> **Note:** Alert color always tracks the *live* value, even when the key is showing MIN / MAX / AVG (press cycles the stat mode). Pressing a key to look at its max won't turn the alert off if the current value is still over the limit, and won't turn it on just because the historical max was.

**2. The trigger is "at or past" the limit.** Crossing means reaching the value, not exceeding it:

- Normal direction (higher is worse): alerts when `value ≥ threshold`.
- Below direction (lower is worse): alerts when `value ≤ threshold`.

Critical is checked before warn, so once a reading is past both limits it shows critical.

### Decimal commas are accepted

Both fields accept a period *or* a comma as the decimal separator, so `70.5` and `70,5` both mean seventy-and-a-half. Blank means "no threshold". Anything that isn't a number is kept as typed but ignored (treated as no threshold), and the field says so under it: *Not a number. Alerts ignore this field until it is one.*

## Direction: alert when high vs. alert when low

By default higher is worse, the right setting for temperatures, power draw, and usage. Tick **Alert when the value drops to or below these numbers** for readings where *low* is the problem:

- **Fan RPM**: a stalled or dying fan reads *low*.
- **Free disk space**: you want to know when it drops *under* a floor.
- **Battery %**, available memory, and similar "headroom" readings.

With the box ticked, your **Warn at** / **Critical at** values become floors: the alert fires when the reading falls to or below them.

<a id="colors-are-global-and-colorblind-safe"></a>
## Alert colors

Key alert palettes stay the same across themes: amber with black text for warning, red with white text for critical. Type accents and a **Custom color** text setting do not override them. Dial overview values use alert foreground colors adjusted for contrast against the row background.

Physical recognition across devices and color-vision differences has not been established.

## Worked examples

### CPU temperature: warn 80, crit 90

Example values for a CPU temperature key in °C. Choose limits appropriate to your hardware:

- **Warn at** `80`
- **Critical at** `90`
- **Alert when the value drops**: leave unticked (higher is worse)

Idle and under load the key stays themed. At 80 °C it goes amber; at 90 °C it goes red. If you'd rather read the face in Fahrenheit, tick **°F** (under Temperature in Display). On a key or a dial whose limits were typed in 1.8 or later, `80` and `90` then fire at 176 °F and 194 °F with no change. On one whose limits were saved by 1.7.1 or earlier and never edited, enter them again in °F (`176` / `194`).

The [theme reference](themes.md#alerts-override-everything) lists the alert palettes.

### Fan RPM: alert when it drops

A fan you want to catch stalling:

- **Warn at** `500`
- **Critical at** `300`
- **Alert when the value drops**: **ticked**

Above 500 RPM the key is normal; at 500 or under it warns; at 300 or under it goes critical (0 RPM = a stopped fan = red).

### Free disk space: alert on a low floor

For a free-space reading that HWiNFO itself reports in **GB**:

- **Warn at** `50`
- **Critical at** `20`
- **Alert when the value drops**: **ticked**

Drops to 50 GB → amber; drops to 20 GB → red. If HWiNFO reports the reading in MB, enter limits in MB even when **Data units** or a fixed **GB** under Unit and decimals per reading displays GB.

> **Tip:** When you use the *below* direction, set **Critical at** *lower* than **Warn at** (crit is the worse, deeper floor). Because critical is evaluated first, an inverted pair (e.g. warn 300, crit 500 with below on) makes the reading go straight to critical without ever showing warn.

## Where thresholds live

The **Warn at**, **Critical at** and direction controls are in the **Alerts** section of both the Sensor Reading (key) and Sensor Dial settings panels, below Display. The folded section's title line states the rule in force (for example *Warn ≥ 80 °C · critical ≥ 90 °C*, followed by *first reading* on a key that draws several readings and by the unit it applies to on a dial), and a value that is not a number is flagged under its field and never used. Limits persist with the rest of that button's [settings](sensor-reading.md).

### Limits for each reading on a key

On the **Two readings, stacked**, **Three readings, rows** and **Four readings, quad grid** key layouts, **Warn at** and **Critical at** are the first reading's limits. Under them, every other reading on the key gets a row of its own with **Warn at**, **Critical at**, **Clear by** and a direction box, so each reading alerts on its own numbers in its own unit. The whole key recolors at the highest level any reading reaches; while it does, the readings that are not alerting draw their values in a muted tone. A row left empty never alerts. The title line adds how many readings have limits of their own (for example *own limits on 2 readings*).

Each reading has one set of limits:

- A reading shown on two rows (say a live value above its pinned maximum) has one set. The second row has no fields and names the row or fields that cover it.
- If limits saved in a row belong to the first reading, for example after you swap two readings, that row shows under the fields and is the one in force. A note under **Warn at** says the fields are not in use, and the title line drops *first reading*.
- A row's direction box and **Clear by** wait until the row has a **Warn at** or **Critical at**.
- A row can be edited only while its reading reports, because its unit is saved with the numbers. With HWiNFO closed or the reading missing, the row is disabled and says so.

A row's numbers keep the unit they were typed in, as the first reading's do. If a reading later reports a different unit (other than a °C/°F switch, which converts), its row says the limits were set for the old unit, and they stay off until you edit them.

### Timing on a key

The key's Alerts section has a folded **Timing** block. A key that never sets it alerts exactly as before.

- **Alert after** waits that long before a level shows: Immediately, 2, 5, 10 or 30 seconds. The reading has to stay past the limit for that long; dropping back inside it, or a gap in the data, starts the wait again.
- **Clear by** keeps a level up until the first reading is that far back on the safe side of the limit it crossed, so a reading sitting on the line does not flicker. Each reading's row has its own **Clear by**.
- **Snooze lasts** (Off, 5 minutes, 15 minutes or 1 hour): while the key shows an alert, a press silences it for that long instead of doing its usual action, and a thin band along the top of the key marks the snooze. A higher level, a recovery or the end of the time ends it. When the **A press** choice includes a hold, a hold still does that action. A detail view's Back tile never snoozes.

On a **dial**, thresholds and the manual bar range are additionally **unit-scoped**: rotation can put readings with different units on the same dial, so a threshold applies only to readings in the unit it was typed against (a °C warn level can never fire on a fan RPM you rotate to). That unit is the one HWiNFO reports, so if you switch HWiNFO's own temperature unit, a dial's thresholds and bar range entered before the switch stand down until you edit one of them again, even when the dial was already showing that unit through its **°F** box. Details on [Dial controls & presets](controls.md#thresholds-and-mixed-units).

## Dial: separate limits, timing and snooze

These controls are in the dial's **Alerts** section, under the dial's own limits. Leave them alone and the dial alerts exactly as described above.

**Separate limits for** *the reading on the dial* gives that one reading its own **Its warn at**, **Its critical at** and direction, which replace **Warn at** and **Critical at** for it alone and stay with it through rotation. Ticking the box saves the limits in HWiNFO's unit for that reading (°F when the dial's **°F** box is on), shown in brackets after each label. For data and rate readings that is not always the unit on the face: a reading HWiNFO reports in MB is typed in MB even when the dial shows it in GB. When the dial's own limits cover the reading, they are copied in as a starting point, so ticking alone changes nothing: a warning that shows, a wait under way and a snooze all carry on, and clearing the box again does the same. The box waits while the reading is not reporting, because there is no unit to save yet. Clearing the box removes that reading's limits and nothing else. If the reading later reports a different unit, its limits stand down instead of being reinterpreted, and a note under the section says so until you edit them (a switch between °C and °F is converted, not reinterpreted).

**Timing** is folded under the limits:

| Setting | What it does | Default |
| --- | --- | --- |
| **Alert after** | A level shows only after the value has stayed past its limit for 2, 5, 10 or 30 seconds over consecutive readings. Stale or missing data restarts the wait, and so does a stretch with no readings at all, such as time the dial spent on another page while no other HWiNFO action was on screen. | **Immediately** |
| **Clear by** | A level stays until the value is back past its limit by this amount, in the unit of the dial's limits. **Its clear by** does the same for a reading's separate limits. | 0: clears at the limit |
| **Snooze lasts** | How long **Snooze alerts** silences a dial: 5 minutes, 15 minutes or 1 hour. | 15 minutes |

**Snooze alerts** is a command, not a setting: assign it to a push or touch gesture on the **Custom** preset ([Dial controls & presets](controls.md#control-presets)), or to an [HWiNFO Control key](controls.md#the-hwinfo-control-key-action). It silences every alert the dial shows at that moment, each at its current level, and the bar or row goes back to its normal color while a thin band along the top of the dial marks the snooze. A snooze ends early when the value recovers, and a reading that goes from warning to critical alerts again. When the time is up, the next current reading ends the snooze; while HWiNFO is stale or not running, nothing alerts and the snooze waits. **End alert snooze** on a Control key ends it at once. A snoozed critical reading neither holds nor pulls the auto cycle.

Nothing here is written to settings while it runs: the wait, the recovery state and any snooze live in the plugin's memory. They survive a page or profile switch for up to 30 minutes, like pause and pin, and start fresh when the plugin restarts.

On Ember, the dial's bar color sits close to the warning amber, so while a warning shows on an Ember dial whose bar is in Ember's own accent, the bar's empty track turns a muted amber too. Every other theme draws the bar as before.

Older plugin versions ignore these settings: after a downgrade the dial alerts from **Warn at** and **Critical at** alone, immediately, with no snooze. A push or touch gesture set to **Snooze alerts** does what the Legacy preset does with it instead: a push resets session stats (as far as **A stats reset clears** reaches), a tap cycles the stat mode and a touch hold goes back to the current value. An HWiNFO Control key set to **Snooze alerts** or **End alert snooze** shows its alert icon.
