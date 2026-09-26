---
title: Themes & colors
nav_order: 6
---

Seven themes control the background, text, graphs and dividers. Set a theme per key or dial, or use the deck default. **Type accents** color graphs and indicators by sensor category. Alerts take priority over normal colors.

> This page describes 1.7. See [what changed from 1.6](whats-new-1.7.md).

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

Since 1.7, built-in value, unit and numeric session-statistic text colors are checked for at least 4.5:1 contrast against their authored backgrounds, and in Dim a label is kept at least as readable as its unit. The floor does not apply to badges, to a Custom Text color, or to individually chosen dial, quad cell and tile colors (a valid Custom Text color replaces those chosen colors while it is set). Physical readability still needs device testing.

The illustrated boards use production renderers with sample scenarios, live inputs and generated histories. They are sample-data renders. Settings-panel captures and hardware photographs are identified separately.

## Per-key vs. shared

Every key and dial has its own **Theme** setting. You can:

- **Set a preset per key/dial**: that key uses exactly that theme, ignoring everything else.
- **Follow the shared default**: the key uses whatever the shared theme is, so changing one setting re-skins the whole wall at once.

Set the shared theme under **Advanced → Shared defaults → Theme** in any key's or dial's settings. It is one value for the whole plugin: every HWiNFO key and dial on every Stream Deck that is set to Default follows it, which is why the panel marks it **All keys and dials**.

### Precedence

> **The rule:** a per-key theme always wins. The shared theme only affects keys and dials set to **Default**.

### The "Default" chip

The theme gallery leads with a **Default** chip (called *Deck default* before this release; the stored setting is unchanged), followed by the seven presets. Click it to make that key follow the shared theme instead of pinning a preset.

Because that chip previews the *resolved* shared theme, it could look identical to the preset it currently follows. To keep it unmistakable, the Default chip:

- wears a **dashed frame** and a small **link/follow badge** (a drawn glyph, not an emoji, so it stays legible on any palette),
- shows **"auto"** on its face instead of a sample value,
- names the resolved theme in its tooltip and in the line under the gallery ("currently Void"), which also links straight to the shared setting.

The folded Display section's summary marks inherited choices too: *Void (shared)* is the shared theme, *Ember* without the mark is this key's own.

So even when the shared theme it follows renders an identical palette, the follow chip is never mistaken for the Void (or any) preset chip.

![The Theme gallery in the property inspector: the dashed "Deck default" chip with its link badge and "auto" face, followed by the seven preset chips, with the help line under the gallery naming the resolved theme.]({{ '/assets/img/settings-panel.png' | relative_url }})

## Text: Theme, Dim, or Custom

The dark themes use bright near-white values, and Ember uses amber. Both can be too much in a dark room or for light-sensitive eyes, so every key and dial has a **Text color** setting directly under its theme gallery, with a shared default under *Advanced → Shared defaults → Text color*:

- **Theme text** *(the default)*: the selected theme's own text colors.
- **Dimmed**: lower-intensity text. Built-in value, unit and numeric session-statistic colors retain a 4.5:1 authored contrast floor, including on the selected dial row, and labels stay at least as readable as units, so the selected row's name never reads dimmer than its neighbours; the accent bar marks the selection. Individually chosen dial, quad cell and tile colors are dimmed without that adjustment.
- **Custom color**: your own color. **Custom text color** sets it, and the main value uses it **exactly as picked**, never adjusted. **Dim labels, units and stats** decides the secondary text: ticked, labels, units, suffixes and MIN/MAX/AVG badges take the same hue at lower intensity; unticked, every textual element uses the exact color.

Per-key and per-dial settings default to **Default**, which follows the shared Text color (the option names it, e.g. *Default (shared: Dimmed)*); a local **Theme text**, **Dimmed** or **Custom color** wins over it, mirroring the theme precedence rule. An invalid custom color falls back to theme text, and the Display summary then says *theme text* rather than naming a color that is not drawn.

Text color and accents are separate on purpose: the numbers take the text color, while graphs, bars, rings and MIN/MAX/AVG badges take the accent ([issue #31](https://github.com/slawrensen/hwinfo-streamdeck/issues/31) asked why numbers stayed white with type accents on). To color the numbers, set Text color to Custom color.

Automatic quad identity colors adjust for their background when needed, including after moving readings in a custom detail list. Individually chosen quad cell and detail tile colors render exactly in Theme mode and are only dimmed in Dim mode. **Custom** text retains your exact color and can fall below the contrast floor; choose a readable foreground for your theme. Authored contrast does not establish recognition speed on a physical key.

![The Text select under the theme gallery, set to Custom, with the Text color well and the "Dim labels, units and stats" checkbox revealed.]({{ '/assets/img/pi-key-text.png' | relative_url }})

The setting recolors **text only**. Backgrounds, theme and type accents, sparklines, bars, rings, range bars, tracks and separators keep their theme colors, status screens keep their fixed safety colors, and the [alert palettes](#alerts-override-everything) always override it: a warning key is amber with black text whatever Text color says, and a dial's alert-colored bar or overview row value is never recolored.

1.7 adds [individual reading colors](sensor-dial.md#reading-colors) to two-row and three-row dials. Use **Text color: Theme text** for exact chosen hues, or **Dimmed** to dim them; a valid **Custom color** retains priority. Individual colors work with **Accent colors: Theme accent everywhere**, so you can color numbers while keeping your existing graph colors. These controls also appeared in the issue #31 preview and are absent from 1.6.0.

## Type accents

**Type accents** (*Advanced → Shared defaults → Accent colors: By sensor type*, **on by default**) color the accent on each key and dial by the sensor's type: the sparkline's line and end dot, the Bar and Ring gauge fills, the MIN/MAX/AVG badge in its gap under the title, and on a dial the range bar fill or the overview's selection bar. With default number-color settings, labels, values and units keep their Text styling.

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

Turn type accents **off** (*Advanced → Shared defaults → Accent colors → "Theme accent everywhere"*) to use the theme's accent color everywhere instead.

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
