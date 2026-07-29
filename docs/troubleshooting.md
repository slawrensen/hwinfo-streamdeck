---
title: Troubleshooting
nav_order: 11
---

This page is the deep symptom → cause → fix guide. For quick answers see the [FAQ](faq.md); for the two interfaces the plugin reads, see [Data sources](data-sources.md).

Every claim here matches the plugin's actual behaviour. HWiNFO must be running on the same Windows machine: this is a **Windows-only** plugin with **no telemetry**; nothing here phones home or needs the internet.

> **First check, always:** is **HWiNFO** running, and is it publishing on at least one interface (**Shared Memory Support** *or* **Gadget reporting**)? Most status screens trace back to this. See [Data sources](data-sources.md).

## How to read a status screen

When a key can't show live data it renders a two-line, true-black status screen instead of a value. Dials show an equivalent two-line touchscreen message. The exact text tells you what's wrong:

| Key shows | Dial shows | Meaning |
| --- | --- | --- |
| **Start HWiNFO** / not detected | Start HWiNFO / not detected | Nothing found on either interface. |
| **Shared Memory** / is off | Shared Memory off / enable in HWiNFO | Mapping exists but HWiNFO marked it disabled. |
| **Not updating** / check sharing *(or)* check Gadget | HWiNFO stalled / check sharing *(or)* check Gadget | Values frozen; the sub-line names the source in use. |
| **Access denied** / un-elevate | Access denied / un-elevate HWiNFO | Privilege mismatch between HWiNFO and Stream Deck. |
| **Tick sensors** / in Gadget | Gadget empty / tick sensors | Gadget reporting is on but no sensors are ticked. |
| **Pick a sensor** / in settings | HWiNFO / rotate to pick | No sensor selected on this key/dial yet. |
| **Sensor missing** / pick again | Sensor missing / waiting | The saved sensor isn't in HWiNFO's current output. |
| **Needs x64** / Windows | Needs x64 Windows | 32-bit or Windows-on-ARM: unsupported. |
| **HWiNFO error** / restart HWiNFO | HWiNFO error / restart HWiNFO | Header didn't validate (mid-restart or incompatible build). |
| **Plugin damaged** / reinstall | Plugin damaged / reinstall it | The plugin's native bridge (`bin/hwsm.node`) would not load: missing, blocked by antivirus, or a version mismatch. Reinstall the plugin. |

