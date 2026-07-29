---
title: Sensor details (drill-down)
nav_order: 4.5
---

A Sensor Reading key can open a full page of related readings: press the CPU temperature key and the deck switches to a detail view listing every reading of that CPU sensor, with the key you pressed staying live as the Back tile. This is the drill-down asked for in [issue #5](https://github.com/slawrensen/hwinfo-streamdeck/issues/5).

## What it is (and is not)

The detail view is a **plugin-managed profile**, not a native Stream Deck folder. The Stream Deck SDK does not let a plugin place keys inside a user's folders or profiles, so the plugin ships one read-only, one-page profile per supported deck type and switches to it on demand. Pressing Back asks the Stream Deck app to return to the profile you came from.

Practical consequences:

- The first time you open details on a deck, the Stream Deck app asks to install that deck's detail profile. Accept once; later entries switch silently.
- The detail page's layout is fixed per deck type. You do not edit it in the Stream Deck app (it is marked read-only), and it holds no data of yours: every tile asks the plugin what to show at runtime.
- Back returns you to the profile you came from. After a full Stream Deck app restart the app's own notion of "previous profile" resets; if Back then lands on your default profile rather than the exact page you left long ago, that is the app's restore behavior, not stored state in this plugin.

## Turning it on

In the key's settings panel, under **Press**:

- **Press does** picks the behavior. The default stays exactly as before: cycle current / min / max / avg. **Open sensor details** switches to the detail view on press. **Tap cycles; hold opens details** keeps the cycle on a short tap and opens details after holding half a second.
- **Detail contains** picks the list. **All readings from this sensor source** (the default) lists every reading HWiNFO currently publishes for the pressed sensor's source, in HWiNFO's order. **Custom sensor list** lists exactly the readings you add, in the order you set.
- **Detail title** (custom mode) names the view's title tile.

Existing keys are untouched: a key without a Press setting behaves exactly as it always has.

## The detail page

![A 15-key detail page rendered by the plugin from live HWiNFO data: the CPU temperature opener as the Back tile with a small return arrow top left, a title tile reading CPU number 0 AMD Ryzen 9 9950X over the range 1-11 of 71, a dimmed Previous chevron, a bright Next chevron, and eleven live CPU temperature tiles, one of them badged MAX.]({{ '/assets/img/detail-view.png' | relative_url }})

Every detail page has the same furniture:

- **Back** (always top left, where the native folder back key lives): the opener's own reading as a live tile, with its theme, text, units, decimals and thresholds, plus a small return arrow. Pressing it leaves the view. It stays pressable when HWiNFO is down, when the sensor is missing, and even right after a plugin restart.
- **Title** (all decks except the Mini): the source or custom title over the visible range, like `CPU Enhanced` over `1-11 / 46`.
- **Previous / Next**: page through long lists. The chevron dims at either end. Paging happens inside the one profile page; nothing stacks.
- **Reading tiles**: one live reading each, themed like the opener, with the type accent of their own reading. Pressing a tile cycles that tile's current / min / max / avg for this visit; leaving the view resets those. Reading tiles deliberately do not inherit the opener's thresholds: a 80 °C warn level means nothing on a wattage or clock tile. The Back tile, which is the opener, keeps them.

If HWiNFO stops publishing while the view is open, the tiles show the same status screens as ordinary keys and recover on their own; Back keeps working throughout. If a listed reading disappears (custom mode), its tile shows **Sensor missing** in place, and the others do not shift.

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

The Virtual Stream Deck's canvas is whatever size you gave it, so it borrows a layout instead of owning one: entry picks the richest keypad layout that fits its grid. A 10x10 virtual deck runs the XL layout (28 tiles per page), a 5x3 one the 15-key layout, down to the Mini layout at 3x2. Below 3x2 there is no room for Back plus the pagers, and entry refuses with the alert cue.

Mobile (variable canvas, no verified install flow), the Studio, the Galleon 100 SD, pedals and G-keys have no bundled detail profile. On those, the key itself keeps working normally; a press configured to open details shows the Stream Deck alert cue instead of switching, and the settings panel says so plainly.

## Privacy

Nothing changes: no telemetry, no network access. The bundled profiles are static layout files; your sensor choices stay in the key's own settings, which the Stream Deck app already saves and exports with your profiles.
