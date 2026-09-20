---
title: Home
nav_order: 1
description: >-
  Live HWiNFO sensor readings on your Elgato Stream Deck.
---

**HWiNFO Sensors** puts temperatures, clocks, fan speeds, usage and power on
your Stream Deck. It reads HWiNFO locally. Windows 10+ x64, free, MIT licensed,
no ads, no telemetry.

![Seven themes, alert states, multi-reading keys and dial views.]({{ '/assets/img/themes-contact-sheet.png' | relative_url }})

*Production renderers with sample readings and generated histories. This is
a layout comparison, not a hardware photograph. The board predates the 1.7
contrast changes.*

> **1.7 is a release candidate.** The current docs describe its reliability
> changes and dial colors. [See what changes for you](whats-new-1.7.md).
> Hardware qualification is still in progress.

## What it does

- **Keys:** one to four readings, custom labels, current or historical values,
  and a sparkline, bar or ring on single-reading keys.
- **Dials:** a single reading or a two- or three-row overview. Rotate through
  readings, use named groups or enable auto-cycle. Local session statistics
  record accepted observations.
- **Colors:** seven themes, per-action or deck-wide text settings, and
  individual reading colors on multi-row dials in 1.7. Alerts take priority.
- **Details:** press a key to open a page for its source, a custom list or a
  filter. Return with the Back tile.
- **Controls:** drive dials from a key or Multi Action. Switch readings,
  pause auto-cycle, pin a reading or reset local statistics.

Shared Memory supplies current values and HWiNFO's MIN/MAX/AVG. Gadget is a
current-value fallback with limited freshness evidence. Saved readings need
[explicit links](data-sources.md#link-readings-across-providers) to work across
the two sources. Read the [source guide](data-sources.md) before relying on
fallback.

## Start here

1. [Install the plugin](installation.md) and enable sharing in HWiNFO.
2. [Add your first reading](getting-started.md) and set its label and alerts.

| Guide | Covers |
| --- | --- |
| [Sensor Reading](sensor-reading.md) | Key layouts, history and press behavior |
| [Sensor details](sensor-details.md) | Detail pages, custom tiles and Back navigation |
| [Sensor Dial](sensor-dial.md) | Dial views, rotation, session statistics and reading colors |
| [Controls](controls.md) | Gesture presets and the HWiNFO Control action |
| [Themes](themes.md) | Themes, text colors and display geometry |
| [Thresholds and alerts](thresholds-alerts.md) | Warning and critical states |
| [Data sources](data-sources.md) | Sharing, fallback, identity and freshness limits |
| [Hardware](hardware.md) | Physically tested devices and simulated coverage |
| [Troubleshooting](troubleshooting.md) | Status messages and fixes |

Requires Stream Deck software 6.9+ and [HWiNFO](https://www.hwinfo.com) running
on the same Windows PC. Not affiliated with or endorsed by REALiX or Elgato.
HWiNFO belongs to REALiX; Stream Deck and Elgato are trademarks of Corsair.
