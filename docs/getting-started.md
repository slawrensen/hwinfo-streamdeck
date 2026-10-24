---
title: Get started
nav_order: 3
description: Put your first HWiNFO reading on a Stream Deck key in five steps.
---

Put one live reading on a key, then customize it.

**You need:** Windows 10 or later **x64**, Stream Deck software **6.9+**, and [HWiNFO](https://www.hwinfo.com/download/) running on the same PC. Check [hardware compatibility](hardware.md) for your deck.

## 1. Install the plugin

Download [version 1.7.1](https://github.com/slawrensen/hwinfo-streamdeck/releases/download/v1.7.1/com.lawrensen.hwinfo.streamDeckPlugin), open `com.lawrensen.hwinfo.streamDeckPlugin`, and confirm the installation in Stream Deck. The actions list gains an **HWiNFO Sensors** category. [Installation and verification](installation.md#install-the-plugin) covers both GitHub and Marketplace packages.

## 2. Enable sharing in HWiNFO

Start HWiNFO in **Sensors-only** mode. Open **Settings**, enable **Shared Memory Support**, and leave HWiNFO running.

**Free HWiNFO stops Shared Memory after 12 hours.** Re-enable it or restart HWiNFO to resume. Pro removes the limit. [Gadget reporting](installation.md#free-path-gadget-reporting) has no timer, but lacks HWiNFO history and a producer timestamp. Saved readings need [explicit links](data-sources.md#link-readings-across-providers) to follow a change between sources.

<a id="2-drag-sensor-reading-onto-a-key"></a>
## 3. Add Sensor Reading

In Stream Deck, drag **HWiNFO Sensors → Sensor Reading** onto an empty display key. Select the key to open its settings. With a readable source, it shows **Pick a sensor / in settings**.

<a id="3-pick-a-reading"></a>
## 4. Select a reading

Click **Reading**, type part of a name such as `cpu die` or `gpu hot`, and choose a result. The list groups readings by their HWiNFO sensor. Arrow keys browse and Enter selects; **Reload the sensor list** refreshes it.

<a class="image-link" data-image-viewer href="{{ '/assets/img/sensor-picker.png' | relative_url }}" aria-label="Enlarge image"><img src="{{ '/assets/img/sensor-picker.png' | relative_url }}" width="800" height="1760" loading="lazy" decoding="async" alt="The Sensor Reading picker filtered to GPU readings, grouped by their HWiNFO sensor."></a>

*Settings-panel capture with live HWiNFO readings in a test host.*

## 5. Confirm a value

The key should show a number and unit. With fresh Shared Memory data, the settings header shows **Live · Shared Memory**. Compare the selected reading with HWiNFO. Updates follow HWiNFO's own refresh rate.

If you see **Start HWiNFO**, **Shared Memory off**, **Age unknown**, or **Sensor missing**, use the exact message in [Troubleshooting](troubleshooting.md). Gadget can show **Age unknown** until an observed value change establishes freshness; a steady value does not prove it stopped.

<a id="4-find-the-rest-of-the-settings"></a>
## Where to go next

- [Sensor Reading](sensor-reading.md): layouts, graphs, labels and key presses.
- [Sensor Dial](sensor-dial.md): touchscreen readings, rotation and transparent backgrounds.
- [Themes & colors](themes.md): one look for a key or the whole deck.
- [Troubleshooting](troubleshooting.md): find a status message and its next step.
