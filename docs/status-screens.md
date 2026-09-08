---
title: Status screens
nav_order: 9
---

When a key or dial cannot show a reading, it shows a **status screen** instead of a value. The first line names the observed state; the second gives a next step. Source recovery is automatic when readable data returns. A native bridge load failure can require an installation repair and plugin restart.

> The image below shows earlier renderer output. The tables document the current development candidate's recovery copy; no physical-device capture of the changed text is claimed.

## Key screens

Each key screen is two short lines. The first names the state; the second gives the next step.

![The plugin's status screens rendered as clean OLED-black key faces, each with a two-line message: Start HWiNFO, HWiNFO busy, Shared Memory off, Access denied, Tick sensors in Gadget, Not updating, Pick a sensor, and Sensor missing]({{ '/assets/img/status-screens.png' | relative_url }})

| Key shows | What it means | How to fix it |
| --- | --- | --- |
| **Start HWiNFO** / *not detected* | HWiNFO isn't running, or isn't publishing on either interface. | Start HWiNFO in Sensors-only mode with **Shared Memory Support** enabled; or, on the free version, enable **Gadget reporting** (no 12-hour limit) and tick the sensors you need. |
| **Source busy** / *retrying* | The sensor source was busy or changed during a read. | The plugin retries automatically on the next poll. |
| **Shared Memory** / *is off* | HWiNFO reports Shared Memory Support as disabled. | Re-enable it in HWiNFO **Settings**. On the free version it switches off after 12 hours. In **Auto** mode the plugin also falls back to the Gadget registry on its own; no action strictly required. |
| **Not updating** / *check sharing* | No new Shared Memory measurement evidence has been observed within the grace period. | Check HWiNFO and Shared Memory Support; a busy connection can also prevent reads. |
| **Age unknown** / *check Gadget* | Unchanged Gadget values do not distinguish a steady reading from persistent values left after exit. | Check HWiNFO and Gadget reporting. |
| **Access denied** / *open settings* | Windows denied access needed to read the sensor source; the error does not identify which access rule failed. | Open settings and choose **Copy support report** for support. Review the Windows account, session and privilege settings of HWiNFO and Stream Deck. |
| **Tick sensors** / *in Gadget* | The Gadget registry is present but has no readable sensor rows. | In HWiNFO, open Configure Sensors and the HWiNFO Gadget tab; check Enable reporting to Gadget and tick the readings you need. |
| **Needs x64** / *Windows* | Unsupported platform: HWiNFO's interfaces aren't readable here. | This plugin needs 64-bit (x64) Windows. macOS and Windows-on-ARM are unsupported. |
| **Pick a sensor** / *in settings* | The key works, but no sensor is selected yet. | Open the key's settings and choose a sensor from the picker. |
| **Sensor missing** / *pick again* | The saved sensor isn't in HWiNFO's current output. | A hardware/driver change or a renamed sensor profile dropped it. Open settings and pick the sensor again. |
| **Source error** / *open settings* | The sensor source could not be opened or validated. The failure may involve the feed or saved identity data. | Open settings and choose **Copy support report** for support. |
| **Bridge failed** / *reinstall* | The native HWiNFO bridge (`bin/hwsm.node`) could not load; this does not identify the cause. | Reinstall the plugin from its release package. If Windows or security software reports a block, keep that report and the package hash for support. A checksum identifies bytes; it does not establish safety. |

> **Note:** *Start HWiNFO*, *Not updating*, and the rest come from the data source (see [Data sources](data-sources.md)). *Pick a sensor* and *Sensor missing* are about this specific key's selection; the data source is fine. *Bridge failed* is about the plugin's own install, not HWiNFO.

## Dial screens (Stream Deck +)

Dials show the same states in the touchscreen's two-slot layout (a title and a value line). The wording is shortened to fit:

| Dial title | Dial value |
| --- | --- |
| Start HWiNFO | not detected |
| Source busy | retrying |
| Shared Memory off | enable in HWiNFO |
| No new data | check sharing *(shared memory)* |
| Age unknown | check Gadget *(gadget)* |
| Access denied | open settings |
| Gadget empty | tick sensors |
| Needs x64 Windows | "—" (placeholder glyph) |
| Source error | open settings |
| Bridge failed | reinstall it *(the native bridge `bin/hwsm.node` didn't load; reinstall the plugin)* |
| HWiNFO | rotate to pick *(no sensor selected yet; the hint line says "or use the settings panel")* |
| Sensor missing | waiting *(the saved sensor isn't in HWiNFO's output; the hint says "reselect in settings")* |

Like the key screens, the frozen-data message is **source-aware**: a dial reading from the Gadget registry says *check Gadget*, never *check sharing*.

While **Sensor missing / waiting** shows, the dial ignores turns so a temporary dropout (an HWiNFO restart, a device asleep) can't bump you off the saved reading; it recovers on its own when the sensor returns. Separately, a live dial can carry a small **"cycle paused"** or **"pinned"** label on its bottom line: those aren't status screens, they're the pause and pin states described on [Dial controls & presets](controls.md#pause-pin-and-reset-reach).

## Recovery is automatic

You never have to remove and re-add a key. The plugin keeps probing in the background:

- When HWiNFO is gone, it re-attempts a full open on **every** poll tick (a cheap failing call), so keys light up again within a second or two of HWiNFO returning.
- When data goes **stale** (frozen for more than ~15 s), it probes a fresh connection every ~5 s to tell "frozen but alive" apart from "HWiNFO exited."
- In **Auto** mode, while running on the Gadget fallback it probes shared memory every ~15 s and silently **upgrades** back to it the moment it returns.
- When a read fails **transiently**, the plugin rides it out instead of flashing a screen. An HWiNFO layout change (starting a game that adds GPU readings does it) poisons the open session; the poller reopens the data source at the new size and re-reads it in the same tick, so live values never leave the keys. If that reopen doesn't land at once, the last values stay on screen for up to ~15 s before any status screen appears. *Access denied*, *Shared Memory off* and *Tick sensors* still appear at once: riding those out would only hide a setup problem you have to fix.

Source failures are retried automatically. **Bridge failed** remains cached for the plugin process, so after repairing the installation, restart the plugin. A loader error alone does not establish whether a file is damaged, missing or blocked.

> **Related:** the *Shared Memory off*, *Not updating*, and *Tick sensors* screens all trace back to how HWiNFO is publishing; see [Data sources](data-sources.md) for the Shared Memory vs. Gadget trade-offs and the 12-hour free-version timer.
