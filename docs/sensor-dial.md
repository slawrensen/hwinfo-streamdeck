---
title: Sensor Dial (Stream Deck +)
nav_order: 5
---

The **Sensor Dial** action shows HWiNFO readings on a Stream Deck + or Stream Deck + XL touchscreen. Choose one reading with a range bar, two readings with sparklines, or three compact rows. Rotate to switch readings; push and touch to control the display.

> This page describes 1.7. See [what changed from 1.6](whats-new-1.7.md).

It shares its data source, themes, thresholds, and formatting with [Sensor Reading](sensor-reading.md) keys; this page covers only what's specific to the dial. Windows only, HWiNFO required.

![A Stream Deck + dial face: CPU temperature with its live value, session min/max, and a range bar whose track marks the warn and critical zones in amber and red.]({{ '/assets/img/dials.png' | relative_url }})

## The touchscreen readout

The slot draws four things, top to bottom:

| Element | Shows |
| --- | --- |
| **Label** | Your custom label, or the sensor's own (renamed) label if you leave it blank. |
| **Value + unit** | The live reading, formatted per **Decimals**, with the unit inline. A stat badge (`· MIN`, `· MAX`, `· AVG`) is appended when you're viewing a session stat instead of the live value. |
| **Stats line** | `▼ <low>   ▲ <high>   session`: the lowest and highest values seen this session. |
| **Range bar** | A fill showing where the **live** value sits between the bar's min and max. |

The bar always tracks the live value, even while you're touching through MIN / MAX / AVG on the number above it.

## Overview view

**View** offers two multi-row layouts besides the single readout, both listing what rotation moves through:

- **Overview (two rows, big values + trend)**: two rows with large right-aligned values. A highlight band and accent bar mark the selection. Long labels wrap; labels that fit one line leave room for a sparkline. The footer shows the selected reading's session statistics.
- **Overview (three rows)**: one line per reading. A marker on the left shows the selection and window position. The context line contains the shared name and session `▼ low ▲ high`; names shorten before statistics. Put it above or below the rows with **Context line**, and show or hide row dividers with **Separators**. Pause, pin and stat badges share the name area. Temporary messages briefly replace the context line.

