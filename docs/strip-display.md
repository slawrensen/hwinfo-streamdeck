---
title: Strip display
nav_order: 5.2
description: Join Sensor Dials into one graph across the touch strip, or two graphs side by side.
---

A **strip display** joins the Sensor Dials of a Stream Deck + or + XL into one graph across the touch strip. Each dial keeps its own reading and settings for when it leaves the strip.

<a class="image-link" data-image-viewer href="{{ '/assets/img/deck-plus-1.8.png' | relative_url }}" aria-label="Enlarge image"><img src="{{ '/assets/img/deck-plus-1.8.png' | relative_url }}" width="1600" height="960" loading="lazy" decoding="async" alt="A Stream Deck + with eight Sensor Reading keys and, across the whole touch strip under them, one Trend graph of CPU and GPU temperature over five minutes: both lines rise during a load and fall back. Keys and strip are on Tint over a blue to violet to orange gradient."></a>

*Production-rendered fixed sample data, not a device capture: a **Trend** across the four dials of a Stream Deck +, with every key and the strip on **Tint** over a gradient drawn for the picture.*

> **New in 1.8.** A whole strip has run on my Stream Deck + XL since 2026-10-25. An equal split and the Stream Deck + have run on simulated decks only. [Hardware](hardware.md) says what is still unmeasured.

## Make a strip

1. In the Stream Deck app, drag a **Sensor Dial** from the HWiNFO Sensors list onto each dial of the deck.
2. Open any of them. **Strip** lists the screens this PC's sensors can fill, each ticked. Untick what you do not want.
3. Press **Make the strip**.

Every change under **Strip** then saves at once. **Whole strip** shows the same list with a preview of what it makes.