![The plugin's status screens rendered as clean OLED-black key faces, each with a two-line message: Start HWiNFO, Shared Memory off, Access denied, Tick sensors in Gadget, Not updating, Pick a sensor, and Sensor missing.]({{ '/assets/img/status-screens.png' | relative_url }})

---

## Keys show "Start HWiNFO"

The plugin found HWiNFO on **neither** interface. In order of likelihood:

1. **HWiNFO isn't running.** Start it. If you use the free version, run it in **Sensors-only** mode.
2. **HWiNFO is running but publishing on neither interface.** Open **HWiNFO → Settings** and tick **Shared Memory Support**. On the free version you can instead right-click sensors and tick **"Report value in Gadget"** (no 12-hour limit); see [Data sources](data-sources.md).
3. **Portable HWiNFO window was closed.** The portable build only publishes while its window is open, and nothing auto-starts it. Reopen it (and add it to autostart yourself if you want it always on).
4. **Wrong bitness.** This plugin reads 64-bit HWiNFO. Use `HWiNFO64`, not the 32-bit build, on 64-bit Windows.
5. **HWiNFO just launched.** It can take a few seconds after start to create the shared-memory mapping. Wait, then the key recovers on its own; the plugin re-probes every tick.
6. **The mapping exists but its consistency mutex doesn't.** Since 1.4.0.0 the plugin reads shared memory only while holding HWiNFO's consistency mutex, with no unguarded read path, so a mapping published without a reachable mutex is treated as HWiNFO still starting up (HWiNFO creates the mapping first and the mutex just after). During a normal start that window is brief and the key recovers on its own. If it never clears, enable **Gadget reporting** and tick the sensors you need: the Gadget registry doesn't use the mutex, and in the default **Auto** data source the plugin falls back to it by itself.

## Keys show "Shared Memory off"

HWiNFO's shared-memory mapping exists but its header is flagged **disabled** (internally a `DEAD` marker). Causes:

1. **Shared Memory Support was turned off** in HWiNFO Settings. Re-enable it.
2. **Free version's 12-hour timer expired.** The free build auto-disables shared memory 12 hours after start and leaves the dead mapping behind. Toggle **Shared Memory Support** off and on to restart the timer, or restart HWiNFO. HWiNFO **Pro** removes the limit entirely.
3. **You don't want to keep toggling it.** Enable **Gadget reporting** instead (tick "Report value in Gadget" on the sensors you need). In the default **Auto** data source the plugin falls back to the Gadget registry by itself when shared memory dies, and upgrades back automatically when it returns.

> **Note:** If your **Data source** (Advanced) is set to **Shared Memory only**, the plugin will *not* fall back. Set it to **Auto** to get automatic Gadget fallback.

## Values are frozen / "Not updating"

The reading stopped changing for more than ~15 seconds, so the plugin flags it stale. The sub-line names the source: **check sharing** (shared memory) or **check Gadget** (Gadget registry).

1. **HWiNFO's Sensors window was closed or HWiNFO was minimised to tray without sensor polling.** Reopen the Sensors window; HWiNFO must keep polling to update either interface.
2. **Not the free version's 12-hour timer.** Expiry doesn't freeze values: it marks the shared-memory mapping `DEAD`, which shows **"Shared Memory off"** or silently falls back to the Gadget registry in Auto mode. (Pro removes the limit.)
3. **HWiNFO itself crashed or hung.** Restart it. The plugin re-probes a fresh handle every 5 seconds while stale and recovers automatically.
4. **Confusing a slow refresh for a freeze.** HWiNFO updates on its own poll cycle (default ~2 s). If your plugin poll interval is *faster* than HWiNFO's, you'll see the same number repeat between HWiNFO updates; that's normal, not a freeze. The plugin only calls it stale after 15 s of no change.

## Keys show "Access denied"

Windows refused to open HWiNFO's shared memory. This is **always** a privilege mismatch: specifically **HWiNFO is running elevated ("Run as administrator") while Stream Deck is not**.

The fix is to make the two match:

| HWiNFO | Stream Deck | Result |
| --- | --- | --- |
| Normal | Normal | ✅ Works |
| Elevated | Elevated | ✅ Works |
| **Elevated** | **Normal** | ❌ Access denied |
| Normal | Elevated | ✅ Works (lower can't be blocked here) |

Easiest fix: **restart HWiNFO without "Run as administrator."** If you genuinely need HWiNFO elevated (some low-level sensors require it), run Stream Deck elevated too.

> **Free-version escape hatch:** the **Gadget registry** lives in `HKCU` and is readable across privilege levels, so enabling Gadget reporting sidesteps this mismatch entirely.

## Keys show "Sensor missing"

A sensor *is* selected, but it isn't in HWiNFO's current output. The saved identity (`sensor-id : instance : reading-id`) no longer resolves. Causes:

1. **Hardware or driver change**: you added/removed a GPU, drive, or peripheral, or a driver update renamed the sensor.
2. **You renamed the sensor or its reading in HWiNFO** (custom labels change the resolved identity on the Gadget source).
3. **HWiNFO profile / config change**, or you switched between shared memory and Gadget sources (the two expose different sensor sets).
4. **The sensor simply isn't present yet**, e.g. a GPU that's asleep, or a drive that spun down.

**Fix:** open the key's settings and **pick the sensor again**. A dial shows **Sensor missing / waiting** and ignores turns while the sensor is gone, so a temporary dropout (an HWiNFO restart, a sleeping GPU) can't move it off your saved pick; it recovers by itself when the sensor returns. If the sensor is gone for good, pick a new reading in the dial's settings panel.

## Picker is empty or shows "No sensors reported"

The settings-panel sensor list is populated live from whatever source is active:

1. **HWiNFO isn't up yet.** Start HWiNFO, then click the **⟳ refresh** button next to the search box.
2. **On the Gadget source with nothing ticked**: the key shows **"Tick sensors / in Gadget."** In HWiNFO's sensor window, right-click each value you want and tick **"Report value in Gadget."** The registry key exists but is empty until you do.
3. **Shared memory is disabled/expired** and you're forced to **Gadget only**; same fix as above.
4. **Search filter too narrow.** Clear the search box; the list groups readings by source (CPU, GPU, drives…).

![The settings-panel sensor picker open, showing the search box, the ⟳ refresh button, and the list of readings grouped by source.]({{ '/assets/img/sensor-picker.png' | relative_url }})

## Plugin shows nothing at all / the action is missing

1. **Actions not visible in Stream Deck.** Look for the **HWiNFO Sensors** category in the actions list; drag **Sensor Reading** onto a key (or **Sensor Dial** onto a Stream Deck + or Stream Deck + XL encoder).
2. **Stream Deck too old.** This plugin requires **Stream Deck software 6.9 or newer**. Update it.
3. **Not on Windows / wrong architecture.** The plugin is Windows x64 only; macOS and Windows-on-ARM are unsupported (you'll see **"Needs x64 Windows"** if it loads at all).
4. **Install got corrupted.** Remove the plugin and reinstall by double-clicking the `.streamDeckPlugin` file, then restart Stream Deck.

## A reading shows the wrong unit

Each key/dial has a per-key **Unit** checkbox: **"Show temperatures in °F."** It only affects `°C` readings. If a temperature reads in the wrong unit, toggle that checkbox on the specific key. Sparkline shape is unaffected; it's stored in native units and just relabelled.

Byte quantities and transfer rates follow a separate, deck-wide control: **Advanced → Data units**, either **Decimal (KB, MB, GB, rates in Mbps)** or **Binary (KiB, MiB, GiB, rates in MiB/s)**. If a drive reading shows MiB where you expected MB, or a network reading shows MiB/s where you expected Mbps, change that setting; it applies to every key and dial at once. Full detail in [Advanced (deck-wide)](sensor-reading.md#advanced-deck-wide).

## Thresholds (warn/critical) don't fire

Three gotchas cause almost all of these:

1. **Thresholds are in *display* units.** The warn/critical fields are compared against the value **as shown on the key**. If you enabled **°F**, enter the threshold in °F (e.g. `176`), not °C (`80`). The placeholder text says "display units" for exactly this reason.
2. **Wrong direction.** By default the key alerts when the value goes **at or above** the threshold. For things where *low* is bad (fan RPM, free disk space, remaining battery), tick **Direction → "Alert when value drops below thresholds."**
3. **A dial rotated to a different unit.** Warn/critical values are anchored to the unit they were typed against, so `80` typed while a °C reading was on screen stands down on the 3000 RPM fan you rotate to; the manual **Bar min**/**Bar max** stand down with it and the bar falls back to the session low/high. Edit the threshold while the reading you want is on screen and it re-anchors to that reading's unit. Thresholds saved before this behavior existed keep their old apply-everywhere reach until you next edit one. See [Dial controls & presets](controls.md#thresholds-and-mixed-units).

Other notes:
- Alerts always track the **live** value, even while the key is showing MIN/MAX/AVG (a key press cycles the *displayed* stat, not what's tested).
- On **dials**, the alert lands wherever the face has room. In the **One reading** view the range bar's fill flips to the alert color, and with **Warn at** or **Critical at** set the bar's track marks those zones in muted amber and red whatever the value is doing. The **two-row and three-row overviews** have no bar, so an alerting row shows its **value** in the alert color instead. Either way the rest of the touchscreen stays themed; the slot is too small for a full field flip. On **keys**, the whole key flips (amber field at warn, red field at critical).
- Leave a field blank to disable that level. Both accept a locale decimal comma (`70,5`).

## A press set to open details shows the alert triangle

The yellow Stream Deck alert cue on a drill-down press means entry was refused, on purpose. In order of likelihood:

- **This deck type has no bundled detail view** (Mobile, Virtual, Studio, Galleon, pedals, G-keys). The key's settings panel says so under Press. Everything else about the key still works.
- **HWiNFO is not publishing data** and the detail list is set to *All readings from this sensor source*: with no snapshot there is nothing to resolve. Fix the data (see the status screens above) and press again. A *Custom sensor list* opens even while HWiNFO is down.
- **The selected sensor is missing** from HWiNFO's current output, so its source cannot be identified. Reopen settings and pick it again.

If instead nothing at all happens on the first press: the Stream Deck app shows an install prompt for the deck's detail profile the first time, and until it is accepted the deck stays put (the plugin quietly forgets the attempt after 30 seconds; press again after accepting).

## The detail view says "No detail / selected"

The detail profile is visible but the plugin was restarted underneath it (plugin update, crash recovery), so it no longer knows which sensor opened the view. Press the Back tile (top left) to return to your profile, then open details again. Back always works there, even in this state.

## Dial gestures do nothing

1. **You're on a plain Stream Deck, not a Stream Deck + or + XL.** The **Sensor Dial** action needs a Stream Deck + or Stream Deck + XL encoder (dial + touchscreen). Regular keys use the **Sensor Reading** action instead.
2. **No sensor picked yet**: a fresh dial shows **"rotate to pick."** Rotate to select a reading, or pick one in the settings panel.
3. **Turns specifically do nothing**: check whether **Ignore turns** is on, or the dial is **pinned** (the bottom line says "pinned"; unpin via the gesture or an HWiNFO Control key).

Dial gesture reference (Legacy preset, the default): **rotate** cycles your rotation set if you built one, otherwise the readings of the same sensor source · **push** resets session min/max/avg · **touch** cycles current/min/max/avg · **long touch** returns to the live value. The Elite and Custom presets remap these; see [Dial controls & presets](controls.md).

## High memory, high CPU, or a stuck process

The plugin runs one poller regardless of how many keys are visible, and is designed to idle when no keys are shown.

1. **Perceived high CPU.** Lower the poll rate: **Advanced → Poll every** (default 1 second; options 250 ms–5 s). There's no benefit polling faster than HWiNFO's own update cycle (~2 s by default).
2. **Process lingering after Stream Deck quits.** The plugin watches its parent and exits when Stream Deck dies; if you ever find an orphaned `plugin.js`/Node process, ending it is safe and Stream Deck respawns it on next launch. If it recurs, capture the log (below) and file an issue.
3. **Memory climbing.** The plugin is memory-stable under long soaks in testing. If you observe real growth, note how many keys/dials are live and attach the log.

---

## Reading the plugin log

Stream Deck writes this plugin's log to its own folder:

```
com.lawrensen.hwinfo.sdPlugin/logs/
```

On a normal install that folder lives under your Stream Deck plugins directory, typically:

```
%APPDATA%\Elgato\StreamDeck\Plugins\com.lawrensen.hwinfo.sdPlugin\logs\
```

Files rotate as `com.lawrensen.hwinfo.0.log` (newest) through `.9.log`. Each line is `TIMESTAMP LEVEL Scope: message`, for example:

```
2026-07-05T19:22:50.649Z INFO  HwinfoPoller: Started (1000 ms interval)
2026-07-05T19:22:50.650Z INFO  HwinfoPoller: Opened HWiNFO data source: gadget
2026-07-05T19:29:12.294Z INFO  HwinfoPoller: Stopped (no visible actions)
```

Useful lines to look for:

- `Opened HWiNFO data source: shared-memory` / `gadget`: which interface is actually in use.
- A `Shared memory returned` line: auto-fallback recovered and upgraded from the gadget registry.
- `HWiNFO unavailable [<reason>]: …` names the exact failure reason (`not-running`, `disabled`, `access-denied`, `gadget-empty`, `bridge-failed`, `invalid`, `unsupported-platform`).
- `Data source layout changed; reopened in place (shared-memory)`: HWiNFO's sensor list grew or shrank (starting a game that adds GPU readings does it) and the poller reopened at the new size and re-read within the same tick, so the values never left the keys. Logged at INFO; it is not an error.
- `Holding last values while the data source reopens [<reason>]: …`: a transient open failure (`invalid` or `not-running`). The last values stay on the keys for up to 15 seconds after the last fresh reading, then a status screen appears.
- `Deck theme = … (source: …)`: the resolved deck-wide theme.
- `Stopped (no visible actions)`: the poller correctly idled (no leak).

> **Note:** The log is local-only: the plugin has **no telemetry** and never uploads anything. You choose what to share.

**Need more detail?** Set the user environment variable `HWINFO_LOG_LEVEL=debug` and restart the Stream Deck app; the plugin then logs where every key and dial appeared (device and position). Levels are `trace`, `debug`, `info` (the default), `warn` and `error`. `trace` needs a debug launch of the plugin; on a normal Stream Deck launch it falls back to `debug` and the log says so. The log also names each connected deck's model and key grid, so it shows exactly what hardware was involved.

---

## Before you file an issue

Run through this first; most problems resolve here:

- [ ] **HWiNFO is running** and its **Sensors window is open**.
- [ ] At least one interface is enabled: **Shared Memory Support** *or* **Gadget reporting** ("Report value in Gadget" on the sensors you need).
- [ ] **Data source** (Advanced) is **Auto** unless you have a specific reason otherwise.
- [ ] HWiNFO and Stream Deck are at the **same elevation** (both normal, or both admin).
- [ ] **Stream Deck 6.9+**, **64-bit Windows 10+**.
- [ ] You **re-picked the sensor** if it went missing after a hardware/driver change.
- [ ] Threshold values are in the **displayed unit**, with the right **Direction**.

If it still fails, open an issue at the [project repository](https://github.com/slawrensen/hwinfo-streamdeck) and include:

1. **What you see**: the exact status-screen text (e.g. "Access denied / un-elevate") or a photo of the key/dial.
2. **HWiNFO version and edition** (free or Pro), and which interface(s) you enabled.
3. **Plugin version** (see the Marketplace listing or `manifest.json`).
4. **Stream Deck software version** and device model (regular, Stream Deck +, Stream Deck + XL).
5. **Windows version**.
6. **The relevant lines from the log** (`com.lawrensen.hwinfo.0.log`), especially any `HWiNFO unavailable […]` and the `Opened HWiNFO data source` lines.
7. **The support report**: the Sensor Reading and Sensor Dial panels have a **Copy support report** button in their advanced section, and the HWiNFO Control panel has one under **Support**. It copies a local JSON summary (plugin and app version, devices by model and hashed ID, data-source state, action states; no sensor values, no sensor names, nothing uploaded). Paste it into the issue.
8. **Whether either HWiNFO or Stream Deck is running elevated.**