![The dial's View setting in the settings panel set to the three-row overview, with the Row labels, Context line and Separators selects it reveals below it.]({{ '/assets/img/pi-dial-overview.png' | relative_url }})

Three things keep the short labels readable:

- **Shared prefixes move to the context line.** For "GPU Temperature / GPU Hot Spot / GPU Thermal Limit", the rows show "Temperature / Hot Spot / Thermal Limit" and the context line shows `GPU`. The two-row view uses its footer. Custom names and labels consisting only of the shared word stay intact. Set **Row labels** to **Always full labels** to disable this shortening.
- **Values share a right-aligned column**, with units beside them. Three-row values use a fixed column and reduce their font size to fit. Two-row columns follow the widest visible value. Labels use the remaining width.
- **You can rename any reading.** Click a chip's name under **Rotation set** and type a new one (Enter or click away to save; clear it to go back to the HWiNFO name). The name shows on that row and as the dial's title whenever that reading is selected, in both views. Unticking a reading keeps its name for later.

  ![The dial's Rotation set in the settings panel: two chips already renamed to "CPU" and "GPU" (the first highlighted because that reading is on the dial), and a third chip open in its inline rename box with the typed name selected, above the line reading "Rotation moves through these 3 readings only".]({{ '/assets/img/pi-dial-rename.png' | relative_url }})

  For example, rename two `SPD Hub Temperature` readings to `DIMM 1` and `DIMM 2` for display. This does not change HWiNFO's names, so it does not separate two Gadget readings that share a name.

See the [current rendered dial examples](#reading-colors) below. Older gallery images may show number colors that stable 1.6 could not produce through its settings.

The overview does not get its own list to manage. It shows exactly what rotation already steps through, in the same order:

- your **rotation set**, if you built one (any size; the view shows a two- or three-row window of it),
- the **active rotation group** when [groups](controls.md#rotation-groups) are in charge of plain rotate,
- otherwise the **picked sensor's readings**.

Rotating works exactly as in the single view: the selection steps through the full list (saved as always), the mark follows it, and the three-row window scrolls with the selection, clamped at the ends. Auto cycle, alert interrupts, pin, pause, group jumps, touch taps and the HWiNFO Control key all keep working unchanged; a touch tap through MIN / MAX / AVG switches every row to that session stat and notes it beside the stats (the context line on three rows, the bottom line on two).

A few details specific to the view:

- The range bar and the big value belong to the single view; the overview trades them for the extra rows. Bar min/max settings are simply not used while the overview is active.
- **Warn / Critical** still apply (unit-scoped as always): a row whose reading trips a threshold shows its value in the alert color, and the alert-aware auto cycle can pull the selection (and so the window) to it.
- A custom **Label** renames the marked row only (and clears on rotation unless Label mode is fixed); per-reading chip names persist per reading instead.
- Values truncate at 12 characters and keep the shared **Decimals** setting; units truncate at 4 characters on the three-row face (its unit column is fixed) and 5 on the two-row face.
- With fewer than three readings in reach, the overview lists what there is; the status faces (HWiNFO down, no selection, sensor missing) are the same as the single view's.

Switching back to **One reading** restores the exact single-view face.

## Reading colors

Saved colors also follow explicitly confirmed Shared Memory/Gadget links.
If both linked keys have their own color, the displayed key's choice wins.
In an uncurated rotation the displayed key is the live key for unselected
rows and the saved key for the selection, so a measurement with two saved
colors can change color when rotation selects it. Keep one color per
measurement to avoid that.

These controls arrived in 1.7 (and the earlier issue #31 preview); 1.6.0 does not have them.

Choose a two-row or three-row **View**, then open **Appearance** and set **Text → Theme**. **Reading colors** uses the same presets and color wells as the [four-reading key](sensor-reading.md#layout-four-readings-the-quad-grid):

- **Signal**, **Pairs**, or **Uniform** applies a preset to the listed readings.
- Click a reading's color well to choose its own number color. Two temperatures can have different colors, like DIMM 1 and DIMM 2 below.
- **Auto** resets one reading; **Automatic** resets the listed readings. Readings without a chosen color follow the sensor-type option below, or normal text.

Colors follow each reading through rotation, reordering and groups. Switching views or removing and re-adding a reading keeps its saved color. Individual colors work with **Type accents off**, including on Paper. Labels, units, footer, graphs and the selection indicator keep their existing styling.

![The 1.7 settings panel's Appearance section with Text set to Theme, Color numbers by sensor type off, and individual color wells using the Signal preset.]({{ '/assets/img/pi-dial-reading-colors-1.7.png' | relative_url }})

*The 1.7 settings panel at panel build 1.7.0.0-7, captured through the local test host with live HWiNFO.*

![Three-row and two-row dial examples comparing automatic text with individual reading colors. CPU temperature is blue, GPU temperature pink, pump speed green, GPU power gold and GPU load blue.]({{ '/assets/img/dial-reading-colors-1.7.png' | relative_url }})

*Production-rendered fixed sample data. Both sides use Void, Text → Theme and Type accents off; only the individual reading colors change. This is not a hardware photograph.*

For automatic category colors, enable **Color numbers by sensor type** and leave **Type accents** enabled: temperature numbers share pink, fans cyan, power gold and load purple. The option is off by default. Paper, Type accents off and unknown categories keep normal text. Automatic colors adjust for readability on each row's background.

**Text → Theme** keeps your chosen colors exact; **Dim** dims them. A valid **Text → Custom** color, including an inherited deck default, overrides reading colors. Warning and critical values keep priority and the existing unit scoping. Leave both number-color controls at their defaults to keep the released appearance.

## Gestures

These are the **Legacy** preset defaults, which every dial runs until you pick otherwise. The [Dial controls & presets](controls.md) page covers the Elite and Custom presets, press+rotate, touch zones, pause/pin, reset reach, and the HWiNFO Control key action.

| Gesture | Effect |
| --- | --- |
| **Rotate** | Step through your [rotation set](#rotation-set-ignore-turns-and-auto-cycle) if you built one, otherwise through the readings of the *same sensor source* (e.g. every reading under one GPU), wrapping around at the ends. The new choice is saved. Does nothing while **Ignore turns** is on. |
| **Push** (press the dial) | Reset the session min / max / average back to the current value. |
| **Touch** (tap the screen) | Cycle the displayed number: current → session min → session max → session average. |
| **Long touch** (touch and hold) | Jump straight back to the live current value. |

> **Note:** Without a rotation set, Rotate only walks readings that belong to the same physical sensor as your current pick, so you can spin through, say, all of one drive's temperatures without leaving that device. To jump to a different source entirely, use the sensor picker in settings, build a rotation set that crosses sensors, or use the Elite preset's press+rotate sensor jump.

## Rotation set, Ignore turns, and Auto cycle

Three settings control what rotation can reach:

- **Rotation set.** Tick the checkbox on any rows in the sensor picker to build a custom list; the dial then rotates through *only* those readings, in the order you picked them, wrapping at the ends. The set can mix readings from different sensors. Picked readings show as removable chips under the picker, and the chip of the reading on the dial right now is highlighted in blue: rotate, jump groups or let the auto cycle run with the panel open and the highlight moves with it. Leave the set empty for the default same-sensor behavior. The set can also be [split into named rotation groups](controls.md#rotation-groups): plain rotate then stays inside one group and press+rotate (Elite) jumps between groups.

  ![The dial's sensor picker open with "cpu" typed, each row carrying a rotation-set checkbox with its live value: two rows ticked, the rest unticked.]({{ '/assets/img/pi-dial-picker.png' | relative_url }})

  ![The dial's settings panel with a rotation set of three readings from three different sensors (CPU temperature, GPU temperature, pump) shown as removable chips with a Split into groups button, the CPU temperature chip highlighted blue as the reading on the dial, above the Ignore turns checkbox, the Auto cycle select and the On alert option.]({{ '/assets/img/pi-dial-rotation.png' | relative_url }})
- **Ignore turns.** A checkbox that makes the dial ignore rotation entirely, so a bump against the deck can never move you off the reading you chose. Push, touch, and the settings panel still work.
- **Auto cycle.** Steps to the next reading in the rotation set (or the picked sensor's readings) on a timer, from every 5 seconds to every 5 minutes. It runs even while turns are ignored, which makes a hands-off tour of your picked readings: build a set, ignore turns, set a cycle time. A manual turn restarts the timer, and each step clears the custom label just like a manual turn (unless **Label mode** is set to fixed). Timing rides the poll interval, so a step can land up to one poll late. Ticking **On alert** makes the cycle alert-aware: it holds instead of rotating away while the shown reading is critical, and its next step goes to a critical member of the set instead of the next one in order. Left unticked (the default), alerts do not steer the cycle; see [Dial controls & presets](controls.md#thresholds-and-mixed-units).

Rotation also protects your selection when HWiNFO temporarily stops publishing the saved sensor (a restart, a device dropout): turns are ignored until the sensor returns, instead of jumping to an unrelated reading.

### Session stats are the dial's own, per reading

The dial calculates local min/max/average for each reading. These are separate from HWiNFO's own statistics. The average is the sum of accepted observations divided by their count; it is not time-weighted. Repeated held frames do not count again.

- The selected reading, rotation-set members and multi-row view readings accumulate while the poller runs. Ordinary rotation preserves a reading's session. Hidden dials can retain their state for up to 30 minutes, subject to the [hidden-dial limit](controls.md#pause-pin-and-reset-reach).
- A missing or non-finite reading, a stale or unavailable source, or a source, native-unit or type change resets the affected session; the first live frame after a stale or unavailable source shows **stats reset: data gap** once. A pairing edit resets a session only when its saved key now stands for a different measurement. This also applies to retained readings while another reading is selected. The next accepted sample starts the new session.
- **Push** resets the current reading under the Legacy preset. **Reset reach** can widen that to the set or every dial. Other presets can assign reset to a different gesture.
- Gadget can supply observations for these local statistics, but has no HWiNFO history or producer timestamp. **Age unknown** replaces the display when freshness cannot be established. See [Data sources](data-sources.md#freshness-and-local-history).

With no Sensor Reading key or Sensor Dial visible, polling stops. Retained state does not establish what happened during that unobserved period.

## Settings

Open the dial's Property Inspector to configure it. Most fields mirror the key action.

| Setting | What it does |
| --- | --- |
| **Sensor** | Searchable picker over every reading HWiNFO publishes, with a live value preview. Same picker as keys, plus a checkbox per row for the rotation set. |
| **Rotation set** | The readings rotation is limited to, shown as removable chips. Empty means the picked sensor's readings. Can be split into named [rotation groups](controls.md#rotation-groups). |
| **View** | **One reading** (default), or an [overview](#overview-view) of the rotation list: two rows with big values and trend sparklines, or three compact rows. |
| **Row labels** | Overview only: shorten shared prefixes into the context line (default), or always show full labels. |
| **Context line** | Three-row overview only: the shared name and session stats line sits above the rows (default) or below them. |
| **Separators** | Three-row overview only: thin lines between rows (default), or none. |
| **Bump guard** | "Ignore turns" disables rotation for bump protection. |
| **Auto cycle** | Timer that steps through the rotation set automatically. Off by default. |
| **Label** | Custom label; blank falls back to the sensor's name. |
| **Theme** | Preset gallery for this dial, or **Deck default** to follow the deck-wide theme. See [Themes](themes.md). |
| **Text** | Text intensity for this dial: **Deck default**, **Theme**, **Dim**, or **Custom** with an exact color. See [Themes](themes.md#text-theme-dim-or-custom). |
| **Color numbers by sensor type** | Multi-row views: opt into automatic category colors for normal numbers. Off by default. See [Reading colors](#reading-colors). |
| **Reading colors** | Multi-row views: choose a preset or individual number colors, with **Auto** to reset a reading. See [Reading colors](#reading-colors). |
| **Decimals** | Auto (magnitude-based; compacts large values through k/M/G/T, e.g. `48.7M`) or a fixed 0–3. Byte and rate units re-tier under the deck-wide **Data units** preference instead. |
| **Unit** | Show temperatures in °F instead of °C. |
| **Bar min** | Fixed low end of the range bar on the single view. Leave blank to auto-track the session low. |
| **Bar max** | Fixed high end of the range bar on the single view. Leave blank to auto-track the session high. |
| **On alert** | Makes the auto cycle alert-aware: it jumps to a critical member of the rotation set instead of waiting its turn, and holds there while the reading stays critical. Off by default. |
| **Label mode** | Whether a custom label clears when rotation moves to another reading (default), or stays as a fixed title. |
| **Warn at** | Live value at which the bar fill turns amber. Use the displayed temperature unit; byte and rate values use HWiNFO's original unit before Data units changes the display scale. |
| **Critical at** | Live value at which the bar fill turns red, using the same units as Warn at. |
| **Direction** | "Alert when value drops below thresholds" flips the comparison: for fan RPM, free space, and other where-lower-is-worse readings. |

Thresholds and the manual bar range are **unit-scoped**: they only apply to readings in the unit they were typed against, so a °C threshold can never misfire on an RPM reading you rotate to. Details on the [controls page](controls.md#thresholds-and-mixed-units).

### Bar range: fixed vs. session

By default (both fields blank) the bar spans the **session low → high**, so the fill grows as new extremes appear and always uses the full width of the range you've actually seen. Set **Bar min** / **Bar max** to pin the bar to a fixed scale instead (e.g. `0` and `100` for a usage percentage, or `30` and `90` for a CPU temperature) so the fill position means the same thing every time you glance at it. You can set just one end; the other stays automatic.

With **Warn at** or **Critical at** set, the bar's track also marks the threshold zones in muted amber and red, escalating toward the alarmed end (the low side when *Direction* alerts below), the same zones a key's [Bar or Ring display](sensor-reading.md#display-sparkline-bar-ring) draws, and an automatic range widens just enough to keep them visible. A manual Bar min/max is never widened; zones outside it are simply clipped. The zones are fixed landmarks; the **fill** is the live value, at full strength (accent normally, amber/red while alerting) so it always reads over them.

## Alerts on a dial

Dials take the same **Warn at** / **Critical at** thresholds as keys, compared against the **live** value. But the alert shows differently, and differently per view: on the single view only the **range bar's fill** flips to the alert color (amber for warn, red for critical) while the label, value and rest of the face stay in your chosen theme; the two [overview](#overview-view) layouts have no range bar, so there the alerting row's **value text** carries the color instead.

Since 1.7, overview alert values adjust for contrast against the row background. Alerts take priority over individual reading colors and Custom Text. See [Themes & alerts](themes.md).

> **Note:** The single view has no sparkline; its range bar is the at-a-glance indicator there. The two-row [overview](#overview-view) draws real sparklines for its visible readings.

## Status screens

When HWiNFO isn't delivering data, the touchscreen shows a short two-line message instead of a reading:

| Touchscreen | Meaning / fix |
| --- | --- |
| **Start HWiNFO** / not detected | HWiNFO isn't publishing on either interface. Start it (Shared Memory Support or Gadget reporting). |
| **Source busy** / retrying | The sensor source was busy or changed during a read. The plugin retries automatically on the next poll. |
| **Shared Memory off** / enable in HWiNFO | HWiNFO reports sharing disabled. Re-enable it, or rely on the Gadget fallback in Auto mode. |
| **No new data** / check sharing | No new Shared Memory measurement evidence has been observed within the grace period. Check HWiNFO and Shared Memory Support; a busy connection can also prevent reads. |
| **Age unknown** / check Gadget | Gadget has no producer timestamp. Before the first observed value change, or after 15 seconds without another, the plugin cannot tell whether the source is steady or stopped. Check HWiNFO and Gadget reporting. |
| **Gadget empty** / tick sensors | The Gadget registry is present but has no readable sensor rows. In HWiNFO, open Configure Sensors and the HWiNFO Gadget tab; check Enable reporting to Gadget and tick the readings you need. |
| **Access denied** / open settings | Windows denied access needed to read the sensor source; the error does not identify which access rule failed. Open settings and choose **Copy support report** for support. Review the Windows account, session and privilege settings of HWiNFO and Stream Deck. |
| **Source error** / open settings | The sensor source could not be opened or validated. In Auto mode a Gadget failure shows this only while Shared Memory is not running. Open settings and choose **Copy support report** for support. |
| **Bridge failed** / reinstall it | The native HWiNFO bridge (`bin/hwsm.node`) could not load. Reinstall the plugin from its release package, then restart it. Keep any Windows or security-software report for support. |

Before you've picked a sensor, the dial shows **HWiNFO** / **rotate to pick** with the hint *or use the settings panel*. If a saved sensor is no longer in HWiNFO's output, it shows **Sensor missing** / **waiting**, and turns are ignored so your saved pick survives the outage; reselect in settings if the sensor is gone for good.

## Advanced (deck-wide)

The dial's Property Inspector also exposes the same global settings as keys, under **Dial gestures & advanced**: **Deck theme**, **Deck text**, **Type accents**, **Data units**, **Data source**, and **Poll every**. These apply to the whole plugin rather than to this dial alone; they're documented in [Data sources](data-sources.md), [Themes](themes.md), and the key page's [Data units section](sensor-reading.md#advanced-deck-wide). The fold also carries the same **Config** wells as the key panel (this dial's settings and the deck-wide settings as canonical JSON, with Copy and Apply); they behave exactly as described in the key page's [Advanced section](sensor-reading.md#advanced-deck-wide).

![The deck-wide tail of the dial's Dial gestures & advanced fold at the panel's real width: the Remote control header with the Link ID field reading cpu-dial, then Deck defaults (every key and dial) with Deck theme, Deck text, Type accents and Data units, Connection with Data source and Poll every, Support with the Copy support report button, and Config with the This dial and Deck JSON wells, each with its Copy and Apply buttons.]({{ '/assets/img/pi-live-dial-advanced.png' | relative_url }})
