---
title: What's new in 1.8
nav_order: 1.5
description: Strip display, backgrounds for keys and the whole deck, a unit and limits for each reading, and what an upgrade changes.
---

**1.8.0.0 joins Sensor Dials into one graph across the touch strip, puts a
picture behind keys and across the whole deck, and gives each reading its
own unit, decimals and limits.** The upgrade only adds settings and reads
every 1.7.1 setting as before. The [changelog](changelog.md) lists every
change.

<a class="image-link" data-image-viewer href="{{ '/assets/img/deck-dusk-1.8.jpg' | relative_url }}" aria-label="Enlarge image" data-image-credit="Device image: Elgato."><img src="{{ '/assets/img/deck-dusk-1.8.jpg' | relative_url }}" width="1600" height="1432" decoding="async" alt="A Stream Deck + XL, front on, with 36 Sensor Reading keys and, across the whole touch strip under them, one Trend graph of CPU and GPU temperature over five minutes: both lines rise during a load and fall back. Keys and strip draw the Dusk background."></a>

*Background **Dusk** behind every key and a **Trend** across the six dials of a Stream Deck + XL. Device image: Elgato.*

## One graph across the touch strip

A [strip display](strip-display.md) joins the Sensor Dials of a Stream Deck + or + XL into one graph, or two side by side with **Equal split**.

