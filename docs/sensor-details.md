---
title: Sensor details (drill-down)
nav_order: 4.5
---

A Sensor Reading key can open a full page of related readings: press the CPU temperature key and the deck switches to a detail view listing every reading of that CPU sensor, with the key you pressed staying live as the Back tile. This is the drill-down asked for in [issue #5](https://github.com/slawrensen/hwinfo-streamdeck/issues/5).

## What it is (and is not)

The detail view is a **plugin-managed profile**, not a native Stream Deck folder. The Stream Deck SDK does not let a plugin place keys inside a user's folders or profiles, so the plugin ships one editable, one-page profile per supported deck type ("HWiNFO Details" in the app's profile list) and switches to it on demand. Pressing Back asks the Stream Deck app to return to the profile you came from.

Practical consequences:

- The first time you open details on a deck, the Stream Deck app asks to install that deck's detail profile. Accept once; later entries switch silently.
- The page is a normal, editable profile, but it ships with every cell already filled: reading tiles, the Back tile, the title and the pagers. Adding a key of your own means replacing one of those, not filling a gap. The plugin never repairs or overwrites what you change. The shipped page holds no data of yours: every tile asks the plugin what to show at runtime.
- What you change on that page is shared. There is one detail page per deck type, so a key you add, or a tile you replace, appears on every drill-down you open on that deck no matter which key you pressed. What still follows the key you pressed is the live content: the reading tiles, the title, the pager range and, until you pick a sensor for it, the Back tile's face.
- To get the shipped page back, delete the profile under Preferences, Profiles in the Stream Deck app, then open a drill-down again and accept the install. There is no reset inside the plugin, because a plugin cannot edit or repair a profile you already have installed.
- If what you want is a page you lay out yourself, with your own multi-reading keys on it, make a Stream Deck folder instead: right-click a key in the Stream Deck app and choose Create Folder. That is the app's own feature, not this plugin's, and unlike the detail page it belongs to that one key. The trade is that a folder's opener key shows a static icon, while a drill-down key shows a live reading.
- The Stream Deck app never updates a profile that is already installed. When a plugin update changes the page itself, it ships as a new profile revision under a new internal identity, the next drill-down asks once to install it, and the previously installed copy stays untouched in your profile list. Upgrading from a preview works that way, but the release name is "HWiNFO Details" again: remove the preview's detail profiles first, or the new one installs alongside them as "HWiNFO Details copy".
- Back returns you to the profile you came from. After a full Stream Deck app restart the app's own notion of "previous profile" resets, so where Back lands then (or whether it moves at all) is the app's restore behavior, not stored state in this plugin; if it does nothing, switch profiles from the Stream Deck app once and re-enter.

## Turning it on

Open **Press** in the key's settings:

- **Press does**: choose **Open sensor details**, or **Tap cycles; hold opens details** to keep stat cycling on a tap and open details after a half-second hold. The default cycles current / min / max / avg.
- **Detail contains**: choose the source, a custom list, or a filter as described below.
- **Tile shows**: one reading per tile by default, or two stacked readings, three rows or a four-cell grid. A press cycles all readings on that tile together. The last tile uses as many readings as remain. Quad labels shorten shared words, so Core 0 through Core 3 VID can read 0, 1, 2, 3.
- **Detail title**: replace the default source name, filter pattern or Custom set title.
- **Repeat Back under this key's own cell**: enabled by default. Untick it to keep only the movable Back tile.