While a slot still needs a Sensor Dial or a dial is in another strip, **Strip** shows no list. Choose **Whole strip** to see it: **Make the strip** waits, the reason sits above the list, and the [row of circles](#missing-dials-and-leaving) marks the dial.

The list's first words, **Screens for this PC**, are a dropdown. **One reading only** there swaps the list for a strip of this dial's reading, and **Screens for this PC** brings the list back.

**Equal split** shows two graphs side by side and starts from a [pair](#equal-split-pairs) this PC's sensors fill. The first pair that fits is picked, so **Make the strip** makes it. The dropdown under the preview picks another pair, or **Choose each half** to fill the halves yourself.

**Independent dials** is the default: each dial shows its own reading. A **Whole strip** is 800 by 100 on a Stream Deck + and 1200 by 100 on a + XL; each half of an **Equal split** is half that.

### Build screens

**Build screens** proposes up to seven screens from this PC's sensors, found by sensor type and by words in the sensor and reading names. It skips any it cannot fill, any already on the strip, and any past the [Group history share](#group).

- **CPU**: Lanes of its temperature, usage and power (Trend with one of them).
- **CPU cores**: Group [Tiles](#tiles) of every thread's usage (filter `*core * t? usage`), with four or more threads.
- **GPU**: Area of its temperature, with **Large values on the left**.
- **CPU and GPU**: Compare of the two temperatures, when they share one unit.
- **Cooling**: a meter per fan or pump, or Group **Now** when they outnumber the dials.
- **Core clocks**: Group **Rows** of each core's clock, with four or more cores.
- **Every temperature**: Ambient of every °C reading.

Each row of the list is one line. A row too long for the panel is cut short, and hovering it shows the whole row.

On a running strip **Build screens** sits beside **Add a screen**, or under **Edit** with two or more screens. **Use these screens** adds the ones ticked, up to eight screens in all. An Equal split has no **Build screens**.

### Equal split pairs

An Equal split offers each pair only when this PC's sensors fill both halves, in this order:

- **CPU and RAM usage**: a Meters **Liquid** of HWiNFO's **Total CPU Usage**, named **CPU usage**, and of **Physical Memory Load**, named **RAM usage**, each in whole percents. A reading that already has its own decimals on the strip keeps them.
- **CPU and GPU**: each temperature in Area, with **Large values on the left**.
- **Temperature and load**: a Compare of the CPU and GPU temperatures, and a Compare of the CPU's usage and that GPU's load.
- **CPU and cooling**: Lanes of the CPU's temperature, usage and power (Trend with one of them), and a meter per fan or pump, or Group **Now** when they outnumber the half's dials.

With no pair, the split starts as before: this dial's reading on the left and an empty right half.

On a running Equal split, **Fill both halves** at the end of the line under the preview offers the pairs the split does not draw yet (with one pair, a **Fill:** link names it). A pair you pick shows in the preview only, and **Cancel** leaves the strip as it is. **Use** puts it on both halves in one change. When a half holds something you made (a graph you built or changed, a name, a **Build screens** screen), **Use** first names that half and asks: **Replace** changes it and **Cancel** keeps it. The pair goes on with no question over an empty half, over both halves as **Fill** left them, and over a left half that is still the strip's start (the reading the strip was made with, alone in Trend, until you change that half's readings). The left half is also the Whole strip's first screen, so the question says when that changes; the Whole strip's other screens stay as they are. **Replace** has no undo.

## What each graph is for

| Graph | Readings | Use it for |
| --- | --- | --- |
| **Trend** | 1 to 3 | A reading over time: a large line for the first, thinner lines for the others. |
| **Area** | 1 to 3 | Trend with a light fill under the highlighted reading. |
| **Compare** | 2 to 4, one unit | Readings against each other on one labeled scale. |
| **Lanes** | 2 or 3 | Readings of different units, one stacked lane and scale each. |
| **Heat** | 1 | One reading as colored time bins. A bin past a limit gets a cap in its alert color. |
| [**Group**](#group) | Up to 32, one unit | Every reading of a folder, a filter or a list, picked by a rule. |
| [**Ambient**](#ambient) | Up to 48, any units | Many readings as colored lines, with no numbers or scale. |
| [**Meters**](#meters-and-events) | One per dial | Current values in large digits, each with a bar against its limits. |
| [**Events**](#meters-and-events) | 1 to 4, Yes/No or with alert bands | When a Yes/No reading said Yes or a reading passed a limit. |

<a class="image-link" data-image-viewer href="{{ '/assets/img/strip-graphs-1.8.png' | relative_url }}" aria-label="Enlarge image"><img src="{{ '/assets/img/strip-graphs-1.8.png' | relative_url }}" width="1920" height="2536" loading="lazy" decoding="async" alt="Eleven whole Stream Deck + XL strips, one under the other, each named: Trend with two temperature lines; Area with one filled line; Compare with three temperatures on one scale; Lanes with a temperature, a load and a power reading in three lanes; Heat as colored time bins with an amber cap where the reading passed its warn limit; Group with one large value and eight thin lines; Group in its Tiles view with sixteen small graphs; Ambient as many colored lines; Meters with six large values and bars; Events with amber bars where a Yes/No reading said Yes; and an Equal split with a Liquid meter of CPU usage in one half and memory usage in the other."></a>

*Production-rendered fixed sample data on the Void theme, not device captures. The last row is an [Equal split](#equal-split-pairs).*

Tick readings in the order you want them drawn. A graph keeps up to six readings and each style draws the first ones up to its limit; a reading past that stays saved and its row says **not drawn in Trend** (for example). The **Graph** list offers only styles that can draw every ticked reading. A Compare saved with several units still draws them, and says so. A reading the plugin's history memory has no room for says **no history room**.

The graph takes the strip's full height. On a Trend, Area, Compare or Heat graph, the names, the current value, the window's words and **LIVE** or **PAUSED** draw over it at 15 to 24 px, smaller where room is short. Every word has a 1 px outline, and on **Glass**, **Tint**, **Outline** and **Clear** a small tab stands behind each left scale number and the window's words.

### Scale

An automatic scale spans at least 5 °C, 200 MHz or 0.05 V, or 2 % of the reading. It starts at zero for power, fan speed, current, frame rate, frame time and data, and runs 0 to 100 for a percentage and 0 to 1 for a Yes/No reading. It grows at once when a reading leaves it and narrows once the readings have fit in half of it for 10 seconds.

**Scale from** and **Scale to** fix either end for readings in the unit shown beside them (for a byte reading, HWiNFO's unit), exactly as typed. A blank end follows the readings. A later **°F** switch converts a typed end, and a reading past it colors it.

Readings in more than one unit on a Trend, Area or Compare graph draw in stacked bands, one per unit.

### Readout

**Readout** shows current values in large digits. Group, Ambient, Meters and Events do not offer it.

- **Large values on the left**: the first dial slot shows the values, and the graph takes the rest of the width.
- **Large values only**: no graph, so the **Graph** list goes while it is on. Up to two readings per dial slot draw, spread across the pane. With **Time span** on, each has a line of its window beside its number where the cell leaves room, otherwise under it.

A value that is stale, missing or not a number shows that word instead of digits. A value inside an alert band takes the alert color.

### Show on the graph, bands and looks

**Show on the graph** turns the current value, min and max, the unit, the names, the time span and **Scale and grid** on or off. **Scale and grid** adds round value ticks, time ticks, gridlines and the window's highest and lowest reading. A box the graph draws nothing for is hidden.

**Alert bands** shade a warn and a critical range behind one reading, up to four per graph. Each band is drawn only against the reading it names.

**Background** and **Words in the accent color** work as on a single dial ([Transparent background](sensor-dial.md#transparent-background)), set under **Display**. A new strip follows **Advanced → Shared defaults → Background**.

## Group

**Group** graphs a set of readings, worked out again from HWiNFO's current list on every update. **Readings from** picks the set:

- **The folder of a ticked reading**: every reading of that HWiNFO sensor.
- **Readings matching a filter**: the [detail filter](sensor-details.md#filter-patterns), over the sensor name and reading label together.
- **A custom list**: the readings you tick, up to 128.
- **Every reading in a unit**: every reading in the unit picked in **Unit**.

A Group draws one unit, the one with the most readings, and says how many it left out (**8 in other units left out**). It draws at most 32 and says so (**32 of 48 shown**). A reading HWiNFO stops listing keeps its place and counts as **not found**.

**View** sets how they draw. **Auto** draws a named line each up to 4 readings, a highlighted line over muted lines for 5 to 8, and **Rows** from 9. It never picks **Tiles**.

- **Rows**: a row per reading, time across, on one color scale. A row past a limit has a short bar at its left end, twice as wide for critical.
- **Now**: a bar per reading up to its current value, with limits as lines across. Use it to spot one core below the rest.
- **Spread**: the group's lowest to highest reading at each moment as a band, with its median and the highlighted reading as lines.
- [**Tiles**](#tiles): a small history graph per reading.

On every view but Tiles, with **Current value** on, the first dial slot shows one reading in large digits: the one you highlight, or else the group's highest (its lowest when the limits say lower is worse). **Alert bands** set one warn and critical pair for every reading of the group.

A Group keeps history for the window it shows, from its own share of the plugin's memory (768 KiB, about 106 readings of 5 or 15 minutes), and keeps recording for 16 minutes after the graph leaves the screen. HWiNFO keeps no past readings the plugin can read, so a reading the plugin was not already recording fills in from the right edge. A full share says so (**history full: 28 of 32**).

### Tiles

**Tiles** gives each reading its own small history graph, as Windows Task Manager does for logical processors. Tiles share one scale and one color ramp by height, blue at the bottom to peach at the top. There is no large readout.

Readings HWiNFO labels by core and thread (**Core 3 T1 Usage**) take a column per physical core, thread 0 over thread 1, with P-cores apart from E-cores. Readings that name no core take one tile each.

| Mark | What it shows |
| --- | --- |
| Top left | HWiNFO's core number (**Core 5 T0** over **Core 5 T1** reads 5 over 5), or the name of a reading that names no core (**Names**) |
| Top right | The value (**Current value**). A core's tile shows it while highlighted, past a limit or inspected; a reading that names no core always shows it |
| Border and small tab | The highlighted reading, which the bottom line names (**5 min · Core 5 T1**) |
| Bar along the bottom and an outline | Past a limit from **Alert bands**: 3 px tall for warn, 6 px for critical |
| Dashed and empty | A reading HWiNFO no longer lists |

Words are placed by tile size, labels, dial edges and the scale's widest number, not by the value. A narrow tile shrinks its value, then drops its name, then its value.

## Ambient

**Ambient** draws up to 48 readings, each as a colored line on its own range, with no numbers or scale, so any units can share it. Red-orange is near a reading's highest in the window, through yellow, green and cyan to violet near its lowest.

**Readings from** takes the same choices as Group, and defaults to **Every reading in a unit** in °C. Yes/No readings and readings with no value are left out.

When HWiNFO stops updating the lines dim and the strip says **stale**. It takes history from up to 384 KiB of the Group share (48 readings of 5 or 15 minutes). **Show on the graph**, scale ends and alert bands do not apply. A turn changes the window; a push or touch does nothing.

## Meters and Events

**Meters** spreads the readings in equal cells, up to one per dial the graph spans. Each cell shows the name, the value, a bar from the bottom of its scale to the value and the window's range as a thin band. The scale starts at zero (or below, for a negative reading) and ends at a round number above the readings and limits, at 100 for a percentage, or where **Scale from** and **Scale to** say. A limit is a tick in its alert color, and the bar past it takes that color. Where every cell has room beside its number (up to four readings on a whole + XL, two on a whole + or half a + XL, one in half a +), the name goes there and, with **Time span** on, a line of the window.

**Look** beside **Graph** sets how Meters draws each reading:

- **Thin bar**: the bar described above.
- **Full bar**: a frame as tall as the strip fills from its left end to the value, ended by a 2 px edge in the reading's full color.
- **Liquid**: the same frame fills from its bottom to a straight surface at the level, its color strongest under the surface and fainter toward the bottom.

With **Full bar** and **Liquid**, the name and the value sit beside the frame, so the fill never runs under a word. The fill and the value take the theme's accent color, or a reading's own color; where that color falls short of 4.5:1 the value takes a shade of it that does. On **Clear** the number takes the theme's value color, as the name and the unit do. A percentage always runs from 0 to 100, whatever **Scale from** and **Scale to** say: when every reading in the pane is a percentage or Yes/No, the two fields go, and beside a reading in another unit they stay for that reading. A value past 100 fills the frame and shows its own number. Another unit takes the Thin bar's scale, and its ends show under the value. Marks inside the frame show 25, 50 and 75 % of the scale and, with **Time span** on, the window's highest reading. A limit is a short mark in its alert color. Past it, the fill beyond the limit takes that color, the frame does too, and a bar runs along the bottom: 3 px for warn, 6 px for critical. The value takes the alert color, as on the Thin bar.

**Events** gives each reading a row. It marks when a Yes/No reading, such as **Thermal Throttling (HTC)**, said Yes, and when a reading with an alert band was past its limit, in the band's color. A warn mark or a Yes is half as tall as a critical mark. A thin line runs along a row only while the reading was watched. The bottom line counts the highlighted reading's events (**3 times past 85.0 °C in 15 min**), and a pressed turn highlights the next reading.

On a strip of one screen, or a half with its own window, choosing Events sets the time window to 15 minutes in the same change; otherwise the window stays as it is. A reading that is not Yes/No and has no alert band has nothing to mark: its row says **no limit**.

## Screens

A **Whole strip** keeps up to eight screens and shows one at a time, each a full strip graph with its own settings. An Equal split draws its two graphs and keeps the screens for when the strip is whole again.

- **Add a screen**, beside **This screen**, adds one after the screen on the strip, as a **Group** of **Readings matching a filter**.
- With two or more screens, **This screen** holds the screen before, a list of names with its place (**3 of 8**), the screen after, and **Edit** (**Rename**, **Earlier**, **Later**, **Remove**, **Add**, **Build screens**). On the list, Left and Right show the screen before or after, Home and End the first or last, Alt with an arrow moves the screen, F2 renames it and Delete twice removes it.
- **The Screens dial**, with two or more screens, is the last dial of the strip (the rightmost one there). Its plain turn moves one screen per detent and stops at the first and the last. Its other gestures still do what the graph does.
- **HWiNFO Control** keys have **Strip: next screen** and **Strip: previous screen** (both wrap) and **Strip: first screen**.
- **Next screen** moves on by itself every 10 seconds, 30 seconds, minute or 5 minutes, or **By hand** (the default). It skips a screen with nothing to draw and waits while you inspect, while the panel of a dial in the strip is open, and while HWiNFO is not running. A turn, push or touch on the strip, or a **Strip** command, starts its wait again.

A thin line along the top edge has a segment for each screen; a screen off the strip with a reading past its critical limit shows dashed in the critical color. After a change the screen's name and place (**Core clocks · 2 of 5**) show for 1.6 seconds.

Moving between screens saves nothing. A screen you come back to within 16 minutes shows its whole window while the history share has room.

## Time windows

A strip graph shows the last **1 minute**, **5 minutes** (the default) or **15 minutes**. In **Equal split** both halves share one window unless you untick **Same window**. Turning a dial changes the window for as long as the plugin runs; the window set in the panel is the saved one.

A reading missed for a moment draws straight across, with no value added. **Brief gaps**, under **Scale and alerts**, sets this for the whole strip: **Connect** (the default), **Connect in color** for a second color, or **Leave gaps**. Anything longer than 2.5 times HWiNFO's scan interval or **Read every**, if longer (at least 5 seconds), stays open in every mode, as does HWiNFO closing, stale data, sleep or a unit change. Ambient and a meter's line always draw straight across, and Heat, Events and Group's **Rows** and **Now** have no line to connect.

## Controls in a strip

A dial in a strip controls the graph it draws (in **Equal split**, the half it sits under). The dial's hints in the Stream Deck app and **How the strip works** in the panel list these gestures.

| Gesture | Live view | Inspecting |
| --- | --- | --- |
| Turn | Time window | Moves the cursor |
| Pressed turn | Highlights the next or previous reading | Same |
| Push | Inspect at the newest data | Back to live |
| Long push | Nothing | Back to live |
| Touch | Inspect the moment under your finger | Moves the cursor there |
| Long touch | Back to live | Back to live |

On a **Whole strip** with two or more screens, the last dial's plain turn moves between screens instead, on every graph, live or inspecting ([Screens](#screens)).

On a Trend, Area or Heat graph of one reading, with no **Scale from** or **Scale to** typed and not a Yes/No reading, a pressed turn widens or narrows the scale for as long as the plugin runs, and a long touch or long push goes back to the automatic scale. The dial's hint ends in **pressed: scale**.

On a **Group** graph a turn picks the reading (past the first, back to the group's highest) and a pressed turn does what a turn does above. A touch on Rows or Now highlights the reading under your finger, and on the first dial slot goes back to the group's highest. A long touch goes back to the group's highest, and to live. On **Tiles** a touch on any dial inspects, a long touch clears the highlight, and a turn past the first reading leaves nothing highlighted.

On a meter, on an Events legend or on large values, a touch inspects the newest moment. Inspecting freezes only the view: the plugin keeps recording, and the strip shows **PAUSED**.

The dial's own gestures, auto cycle, alerts and Link ID wait while it is in a strip. [HWiNFO Control](controls.md) keys reach a strip with the **Strip** commands, by its **Strip Link ID**, which starts as the Link ID of the dial that made the strip.

## Settings on a running strip

While a dial is in a strip, the **Theme** band and **Display**'s **Text color**, **Background**, **Words in the accent color**, **Decimals**, **°F** and **Unit and decimals per reading** set the strip's own, and the dial's own stay saved. **Reading**, **Alerts** and **Controls** step aside until the dial leaves; the sensor list's reload moves to the strip's **Readings** row (beside **Filter** or **Unit** on a screen with no search).

If another dial's panel changed the strip first, your change is not applied and the status line says so. A new strip's choices save nothing until **Make the strip**; the plugin remembers them for ten minutes, so you can open another dial of the deck and find them there.

### Unit and decimals per reading

A strip keeps its own unit and decimals for each of its readings, as a key or a dial does ([Unit and decimals per reading](sensor-reading.md#unit-and-decimals-per-reading)). A new strip starts with its creating dial's. On any dial of the strip, **Display → Unit and decimals per reading** lists the readings of every screen and both halves. A unit picked there applies to every number the strip draws for that reading, the scale included; readings in different fixed units on one scale leave that scale on Auto. **Same as strip** under **Decimals** follows the strip's **Decimals**.

## Missing dials and leaving

A row of circles under the layout choice shows the deck's dials while you make a strip or a dial needs you. The line beside it names one dial and ends in its action (**Dial 3 left the strip**, **Rejoin**); choose a circle to name that dial. A Sensor Dial not in a running strip offers **Add**, and one in another strip offers **Include** while you make a strip and **Move here** on a running one. A dashed circle is a slot that is empty or holds another plugin's action: drag a Sensor Dial there.

A missing dial (taken off the deck, hidden by a dial stack, or on another page) leaves a gap, and the slice next to it says **Dial 3 missing**. The strip draws in full when the dial comes back. A strip comes back by itself when its deck reconnects; a dial removed while the deck was away stays missing. A strip set up for a + XL does not draw on a +, and the other way round: **Use this deck's dials** sets it up for the deck it is on.

Choose **Independent dials** on a dial in a strip and that dial leaves at once; the rest of the strip keeps running and shows the gap. Its panel then offers **Rejoin** and **Every dial leaves** (**Restore the strip** once no other dial is in it). **Rejoin** or **Restore the strip** brings back the newest setup any of its dials holds. A dial off screen when every dial leaves is not changed: the panel says how many, and it comes back in the strip when it shows again.

## Copies and other decks

Each dial carries a full copy of the strip's setup, so a strip travels with an exported or copied profile. A copy on another deck, or a second copy on the same deck, is a separate strip. A dial that receives a different copy asks: **Keep the strip's setup** or **Use this dial's copy**.

One case does not work this way yet. A Sensor Dial copied from a second copy of the profile and pasted onto the page that shows the strip can bring that copy's setup to the whole strip without asking. Nothing is saved until you next change the strip's settings: remove the pasted dial before that, and the strip draws its own setup again. If the pasted copy keeps its own **Background** or **Words in the accent color** from before your last **Use it everywhere**, the strip saves the pasted setup as soon as the dial appears, and removing the dial does not undo it.

## Limits

- Each dial draws its own 200 by 100 slice of the graph, and the app updates the slices one after another, not as one frame. A change can reach one dial a moment before the next.
- The plugin cannot place, move or remove actions. Every slot needs a Sensor Dial you put there.
- The panel's preview shows the layout, not how a particular deck paints it. On a + XL it shows the left half of the strip above the right half.
