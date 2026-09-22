---
title: Installation & requirements
nav_order: 2
---

Getting the plugin running is three things: the Stream Deck plugin itself, a working copy of HWiNFO, and a one-time toggle in HWiNFO so the plugin can read its sensors. This page covers all three.

> **Windows only.** HWiNFO is a Windows application and this plugin reads its shared-memory or Gadget-registry interface locally. There is no macOS or Windows-on-ARM build; the plugin needs 64-bit (x64) Windows. No ads, no telemetry, MIT licensed.

## System requirements

| Requirement | Notes |
| --- | --- |
| **Windows 10 or later**, 64-bit (x64) | Windows-on-ARM is not supported (keys show a clear "Needs x64 Windows" screen). There is no macOS build; the plugin doesn't install there at all. |
| **Stream Deck software 6.9+** | The Elgato desktop app that hosts plugins. Update it from within the app if you are on an older build. |
| **HWiNFO** (free or Pro) | Installer or portable. Download from [hwinfo.com](https://www.hwinfo.com/download/). The plugin does not bundle HWiNFO; you run it yourself. |

Any Stream Deck hardware works for the **Sensor Reading** key action. The **Sensor Dial** action needs a Stream Deck + or Stream Deck + XL (the models with dials and a touchscreen). The **HWiNFO Control** key action goes anywhere a key action can, including the Stream Deck Pedal and Corsair G-keys, and drives Sensor Dials on other connected decks. The full device matrix is on [Hardware compatibility](hardware.md).

## Install the plugin

There are two ways to install, depending on where you got the plugin.

**From a GitHub Release (`.streamDeckPlugin` file)**

1. Download `com.lawrensen.hwinfo.streamDeckPlugin` from the [releases page](https://github.com/slawrensen/hwinfo-streamdeck/releases).
2. Optional: the native addon inside is unsigned, so verify the download against the pack SHA-256 printed in the release notes. In PowerShell: `Get-FileHash com.lawrensen.hwinfo.streamDeckPlugin -Algorithm SHA256`. More in [SECURITY.md](https://github.com/slawrensen/hwinfo-streamdeck/blob/main/SECURITY.md).
3. Double-click the file. The Stream Deck app opens and asks you to confirm the install.
4. Confirm. **HWiNFO Sensors** appears in the actions list on the right, under its own **HWiNFO Sensors** category.

**From the Elgato Marketplace**

The plugin is on the [Elgato Marketplace](https://marketplace.elgato.com/product/hwinfo-sensors-82436166-3d61-4527-9034-8fdf16d92c54). Install it from there in one click and the Marketplace hands the package to the Stream Deck app. I publish each version to GitHub Releases first, so while an update is in review the Marketplace can be a version behind. Check the version shown on the listing if you want the newest build.

> **Note:** No admin rights are needed to install the plugin. If a key later shows **Access denied**, Windows refused access needed to read the sensor source. That error alone does not identify an account, session or privilege mismatch. Open the key or dial settings and choose **Copy support report** for support; see [Troubleshooting](troubleshooting.md).

### Updating and removing

- **Update:** double-click a newer `.streamDeckPlugin` (or install the newer version from the Marketplace) and the Stream Deck app replaces the old copy **in place**. Your keys keep their sensors, themes and thresholds.
- **Uninstall:** in the Stream Deck app, right-click the **HWiNFO Sensors** category (or any of its keys) in the actions list on the right and choose **Uninstall**, or manage it under the app's **Preferences → Plugins**. HWiNFO is a separate program; remove it on its own if you no longer need it.

## One-time HWiNFO setup

The plugin reads HWiNFO through one of two interfaces. You only need to enable **one**; the plugin picks the best available source automatically and falls back on its own (see [Data sources](data-sources.md)).

### Recommended: Shared Memory Support

Shared Memory exposes **every** reading HWiNFO measures, with min / max / average. It is the preferred source.

1. Install and start **HWiNFO**. On the startup dialog, choose **Sensors-only** (you don't need the summary window).
2. Open **Settings** (the gear icon).
3. Turn on **Shared Memory Support**.
4. Recommended, so HWiNFO is always feeding the deck without a window in your way:
   - **Auto Start**: HWiNFO launches with Windows.
   - **Minimize Sensors on Startup**: the Sensors window starts minimized.
   - (Combined with Sensors-only, HWiNFO runs quietly in the background.)
5. Click **OK**.

> **Free version: 12-hour limit.** Shared Memory Support switches off after 12 hours; HWiNFO Pro removes the limit. Re-enable sharing or restart HWiNFO to resume it. Auto can use Gadget if reporting is enabled, but saved Shared Memory readings do not automatically match Gadget readings. 1.7 adds [explicit provider links](data-sources.md#link-readings-across-providers).

### Free path: Gadget reporting

Gadget reporting never expires on the free version, but it only exposes the sensors **you tick**, and only their current value (no min / max / average).

1. Start **HWiNFO** in Sensors mode.
2. In the HWiNFO **sensor window**, click **Configure Sensors** and open the **HWiNFO Gadget** tab.
3. Tick **"Enable reporting to Gadget"**, then tick **"Report value in Gadget"** for each value you want on the deck, and click OK. Shift-click selects a range, so you can tick many at once.

The plugin reads these from `HKCU\Software\HWiNFO64\VSB`. HWiNFO 8.48 creates that key only once a reading is ticked: with reporting enabled and nothing ticked, keys show **Start HWiNFO / not detected** while HWiNFO is running. **Tick sensors / in Gadget** appears when the key is there but holds no rows, which unticking everything can leave.

You can enable **both** interfaces. Auto prefers Shared Memory and can switch to Gadget when needed. To configure only Gadget readings, select **Advanced → Data source → Gadget registry only** before choosing them. Since 1.7, Gadget shows **Age unknown** until a value change is observed, and again after 15 seconds without another. Gadget supplies no historical min/max/average.

## Portable HWiNFO caveats

The portable build of HWiNFO works identically, but there is no installer to wire things up for you:

- **Keep HWiNFO running and publishing sensors.** Exiting it stops new data, and keys show **Start HWiNFO**. A killed or crashed HWiNFO can leave old Gadget values behind, which 1.7 shows as **Age unknown**.
- **Add it to autostart yourself.** There's no installer to register Auto Start, so if you want it running at login you must add the executable to your own startup (e.g. a Startup-folder shortcut or Task Scheduler).
- **Review access settings if needed.** **Access denied / open settings** means Windows refused access needed to read the sensor source. Review the Windows account, session and privilege settings used to launch HWiNFO and Stream Deck; the error alone does not identify which access rule failed. See [Troubleshooting](troubleshooting.md#keys-show-access-denied).

## Verify it works

1. Drag **HWiNFO Sensors → Sensor Reading** onto a key.
2. In the settings panel (property inspector), open the **Sensor** picker and choose a reading. The list groups readings by source (CPU, GPU, drives, …) and shows live values; type to filter.
3. With a readable source, the key shows the value. Since 1.7, Gadget can show **Age unknown** until a value change is observed; see [Status screens](status-screens.md).

If instead the key shows a status screen like **Start HWiNFO** or **Shared Memory off**, HWiNFO isn't publishing yet; recheck the setup above, or see [Troubleshooting](troubleshooting.md) for what each screen means and how to fix it.

## Next steps

- [Sensor Reading (keys)](sensor-reading.md): every key setting (label, theme, stat mode, decimals, sparkline, thresholds).
- [Sensor Dial (Stream Deck +)](sensor-dial.md): the dial and touchscreen action.
- [Data sources](data-sources.md): Shared Memory vs. Gadget, and how auto-fallback works.
- [Themes](themes.md): the seven presets, type accents, and alert colors.