![The Press settings with Open sensor details, All readings from this sensor source, one reading per tile, and Repeat Back under this key's own cell enabled.]({{ '/assets/img/detail-press-panel.png' | relative_url }})

### Choosing the list

**All readings from this sensor source** lists the source's other published readings in HWiNFO's order. The opener's reading appears on Back and is excluded from the list and its count.

**Custom sensor list** uses the readings and order you choose. It also supports individual tile sizes, labels and colors. The list shows one tile per measurement: two saved keys that resolve to the same reading through a confirmed source link or a legacy Gadget alias share one tile, and a key that resolves to the opener's own reading is left to the Back tile.

**Readings matching a filter** matches the combined source name and reading label across the current source. Matches update each poll. The panel shows a match count, and the pattern becomes the title unless you set one. See [Filter patterns](#filter-patterns) for examples.

### Editing custom tiles

The custom-list editor lets you mix tile sizes and formatting:

- Click a tile's size to cycle through one to four readings. Set cell labels, quad colors or a quad's labels-on/off option. Ungrouped readings use **Tile shows**.
- The arrows and drags within a tile reorder readings through the existing tile pattern. Dragging a reading to another tile shrinks the source tile and grows the destination. The blue caret marks the insertion point. A full four-reading tile cannot accept another cell; the reading becomes its own tile beside it.
- Labels and colors move with the reading, including default quad colors. Automatic colors keep adjusting for the theme; moving a reading does not turn them into a chosen color. Other readings keep their colors. If two readings end up with the same color, change one using its color control.
- Removing a reading shrinks its tile without pulling a reading from the next tile. Use the tile's plus to add another. Resizing or shrinking a tile created by **Tile shows** saves it as an explicit group.

Source and filter lists update with HWiNFO and do not support these fixed tile groups.

![The custom-list editor with three tiles containing two, four and one readings, plus size controls, labels, colors, move arrows, remove buttons and add controls.]({{ '/assets/img/detail-custom-tiles-panel.png' | relative_url }})

Keys without a saved **Press does** choice continue to cycle statistics.

## The detail page

![A 15-key detail page rendered by the plugin from live HWiNFO data, with Repeat Back under this key's own cell unticked by hand so the page holds one Back only: the CPU temperature opener as the top-left Back tile with a small return arrow in its lower-left corner, a title tile reading CPU number 0 AMD Ryzen 9 9950X over the range 1-11 of 71, a dimmed Previous chevron, a bright Next chevron, and eleven live CPU temperature tiles, one of them badged MAX.]({{ '/assets/img/detail-view.png' | relative_url }})

Every detail page has these controls:

- **Back** (always top left, where the native folder back key lives): a real Sensor Reading key whose press is fixed to leaving the view; a small return arrow in the tile's lower-left corner marks it. Fresh from install it shows the sensor you drilled down from, live, with that key's theme, text, units, decimals and thresholds. It stays pressable when HWiNFO is down, when the sensor is missing, and even right after a plugin restart.
- **A second Back under your finger, on by default.** When the opener key's cell maps onto a reading cell of the page, that cell becomes a second Back tile showing the same opener face with the return arrow: tap in, tap out, without moving your hand. The readings flow around it (none are hidden). Untick **Repeat Back under this key's own cell** on the opener to keep one movable Back only, the way the 1.5.0 releases shipped it after [issue #5](https://github.com/slawrensen/hwinfo-streamdeck/issues/5) testing; from 1.6.0 the same-finger exit is the default again, and the top-left Back always works regardless.
- **Title** (all decks except the Mini): the source or custom title over the visible range, like `CPU Enhanced` over `1-11 / 46`.
- **Previous / Next**: page through long lists. The chevron dims at either end. Paging happens inside the one profile page; nothing stacks.
- **Reading tiles**: live readings, themed like the opener. At the default one reading per tile, each tile carries the type accent of its own reading; a denser tile (**Tile shows**) carries its first reading's accent, the same rule the regular stacked, row and quad layouts follow for their first sensor. Pressing a tile cycles current / min / max / avg for everything on it, for this visit; leaving the view resets those. Reading tiles deliberately do not inherit the opener's thresholds: an 80 °C warn level means nothing on a wattage or clock tile. The Back tile keeps its own.
- **No sparklines on reading tiles.** Use a Sensor Reading key for recent history. In the **unreleased 1.7 candidate**, Gadget provides current values only; a detail tile set to MIN, MAX or AVG shows **N/A** with an empty value.

![The same 15-key detail page at the default, with the second Back on: the CPU temperature opener appears twice with the return arrow in its corner, once on the top-left Back tile and once on the center cell where the key sits, the title range reads 1-10 of 71 instead of 1-11, and the readings flow around the second tile.]({{ '/assets/img/detail-second-back.png' | relative_url }})

With **Tile shows** at four readings per tile the same page carries 40 readings: ten quad tiles around the two Back tiles, each cell with a short label, the title counting readings rather than tiles, and one tile showing the MAX badge after a press.

![The same 15-key detail page with Tile shows set to four readings per tile: the CPU temperature opener on the top-left Back tile and again on the center cell as the second Back, the title reading CPU number 0 AMD Ryzen 9 9950X over the range 1-40 of 71, and ten quad tiles each carrying four live CPU readings with short per-cell labels such as CPU, CORE, L3 and VDDC, one of them badged MAX.]({{ '/assets/img/detail-dense-view.png' | relative_url }})

A hand-grouped custom list mixes sizes on one page: here a single, a stacked pair with its own cell labels, a three-row tile, a quad with chosen cell colors, a bare-values quad, and the rest of the list flowing on at two per tile.

![A 15-key detail page for a hand-grouped custom list titled Mixed bench over the range 1-24 of 24: a single CPU package power tile, a stacked pair labelled Load and GPU with a MAX badge, a three-row tile of GPU hot spot, CPU fan and pump readings, a quad with blue, red, green and yellow cell labels, a bare-values quad showing four color-coded temperatures without labels, five two-reading tiles of CCD core temperatures, and the CPU temperature opener on the top-left Back tile and again on the center cell.]({{ '/assets/img/detail-mixed-view.png' | relative_url }})

If HWiNFO stops publishing while the view is open, the tiles show the same status screens as ordinary keys and recover on their own; Back keeps working throughout. If a listed reading disappears (custom mode), its tile shows **Sensor missing** in place, and the others do not shift.

## Configuring the Back tile

The Back tile is an ordinary Sensor Reading key with one fixed job. Select it in the Stream Deck app and its settings panel opens with everything a normal key has: the sensor picker, label, Show stat, decimals, units, theme, custom text, warn and critical thresholds, the Display strip, and the single, dual, triple and quad layouts. Two things differ, both stated in the panel:

- Pressing it always returns to the previous profile. There is no Press section on this tile, and the return arrow stays visible on every layout (it sits in a small gap on the divider in the dual, triple and quad layouts).
- Until you pick a sensor, the tile shows the sensor you drilled down from, so a fresh page needs no setup. Once you pick one, the tile shows your pick, and a missing pick shows **Sensor missing** like any key would.

Copying the Back tile elsewhere copies the fixed role with it: a pasted copy still returns to the previous profile when pressed. For an ordinary key, add a fresh Sensor Reading from the actions list instead.

## Filter patterns

The filter is a glob, not a regex: `*` spans anything, `?` matches exactly one character, everything else is literal, and case never matters. Every reading is tested against one string: the source name, a single space, then the label. For the 4090's first fan that text is `dGPU [#0]: NVIDIA GeForce RTX 4090 GPU Fan1` (the middle of the source name is shortened here), which is why one pattern can select by card, by quantity, or across every source at once, and why anchored patterns must account for the source name at the front. Three rules cover all of it:

1. **Plain text matches anywhere.** A pattern with no wildcard behaves as if wrapped in `*...*`, so `4090` and `*4090*` are the same filter.
2. **One wildcard anchors the whole pattern.** The moment a pattern contains `*` or `?`, the automatic wrapping is off and the pattern must cover the entire combined text. `core*clock` matches nothing, because the text starts with the source name, not with "core"; `*core*clock*` is the form you want.
3. **Spaces are literal.** Multi-word plain text works only when the words sit adjacent in the name: `gpu fan` finds the GPU fans, but `core clock` finds nothing because the cores are named `Core 0 Clock`. Span the gap with a star: `*core*clock*`.

![The Press section of the settings panel with Detail contains set to Readings matching a filter: the Filter field holds the pattern star 4090 star, and a live hint under it reads Matches 79 readings right now, above the help text, the Tile shows select, the Detail title field and a Second Back checkbox unticked by hand.]({{ '/assets/img/detail-filter-panel.png' | relative_url }})

Patterns I run on my own bench (512 readings across 21 sources), with their live match counts:

| Pattern | Matches | What it gathers |
| --- | ---: | --- |
| `4090` | 79 | the whole RTX 4090, selected by its source name |
| `gpu fan` | 4 | the card's fan readings (adjacent words, no wildcard needed) |
| `*core*clock*` | 48 | every per-core clock on the CPU |
| `*hot*spot*` | 2 | the CPU IOD hotspot and the GPU hot spot, across sources |
| `tdie` | 3 | the Tdie temperatures, case-insensitive |
| `*12v*` | 8 | every 12 V rail on the board and the PSU |
| `*temperature*` | 18 | everything HWiNFO literally labels a temperature |
| `?PU*` | 270 | sources whose name starts with any one character plus "PU" (anchored start) |
| `*` | everything | all readings, paginated |

Two edges worth knowing: an empty pattern refuses entry with the alert cue (there is nothing to list), and a pattern that matches nothing opens an empty view reading `0 / 0`. Two more: leading and trailing spaces are trimmed (spaces only count inside the pattern), and everything past 128 characters is cut. The panel's live count reflects all of this before you press.

## Supported decks

One bundled profile per deck type. The layouts are generated from one table and validated by tests; reading slots fill left to right, top to bottom around the navigation tiles.

| Deck | Grid | Reading tiles per page |
| --- | --- | --- |
| Stream Deck Mini | 3x2 | 3 (no title tile) |
| Stream Deck (every 15-key revision) | 5x3 | 11 |
| Stream Deck Neo | 4x2 | 4 |
| Stream Deck + | 4x2 keys | 4 (dials stay inert in the view) |
| Stream Deck XL | 8x4 | 28 |
| Stream Deck + XL | 9x4 keys | 32 |
| Virtual Stream Deck | your size | by fit (see below) |

**Tile shows** multiplies those counts without touching the page: the tiles stay put and each carries up to four readings, so a + XL page lists up to 128 readings at once and the paging steps by readings, not tiles. The second Back (on by default) still costs exactly one tile per page.

The Virtual Stream Deck's canvas is whatever size you gave it, so it borrows a layout instead of owning one: entry picks the richest keypad layout that fits its grid. A 10x10 virtual deck runs the + XL layout (32 tiles per page; its baked dial bank is empty, so the page references no dials), a 5x3 one the 15-key layout, down to the Mini layout at 3x2. Below 3x2 there is no room for Back plus the pagers, and entry refuses with the alert cue.

Mobile (variable canvas, no verified install flow), the Studio, the Galleon 100 SD, pedals and G-keys have no bundled detail profile. On those, the key itself keeps working normally; a press configured to open details shows the Stream Deck alert cue instead of switching, and the settings panel says so plainly.

## Privacy

Nothing changes: no telemetry, no network access. The bundled profiles are static layout files; your sensor choices stay in the key's own settings, which the Stream Deck app already saves and exports with your profiles.