- **Nine graphs**: **Trend**, **Area**, **Compare**, **Lanes**, **Heat**, **Group**, **Ambient**, **Meters** and **Events**, over the last 1, 5 or 15 minutes. See [What each graph is for](strip-display.md#what-each-graph-is-for).
- **Build screens** proposes up to seven graphs from this PC's sensors, and **Make the strip** creates them. See [Build screens](strip-display.md#build-screens).
- **Equal split** starts from a pair of graphs this PC's sensors fill, such as **CPU and GPU**, and **Fill both halves** puts one on a running split. See [Equal split pairs](strip-display.md#equal-split-pairs).
- **Screens**: a whole strip keeps up to eight graphs and shows one at a time. See [Screens](strip-display.md#screens).
- **Group** draws up to 32 readings of a folder, a filter, a list or a unit. Its **Tiles** view gives each reading a small graph of its own. See [Group](strip-display.md#group).
- **Meters** has a **Look**: **Thin bar**, **Full bar** or **Liquid**. **CPU and RAM usage**, the first pair, is a **Liquid** of each.
- **Brief gaps** sets how a strip draws a reading missed for a moment.

<a class="image-link" data-image-viewer href="{{ '/assets/img/strip-graphs-1.8.png' | relative_url }}" aria-label="Enlarge image"><img src="{{ '/assets/img/strip-graphs-1.8.png' | relative_url }}" width="1920" height="2536" loading="lazy" decoding="async" alt="Eleven whole Stream Deck + XL strips, one under the other, each named: Trend with two temperature lines; Area with one filled line; Compare with three temperatures on one scale; Lanes with a temperature, a load and a power reading in three lanes; Heat as colored time bins with an amber cap where the reading passed its warn limit; Group with one large value and eight thin lines; Group in its Tiles view with sixteen small graphs; Ambient as many colored lines; Meters with six large values and bars; Events with amber bars where a Yes/No reading said Yes; and an Equal split with a Liquid meter of CPU usage in one half and memory usage in the other."></a>

*The nine graphs, Group's Tiles view and an Equal split, each across a whole + XL strip on the Void theme.*

## A picture behind keys and across the deck

- **Background** on a Sensor Reading key lets the page picture set in the Stream Deck app show behind it: **Glass**, **Tint**, **Outline** or **Clear**, as on a dial since 1.7.1. See [Background](sensor-reading.md#background).
- **Stars**, **Dusk** and **Nebula** draw the plugin's own picture across the whole deck. See [Deck backgrounds](themes.md#deck-backgrounds-stars-dusk-and-nebula).
- **Advanced → Shared defaults** sets one **Background** for every key, dial and strip that has none of its own.

<a class="image-link" data-image-viewer href="{{ '/assets/img/deck-cliffs-1.8.jpg' | relative_url }}" aria-label="Enlarge image" data-image-credit="Cosmic Cliffs: NASA, ESA, CSA, and STScI. Cropped to the display. Device image: Elgato." data-image-credit-url="https://esawebb.org/images/weic2205a/" data-image-license="CC BY 4.0 (Cosmic Cliffs)" data-image-license-url="https://creativecommons.org/licenses/by/4.0/"><img src="{{ '/assets/img/deck-cliffs-1.8.jpg' | relative_url }}" width="1600" height="1432" loading="lazy" decoding="async" alt="A Stream Deck + XL, front on, with all 36 Sensor Reading keys on Tint over the Cosmic Cliffs as the page picture: each key shows its own part of the picture, blue sky and stars behind the top rows and orange cliffs behind the lower ones, darkened by the tint, and every word has a thin dark outline. A Trend graph crosses the whole touch strip over the same picture."></a>

*Every key and the strip on **Tint** on the Void theme. Picture: the Cosmic Cliffs ([NASA, ESA, CSA, and STScI](https://esawebb.org/images/weic2205a/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), cropped), standing in for a page and strip picture set in the Stream Deck app. Device image: Elgato.*

## A unit, decimals and limits for each reading

- **Unit and decimals per reading** ([issue #59](https://github.com/slawrensen/hwinfo-streamdeck/issues/59)): a reading's own decimals, and one unit for a byte reading. See [Unit and decimals per reading](sensor-reading.md#unit-and-decimals-per-reading).
- **Limits for each reading on a key**, and **Separate limits for** a reading on a dial. See [Limits for each reading on a key](thresholds-alerts.md#limits-for-each-reading-on-a-key) and [Dial: separate limits, timing and snooze](thresholds-alerts.md#dial-separate-limits-timing-and-snooze).
- **Alert after**, **Clear by** and **Snooze lasts** set an alert's timing on keys and dials.
- Limits typed in 1.8 keep their unit, so a later **°F** switch converts them.

<a class="image-link" data-image-viewer href="{{ '/assets/img/reading-units-1.8.png' | relative_url }}" aria-label="Enlarge image"><img src="{{ '/assets/img/reading-units-1.8.png' | relative_url }}" width="648" height="348" loading="lazy" decoding="async" alt="The same two-reading key twice, with the free memory of two GPUs. On Auto it reads 12.1 GB over 453 MB. With GB and 2 decimals set for each reading it reads 12.10 GB over 0.45 GB."></a>

*12100 MB and 453 MB on one two-reading key: on **Auto**, and with **GB** and 2 decimals set for each reading.*

## Time windows

**Time window** on a key's sparkline or a two-row dial covers the last 1, 5 or 15 minutes. History is capped at 2 MiB, plus a separate 768 KiB for Group and Ambient strip graphs. See [Time window](sensor-reading.md#time-window) for a key and [Time window on the two-row view](sensor-dial.md#time-window-on-the-two-row-view) for a dial.

## Sensor details

- **Page layout** keeps chosen cells of the detail page empty for one key's drill-down ([issue #5](https://github.com/slawrensen/hwinfo-streamdeck/issues/5)). See [Empty cells: Page layout](sensor-details.md#empty-cells-page-layout).
- **Detail filters take `|`** ([issue #35](https://github.com/slawrensen/hwinfo-streamdeck/issues/35)): `4090 | pump` lists every reading either pattern matches. See [Filter patterns](sensor-details.md#filter-patterns).

## Reading links and calculated readings

- **Advanced → Reading links** pairs a Shared Memory reading with its Gadget counterpart. See [Link from the settings panel](data-sources.md#link-from-the-settings-panel).
- **Advanced → Calculated readings**: the sum, average, lowest or highest of 2 to 8 readings, or the difference or ratio of two. See [Calculated readings](data-sources.md#calculated-readings).

## The HWiNFO Control key

An [HWiNFO Control key](controls.md#the-hwinfo-control-key-action) can **Snooze alerts**, **End alert snooze** and drive a strip: its screens, its time window, the highlighted reading and **Strip: inspect (pause the view)**.

## What changes on your deck

| Change | What you see |
| --- | --- |
| Binary data units | HWiNFO's KB to TB are read as 1024-based. With 2 decimals, 12,100 MB read 11.27 GiB in 1.7.1 and read 11.82 GiB now. |
| A busy Shared Memory read | A read that finds HWiNFO busy looks again, up to six times 25 ms apart, before it counts as missed. Before, graphs broke about every 139 seconds. |
| Presses in the settings panels | A held Enter presses once (the screen and page arrows keep stepping), and a double click or a pen's double tap acts once on a button, a checkbox, a section heading or a reading in a list. Quick presses still repeat on a tile's size, the screen and page arrows, and **Earlier** and **Later**. |
| Renamed labels | **Not updating** (was **No new data**) on a dial. **Link ID** (was **Target**) and **A stats reset clears** (was **A reset clears**) on an HWiNFO Control key. |

## Upgrading and going back

- 1.8 only adds settings. **Use it everywhere** (**Advanced → Shared defaults**) is the one button that removes fields: each key's, dial's and strip's own **Background** and **Words in the accent color**.
- Going back to 1.7.1 ignores the new fields. Keys draw Recent samples and alert only from the first reading's **Warn at** and **Critical at**, at once and with no snooze. An HWiNFO Control key set to **Snooze alerts**, **End alert snooze** or a **Strip** command shows the Stream Deck alert when pressed. Joined dials show their own readings. Every key, and a dial on **Default**, **Stars**, **Dusk** or **Nebula**, draws the theme's background. Calculated readings show **Sensor missing**.
- A dial's **Background** picked on 1.7.1 after **Use it everywhere** can go back to **Default** on the way back to 1.8. Pick it again.
- A known gap: a Sensor Dial pasted from a second copy of a strip's profile can bring that copy's setup to the whole strip without asking. [Copies and other decks](strip-display.md#copies-and-other-decks) says how to undo it.
- Requirements are unchanged.

The [hardware page](hardware.md) lists what ran on which device, and [PERF.md](https://github.com/slawrensen/hwinfo-streamdeck/blob/main/PERF.md) has the soak and timing records.

Upgrading from 1.6? [What changed in 1.7](whats-new-1.7.md) says where that step needs you to act.
