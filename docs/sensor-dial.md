---
title: Sensor Dial
nav_order: 5
description: Configure touchscreen readings, transparent backgrounds and dial behavior.
---

The **Sensor Dial** action shows HWiNFO readings on a Stream Deck + or Stream Deck + XL touchscreen. Choose one reading with a range bar, two readings with sparklines, or three compact rows. Turn to switch readings; push and touch to control the display.

**Requires:** Windows x64, local HWiNFO, and a Stream Deck + or + XL. Set **Display → Background** for transparency, **Display → View** for layouts, or **Controls → Gestures** for the dial's inputs.

<a class="image-link" data-image-viewer href="{{ '/assets/img/dials.png' | relative_url }}" aria-label="Enlarge image"><img src="{{ '/assets/img/dials.png' | relative_url }}" width="440" height="240" loading="lazy" decoding="async" alt="A Sensor Dial face as the plugin renders it: CPU Temp at 58.6 °C, the session low 52.8 and high 78.9, and a range bar whose track marks the warn and critical zones in amber and red."></a>

To join the dials of a deck into one graph across the touch strip, or two graphs side by side, see [Strip display](strip-display.md).

## Transparent background

Available in **1.7.1**. To show the Stream Deck app's touch strip picture behind your readings:

1. Right-click the strip in Stream Deck and choose **Set from File...** or **Open Background Library**.
2. Select a Sensor Dial and open **Display → Background**.
3. Choose **Glass**, **Tint**, **Outline** or **Clear**. Repeat for the dials you want transparent, or set **Advanced → Shared defaults → Background** once for every key, dial and strip left on **Default** ([Per-key vs. shared](themes.md#per-key-vs-shared)).

Each dial still draws inside its own **200 × 100** segment. A picture can span the touch strip. For one graph across the whole strip or half of it, join the dials in a [strip display](strip-display.md), which takes the same backgrounds.

| Background | What the dial draws | Text over the picture |
| --- | --- | --- |
| **Theme** (default) | The theme's background, exactly as before. | The picture does not show. |
| **Glass** | The theme's background as a panel at 80% opacity, so the picture shows through at 20%. | Built-in text keeps 4.5:1 contrast over any picture (a calculation). |
| **Tint** | The theme's background as a panel at 50% opacity, so the picture shows through at half strength, with Outline's 1 px outline on every word and mark. | Built-in text keeps 4.5:1 contrast against its outline (a calculation). |
| **Outline** | No background. Every word, the range bar, the rail mark and the trend line get a 1 px outline: black on the dark themes, the theme's background on **Paper**. | Built-in text keeps 4.5:1 contrast against its outline (a calculation). |
| **Clear** | No background and no outline. | Depends on the picture. |
| **Stars**, **Dusk**, **Nebula** (new in 1.8) | A picture the plugin draws across the whole deck, keys and strip, in place of the strip picture ([Deck backgrounds](themes.md#deck-backgrounds-stars-dusk-and-nebula)). | Built-in text keeps 4.5:1 contrast against the brightest color the picture can draw (a calculation). |

<a class="image-link" data-image-viewer href="{{ '/assets/img/dial-backgrounds-looks.jpg' | relative_url }}" aria-label="Enlarge image" data-image-credit="Cosmic Cliffs: NASA, ESA, CSA, and STScI. Cropped for the touch strip. Auroras: NASA." data-image-credit-url="https://esawebb.org/images/weic2205a/" data-image-license="CC BY 4.0 (Cosmic Cliffs)" data-image-license-url="https://creativecommons.org/licenses/by/4.0/"><img src="{{ '/assets/img/dial-backgrounds-looks.jpg' | relative_url }}" width="1264" height="352" loading="lazy" decoding="async" alt="Three touch strips from a Stream Deck + XL, each with six dials over one picture: the Cosmic Cliffs, an aurora over the Earth&#x27;s horizon and a pale mist. From left, the same reading drawn in Theme, Glass, Tint, Outline and Clear, then a three-row overview in Tint."></a>

*Stream Deck app captures with live readings on a Stream Deck + XL. From left: Theme, Glass, Tint, Outline, Clear, then Tint in the three-row view. Strip pictures: the Cosmic Cliffs ([NASA, ESA, CSA, and STScI](https://esawebb.org/images/weic2205a/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), cropped for the strip), auroras photographed from the International Space Station (NASA), and gradients I made.*

**Words in the accent color** appears below Background on Glass, Tint and Outline; **Default** follows the shared **Words in the accent color** (off until you change it, so it reads *Off (shared)*), and **On** or **Off** keeps that choice on this dial. It colors the title, selected row name and context name with the dial's accent; values and individual Reading colors keep their own settings. The accent follows **Advanced → Shared defaults → Accent colors**.

**Check custom colors on the actual display.** Custom text and individually chosen reading colors can fall below the contrast floor. Clear has no panel or outline, so its readability depends entirely on the picture. Use Glass, Tint or Outline for busy or uneven backgrounds.

<details markdown="1">
<summary>How the background modes draw text and selection indicators</summary>

**Glass.** The plugin cannot read the picture, so I calculate Glass's text colors against the hardest case: the panel over pure white, or over pure black for **Paper**. Every built-in value, unit, statistic and label keeps the 4.5:1 floor of [the display system](themes.md#the-display-system) over any picture. That is why labels and units draw lighter on Glass (darker on Paper), and why an overview value in alert can draw a lighter amber or red (a darker one on Paper) where the theme's own falls short there. The red lifts most on **Graphite**, whose background is the lightest of the dark themes, and on the selected row of the two-row view. The bar track, the rail groove, the separators, the selected two-row band and the area under a trend draw in the theme's label color at 20%.

**Tint.** The panel is the theme's background at 50%, so more of the picture shows than on Glass. Over a white picture (black on **Paper**) that panel leaves the theme's own text below 4.5:1, so Tint does not rely on it: it draws Outline's 1 px outline and uses Outline's text colors, described next.

**Outline.** Labels take the value color, and units and statistics a dimmer step of it, so a gray word does not merge with its dark outline over a light picture. The two-row view draws no band behind the selected row (the accent rail and the brighter label mark it) and draws trend lines without the shaded area under them. Separators stay thin lines in the theme's track color.

**Clear.** Labels, units and statistics take the value color. Use a dark, even picture with a dark theme, or a light one with **Paper**. Over a bright, mid-tone or busy picture the text has no contrast floor; use Glass, Tint or Outline there. The range bar, the three-row rail and the two-row rail keep a track 1 px wider than themselves, and trend lines keep their shaded area.

**Words in the accent color.** On Glass, Tint and Outline, the select under **Background** set to **On** (or **Default** while the shared one is on) draws the dial's words in its accent color, the color of the range bar and the rail mark. The title, the selected row's name and the context line's name take the accent. Units, statistics and the other rows' names take their usual color moved halfway toward it, and the selected row's name never has less contrast than they do. With **Accent colors** (Advanced, Shared defaults) on **By sensor type**, the accent is the sensor type's color, so the words change color with the reading on the dial. Under **Dimmed** the accent dims with the rest of the text. Values, alert colors, **Color numbers by sensor type**, **Reading colors** and a **Custom color** for text do not change.

Each recolored word keeps the 4.5:1 floor of the rest of the text on that look (a calculation). Where an accent falls short of it, mostly on Glass, the word draws a lighter shade of it than the bar (a darker one on **Paper**). **Paper**'s accent is a dark gray, so on Paper the words change little. Clear does not offer the box: with no panel and no outline, a word has only the picture behind it, and the value color is already the theme's most readable color there.

</details>

<a class="image-link" data-image-viewer href="{{ '/assets/img/dial-backgrounds-deck.jpg' | relative_url }}" aria-label="Enlarge image" data-image-credit="Cosmic Cliffs: NASA, ESA, CSA, and STScI. Cropped for the touch strip." data-image-credit-url="https://esawebb.org/images/weic2205a/" data-image-license="CC BY 4.0 (Cosmic Cliffs)" data-image-license-url="https://creativecommons.org/licenses/by/4.0/"><img src="{{ '/assets/img/dial-backgrounds-deck.jpg' | relative_url }}" width="1300" height="710" loading="lazy" decoding="async" alt="A Stream Deck + XL page: 36 Sensor Reading keys in Midnight, and six Tint dials with Words in the accent color over the Cosmic Cliffs across the whole touch strip."></a>

*A Stream Deck app capture of a whole + XL page with live readings: Midnight keys, and six dials on Tint with Words in the accent color. Strip picture: the Cosmic Cliffs ([NASA, ESA, CSA, and STScI](https://esawebb.org/images/weic2205a/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), cropped for the strip).*

On Glass, Tint, Outline and Clear:

- In the two-row view only Glass draws the band behind the selected row. Tint, Outline and Clear mark that row with the accent rail and the brighter label.
- Status screens such as **Start HWiNFO** show their text without the empty range bar on Tint, Outline and Clear. Glass keeps it as a faint groove.
- A **Custom color** for text and chosen **Reading colors** stay exactly as chosen and can fall below the floor over a bright picture.
- With no background box to hide a label that runs long, a three-row label and a two-row label's second line are cut to their measured width, or left off when not even an ellipsis fits, so a label with emoji or symbols the face font does not have is shortened a little sooner.
- The settings panel header cannot show your picture, so it previews a see-through dial over a checkerboard. Sensor Reading keys have their own **Background** for the page background ([Background](sensor-reading.md#background), new in 1.8).
- Tint's and Outline's outline is an SVG filter, which the Stream Deck app draws on the versions I checked (7.4 and 7.6). I have run Glass and Outline on my Stream Deck + XL since 2026-10-16.

### Get the Cosmic Cliffs background

[Download the source photograph from ESA/Webb](https://esawebb.org/images/weic2205a/). This is the full photograph; crop it to fit your touch strip, then use **Set from File...** in Stream Deck. To match the displayed settings, use **Midnight** on the keys and **Tint** with **Words in the accent color** on the dials.


## The touchscreen readout

The slot draws four things, top to bottom:

| Element | Shows |
| --- | --- |
| **Title** | Your **Title on the dial**. Left blank, the name you gave the reading with **Rename** in the rotation list, else HWiNFO's label. |
| **Value + unit** | The live reading, formatted per **Decimals** (or in the reading's own unit and decimals, set under **Unit and decimals per reading**), with the unit inline. A stat badge (`· MIN`, `· MAX`, `· AVG`) is appended when you're viewing a session stat instead of the live value. |
| **Stats line** | `▼ <low>   ▲ <high>   session`: the lowest and highest values seen this session. `pinned` replaces `session` while the dial is pinned, and `cycle paused` while its auto cycle is paused. A line too long for 12 px draws at 11 px; only a line too long even then loses words, `session` first. For a reading with its own format, the low and high use it; a line too long even at 11 px drops its tag first, then both numbers drop their decimals, then shorten (`22.0T`), never cut. A short message (a group name after a group jump, `stats reset`) takes the whole line for a moment. |
| **Range bar** | A fill showing where the **live** value sits between the bar's min and max. |

The bar always tracks the live value, even while you're touching through MIN / MAX / AVG on the number above it.

## Overview view

**View** offers two multi-row layouts besides the single readout, both listing what rotation moves through:

- **Overview, two rows (big values and trend)**: two rows with large right-aligned values. A highlight band and accent bar mark the selection (the band only on the **Theme** and **Glass** backgrounds). Long labels wrap; labels that fit one line leave room for a sparkline, which can cover a time span set by **Time window** (see [Time window on the two-row view](#time-window-on-the-two-row-view)). The footer shows the selected reading's session statistics.
- **Overview, three rows**: one line per reading. A marker on the left shows the selection and window position. The context line contains the shared name and session `▼ low ▲ high`; names shorten before statistics. Put it above or below the rows with **Context line**, and show or hide row dividers with **Separators**. Pause, pin and stat badges share the name area. Temporary messages briefly replace the context line.

<a class="image-link" data-image-viewer href="{{ '/assets/img/pi-dial-overview.png' | relative_url }}" aria-label="Enlarge image"><img src="{{ '/assets/img/pi-dial-overview.png' | relative_url }}" width="800" height="524" loading="lazy" decoding="async" alt="The dial&#x27;s View select on Overview, three rows, with Decimals on Auto, the Temperature °F box and the folded Unit and decimals per reading (None set) under it, then the Row labels, Context line and Separators selects that the overview reveals, on Shorten shared words; name on the context line, Above the rows and Thin lines."></a>

Three things keep the short labels readable:

- **Shared prefixes move to the context line.** When the visible rows' labels start with the same words ("GPU Temperature / GPU Hot Spot / GPU Thermal Limit"), the shared part is lifted out and shown once beside the stats: the rows read "Temperature / Hot Spot / Thermal Limit" with `GPU` in the context line (the two-row face keeps it in its bottom line). Names you type yourself are never altered, and a reading whose whole label is the shared word (a plain "GPU" row) keeps it. To keep HWiNFO's full names, set **Row labels** to **Always full labels**.
- **Values share one right-aligned column.** Every value's ones digit lands on the same column edge, with units in their own column beside it. The three-row face steps the value size down a ladder until the widest visible value fits, and each row's label runs up to its own value before it shortens. Its columns stay in place unless a wide rate unit (Mbps, Gbps, MB/s, MT/s) is in view; since 1.7 the value and unit columns then move left together so the unit is not cut at the screen edge. The two-row face places its columns by the widest visible value, so a short value leaves more room for the labels.
- **You can rename any reading in the rotation.** Select it in the rotation list under **Readings to rotate through** and press **Rename** in the toolbar under the list (or double-click it, or press F2 in the list), then type a new name in the **Name on the dial for …** field (Enter or click away to save; clear it to go back to HWiNFO's name). The name shows on that row and as the dial's title whenever that reading is selected, in both views. Unticking a reading keeps its name for later.

  <a class="image-link" data-image-viewer href="{{ '/assets/img/pi-dial-rename.png' | relative_url }}" aria-label="Enlarge image"><img src="{{ '/assets/img/pi-dial-rename.png' | relative_url }}" width="800" height="606" loading="lazy" decoding="async" alt="The Rotation group of the dial&#x27;s settings panel: the Readings to rotate through search and its help line, then a rotation list of three readings, two already renamed &quot;CPU&quot; (filled, as the one on the dial) and &quot;GPU&quot;, and the third, PUMP SYS1, selected. Under the list, the Earlier, Later, Rename and Remove toolbar with Later dimmed because PUMP SYS1 is last, the &quot;Name on the dial for PUMP SYS1&quot; field with &quot;Pump&quot; typed and selected, the line &quot;Rotation moves through these 3 readings only, in this order.&quot; and the Split into groups button."></a>

  For example, rename two `SPD Hub Temperature` readings to `DIMM 1` and `DIMM 2` for display. This does not change HWiNFO's names, so it does not separate two Gadget readings that share a name.

See the [current rendered dial examples](#reading-colors) below.

The overview does not get its own list to manage. It shows exactly what rotation already steps through, in the same order:

- your **rotation set**, if you built one (any size; the view shows a two- or three-row window of it),
- the **active rotation group** when [groups](controls.md#rotation-groups) are in charge of a plain turn,
- otherwise the **picked sensor's readings**.

Rotating works exactly as in the single view: the selection steps through the full list (saved as always), the mark follows it, and the three-row window scrolls with the selection, clamped at the ends. Auto cycle, alert interrupts, pin, pause, group jumps, touch taps and the HWiNFO Control key all keep working unchanged; a touch tap through MIN / MAX / AVG switches every row to that session stat and notes it beside the stats (the context line on three rows, the bottom line on two).

A few details specific to the view:

- The range bar and the big value belong to the single view; the overview trades them for the extra rows. **Bar from** / **Bar to** are hidden in the settings panel and not used while an overview is active; their values stay saved.
- **Warn / Critical** still apply (unit-scoped as always): a row whose reading trips a threshold shows its value in the alert color, and the alert-aware auto cycle can pull the selection (and so the window) to it.
- A **Title on the dial** renames the marked row only (and clears when the dial moves on to another reading unless **Title when the dial moves on** is set to **Stays for this dial**); names given with **Rename** stay with each reading instead.
- Values truncate at 12 characters and keep the shared **Decimals** setting, unless a reading has its own format under **Unit and decimals per reading**: its row then shows its own unit and decimals, the footer follows the selected reading's format, and a number longer than 12 characters drops its decimals, then shortens (`22.0T`); units truncate at 4 characters on the three-row face and 5 on the two-row face.
- With fewer than three readings in reach, the overview lists what there is; the status faces (HWiNFO down, no selection, sensor missing) are the same as the single view's.

Switching back to **One reading** restores the exact single-view face.

### Time window on the two-row view

**Time window** sets what each row's sparkline covers. **Recent samples** *(default)* spaces the row's last 36 readings evenly. **1 minute**, **5 minutes** or **15 minutes** draws that span of time with now at the right edge, kept in the same 1, 2 and 6 second steps as a key's; the key's [Time window](sensor-reading.md#time-window) has the full rules.

- Each row's trend fills the room left of the values, so its width follows the widest value on the face. A row whose label wraps onto the value line has no trend.
- Each pixel column draws the lowest and highest reading behind it, so a spike that lasted one reading still shows.
- The line ends at the row's last reading, and the window moves only when a new reading arrives.
- A row's window starts empty and fills from the right; a short history stays on the right. A row that scrolls into view starts empty too, unless that reading's window was on screen somewhere in the last 16 minutes.
- The line breaks where no new reading came in, goes straight across a read skipped for a moment, and never draws a gap as zero. When HWiNFO closes, the dial keeps its last readings until about 15 seconds after the last one arrived, and then shows **Start HWiNFO**. After 15 seconds without a new reading it shows **Not updating** (Shared Memory) or **Age unknown** (Gadget), and the run ends at the last reading that arrived. The PC sleeping breaks the line too. When HWiNFO starts reporting a reading in another unit, the readings in the old unit are left out and that row's line starts again from the right; the dial's **°F** box only changes the display and keeps the line.
- On the Gadget source, readings that HWiNFO stops updating while others still change draw flat; see [Freshness and local history](data-sources.md#freshness-and-local-history).

## Reading colors

These controls arrived in 1.7 (and the earlier issue #31 preview); 1.6.0 does not have them.

In **Display**, choose one of the two overview **View** options. **Color numbers by sensor type** and **Reading colors** then appear under the overview options. **Reading colors** uses the same presets and color wells as the [four-reading key](sensor-reading.md#layout-four-readings-the-quad-grid):

- **Signal (four hues)**, **Pairs (two hues)** or **Uniform** applies a preset to the listed readings.
- Click a reading's color well to choose its own number color. Two temperatures can have different colors, like CPU Temp and GPU Temp below.
- **Auto** resets one reading; **Automatic** resets the listed readings. Readings without a chosen color follow the sensor-type option below, or normal text.

Without a rotation set, the list is the picked reading's sensor. A sensor of more than 8 readings lists its first 8 and every reading with its own color, and a button such as **Show all 149 readings** under the list shows the rest. The picked reading is always listed, wherever it sits in the sensor.

Colors follow each reading through rotation, reordering and groups. Switching views or removing and re-adding a reading keeps its saved color. Individual colors work with **Accent colors** set to **Theme accent everywhere**, including on Paper. Labels, units, footer, graphs and the selection indicator keep their existing styling.

Saved colors also follow explicitly confirmed Shared Memory/Gadget links.
If both linked keys have their own color, the displayed key's choice wins.
In an uncurated rotation the displayed key is the live key for unselected
rows and the saved key for the selection, so a measurement with two saved
colors can change color when rotation selects it. Keep one color per
measurement to avoid that.

<a class="image-link" data-image-viewer href="{{ '/assets/img/pi-dial-reading-colors-1.7.png' | relative_url }}" aria-label="Enlarge image"><img src="{{ '/assets/img/pi-dial-reading-colors-1.7.png' | relative_url }}" width="800" height="1450" loading="lazy" decoding="async" alt="The Display section of the dial&#x27;s settings panel: Text color on Theme text, Background on Theme (shared), View on Overview (three rows), Row labels on Always full labels, Color numbers by sensor type unticked, and Reading colors on Signal (four hues), with a color well and an Auto button for each reading: CPU Temp blue, GPU Temp pink, Pump green, GPU Power gold and GPU Load blue."></a>

*An actual settings-panel capture at panel build 1.8.0.0-54 (the marker in its title bar), served by the local test host with live HWiNFO Shared Memory readings.*

<a class="image-link" data-image-viewer href="{{ '/assets/img/dial-reading-colors-1.7.png' | relative_url }}" aria-label="Enlarge image"><img src="{{ '/assets/img/dial-reading-colors-1.7.png' | relative_url }}" width="1340" height="884" loading="lazy" decoding="async" alt="Three-row and two-row dial examples comparing automatic text with individual reading colors. CPU temperature is blue, GPU temperature pink, pump speed green, GPU power gold and GPU load blue."></a>

*Both sides use Void, Text color Theme text and Accent colors Theme accent everywhere; only the individual reading colors change.*

For automatic category colors, tick **Color numbers by sensor type** and leave **Accent colors** (Advanced, Shared defaults) on **By sensor type**: temperature numbers share pink, fans cyan, power gold and load purple. The option is off by default. Paper, the theme accent everywhere and unknown categories keep normal text. Automatic colors adjust for readability on each row's background.

**Theme text** keeps your chosen colors exact; **Dimmed** dims them. A valid **Custom color**, including one inherited from the shared Text color, overrides reading colors. Warning and critical values keep priority and the existing unit scoping. Leave both number-color controls at their defaults to keep the released appearance.

## Gestures

These are the **Legacy** preset defaults, which every dial runs until you pick otherwise. The [Dial controls & presets](controls.md) page covers the Elite and Custom presets, the pressed turn, touch zones, pause/pin, **A stats reset clears**, and the HWiNFO Control key action.

| Gesture | Effect |
| --- | --- |
| **Turn** (pressed or not) | Step through your [rotation set](#rotation-set-ignore-turns-and-auto-cycle) if you built one, otherwise through the readings of the *same sensor source* (e.g. every reading under one GPU), wrapping around at the ends. The new choice is saved. Does nothing while **Ignore turns** is on. |
| **Push** (press the dial) | Reset the session min / max / average back to the current value. |
| **Touch** (tap the screen) | Cycle the displayed number: current → session min → session max → session average. |
| **Long touch** (touch and hold) | Jump straight back to the live current value. |

> **Note:** Without a rotation set, a turn only walks readings that belong to the same physical sensor as your current pick, so you can spin through, say, all of one drive's temperatures without leaving that device. To jump to a different source entirely, pick it under **On the dial now** in the settings panel, build a rotation set that crosses sensors, or use the Elite preset's pressed-turn sensor jump.

## Rotation set, Ignore turns, and Auto cycle

Three settings control what rotation can reach:

- **Rotation set.** Tick readings in the **Readings to rotate through** search (under Reading, in the **Rotation** group) to build a custom list; the dial then rotates through *only* those readings, in list order, wrapping at the ends. Ticking never changes the reading on the dial; the **On the dial now** picker above it does that. The set can mix readings from different sensors. Picked readings show as a list under the search, in rotation order; select one and use **Earlier**, **Later**, **Rename** or **Remove** in the toolbar under it (in the list, Alt with an arrow key moves it and F2 renames it), and the reading on the dial right now is highlighted: turn, jump groups or let the auto cycle run with the panel open and the mark moves with it. A ticked reading HWiNFO is not publishing right now keeps its place, shows a **missing** pill and is skipped until it returns; the note under the list counts only the readings the dial steps through. Two readings with the same name (two drives' Drive Temperature) carry the word that tells their sensors apart, such as **#0** and **#1**. When the reading on the dial is not in the set, a line under the list says the next step leaves it and names where it goes. Leave the set empty for the default same-sensor behavior. The set can also be [split into named rotation groups](controls.md#rotation-groups): a plain turn then stays inside one group and a pressed turn (Elite) jumps between groups.

  <a class="image-link" data-image-viewer href="{{ '/assets/img/pi-dial-picker.png' | relative_url }}" aria-label="Enlarge image"><img src="{{ '/assets/img/pi-dial-picker.png' | relative_url }}" width="800" height="1760" loading="lazy" decoding="async" alt="The top of the dial&#x27;s settings panel: the header with the dial face beside CPU (Tctl/Tdie) and Live · Shared Memory, the theme strip on Default (shared: Void) and the folded Strip section, then Reading with On the dial now and &quot;cpu&quot; typed in the Readings to rotate through search. The results sit under their sensor, each row a checkbox with its live value and type; Core 0 VID and Core 1 VID are ticked and form the rotation list under the search, with the Earlier, Later, Rename and Remove toolbar, the line &quot;Rotation moves through these 2 readings only, in this order.&quot; and Split into groups. A line at the bottom edge, cut off by it, says CPU (Tctl/Tdie) is on the dial but not in this rotation, so the next step moves to Core 0 VID and does not come back."></a>

  <a class="image-link" data-image-viewer href="{{ '/assets/img/pi-dial-rotation.png' | relative_url }}" aria-label="Enlarge image"><img src="{{ '/assets/img/pi-dial-rotation.png' | relative_url }}" width="800" height="1760" loading="lazy" decoding="async" alt="The top of the dial&#x27;s settings panel: the header with the dial face beside CPU (Tctl/Tdie) and Live · Shared Memory, the theme strip on Default (shared: Void), the folded Strip section, On the dial now with the line &quot;Turns and pressed turns change this too.&quot;, and a rotation of three readings from three sensors (CPU (Tctl/Tdie), filled as the one on the dial and selected, GPU Temperature and PUMP SYS1) with the Earlier, Later, Rename and Remove toolbar and Split into groups below it, then Title on the dial beside Title when the dial moves on, and the start of Display with Text color, Background and View on One reading."></a>
- **Ignore turns.** A checkbox under Controls that makes the dial ignore rotation entirely, so a bump against the deck can never move you off the reading you chose. Push, touch, and the settings panel still work.
- **Auto cycle.** A select under Controls that steps to the next reading in the rotation set (or the picked sensor's readings) on a timer, from every 5 seconds to every 5 minutes. It runs even while turns are ignored, which makes a hands-off tour of your picked readings: build a set, ignore turns, set a cycle time. A manual turn restarts the timer, and each step clears the custom title just like a manual turn (unless **Title when the dial moves on** is set to **Stays for this dial**). Timing rides the poll interval (**Read every**), so a step can land up to one read late. Ticking **Auto cycle jumps to a critical reading** (under Alerts) makes the cycle alert-aware: it holds instead of rotating away while the shown reading is critical, and its next step goes to a critical member of the set instead of the next one in order. Left unticked (the default), alerts do not steer the cycle; see [Dial controls & presets](controls.md#thresholds-and-mixed-units).

Rotation also protects your selection when HWiNFO temporarily stops publishing the saved sensor (a restart, a device dropout): turns are ignored until the sensor returns, instead of jumping to an unrelated reading.

### Session stats are the dial's own, per reading

The dial calculates local min/max/average for each reading. These are separate from HWiNFO's own statistics. The average is the sum of accepted observations divided by their count; it is not time-weighted. Repeated held frames do not count again.

- The selected reading, rotation-set members and multi-row view readings accumulate while the poller runs. Ordinary rotation preserves a reading's session. Hidden dials can retain their state for up to 30 minutes, subject to the [hidden-dial limit](controls.md#pause-pin-and-reset-reach).
- A missing or non-finite reading, a stale or unavailable source, or a source, native-unit or type change resets the affected session; the first live frame after a stale or unavailable source shows **stats reset: data gap** once. A pairing edit resets a session only when its saved key now stands for a different measurement. This also applies to retained readings while another reading is selected. The next accepted sample starts the new session.
- **Push** resets the current reading under the Legacy preset. **A stats reset clears** can widen that to the set or every dial. Other presets can assign reset to a different gesture.
- Gadget can supply observations for these local statistics, but has no HWiNFO history or producer timestamp. **Age unknown** replaces the display when freshness cannot be established. See [Data sources](data-sources.md#freshness-and-local-history).

With no Sensor Reading key or Sensor Dial visible, polling stops. Retained state does not establish what happened during that unobserved period.

## Settings

The panel groups settings under **Strip** (see [Strip display](strip-display.md)), **Reading**, **Display**, **Alerts**, **Controls** and **Advanced**. Its header shows the current face, reading and data state. A reading name longer than two lines is cut with an ellipsis, and so is a source line longer than three lines, or longer than two where any name the dial can show takes two. Point at it, or move to it with Tab, to see it whole in a card over the settings; a click or Enter keeps the card open, and **Copy** puts HWiNFO's name for the reading on the clipboard. A status message offers a fix when needed. The theme strip sits below the header.

Reading and Display start open. Folded sections summarize their settings; folds persist between dial panels until Stream Deck restarts. **Open all sections**, **Fold all sections**, or Alt-click on a section title changes them together.

| Section | Setting | What it does |
| --- | --- | --- |
| Theme strip | **Theme** | A named theme applies to this dial; **Default** follows the shared theme. **Make shared** makes this dial's theme the shared choice. [Compare themes](themes.md). |
| Reading | **On the dial now** | Searchable picker over every reading HWiNFO publishes, with live values; the button beside it reloads the sensor list. The line under it names what else changes the reading on this dial, from the dial's control map, for example *Turns and pressed turns change this too.* Arrow keys browse, Enter picks, Tab or a click elsewhere closes without changing anything. |
| Reading | **Readings to rotate through** | The **Rotation** group sits right under **On the dial now**: first a search whose results tick readings in or out (ticking never changes what is on the dial now), then the ticked readings in rotation order as one list, the one on the dial highlighted, so you can watch it move as the dial turns, and one HWiNFO no longer lists marked **missing**. Select a reading and use the toolbar under the list: **Earlier**, **Later**, **Rename**, **Remove**. The list is one Tab stop; arrow keys select and Delete removes. Empty means every reading of the picked sensor: an overview then shows the reading on the dial and the ones after it in HWiNFO's list. Can be split into named [rotation groups](controls.md#rotation-groups). |
| Reading | **Title on the dial** | Custom title; blank falls back to the reading's own (renamed) label. |
| Reading | **Title when the dial moves on** | **Clears** (default): a custom title clears whenever the dial moves on to another reading, by a turn, a press or touch set to step, a Control key or the auto cycle; picking a reading in the settings panel keeps it. **Stays for this dial** keeps it as a fixed title. |
| Display | **Text color** | **Default** (follows the shared Text color and names it, for example *Theme text (shared)*), **Theme text**, **Dimmed**, or **Custom color** with an exact color. See [Themes](themes.md#text-theme-dim-or-custom). |
| Display | **Background** | **Default** follows the shared **Background** and names it (*Theme (shared)* until you change it). **Theme** fills the dial's part of the touch strip with the theme's background. **Glass**, **Tint**, **Outline** and **Clear** show the touch strip picture set in the Stream Deck app behind the dial. See [Transparent background](#transparent-background). **Stars**, **Dusk** and **Nebula** draw a picture of the plugin's own across the deck ([Deck backgrounds](themes.md#deck-backgrounds-stars-dusk-and-nebula)). |
| Display | **Words in the accent color** | Glass, Tint and Outline only: the title and the selected row's name take the accent color, and units, statistics and other names move halfway to it. **Default** follows the shared **Words in the accent color** (*Off (shared)* until you change it); **On** and **Off** are this dial's own. See [Transparent background](#transparent-background). |
| Display | **Stars** / **Sky color** | **Stars**, **Dusk** and **Nebula** only, under Background: **Stars** (All, Few or Off; the Stars look always draws at least Few) and **Sky color** (Theme, Deep, Warmer, Cooler or Mono). Each starts on the shared choice, for example *All (shared)* and *Theme (shared)*. See [Deck backgrounds](themes.md#deck-backgrounds-stars-dusk-and-nebula). |
| Display | **View** | **One reading** (default), or an [overview](#overview-view) of the rotation list: **Overview, two rows (big values and trend)** or **Overview, three rows**. |
| Display | **Time window** | Two-row overview only: **Recent samples** (default) spaces each row's last 36 readings evenly; **1 minute**, **5 minutes** or **15 minutes** draws that span of time on each row. See [Time window on the two-row view](#time-window-on-the-two-row-view). |
| Display | **Decimals** | Auto (magnitude-based; compacts large values through k/M/G/T, e.g. `48.7M`) or a fixed 0–3. Byte and rate units re-tier under the shared **Data units** preference instead. |
| Display | **Unit and decimals per reading** | *New in 1.8.* One row per reading the dial can show (the rotation set, else the picked reading's sensor, the reading on the dial first), so the list stays put while the dial turns. A sensor of more than 8 readings lists its first 8 and every reading with its own format, and **Show all** under the list shows the rest. Each row sets a fixed unit for byte readings and the reading's own decimals, on every view, its low and high included. On a dial that is part of a running strip, the rows are the strip's readings and set the strip's own (see [Strip Display](strip-display.md#unit-and-decimals-per-reading)); the dial's own stay saved for when it leaves. See [Unit and decimals per reading](sensor-reading.md#unit-and-decimals-per-reading). |
| Display | **°F** (under Temperature) | Temperatures in °F instead of °C. |
| Display | **Row labels** | Overview only: shorten shared words into the context line (default), or **Always full labels**. |
| Display | **Context line** | Three-row overview only: the shared name and session stats line sits above the rows (default) or below them. |
| Display | **Separators** | Three-row overview only: thin lines between rows (default), or none. |
| Display | **Color numbers by sensor type** | Overviews only: opt into automatic category colors for normal numbers. Off by default. See [Reading colors](#reading-colors). |
| Display | **Reading colors** | Overviews only: choose a preset or individual number colors, with **Auto** to reset a reading. See [Reading colors](#reading-colors). |
| Display | **Bar from** / **Bar to** | One-reading view only (hidden on the overviews): fixed ends of the range bar, in HWiNFO's unit for the reading like **Warn at**, even when the dial shows another. Leave blank to follow the session low and high. |
| Alerts | **Warn at** / **Critical at** | Values at which the bar fill (or an overview row's value) turns amber or red. Use the displayed temperature unit; byte and rate values use HWiNFO's original unit before Data units, or a fixed unit, changes what the dial shows. The title line says what is set, e.g. *Warn ≥ 80 °C · °C readings only*. |
| Alerts | **Alert when the value drops to or below these numbers** | Flips the comparison: for fan RPM, clocks and other where-lower-is-worse readings. |
| Alerts | **Auto cycle jumps to a critical reading** | Makes the auto cycle alert-aware: it jumps to a critical member of the rotation instead of waiting its turn, and holds there while the reading stays critical. Off by default. |
| Controls | **Gestures** | **Legacy** (default), **Elite** or **Custom**. Under it the panel lists what each gesture does on this dial now. Custom adds one command per gesture (**Turn**, **Pressed turn**, **Short push**, **Long push**, **Touch tap**, **Long touch**). See [Dial controls & presets](controls.md). |
| Controls | **Touch zones** | Elite and Custom only: split the strip into previous and next, optionally with a center tap. Off by default. |
| Controls | **Ignore turns** | Disables rotation for bump protection. |
| Controls | **Auto cycle** | Timer that steps through the rotation automatically, every 5 seconds to every 5 minutes. Off by default. |
| Controls | **A stats reset clears** | **This reading only** (default), **The whole rotation set**, or **Every dial, everywhere**. |
| Controls | **Link ID** | The name HWiNFO Control keys target to steer this dial. |
{: .reference-table }

The Controls title line reads the dial's resolved gesture map, so a Touch tap made dead by two touch zones is not listed as if it worked.

Thresholds and the manual bar range are **unit-scoped**: they only apply to readings in the unit they were typed against, so a °C threshold can never misfire on an RPM reading you rotate to. Details on the [controls page](controls.md#thresholds-and-mixed-units).

### Bar range: fixed vs. session

By default (both fields blank) the bar spans the **session low → high**, so the fill grows as new extremes appear and always uses the full width of the range you've actually seen. Set **Bar from** / **Bar to** (Display) to pin the bar to a fixed scale instead (e.g. `0` and `100` for a usage percentage, or `30` and `90` for a CPU temperature) so the fill position means the same thing every time you glance at it. You can set just one end; the other stays automatic.

With **Warn at** or **Critical at** set, the bar's track also marks the threshold zones in muted amber and red, escalating toward the alarmed end (the low side when alerts fire on a drop), the same zones a key's [Bar or Ring display](sensor-reading.md#display-sparkline-bar-ring) draws, and an automatic range widens just enough to keep them visible. A manual Bar from / Bar to is never widened; zones outside it are simply clipped. The zones are fixed landmarks; the **fill** is the live value, at full strength (accent normally, amber/red while alerting) so it always reads over them.

## Alerts on a dial

Dials take the same **Warn at** / **Critical at** thresholds as keys, compared against the **live** value. But the alert shows differently, and differently per view: on the single view only the **range bar's fill** flips to the alert color (amber for warn, red for critical) while the label, value and rest of the face stay in your chosen theme; the two [overview](#overview-view) layouts have no range bar, so there the alerting row's **value text** carries the color instead.

Since 1.7, overview alert values adjust for contrast against the row background. Alerts take priority over individual reading colors and a custom text color. See [Themes & alerts](themes.md).

> **Note:** The single view has no sparkline; its range bar is the at-a-glance indicator there. The two-row [overview](#overview-view) draws real sparklines for its visible readings.

## Status screens

When HWiNFO isn't delivering data, the touchscreen shows a short two-line message instead of a reading:

| Touchscreen | Meaning / fix |
| --- | --- |
| **Start HWiNFO** / not detected | HWiNFO isn't publishing to the selected data source (in Auto, to neither). Start it (Shared Memory Support or Gadget reporting), or check **Data source**. |
| **Source busy** / retrying | The sensor source was busy or changed during a read. The plugin retries automatically on the next poll. |
| **Shared Memory off** / enable in HWiNFO | HWiNFO reports sharing disabled. Re-enable it. Auto can switch to Gadget when Gadget reporting is on; saved readings need [explicit links](data-sources.md#link-readings-across-providers) to work there. |
| **Not updating** / check sharing | No new Shared Memory measurement evidence has been observed within the grace period. Check HWiNFO and Shared Memory Support; a busy connection can also prevent reads. |
| **Age unknown** / check Gadget | Gadget has no producer timestamp. Before the first observed value change, or after 15 seconds without another, the plugin cannot tell whether the source is steady or stopped. Check HWiNFO and Gadget reporting. |
| **Tick sensors** / in Gadget | The Gadget registry is present but has no readable sensor rows. In HWiNFO, open Configure Sensors and the HWiNFO Gadget tab; check Enable reporting to Gadget and tick the readings you need. |
| **Access denied** / open settings | Windows denied access needed to read the sensor source; the error does not identify which access rule failed. Open settings and choose **Copy support report** for support. Review the Windows account, session and privilege settings of HWiNFO and Stream Deck. |
| **Source error** / open settings | The sensor source could not be opened or validated. In Auto mode a Gadget failure shows this only while Shared Memory is not running. Open settings and choose **Copy support report** for support. |
| **Bridge failed** / reinstall it | The native HWiNFO bridge (`bin/hwsm.node`) could not load. Reinstall the plugin from its release package, then restart it. Keep any Windows or security-software report for support. |

Before you've picked a sensor, the dial shows **Pick a sensor** / **rotate to pick** with the hint *or use the settings panel*. If a saved sensor is no longer in HWiNFO's output, it shows **Sensor missing** / **waiting** with the hint *reselect in settings*, and turns are ignored so your saved pick survives the outage; reselect in settings if the sensor is gone for good.

## Advanced (shared by all keys and dials)

**Shared defaults** and **Connection** affect every HWiNFO key and dial. They are documented in [Themes](themes.md), [Data sources](data-sources.md) and the key's [Advanced reference](sensor-reading.md#advanced-shared-by-all-keys-and-dials).

**Reading links** and **Calculated readings** are described in [Data sources](data-sources.md).

**Support** contains **Copy support report**. **Configuration documents** can copy or replace **This dial's settings** or **Shared settings**. Replacing shared settings asks for a second press because it changes all keys and dials.

<a class="image-link" data-image-viewer href="{{ '/assets/img/pi-live-dial-advanced.png' | relative_url }}" aria-label="Enlarge image"><img src="{{ '/assets/img/pi-live-dial-advanced.png' | relative_url }}" width="800" height="3566" loading="lazy" decoding="async" alt="The dial&#x27;s Advanced section at the panel&#x27;s real width with its six groups open: Shared defaults (marked All keys and dials) with Theme, Text color, Background, Text font, Accent colors and Data units; Connection (marked All keys and dials) with Data source, Read every, the reading-links note and the folded HWiNFO setup steps; Reading links (marked All keys and dials) with Reading to link on CPU (Tctl/Tdie) live on Shared Memory, Look on Gadget, the other source&#x27;s filter and Link; Calculated readings (marked All keys and dials) with New calculated reading; Support with the Copy support report button; and Configuration documents with the This dial&#x27;s settings and Shared settings wells, their Copy buttons and the Replace this dial&#x27;s settings and Replace shared settings buttons."></a>
