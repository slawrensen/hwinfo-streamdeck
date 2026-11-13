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

<a class="image-link" data-image-viewer href="{{ '/assets/img/settings-panel.png' | relative_url }}" aria-label="Enlarge image"><img src="{{ '/assets/img/settings-panel.png' | relative_url }}" width="800" height="4800" loading="lazy" decoding="async" alt="Sensor Reading settings: Theme, Reading, Display, Alerts, Press and Advanced."></a>

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

- **Default** *(default)*: follows the shared **Text color** under *Advanced → Shared defaults*; the option names what that currently is, for example *Theme text (shared)*.
- **Theme text**: the selected theme's own text colors, bypassing a shared Dimmed or Custom.
- **Dimmed**: a lower-intensity version of the theme's text, for dark rooms and light-sensitive eyes.
- **Custom color**: your exact color. Two extra controls appear: **Custom text color** (the main value uses it exactly as picked; its hex code shows beside it) and **Dim labels, units and stats** (secondary text takes the same hue at lower intensity; untick it to paint every textual element the exact color).

Text color paints the numbers and labels. The accent (sparkline, bar, ring and stat badge) comes from the theme or, with **Accent colors** set to *By sensor type*, from the sensor's type, so turning accents on never recolors a number.

The setting recolors text only: backgrounds, accents, sparklines, bars and rings keep their theme colors, and a warn or critical alert always overrides it. Existing keys keep their current look until you change the setting. Details on [Themes](themes.md#text-theme-dim-or-custom).

### Background

> **New in 1.8.** Glass, Tint, Outline and Clear on a key are checked in renderer tests only; I have not yet run a see-through key on a physical deck. Stars, Dusk and Nebula ran on my Stream Deck + XL ([Deck backgrounds](themes.md#deck-backgrounds-stars-dusk-and-nebula)).

The Stream Deck app can show one picture behind all the keys of a page: right-click a key in the app and choose **Set from File...** (Elgato added page backgrounds in Stream Deck 6.6; the plugin needs 6.9 or later, so every app version it runs on has them). A Sensor Reading key fills its whole face with the theme's background, which hides that picture. **Background** (Display, under Text color) chooses what the key draws instead, with the same looks as a dial's [Transparent background](sensor-dial.md#transparent-background):

| Background | What the key draws | Text over the picture |
| --- | --- | --- |
| **Theme** (default) | The theme's background, exactly as before. | The picture does not show. |
| **Glass** | The theme's background as a panel at 80% opacity. | Built-in text keeps 4.5:1 contrast over any picture (a calculation). |
| **Tint** | The theme's background at 50% opacity, with a 1 px outline on every word and mark. | Built-in text keeps 4.5:1 contrast against its outline (a calculation). |
| **Outline** | No background. Every word, graph and mark gets a 1 px outline: black on the dark themes, the theme's background on **Paper**. | Built-in text keeps 4.5:1 contrast against its outline (a calculation). |
| **Clear** | No background and no outline; labels, units and badges take the value color, and a four-reading key keeps its cell colors. | Depends on the picture. |
| **Stars**, **Dusk**, **Nebula** | A picture the plugin draws across the whole deck, in place of the page picture ([Deck backgrounds](themes.md#deck-backgrounds-stars-dusk-and-nebula)). | Built-in text keeps 4.5:1 contrast against the brightest color the picture can draw (a calculation). |

**Default** (new keys start on it, and it names the look it follows, for example *Theme (shared)*) follows **Advanced → Shared defaults → Background**, which is Theme until you change it; picking a look here keeps that look on this key whatever the shared one is ([Per-key vs. shared](themes.md#per-key-vs-shared)).

It works on every layout (one, two, three and four readings, with or without a sparkline, bar or ring) and on the Back tile. The detail view's tiles follow the look of the key that opened it, as they follow its theme. Without the theme's background, the key draws a few things differently:

- A **warn or critical alert** still fills the whole key with the alert color: on a key the filled face is the alert, so it never turns see-through.
- Status screens such as **Start HWiNFO** and **Sensor missing** keep their black face.
- A stat badge sits in a gap the divider, cross or ring leaves open, and on the Back tile the divider starts after the return arrow and a sparkline or bar starts to its right.
- On the three-reading layout, a label that would run into its value is cut to its measured width, so a label with emoji or symbols the face font does not have is shortened a little sooner.
- **Words in the accent color** (beside its label under Background, on Glass, Tint and Outline: **Default** follows the shared **Words in the accent color**, off until you change it, so it reads *Off (shared)*; **On** or **Off** keeps that choice on this key) draws labels in the accent color, like the stat badges, and moves units halfway to it. Values, quad cell colors, alert colors and a **Custom color** for text do not change.
- A **Custom color** for text and chosen quad cell colors stay exactly as chosen and can fall below the floor over a bright picture.
- The settings panel header cannot show your picture, so it previews a see-through key over a checkerboard.

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

Useful pairs include CPU/GPU temperature, network download/upload, or one sensor's current value above its fixed maximum. For framerates, use HWiNFO's own low readings instead of a minimum and maximum pair; see [Framerate readings](#framerate-readings).

<a class="image-link" data-image-viewer href="{{ '/assets/img/pi-key-dual.png' | relative_url }}" aria-label="Enlarge image"><img src="{{ '/assets/img/pi-key-dual.png' | relative_url }}" width="800" height="1928" loading="lazy" decoding="async" alt="The Sensor Reading key&#x27;s settings panel with Readings on this key on Two readings, stacked: the header with the two-row face, CPU (Tctl/Tdie) over GPU Temperature, and Live · Shared Memory; the theme strip on Default (shared: Void); Reading with Reading 2 on GPU Temperature, an empty Label 2 and Row 2 shows on The same stat as row 1; Display with Text color, Background, Value shown, Decimals, the °F box and the folded Unit and decimals per reading; Alerts folded on the first reading&#x27;s limits; Press with A press on Cycles current, min, max, avg; and Advanced folded."></a>

<a class="image-link" data-image-viewer href="{{ '/assets/img/multi-readouts.png' | relative_url }}" aria-label="Enlarge image"><img src="{{ '/assets/img/multi-readouts.png' | relative_url }}" width="2820" height="358" loading="lazy" decoding="async" alt="Production-rendered examples of stacked, three-row and four-cell keys, alongside dial overview layouts."></a>

**Shared rules for all multi-reading key layouts:**

- **Warn at / Critical at** are the first reading's limits, and an alert recolors the whole key. Since 1.8 every other reading gets [limits of its own](thresholds-alerts.md#limits-for-each-reading-on-a-key) in a row under them.
- **Decimals** and **°F** apply to every reading, except that a reading set under [Unit and decimals per reading](#unit-and-decimals-per-reading) keeps its own unit and decimals. The sensor-type accent follows the first.
- **Graph under the value** is available only with One reading. Its setting stays saved when hidden.
- A missing reading shows a placeholder while the others continue. If all picked readings disappear, the key shows **Sensor missing**.
- Changing layouts preserves readings, labels and colors. Switching to One reading restores the single face.

Pinned row statistics are specific to the two-reading layout. Their badges share the label line when space permits and otherwise follow the value.

### Layout: three readings, rows

Choose **Readings on this key → Three readings, rows**, then set **Reading 2** and **Reading 3**. Each row has a left-aligned label and a right-aligned value with its unit. **Label 2** and **Label 3** are optional.

The layout needs the first reading and at least one additional reading; an unpicked row remains empty. Reading 3 is shared with the four-cell layout, so changing layouts keeps that selection.

<a class="image-link" data-image-viewer href="{{ '/assets/img/pi-key-triple.png' | relative_url }}" aria-label="Enlarge image"><img src="{{ '/assets/img/pi-key-triple.png' | relative_url }}" width="800" height="1928" loading="lazy" decoding="async" alt="The Sensor Reading key&#x27;s settings panel with Readings on this key on Three readings, rows: the header with the three-row face and Live · Shared Memory; the theme strip on Default (shared: Void); Reading with Reading 2 on GPU Temperature and Reading 3 on GPU Clock, empty Label 2 and Label 3 fields, and the line &quot;A long name shortens so its number stays whole. Every row shows the same stat.&quot;; Display with Text color, Background, Value shown, Decimals, the °F box and the folded Unit and decimals per reading; Alerts folded on the first reading&#x27;s limits; Press; and Advanced folded."></a>

All rows display the same statistic and a press cycles them together. MIN, MAX or AVG appears once on the first separator. Values share a font size; labels shorten to fit the space beside their own value.

The [multi-reading rules](#layout-two-readings-on-one-key) apply: the first reading's limits are **Warn at / Critical at**, the other rows get [limits of their own](thresholds-alerts.md#limits-for-each-reading-on-a-key), there are no per-row stat pins, and this layout has no graph strip.

### Layout: four readings, the quad grid

Choose **Readings on this key → Four readings, quad grid**. The first reading is top left, **Reading 2** top right, and **Reading 3** and **Reading 4** below. It needs the first reading and at least one more; unpicked cells remain empty.

**Cell colors** in Display distinguish the readings:

- **Signal** gives four hues, **Pairs** groups the top and bottom rows, and **Uniform** uses one accent hue.
- The four color wells change individual cells. The preset reads **Custom** when no preset matches.
- **Show a small label in each cell** puts a short label above each value. Labels use the cell color and values use the theme's text color. Unticked, values take the cell colors.

Labels use **Label on the key** and **Label 2 / 3 / 4**, falling back to the first word of each reading's name. Only the first four characters appear. Values compact to at most four characters: decimals drop first, then large numbers shorten, such as `48700` to `49k`. A reading set under [Unit and decimals per reading](#unit-and-decimals-per-reading) keeps its exact text instead: those cells draw at one shared size, smaller than the other cells when the text needs it, down to 18 px. A cell whose text needs less than 18 px drops its decimals and draws the whole number at its own size, down to 16 px, leaving the other cells at theirs; a number too wide even then shortens to four characters over its unit, such as `1.2M` GB.

<a class="image-link" data-image-viewer href="{{ '/assets/img/pi-key-quad.png' | relative_url }}" aria-label="Enlarge image"><img src="{{ '/assets/img/pi-key-quad.png' | relative_url }}" width="800" height="2204" loading="lazy" decoding="async" alt="The Sensor Reading key&#x27;s settings panel with Readings on this key on Four readings, quad grid: the header with the four-cell face; the theme strip on Default (shared: Void); Reading with Reading 2 on GPU Temperature, Reading 3 on GPU Clock and Reading 4 on PUMP SYS1, each label field showing &quot;4 chars max&quot;, and the line saying cells fill in reading order; Display with Text color, Background, Value shown, Decimals, the °F box, the folded Unit and decimals per reading, Cell colors on Signal (four hues) with four color wells, and the unticked Show a small label in each cell box; then Alerts, Press and Advanced."></a>

A press cycles every cell through the same statistic; one MIN, MAX or AVG badge appears at the center. The [multi-reading rules](#layout-two-readings-on-one-key) apply: the first reading's limits are **Warn at / Critical at**, the other cells get [limits of their own](thresholds-alerts.md#limits-for-each-reading-on-a-key), there are no per-cell stat pins, and the layout has no graph strip.

Individually chosen cell colors can be hard to read. **Custom color** for text takes priority; [Themes & colors](themes.md#text-theme-dim-or-custom) explains contrast and color precedence. An alert always recolors the whole field, never one cell.

### Decimals

Controls value precision:

- **Auto** *(default)*: scales precision with magnitude and compacts large numbers through **k, M, G and T** so they never overflow the key (`48700` → `48.7k`, `48700000` → `48.7M`): ≥ 100 shows 0 decimals; ≥ 10 shows 1; below 10 shows 2, at every tier.
- **0 / 1 / 2 / 3**: a fixed number of decimal places.

Byte quantities and transfer rates scale by their real units instead of the generic ladder; see [Data units](#advanced-shared-by-all-keys-and-dials).

### Unit and decimals per reading

> **New in 1.8.**

**Unit and decimals per reading** is a folded group right under **Decimals** in Display, with one row for each reading the key shows (each slot of the chosen layout; a slot that repeats an earlier slot's reading says so and has no choices of its own). A row names its slot and its reading; when two readings share a name (two GPUs' **GPU Memory Available**), each also carries the short tag of its sensor, such as `#0` and `#1`. Each row has two choices:

- **Unit**: **Auto** *(default)* picks the unit from the size of the value, as before. A unit picked here stays at any value and never switches to another one. A reading HWiNFO labels KB, MB, GB or TB offers **B**, then **KB, MB, GB** and **TB** (*Steps of 1000*) and **KiB, MiB, GiB** and **TiB** (*Steps of 1024*); a reading labelled KiB, MiB, GiB or TiB offers **B, KiB, MiB, GiB** and **TiB**. Transfer rates, temperatures, percentages and every other unit stay on **Auto**, and the choice is disabled for them.
- **Decimals**: **Same as key** *(default)* uses the key's **Decimals**; **Auto** or **0** to **3** set the reading's own, for any reading.

MIN, MAX and AVG use the reading's unit and decimals too. A source with no statistics (Gadget, a calculated reading) still shows the no-value placeholder and **N/A** for them.

Three HWiNFO memory readings read:

| HWiNFO reports | Auto (unit and decimals) | GB, 2 decimals | GiB, 2 decimals |
| --- | --- | --- | --- |
| 453 MB | 453 MB | 0.45 GB | 0.44 GiB |
| 3020 MB | 3.02 GB | 3.02 GB | 2.95 GiB |
| 12100 MB | 12.1 GB | 12.10 GB | 11.82 GiB |

The two families count differently. **KB** to **TB** rescale HWiNFO's number by 1000 per step, the way Decimal [Data units](#advanced-shared-by-all-keys-and-dials) does: 12100 MB reads 12.10 GB, HWiNFO's figure in thousands, not a drive maker's gigabytes. **KiB** to **TiB** read HWiNFO's KB, MB, GB and TB as the 1024-based units they are (HWiNFO's author wrote on the HWiNFO forum in January 2021 that its MB and GB are multiples of 1024, disk capacity aside; on my RTX 5080, HWiNFO's 16,303 MB is the 16,303 MiB `nvidia-smi` reports), the way Binary Data units does: 12100 MB reads 11.82 GiB, the unit `nvidia-smi` counts in. Pick GB to match HWiNFO's own numbers, GiB to match `nvidia-smi`. Rounding works as everywhere else on the face.

On a two-reading key where both readings have their own format, both values draw at one size, the smaller of the two, so two GPUs in GB compare at a glance, and when one value needs a smaller size both take it; a reading that follows the key's **Decimals**, or that drops its decimals to fit, keeps its own size.

When a number is too long for its place in the layout at the chosen unit (a fixed **B** on a reading of several GB, for example), the face drops its decimals, and if the number is still too long, shortens it (`22.0T` B), keeping the unit and never cutting digits. The row in the settings panel then says what the key shows and what fits, for example *Shows 22031 GB on this key. TB fits with 2 decimals.* On the three-row layout, more decimals leave less room for the row labels; short labels (**Label on the key**, **Label 2**, **Label 3**) keep the rows apart.

The format follows the reading, not the slot: moving a reading to another slot keeps its format, and picking another reading for a slot does not carry the old one's over. A [reading link](data-sources.md#link-readings-across-providers) keeps it across Shared Memory and Gadget; without one, a reading that changes provider shows **Sensor missing** and gets its format back when it returns. Detail pages and the Back tile show the formats of the readings the key itself shows; other readings there use the key's **Decimals**.

The format changes only what the face shows. **Warn at**, **Critical at**, the Bar and Ring ranges and the graph keep using HWiNFO's own number and unit, so changing a unit never re-arms or silences an alert; type limits in HWiNFO's unit even when the key shows another. A [Strip Display](strip-display.md#unit-and-decimals-per-reading) keeps its own unit and decimals per reading, set from a dial of the strip. A version from before 1.8 ignores these choices and shows Auto with the key's **Decimals**; the choices stay saved and apply again after an update.

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

Sparkline notes, for the default **Recent samples** [Time window](#time-window):

- It holds the last **36 samples**. Since 1.7, its history buffer accepts subsecond value changes and advancing producer timestamps. Repeated held frames do not add points. The collection rate depends on HWiNFO and the plugin's poll interval.
- Collection continues for subscribed readings while any Sensor Reading key or Sensor Dial is visible. With none visible, polling stops and samples stay in memory. Returning can append to them; the line is spaced by samples and does not measure that pause.
- A skipped read, missing or non-finite reading, stale data, source transition or native-unit/type change clears the affected segment. A poll-interval change clears all segments; a pairing edit clears only a segment whose saved key now stands for a different measurement. Restarting the plugin also clears history. See [collection rules](data-sources.md#freshness-and-local-history).
- It **survives a °C/°F toggle** unchanged (same data, just relabelled), and a frozen HWiNFO holds the line's last real shape instead of flattening it.
- The sparkline self-scales to its own visible min/max, so the shape reflects recent variation, not absolute magnitude.

> **Note:** Changing the poll interval (*Advanced → Connection → Read every*) resets sparkline history, because the history buffer is spaced by sample index and does not preserve elapsed time across a cadence change. Keys configured before 1.2.x keep their old Sparkline checkbox behavior until you touch the **Graph under the value** select.

<a id="trend-window"></a>
### Time window

> **New in 1.8.**

With **Graph under the value** on **Sparkline**, a **Time window** select appears under it:

- **Recent samples** *(default)*: the last 36 readings, spaced evenly, as described above.
- **1 minute**, **5 minutes** or **15 minutes**: the strip becomes a time axis over that span, with now at the right edge.

| Time window | The strip spans | Readings are kept in steps of | One pixel column of the key's strip covers |
| --- | --- | --- | --- |
| **1 minute** | the last 60 seconds | 1 second | about half a second |
| **5 minutes** | the last 5 minutes | 2 seconds (HWiNFO's default polling period) | about 2.3 seconds |
| **15 minutes** | the last 15 minutes | 6 seconds | about 7 seconds |

Each step keeps the first, lowest, highest and last reading in it, and the strip draws every pixel column from its lowest to its highest reading, so a spike that lasted one reading still reaches its full height in a 15-minute window. The strip scales to the lowest and highest readings in the window, and a °C/°F toggle keeps its shape.

Each reading sits at the time the plugin read it, usually within one **Read every** interval of HWiNFO writing it. The window moves only when a new reading arrives. The line ends at the last reading, with no line drawn from there to now, and the dot at its end marks the newest reading until the line breaks.

The window starts empty when you choose it and fills from the right. A short history stays on the right and is never stretched across the strip: 20 seconds of readings fill the right fifteenth of a 5-minute window.

The line breaks wherever no new reading came in, and each run of the line ends at its last reading. A gap is drawn as a gap, never as zero:

- **HWiNFO closed**: the line stops at the last reading. The key keeps showing that reading, end dot included, until about 15 seconds after it arrived, and then shows **Start HWiNFO** until HWiNFO is back. The line starts again after a gap as long as HWiNFO was closed.
- **Stale data**: after 15 seconds without a new reading the key shows **Not updating** (Shared Memory) or **Age unknown** (Gadget). The run ends at the last reading that arrived, 15 seconds before that screen appeared.
- **Sleep**: the PC sleeping, or no key or dial visible for longer than three **Read every** intervals (at least 5 seconds), because polling stops then.
- **Unit changes**: when HWiNFO starts reporting the reading in another unit or as another reading type, the readings in the old unit are left out of the window rather than converted, and the line starts again from the right. The key's own **°F** box only changes the display and keeps the line.
- A missing reading, a source switch, or a pairing edit that points the saved reading at another measurement.
- A skipped read, unless the next reading arrives within 2.5 times HWiNFO's scan interval or **Read every**, if longer (at least 5 seconds). Then the line goes straight across it, and no value is added.

A time window keeps its history across a **Read every** change. That history lives in the plugin's memory: it is collected while any key or dial is visible, kept for 16 minutes after the last key or dial showing it leaves the screen, and cleared when the plugin restarts. All windows together are capped at 2 MiB of memory; if a new window would pass that, the key draws Recent samples until room frees up, and the plugin log says so once.

> **Note:** On the Gadget source, a block of readings that HWiNFO stops updating while other readings still change draws as flat lines instead of gaps. See [Freshness and local history](data-sources.md#freshness-and-local-history).

### Warn at / Critical at

Type the numbers in the unit the key shows; the panel saves that unit with them, so a later **°F** switch converts them. Byte and rate thresholds use the native value before [Data units](#advanced-shared-by-all-keys-and-dials) re-tiers it. When the live value crosses **Warn at**, the whole key flips to an amber field with black text; at **Critical at**, a red field with white text (aviation-style master caution/warning). These two alert palettes are global and never tinted per theme, so warn and critical look the same on every theme. Leave a field blank to disable it. Decimal commas are accepted (`70,5` works as `70.5`); text that is not a number is kept as typed and flagged under the field (*Not a number. Alerts ignore this field until it is one.*), and alerts ignore it. The folded Alerts section reads back what is in force, with the comparison the key really uses, for example *Warn ≥ 80 °C · critical ≥ 90 °C*; on a key that draws two or more readings it ends in *first reading*. On those keys every other reading gets a row with limits of its own, and a folded **Timing** block holds **Alert after**, **Clear by** and **Snooze lasts** (for a press while alerting); see [limits for each reading](thresholds-alerts.md#limits-for-each-reading-on-a-key) and [timing](thresholds-alerts.md#timing-on-a-key).

See [Thresholds & alerts](thresholds-alerts.md) for the full behavior.

> **Note:** Warn/critical always track the **live** value, even when the key is showing MIN, MAX, or AVG. The stat mode changes what number you see; it never changes what triggers the alert.

### Direction

**Alert when the value drops to or below these numbers (for fans and clocks)** flips the comparison so *lower is worse*. Use it for readings where a low number is the problem: fan RPM, free disk space, remaining battery. With it off (default), higher is worse (temperatures, power, load).

## Framerate readings

HWiNFO publishes framerates through its PresentMon sensor, named after the process it follows (for example `PresentMon [game.exe]`). They are ordinary readings: pick them like any other, on a key, a dial, a detail page or a strip graph. The plugin does not capture frames or hook into games; it shows what HWiNFO publishes. Which games and graphics APIs report a framerate is up to HWiNFO and PresentMon.

What I checked, on HWiNFO 8.48 over Shared Memory: the PresentMon sensor published 23 readings, among them **Framerate Presented** and **Framerate Displayed** as an average, as percentiles and as HWiNFO's own **(1% low)** and **(0.1% low)**, plus frame times in ms, and the plugin showed them live. What I have not checked yet: starting and quitting a real game, and RTSS. Until I have, I cannot say what a framerate key shows while a game starts or after it exits.

- **For lows, pick HWiNFO's (1% low) or (0.1% low) reading.** HWiNFO works these out from frame times. The plugin does not compute lows, and **Value shown** set to **Minimum** is not a 1% low.
- **Minimum and Maximum do not mean much on a framerate.** HWiNFO's statistics cover every process it followed since it started or was last reset, desktop apps included: on my PC one framerate reading had a maximum above 55,000 FPS and a minimum below 0.1 FPS. A dial's session MIN and MAX collect the same values while no game runs.
- **With no game running**, the PresentMon readings followed a desktop app on my PC, so a framerate key can show an app's framerate rather than nothing.
- **Use Shared Memory for framerate keys.** A Shared Memory selection is saved by HWiNFO's sensor and reading ids, and those stayed the same when HWiNFO moved to another process. The Gadget source saves a selection by sensor name and label, and the PresentMon sensor's name carries the process name, so a Gadget framerate key shows **Sensor missing** once HWiNFO follows another process.
- **The sensor name can lag.** The plugin reads sensor names again only when HWiNFO's sensor list changes shape, so the reading list and a detail page's title can name an earlier process for a while. The key's reading is not affected.

## Pressing the key

By default, pressing the key cycles the displayed stat: **current → MIN → MAX → AVG → current**. The badge under the label updates to match, and the choice is saved back to the key's settings (so it's the same as changing **Value shown** in the panel). Warn/critical coloring keeps tracking the live value throughout.

On a dual key with **Row 2 shows** at its default (the same stat as row 1), the press cycles **both rows together**, one shared badge centered on the divider. A second row pinned to a fixed stat stays put while the first row cycles, so a configured pair (say a pinned maximum under a live value) survives any press.

On a quad key every cell shows the same stat, so the press cycles **all four together**, with the one badge at the cross center updating.

### A press can open details (drill-down)

The **Press** section's **A press** select can repurpose the press instead. Its default, **Cycles current, min, max, avg**, is the cycle above. **Opens sensor details** switches the deck to a bundled detail view listing every reading from this reading's sensor, a custom list, or everything matching a glob filter (`*4090*` style, with a live match count in the panel). **Tap cycles; hold opens details** keeps the stat cycle on a short tap and opens the view after holding half a second. Keys that never touch the Press section behave exactly as before. The whole feature has [its own page](sensor-details.md): what the view shows, the one-time install prompt per deck type, and which decks are supported.

If the key snoozes alerts (see [Timing](thresholds-alerts.md#timing-on-a-key)), a press while the key shows an alert snoozes instead of doing its usual action; on **Tap cycles; hold opens details**, the hold still opens details.

The detail view's own Back tile is this same Sensor Reading action with one difference: its press is fixed to returning to the previous profile. Its panel says so in a note under the header, and its Press section holds that note in place of the press choices. Everything else here (the reading, layouts, theme, Text color, thresholds, Graph under the value) applies to it unchanged; see [configuring the Back tile](sensor-details.md#configuring-the-back-tile).

## Status screens

A two-line message replaces the value when a reading cannot be shown. **Start HWiNFO / not detected**, **Shared Memory / is off**, **Not updating / check sharing** and **Age unknown / check Gadget** describe different source states. **Sensor missing / pick again** concerns the saved selection.

Use the [complete status table](status-screens.md#key-screens) or [Troubleshooting](troubleshooting.md) for the exact message. The settings header offers **Check again**, **HWiNFO setup steps**, **Reload sensor list** or **Pick another reading** as appropriate. A source outage preserves the saved selection and settings.

**Access denied** and **Source error** need the evidence in **Advanced → Support → Copy support report**. **Bridge failed / reinstall** can require an installation repair and plugin restart; the message alone does not identify the cause.

## Advanced (shared by all keys and dials)

**Advanced** contains these groups:

- **Shared defaults:** Theme, Text color, Background, Words in the accent color (shown on Glass, Tint and Outline), Stars and Sky color (shown on Stars, Dusk and Nebula, and while this key or dial draws one of them), Text font, Accent colors and Data units. When keys, dials or strips on screen keep a Background or Words of their own, a line under these counts them, with **Use it everywhere** to set them back to **Default** (see [Per-key vs. shared](themes.md#per-key-vs-shared)).
- **Connection:** Data source, Read every, source links and HWiNFO setup steps.
- **Reading links** and **Calculated readings** (new in 1.8): see [Link readings](data-sources.md#link-readings-across-providers) and [Calculated readings](data-sources.md#calculated-readings).
- **Support:** Copy support report.
- **Configuration documents:** copy or replace this key's settings and the shared settings.

Shared defaults and Connection are marked **All keys and dials**. They affect the whole plugin. See [Themes](themes.md) and [Data sources](data-sources.md).

<a class="image-link" data-image-viewer href="{{ '/assets/img/pi-live-key-advanced.png' | relative_url }}" aria-label="Enlarge image"><img src="{{ '/assets/img/pi-live-key-advanced.png' | relative_url }}" width="800" height="3456" loading="lazy" decoding="async" alt="The Advanced section at the panel&#x27;s real width with its six groups open: Shared defaults (marked All keys and dials) with Theme, Text color, Background, Text font, Accent colors and Data units; Connection (marked All keys and dials) with Data source, Read every, the reading-links note and the folded HWiNFO setup steps; Reading links (marked All keys and dials) with this key&#x27;s reading live on Shared Memory, Look on Gadget, the other source&#x27;s filter and Link; Calculated readings (marked All keys and dials) with New calculated reading; Support with the Copy support report button; and Configuration documents with the This key&#x27;s settings well and the Shared settings well (marked All keys and dials), each with Copy and Replace, over the help line that explains them."></a>

**Configuration documents** holds two JSON wells: **This key's settings**, the exact settings this key runs on, and **Shared settings**, the plugin-wide settings. **Copy** fills an untouched well with the settings of the moment you press it and puts the document on the clipboard; save it to a file to back a hand-built layout up. Paste a saved document and press **Replace this key's settings** to restore it, or to clone it onto another key here or on another machine. Replacing swaps the whole document in one write and reloads the panel; fields this build does not know survive untouched. **Replace shared settings** changes every HWiNFO key and dial, so its first press only arms it (the button then reads *Press again to replace for all keys and dials*) and a second press replaces; a quick double click only arms it, and leaving the button or editing the document disarms it. Reading keys in the document carry the sensor's friendly name after the key so the file stays readable; replacing strips the names, and settings always store bare keys. The wells live on the Sensor Reading and Sensor Dial panels only; the HWiNFO Control key holds just a command, a Link ID and a reset scope, so it has no wells; re-enter those by hand.

**Data units** decides how byte quantities and transfer rates read, everywhere at once:

- **Decimal** *(default)*: bytes in **B / KB / MB / GB / TB**, HWiNFO's number rescaled by 1000 per step, and rates as **bits: bps / kbps / Mbps / Gbps / Tbps** (byte rates multiply by 8), so `12000000 B/s` reads **96.0 Mbps**.
- **Binary**: bytes in **B / KiB / MiB / GiB / TiB** (steps of 1024), reading HWiNFO's KB, MB, GB and TB as the 1024-based units they are, and rates as **bytes: B/s through TiB/s** (bit rates divide by 8), so the same rate reads **11.4 MiB/s**.

The value is converted whenever the label changes, never shown as a relabeled raw number: a `12345.6 MB` reading shows as `12.3 GB` in Decimal and `12.1 GiB` in Binary (`12.06 GiB` with 2 decimals). Before 1.8, Binary read HWiNFO's MB as millions of bytes and showed that reading as `11.5 GiB`, about 5% low. Transfer rates (KB/s, MB/s and the bit rates) keep the basis they had: their label is read as written in both modes, because whether HWiNFO's rates count in 1000s or 1024s has not been checked. Data units sets the Auto unit only: a reading with its own unit under [Unit and decimals per reading](#unit-and-decimals-per-reading) keeps that unit. This is display only: **Warn at**, **Critical at**, and the dial's bar range keep working against the number HWiNFO reports (the displayed unit before this re-tiering), exactly as before.
