---
title: Themes & colors
nav_order: 6
---

Seven themes control the background, text, graphs and dividers. Set a theme per key or dial, or use the deck default. **Type accents** color graphs and indicators by sensor category. Alerts take priority over normal colors.

> This page includes changes in the **unreleased 1.7 candidate**. See [what changes from 1.6](whats-new-1.7.md).

## The seven presets

Pick a theme from the live gallery in any key's or dial's settings (the **Theme** row). Every chip previews its real colors.

| Preset | Character |
| --- | --- |
| **Void** *(default)* | Black background (`#000000`), white values. |
| **Graphite** | Dark slate background (`#1A1C22`). The default for installs configured before themes were added. |
| **Ultraviolet** | Dark violet background, lavender accent. |
| **Midnight** | Dark blue background, light blue accent. |
| **Forest** | Dark green background, green accent. |
| **Ember** | Black background, amber text and accent. |
| **Paper** | Light background (`#E9E6DE`), dark text. |

![Earlier production-rendered examples of seven themes, alert palettes, key layouts and dial views, using sample scenarios and generated histories.]({{ '/assets/img/themes-contact-sheet.png' | relative_url }})

*This earlier board predates the 1.7 contrast adjustments. See the [1.7 reading-color examples](sensor-dial.md#reading-colors) for the new dial options.*

> **Note:** New installs start on **Void**. Installs configured before themes were added keep **Graphite** as the deck default. Selecting a theme replaces that default.

## The display system

Each layout uses fixed positions across themes. A one-reading key puts its label on baseline 32, value on 94 and unit on 114. The multi-reading layouts use their own grids. Renderer tests check these positions.

In the 1.7 candidate, built-in value, unit and numeric session-statistic text colors are checked for at least 4.5:1 contrast against their authored backgrounds, and in Dim a label is kept at least as readable as its unit. The floor does not apply to badges, to a Custom Text color, or to individually chosen dial, quad cell and tile colors (a valid Custom Text color replaces those chosen colors while it is set). Physical readability still needs device testing.

The illustrated boards use production renderers with sample scenarios, live inputs and generated histories. They are sample-data renders. Settings-panel captures and hardware photographs are identified separately.

## Per-key vs. deck-wide

Every key and dial has its own **Theme** setting. You can:

- **Set a preset per key/dial**: that key uses exactly that theme, ignoring everything else.
- **Follow the deck default**: the key uses the deck-wide theme.

Set the deck-wide theme under **Advanced → Deck theme** in any key's settings, or under **Dial gestures & advanced → Deck theme** on a dial (it's a global setting; there's one value for the whole plugin).

### Precedence

> **The rule:** a per-key theme always wins. The Advanced *Deck theme* only affects keys and dials set to **Deck default**.

### The "Deck default" chip

The theme gallery leads with a **Deck default** chip, followed by the seven presets. Click it to make that key follow the deck-wide theme instead of pinning a preset.

The Deck default chip previews the resolved theme and identifies itself with:

- a **dashed frame** and a small **link/follow badge**,
- **"auto"** on its face,
- the resolved theme in its tooltip and the help line, e.g. *Deck default · Void* / "currently Void".

![The Theme gallery in the property inspector: the dashed "Deck default" chip with its link badge and "auto" face, followed by the seven preset chips, with the help line under the gallery naming the resolved theme.]({{ '/assets/img/settings-panel.png' | relative_url }})

## Text: Theme, Dim, or Custom

The dark themes use bright near-white values, and Ember uses amber. Both can be too much in a dark room or for light-sensitive eyes, so every key and dial has a **Text** setting directly under its theme gallery, with a deck-wide default under *Advanced → Deck text*:

- **Theme** *(deck-wide default)*: the selected theme's own text colors.
- **Dim**: lower-intensity text. Built-in value, unit and numeric session-statistic colors retain a 4.5:1 authored contrast floor, including on the selected dial row, and labels stay at least as readable as units, so the selected row's name never reads dimmer than its neighbours; the accent bar marks the selection. Individually chosen dial, quad cell and tile colors are dimmed without that adjustment.
- **Custom**: your own color. **Text color** sets it, and the main value uses it **exactly as picked**, never adjusted. **Dim labels, units and stats** decides the secondary text: ticked, labels, units, suffixes and MIN/MAX/AVG badges take the same hue at lower intensity; unticked, every textual element uses the exact color.

Per-key and per-dial settings default to **Deck default**, which follows the deck-wide Text value; a local **Theme**, **Dim** or **Custom** wins over it, mirroring the theme precedence rule. An invalid custom color falls back to theme text.

Automatic quad identity colors adjust for their background when needed. Saved quad cell colors and hand-grouped detail tile colors render exactly in Theme mode and are only dimmed in Dim mode. **Custom** text retains your exact color and can fall below the contrast floor; choose a readable foreground for your theme. Authored contrast does not establish recognition speed on a physical key.

![The Text select under the theme gallery, set to Custom, with the Text color well and the "Dim labels, units and stats" checkbox revealed.]({{ '/assets/img/pi-key-text.png' | relative_url }})

The setting recolors **text only**. Backgrounds, theme and type accents, sparklines, bars, rings, range bars, tracks and separators keep their theme colors, status screens keep their fixed safety colors, and the [alert palettes](#alerts-override-everything) always override it: a warning key is amber with black text whatever Text says, and a dial's alert-colored bar or overview row value is never recolored.

The unreleased 1.7 candidate adds [individual reading colors](sensor-dial.md#reading-colors) to two-row and three-row dials. Use **Text → Theme** for exact chosen hues, or **Dim** to dim them; valid **Custom** Text retains priority. Individual colors work with **Type accents off**, so you can color numbers while keeping your existing graph colors. These controls also appeared in the issue #31 preview and are absent from 1.6.0.

## Type accents

**Type accents** (*Advanced → Type accents*, **on by default**) color the accent on each key and dial by the sensor's type: the sparkline's line and end dot, the Bar and Ring gauge fills, the MIN/MAX/AVG badge in its gap under the title, and on a dial the range bar fill or the overview's selection bar. With default number-color settings, labels, values and units keep their Text styling.

| Sensor type | Accent |
| --- | --- |
| Temperature | Rose (`#FF7E8E`) |
| Fan | Cyan (`#3FBEDD`) |
| Power | Gold (`#D4AB33`) |
| Clock | Green (`#38CD89`) |
| Load / usage | Violet (`#B195FF`) |
| Network | Blue (`#6FA7FF`) |
| Memory | Magenta (`#CE8BE0`) |

Network and memory readings don't have a dedicated HWiNFO type, so they're recognized from the unit (throughput like `MB/s`, `Mbps`) or label (`memory`, `RAM`/`VRAM`). Anything the plugin can't classify keeps the theme's own accent.

Turn type accents **off** (*Advanced → Type accents → "Off (theme accent everywhere)"*) to use the theme's accent color everywhere instead.

> **Note:** **Paper** ignores type accents by design: its accent stays ink so the light theme keeps its high contrast. Switching to Paper effectively disables accents regardless of the toggle.

## Alerts override everything

When a value crosses a threshold (see [Alerts & thresholds](thresholds-alerts.md)), the theme steps aside for a global alert palette:

| Level | Field | Text |
| --- | --- | --- |
| **Warn** | Bright amber (`#E8940D`) | Black |
| **Critical** | Red (`#CB2114`) | White |

On **keys**, the whole face flips: background, label, value, accent and track all recolor from the alert palette. On **dials** (Stream Deck +) the rest of the touchscreen stays themed: in the single view the **range bar fill** changes, and in the two-row and three-row overview views an alerting row's **value** uses a separate foreground hue adjusted for readable contrast.

Whole-key alert palettes remain global; type accents do not replace them. Physical recognition across displays and color-vision differences still requires device testing.

---

Themes and colors are pure display: nothing here is sent anywhere. This is a Windows-only, HWiNFO-dependent plugin with no telemetry (MIT licensed). See [Sensor Reading (keys)](sensor-reading.md) and [Sensor Dial (Stream Deck +)](sensor-dial.md) for where each color lands on the face, and [Alerts & thresholds](thresholds-alerts.md) for the threshold rules that trigger the alert palette.
