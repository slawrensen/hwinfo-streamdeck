---
title: Sensor Reading
nav_order: 4
description: Configure key layouts, readings, graphs and press actions.
---

Show one to four HWiNFO readings on a display key. Add a graph to the single-reading layout, set alerts, or make a press open related readings.

**Start:** drag **HWiNFO Sensors → Sensor Reading** onto a key and choose **Reading**. For the complete setup, follow [Get started](getting-started.md).

| Change | Setting or guide |
| --- | --- |
| Number of readings | [Two stacked](#layout-two-readings-on-one-key), [three rows](#layout-three-readings-rows), or [four-cell grid](#layout-four-readings-the-quad-grid) |
| Graph or gauge | [Graph under the value](#display-sparkline-bar-ring) |
| Appearance | [Theme](#theme) and [Text color](#text-color) |
| Press behavior | [Cycle statistics or open details](#pressing-the-key) |

<details markdown="1">
<summary>See the complete Sensor Reading settings panel</summary>

<a class="image-link" data-image-viewer href="{{ '/assets/img/settings-panel.png' | relative_url }}" aria-label="Enlarge image"><img src="{{ '/assets/img/settings-panel.png' | relative_url }}" width="800" height="4310" loading="lazy" decoding="async" alt="Sensor Reading settings: Reading, Display, Alerts, Press and Advanced."></a>

*Settings-panel capture. Open the image to read individual controls.*

</details>

## Settings

The header shows the last rendered key face, reading and data state. A message below it offers a next step when data or the selection needs attention.

**Reading** and **Display** open first. **Alerts**, **Press** and **Advanced** start folded, with a short settings summary. **Open all sections**, **Fold all sections**, or Alt-click on a section title changes every fold. Folds persist between keys while the plugin runs; they do not change saved key settings.

### Reading

Search by reading or sensor name. Each result shows its value when the list loaded; **Reload the sensor list** refreshes it. Arrow keys browse, Enter selects, and Tab, another click in the box or a click elsewhere closes the list. Stream Deck keeps Escape for its own use. Enter with an empty search leaves the selection unchanged.

Shared Memory stores HWiNFO's `sensor-id : instance : reading-id`; Gadget uses its source name and reading label. Selections survive reordering and restarts while that identity remains valid. Renaming a Gadget source or reading changes its identity.

**Sensor missing / pick again** means the saved reading is absent from a readable source. Its settings remain saved and it recovers if that identity returns. When the source itself is unavailable, the panel reports that instead. See [identities and provider links](data-sources.md).

### Label on the key

Custom text for the key. Leave it blank to use the sensor's own (HWiNFO-renamed) label. Labels size themselves to the key: a short name like `CCD1` renders large, a longer one steps down through smaller sizes, and only a name too wide for the smallest size is truncated with an ellipsis. A stat badge (MIN / MAX / AVG) sits in its own gap under the label, so it never costs the label any width.

### Theme

Choose **Default**, **Void**, **Graphite**, **Ultraviolet**, **Midnight**, **Forest**, **Ember** or **Paper** in the theme strip under the header.

- A named theme applies to this key only.
- **Default** follows **Advanced → Shared defaults → Theme**, shared by all HWiNFO keys and dials.
- **Change** opens the shared theme setting. **Make shared** appears when this key's theme differs from it; that command updates the shared theme and returns this key to Default.

The strip names both the current theme and where it comes from. [Compare themes and colors](themes.md).

### Text color

How bright the key's text draws, first in the Display section:

- **Default** *(default)*: follows the shared **Text color** under *Advanced → Shared defaults*; the option names what that currently is.
- **Theme text**: the selected theme's own text colors, bypassing a shared Dimmed or Custom.
- **Dimmed**: a lower-intensity version of the theme's text, for dark rooms and light-sensitive eyes.
- **Custom color**: your exact color. Two extra controls appear: **Custom text color** (the main value uses it exactly as picked; its hex code shows beside it) and **Dim labels, units and stats** (secondary text takes the same hue at lower intensity; untick it to paint every textual element the exact color).

Text color paints the numbers and labels. The accent (sparkline, bar, ring and stat badge) comes from the theme or, with **Accent colors** set to *By sensor type*, from the sensor's type, so turning accents on never recolors a number.

The setting recolors text only: backgrounds, accents, sparklines, bars and rings keep their theme colors, and a warn or critical alert always overrides it. Existing keys keep their current look until you change the setting. Details on [Themes](themes.md#text-theme-dim-or-custom).

### Value shown (stat mode)

What the key displays, drawn from HWiNFO's own statistics since it started:

| Option | Shows |
| --- | --- |
| **Current value** *(default)* | The live reading. |
| **Minimum** | Lowest value HWiNFO has recorded since it started. |
| **Maximum** | Highest value HWiNFO has recorded since it started. |
| **Average** | Running average HWiNFO has computed since it started. |

When a non-current mode is selected, a small **MIN / MAX / AVG** badge appears in a gap between the label and the value, centered on the key, so the label keeps its full width.

> **Note:** Min / max / average come from HWiNFO's Shared Memory interface. On the Gadget-registry fallback these statistics aren't available, so historical modes show N/A with an empty value. See [Data sources](data-sources.md).

### Layout: two readings on one key

Choose **Reading → Readings on this key → Two readings, stacked**, then pick **Reading 2** and an optional **Label 2**. The key stays single until a second reading is selected.

**Row 2 shows** controls the second row's statistic:

- **The same stat as row 1**: a press cycles both rows together. MIN, MAX or AVG appears once in the divider.
- **Always the current value / minimum / maximum / average**: pins row 2 while a press cycles row 1. Each non-current row names its statistic. Matching statistics share a divider badge.

Useful pairs include CPU/GPU temperature, network download/upload, or one sensor's current value above its fixed maximum.

<a class="image-link" data-image-viewer href="{{ '/assets/img/pi-key-dual.png' | relative_url }}" aria-label="Enlarge image"><img src="{{ '/assets/img/pi-key-dual.png' | relative_url }}" width="800" height="1796" loading="lazy" decoding="async" alt="Two stacked readings configured in the Sensor Reading settings, including Reading 2 and Row 2 shows."></a>

<a class="image-link" data-image-viewer href="{{ '/assets/img/multi-readouts.png' | relative_url }}" aria-label="Enlarge image"><img src="{{ '/assets/img/multi-readouts.png' | relative_url }}" width="2820" height="358" loading="lazy" decoding="async" alt="Production-rendered examples of stacked, three-row and four-cell keys, alongside dial overview layouts."></a>

**Shared rules for all multi-reading key layouts:**

- **Warn at / Critical at watch the first reading only**, recoloring the whole key. Put the reading you need alerts on first, or give it its own key.
- **Decimals** and **°F** apply to every reading. The sensor-type accent follows the first.
- **Graph under the value** is available only with One reading. Its setting stays saved when hidden.
- A missing reading shows a placeholder while the others continue. If all picked readings disappear, the key shows **Sensor missing**.
- Changing layouts preserves readings, labels and colors. Switching to One reading restores the single face.

Pinned row statistics are specific to the two-reading layout. Their badges share the label line when space permits and otherwise follow the value.

### Layout: three readings, rows

Choose **Readings on this key → Three readings, rows**, then set **Reading 2** and **Reading 3**. Each row has a left-aligned label and a right-aligned value with its unit. **Label 2** and **Label 3** are optional.

The layout needs the first reading and at least one additional reading; an unpicked row remains empty. Reading 3 is shared with the four-cell layout, so changing layouts keeps that selection.

<a class="image-link" data-image-viewer href="{{ '/assets/img/pi-key-triple.png' | relative_url }}" aria-label="Enlarge image"><img src="{{ '/assets/img/pi-key-triple.png' | relative_url }}" width="800" height="1796" loading="lazy" decoding="async" alt="The three-row layout selected, with Reading 2 and Reading 3 fields."></a>

All rows display the same statistic and a press cycles them together. MIN, MAX or AVG appears once on the first separator. Values share a font size; labels shorten to fit the space beside their own value.

The [multi-reading rules](#layout-two-readings-on-one-key) apply: the first reading controls alerts, there are no per-row stat pins, and this layout has no graph strip.

### Layout: four readings, the quad grid

Choose **Readings on this key → Four readings, quad grid**. The first reading is top left, **Reading 2** top right, and **Reading 3** and **Reading 4** below. It needs the first reading and at least one more; unpicked cells remain empty.

**Cell colors** in Display distinguish the readings:

- **Signal** gives four hues, **Pairs** groups the top and bottom rows, and **Uniform** uses one accent hue.
- The four color wells change individual cells. The preset reads **Custom** when no preset matches.
- **Show a small label in each cell** puts a short label above each value. Labels use the cell color and values use the theme's text color. Unticked, values take the cell colors.

Labels use **Label on the key** and **Label 2 / 3 / 4**, falling back to the first word of each reading's name. Only the first four characters appear. Values compact to at most four characters: decimals drop first, then large numbers shorten, such as `48700` to `49k`.

<a class="image-link" data-image-viewer href="{{ '/assets/img/pi-key-quad.png' | relative_url }}" aria-label="Enlarge image"><img src="{{ '/assets/img/pi-key-quad.png' | relative_url }}" width="800" height="2072" loading="lazy" decoding="async" alt="Four-cell grid settings with Reading 2 to 4, cell color presets and the small-label checkbox."></a>

A press cycles every cell through the same statistic; one MIN, MAX or AVG badge appears at the center. The [multi-reading rules](#layout-two-readings-on-one-key) apply: the first reading controls alerts, there are no per-cell stat pins, and the layout has no graph strip.

Individually chosen cell colors can be hard to read. **Custom color** for text takes priority; [Themes & colors](themes.md#text-theme-dim-or-custom) explains contrast and color precedence.

### Decimals

Controls value precision:

- **Auto** *(default)*: scales precision with magnitude and compacts large numbers through **k, M, G and T** so they never overflow the key (`48700` → `48.7k`, `48700000` → `48.7M`): ≥ 100 shows 0 decimals; ≥ 10 shows 1; below 10 shows 2, at every tier.
- **0 / 1 / 2 / 3**: a fixed number of decimal places.

Byte quantities and transfer rates scale by their real units instead of the generic ladder; see [Data units](#advanced-shared-by-all-keys-and-dials).

### Temperature unit

The **°F** box (under **Temperature** in Display, next to Decimals) converts °C readings to Fahrenheit for display. It only affects readings whose unit is °C; every other unit is left as HWiNFO reports it. Thresholds and the Display strip follow the displayed unit; see the notes below.

### Display: sparkline, bar, ring

The **Graph under the value** select in the Display section picks one strip under the value. It shows only on the one-reading layout:

- **None** *(default)*: just the value.
- **Sparkline (recent history)**: a filled line of the reading's recent values along the bottom of the key, tinted with the key's accent (or its sensor-type accent).
- **Bar (value in its range)**: a horizontal gauge in the sparkline's spot showing where the live value sits in its range.
- **Ring (value in its range)**: the same gauge as a radial arc around the value.

<a class="image-link" data-image-viewer href="{{ '/assets/img/display-text.png' | relative_url }}" aria-label="Enlarge image"><img src="{{ '/assets/img/display-text.png' | relative_url }}" width="1672" height="696" loading="lazy" decoding="async" alt="Graph modes and the Text color setting rendered by the plugin: a sparkline key, a percentage bar, a bar with amber and red threshold zones, a ring, a dial bar sharing the zones, and theme, dim, custom and secondary-dimmed text faces."></a>

<a class="image-link" data-image-viewer href="{{ '/assets/img/pi-key-display.png' | relative_url }}" aria-label="Enlarge image"><img src="{{ '/assets/img/pi-key-display.png' | relative_url }}" width="800" height="270" loading="lazy" decoding="async" alt="The Graph under the value select in the key&#x27;s settings panel, set to Bar (value in its range), with the range sentence it shows only for Bar and Ring."></a>

Bar and Ring find their range automatically:

- **Percentages** (and duty cycles) run 0 to 100.
- **Yes/No readings** run 0 to 1. The key shows the word HWiNFO shows, Yes or No; a threshold compares the 0 or 1 behind it.
- Everything else spans the **values actually seen**. On Shared Memory that is HWiNFO's session min/max plus the plugin's own recent samples. Gadget has no min/max, so there the range follows a moving window of the last 36 samples and starts again after a gap. There are no manual bounds to type.
- **Warn at / Critical at** draw amber and red zones that escalate **toward the alarmed end**: amber then red at the high side normally, mirrored to the low side when the alert is set to fire on a drop, the classic instrument convention (a fuel gauge is red at empty, a tachometer at the top). The range widens to keep the zones visible.

The zones are **fixed landmarks**, drawn as muted shades so they read as markers, not state; the **moving fill is the live value**, and it keeps its full color (accent normally, amber/red while alerting) over them. The gauge follows the **live** value even while the key's text shows MIN, MAX, or AVG, exactly like alert coloring. The dual, triple and quad layouts have no strip, so **Graph under the value** hides there.

Sparkline notes:

- It holds the last **36 samples**. Since 1.7, its history buffer accepts subsecond value changes and advancing producer timestamps. Repeated held frames do not add points. The collection rate depends on HWiNFO and the plugin's poll interval.
- Collection continues for subscribed readings while any Sensor Reading key or Sensor Dial is visible. With none visible, polling stops and samples stay in memory. Returning can append to them; the line is spaced by samples and does not measure that pause.
- A skipped read, missing or non-finite reading, stale data, source transition or native-unit/type change clears the affected segment. A poll-interval change clears all segments; a pairing edit clears only a segment whose saved key now stands for a different measurement. Restarting the plugin also clears history. See [collection rules](data-sources.md#freshness-and-local-history).
- It **survives a °C/°F toggle** unchanged (same data, just relabelled), and a frozen HWiNFO holds the line's last real shape instead of flattening it.
- The sparkline self-scales to its own visible min/max, so the shape reflects recent variation, not absolute magnitude.

> **Note:** Changing the poll interval (*Advanced → Connection → Read every*) resets sparkline history, because the history buffer is spaced by sample index and does not preserve elapsed time across a cadence change. Keys configured before 1.2.x keep their old Sparkline checkbox behavior until you touch the **Graph under the value** select.

### Warn at / Critical at

Use the displayed temperature unit; byte and rate thresholds use the native value before [Data units](#advanced-shared-by-all-keys-and-dials) re-tiers it. When the live value crosses **Warn at**, the whole key flips to an amber field with black text; at **Critical at**, a red field with white text (aviation-style master caution/warning). These two alert palettes are global and never tinted per theme, so warn and critical look the same on every theme. Leave a field blank to disable it. Decimal commas are accepted (`70,5` works as `70.5`); text that is not a number is kept as typed and flagged under the field (*Not a number. Alerts ignore this field until it is one.*), and alerts ignore it. The folded Alerts section reads back what is in force, with the comparison the key really uses, for example *Warn ≥ 80 °C · critical ≥ 90 °C*; on a key that draws two or more readings it ends in *first reading*.

See [Thresholds & alerts](thresholds-alerts.md) for the full behavior.

> **Note:** Warn/critical always track the **live** value, even when the key is showing MIN, MAX, or AVG. The stat mode changes what number you see; it never changes what triggers the alert.

### Direction

**Alert when the value drops to or below these numbers (for fans and clocks)** flips the comparison so *lower is worse*. Use it for readings where a low number is the problem: fan RPM, free disk space, remaining battery. With it off (default), higher is worse (temperatures, power, load).

## Pressing the key

By default, pressing the key cycles the displayed stat: **current → MIN → MAX → AVG → current**. The badge under the label updates to match, and the choice is saved back to the key's settings (so it's the same as changing **Value shown** in the panel). Warn/critical coloring keeps tracking the live value throughout.

On a dual key with **Row 2 shows** at its default (the same stat as row 1), the press cycles **both rows together**, one shared badge centered on the divider. A second row pinned to a fixed stat stays put while the first row cycles, so a configured pair (say a pinned maximum under a live value) survives any press.

On a quad key every cell shows the same stat, so the press cycles **all four together**, with the one badge at the cross center updating.

### A press can open details (drill-down)

The **Press** section's **A press** select can repurpose the press instead. Its default, **Cycles current, min, max, avg**, is the cycle above. **Opens sensor details** switches the deck to a bundled detail view listing every reading from this reading's sensor, a custom list, or everything matching a glob filter (`*4090*` style, with a live match count in the panel). **Tap cycles; hold opens details** keeps the stat cycle on a short tap and opens the view after holding half a second. Keys that never touch the Press section behave exactly as before. The whole feature has [its own page](sensor-details.md): what the view shows, the one-time install prompt per deck type, and which decks are supported.

The detail view's own Back tile is this same Sensor Reading action with one difference: its press is fixed to returning to the previous profile. Its panel says so in a note under the header, and its Press section holds that note in place of the press choices. Everything else here (the reading, layouts, theme, Text color, thresholds, Graph under the value) applies to it unchanged; see [configuring the Back tile](sensor-details.md#configuring-the-back-tile).

## Status screens

A two-line message replaces the value when a reading cannot be shown. **Start HWiNFO / not detected**, **Shared Memory / is off**, **Not updating / check sharing** and **Age unknown / check Gadget** describe different source states. **Sensor missing / pick again** concerns the saved selection.

Use the [complete status table](status-screens.md#key-screens) or [Troubleshooting](troubleshooting.md) for the exact message. The settings header offers **Check again**, **HWiNFO setup steps**, **Reload sensor list** or **Pick another reading** as appropriate. A source outage preserves the saved selection and settings.

**Access denied** and **Source error** need the evidence in **Advanced → Support → Copy support report**. **Bridge failed / reinstall** can require an installation repair and plugin restart; the message alone does not identify the cause.

## Advanced (shared by all keys and dials)

**Advanced** contains four groups:

- **Shared defaults:** Theme, Text color, Text font, Accent colors and Data units.
- **Connection:** Data source, Read every, source links and HWiNFO setup steps.
- **Support:** Copy support report.
- **Configuration documents:** copy or replace this key's settings and the shared settings.

Shared defaults and Connection are marked **All keys and dials**. They affect the whole plugin. See [Themes](themes.md) and [Data sources](data-sources.md).

<a class="image-link" data-image-viewer href="{{ '/assets/img/pi-live-key-advanced.png' | relative_url }}" aria-label="Enlarge image"><img src="{{ '/assets/img/pi-live-key-advanced.png' | relative_url }}" width="800" height="2436" loading="lazy" decoding="async" alt="The Advanced section at the panel&#x27;s real width with its four groups open: Shared defaults (marked All keys and dials) with Theme, Text color, Text font, Accent colors and Data units; Connection (marked All keys and dials) with Data source, Read every, the reading-links note and the folded HWiNFO setup steps; Support with the Copy support report button; and Configuration documents with the This key&#x27;s settings well and the Shared settings well (marked All keys and dials), each with Copy and Replace, over the help line that explains them."></a>

**Configuration documents** holds two JSON wells: **This key's settings**, the exact settings this key runs on, and **Shared settings**, the plugin-wide settings. **Copy** fills an untouched well with the settings of the moment you press it and puts the document on the clipboard; save it to a file to back a hand-built layout up. Paste a saved document and press **Replace this key's settings** to restore it, or to clone it onto another key here or on another machine. Replacing swaps the whole document in one write and reloads the panel; fields this build does not know survive untouched. **Replace shared settings** changes every HWiNFO key and dial, so its first press only arms it (the button then reads *Press again to replace for all keys and dials*) and a second press replaces; a quick double click only arms it, and leaving the button or editing the document disarms it. Reading keys in the document carry the sensor's friendly name after the key so the file stays readable; replacing strips the names, and settings always store bare keys. The wells live on the Sensor Reading and Sensor Dial panels only; the HWiNFO Control key holds just a command, a target and a reset scope, so it has no wells; re-enter those by hand.

**Data units** decides how byte quantities and transfer rates read, everywhere at once:

- **Decimal** *(default)*: bytes in **B / KB / MB / GB / TB** (steps of 1000) and rates as **bits: bps / kbps / Mbps / Gbps / Tbps** (byte rates multiply by 8), so `12000000 B/s` reads **96.0 Mbps**.
- **Binary**: bytes in **B / KiB / MiB / GiB / TiB** (steps of 1024) and rates as **bytes: B/s through TiB/s** (bit rates divide by 8), so the same reading reads **11.4 MiB/s**.

The value is converted whenever the label changes; a `12345.6 MB` reading shows as `12.3 GB` in Decimal and `11.5 GiB` in Binary, never as a relabeled raw number. This is display only: **Warn at**, **Critical at**, and the dial's bar range keep working against the number HWiNFO reports (the displayed unit before this re-tiering), exactly as before.
