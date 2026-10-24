---
title: Themes & colors
nav_order: 6
description: Compare the seven themes and control text, accents and shared defaults.
---

Pick a theme in the strip below a key or dial's settings header. Choose **Default** to follow the shared theme, or a named preset for that key or dial only.

For a see-through touch strip, use **Display → Background** on a dial. [Transparent backgrounds](sensor-dial.md#transparent-background) are available in 1.7.1.

## The seven presets

| Preset | Background and accent |
| --- | --- |
| **Void** | Black, with white values. The default for new installs. |
| **Graphite** | Dark slate (`#1A1C22`). Retained by installs configured before themes were added. |
| **Ultraviolet** | Dark violet with a lavender accent. |
| **Midnight** | Dark blue with a light blue accent. |
| **Forest** | Dark green with a green accent. |
| **Ember** | Black with amber text and accents. |
| **Paper** | Light (`#E9E6DE`) with dark text. |

<div class="image-strip" role="region" tabindex="0" aria-label="Seven theme samples, scroll horizontally to compare">
  <a class="image-link" data-image-viewer href="{{ '/assets/img/themes-contact-sheet.png' | relative_url }}" aria-label="Open the full theme comparison"><picture><source type="image/webp" srcset="{{ '/assets/img/showcase/themes-key-strip.webp' | relative_url }}"><img src="{{ '/assets/img/showcase/themes-key-strip.png' | relative_url }}" width="1072" height="168" loading="lazy" decoding="async" alt="Sample keys in Void, Graphite, Ultraviolet, Midnight, Forest, Ember and Paper, rendered by the plugin."></picture></a>
</div>

*Scroll to compare the seven presets at a readable size. Open the full comparison for layouts and alert states. Sample renderings.*

The layout stays consistent when you change themes. [Individual dial colors](sensor-dial.md#reading-colors) can distinguish readings within the same theme.

## The display system

Built-in value, unit and numeric session-statistic colors have a calculated **4.5:1 contrast floor** against their authored backgrounds. Dimmed labels stay at least as readable as units.

That floor does **not** cover badges, a **Custom color** for text, individually chosen reading/cell/tile colors, or text drawn directly on a picture with **Clear**. For **Glass**, contrast is calculated against the panel over its worst-case picture. **Tint** and **Outline** use the outline behind each word. Physical readability still requires device testing.

Use a readable custom foreground and check it on your display, especially over a bright or busy strip picture. See the [background limits](sensor-dial.md#transparent-background).

## Per-key vs. shared

Set the shared theme in **Advanced → Shared defaults → Theme**. It applies to every HWiNFO key and dial set to **Default**, across all connected decks.

A named preset stays local. This lets you keep one dial in Ember while the rest follow Midnight, for example.

### Precedence

A per-key or per-dial theme wins over the shared theme. Change that key or dial to **Default** to make it follow again.

### The "Default" chip

**Default** follows the shared choice; it is not a separate color palette. Its dashed frame and link mark distinguish it from the preset it currently uses. The theme line says where the colors come from, such as **Default (shared: Void)** or **Ember (set on this key)**.

- **Change** opens the shared Theme setting.
- **Make shared** appears when a local theme differs from the shared one. It makes that theme shared, returns the key or dial to Default, and keeps its appearance.

<a class="image-link" data-image-viewer href="{{ '/assets/img/pi-theme-share.png' | relative_url }}" aria-label="Enlarge image"><img src="{{ '/assets/img/pi-theme-share.png' | relative_url }}" width="800" height="420" loading="lazy" decoding="async" alt="The theme strip with Ember selected and the Make shared command."></a>

*Settings-panel capture.*

Folding the strip keeps the chosen chip and its source visible. A new key with no reading shows the theme after you select one.

## Text: Theme, Dim, or Custom

Set **Display → Text color** for one key or dial, or **Advanced → Shared defaults → Text color** for the shared default.

| Choice | Result |
| --- | --- |
| **Default** | Follows the shared Text color. |
| **Theme text** | Uses the theme's text colors, ignoring a shared Dimmed or Custom choice. |
| **Dimmed** | Lowers text intensity. Built-in values, units and numeric statistics retain the authored contrast floor; individually chosen colors are dimmed without that adjustment. |
| **Custom color** | Uses your exact chosen color. **Dim labels, units and stats** reduces secondary text intensity; untick it to use the exact color throughout. |

A valid Custom color takes priority over individual dial, quad-cell and detail-tile colors. An invalid color falls back to theme text. Alerts take priority over every text choice.

Text and accents are separate. **Text color** changes numbers and labels; graphs, bars, rings and statistic badges keep their accent. To give individual dial numbers different colors, use [Reading colors](sensor-dial.md#reading-colors) with Theme text or Dimmed. A Custom color overrides them.

Automatic quad identity colors adjust for their backgrounds. Individually chosen colors stay exact in Theme mode and are only dimmed in Dim mode, so they can fall below the contrast floor.

<a class="image-link" data-image-viewer href="{{ '/assets/img/pi-key-text.png' | relative_url }}" aria-label="Enlarge image"><img src="{{ '/assets/img/pi-key-text.png' | relative_url }}" width="800" height="354" loading="lazy" decoding="async" alt="Custom color selected, with a color well, hex value and Dim labels, units and stats checkbox."></a>

*Settings-panel capture.*

## Text font

**Advanced → Shared defaults → Text font** changes every Sensor Reading key, Sensor Dial and detail tile:

- **Tahoma**: the default, bold and wide.
- **Segoe UI**: lighter and narrower, leaving more space for long labels.

The HWiNFO Control key keeps its fixed Tahoma icon. The settings header previews the font you choose.

## Type accents

Set **Advanced → Shared defaults → Accent colors → By sensor type** to color graphs and indicators by category. It is on by default. With default number-color settings, labels, values and units keep their Text color.

| Sensor type | Accent |
| --- | --- |
| Temperature | Rose (`#FF7E8E`) |
| Fan | Cyan (`#3FBEDD`) |
| Power | Gold (`#D4AB33`) |
| Clock | Green (`#38CD89`) |
| Load / usage | Violet (`#B195FF`) |
| Network | Blue (`#6FA7FF`) |
| Memory | Magenta (`#CE8BE0`) |

Network and memory are classified from units or labels. Unknown categories keep the theme's accent. **Theme accent everywhere** disables category accents.

**Paper always keeps its dark ink accent** (`#3B382E`), regardless of Accent colors.

## Alerts override everything

Set **Warn at** or **Critical at** in the Alerts section. The [threshold guide](thresholds-alerts.md) explains units, direction and examples.

| Level | Key background | Key text |
| --- | --- | --- |
| Warning | Amber (`#E8940D`) | Black |
| Critical | Red (`#CB2114`) | White |

Keys recolor the whole face. A single-reading dial changes its range-bar fill; an overview dial changes the alerting row's value. The rest of the dial keeps its theme. Overview alert foregrounds adjust for contrast against the row background.

Custom text and type accents do not replace alert colors. Physical recognition across displays and color-vision differences has not been established.
