---
title: Install
nav_order: 2
description: Requirements, stable downloads and HWiNFO sharing setup.
---

Install the plugin, then enable HWiNFO sharing on the same PC. Already installed? [Get your first reading](getting-started.md).

## System requirements

| Requirement | Details |
| --- | --- |
| **Windows 10 or later, x64** | macOS, Linux and Windows-on-ARM are unsupported. |
| **Stream Deck software 6.9+** | The Elgato desktop app hosts the plugin. |
| **HWiNFO running locally** | [Free or Pro](https://www.hwinfo.com/download/), installed or portable. Enable Shared Memory Support or Gadget reporting. |
| **A supported display key or dial** | Sensor Reading uses display keys. Sensor Dial requires Stream Deck + or + XL. See the [compatibility matrix](hardware.md#compatibility-matrix) for tested, simulated and expected support. |

Devices without displays, including Pedal and Corsair G-Keys, can use **HWiNFO Control** to operate dials on another connected deck. Support is not claimed for every Stream Deck model.

## Install the plugin

### GitHub release

1. Download [com.lawrensen.hwinfo.streamDeckPlugin, version 1.7.1](https://github.com/slawrensen/hwinfo-streamdeck/releases/download/v1.7.1/com.lawrensen.hwinfo.streamDeckPlugin). [Release notes and hashes](https://github.com/slawrensen/hwinfo-streamdeck/releases/tag/v1.7.1).
2. To verify the download, compare its SHA-256 with the **pack** hash in that release's notes:

   ```powershell
   Get-FileHash .\com.lawrensen.hwinfo.streamDeckPlugin -Algorithm SHA256
   ```

3. Double-click the package and confirm installation in Stream Deck. **HWiNFO Sensors** appears in the actions list.

The native addon is **unsigned**. A matching checksum identifies the published bytes; it does not establish safety. See [installation verification](faq.md#is-the-native-binary-signed-how-do-i-verify-what-i-installed) and [SECURITY.md](https://github.com/slawrensen/hwinfo-streamdeck/blob/main/SECURITY.md).

### Elgato Marketplace

Install from the [Marketplace listing](https://marketplace.elgato.com/product/hwinfo-sensors-82436166-3d61-4527-9034-8fdf16d92c54). It hands the package to Stream Deck. Checked 24 October 2026: the listing shows **1.7**, with notes for **1.7.0.0**. GitHub's stable release is **1.7.1**, which adds transparent dial backgrounds. Marketplace packaging applies DRM, so do not compare its package hash with the GitHub package hash.

No administrator rights are required to install the plugin. If reading sensors later produces **Access denied**, follow the [access checks](troubleshooting.md#keys-show-access-denied).

### Updating and removing

- **Update:** install the newer package from your chosen channel. Stream Deck replaces the plugin; saved readings and settings remain.
- **Remove:** use Stream Deck's **Preferences → Plugins** or the plugin's **Uninstall** command. HWiNFO is a separate application.

## One-time HWiNFO setup

Enable at least one source. **Auto** prefers Shared Memory when readable.

### Recommended: Shared Memory Support

1. Start HWiNFO in **Sensors-only** mode.
2. Open **Settings**, enable **Shared Memory Support**, and click **OK**.
3. Keep HWiNFO running and polling sensors. Optionally enable **Auto Start** and **Minimize Sensors on Startup**.

Shared Memory supplies HWiNFO's published readings and min/max/average. **I recommend [buying HWiNFO Pro](https://www.hwinfo.com/licenses/) for continuous Shared Memory use without the 12-hour limit.**

**Free HWiNFO disables Shared Memory after 12 hours.** Re-enable sharing or restart HWiNFO to resume. Auto can fall back to Gadget, but saved selections need [explicit provider links](data-sources.md#link-readings-across-providers) to identify the same reading on another source.

### Free path: Gadget reporting

1. In HWiNFO's Sensors window, open **Configure Sensors → HWiNFO Gadget**.
2. Enable **Enable reporting to Gadget**.
3. Tick **Report value in Gadget** for each reading you need, then click **OK**.

Gadget has no 12-hour timer. It exposes only ticked readings and current values, with no HWiNFO min/max/average or producer timestamp. The plugin shows **Age unknown** until it observes a value change, and again after 15 seconds without another. Steady values can be live or left behind by a stopped HWiNFO.

Tick only the readings you use. Duplicate source-name/reading-label pairs are withheld; untick or rename the unwanted duplicate in HWiNFO. Enabling reporting without ticking a reading may leave no registry data and show **Start HWiNFO / not detected**. A present but empty store shows **Tick sensors / in Gadget**. [Data sources](data-sources.md#enabling-gadget-reporting) explains these limits.

To select Gadget readings directly, choose **Advanced → Connection → Data source → Gadget registry only** first.

## Portable HWiNFO caveats

Keep the portable application running and publishing. Add it to Windows startup yourself if needed. A crash can leave Gadget values behind; **Age unknown** does not establish whether they are current. For **Access denied**, check the launch account, session and permissions; matching elevation alone does not guarantee access.

## Verify it works

Drag **Sensor Reading** onto a key, choose a **Reading**, and compare its value with HWiNFO. Fresh Shared Memory data shows **Live · Shared Memory** in the settings header. Follow the [five-step guide](getting-started.md) or find the exact message in [Troubleshooting](troubleshooting.md).

## Next steps

[Get started](getting-started.md) · [Sensor Reading](sensor-reading.md) · [Sensor Dial](sensor-dial.md) · [Data sources](data-sources.md)
