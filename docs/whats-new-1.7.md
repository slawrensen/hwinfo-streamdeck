---
title: What's changing in 1.7
nav_order: 1.5
---

**1.7 is a release candidate, not a published release.** It combines the
dial-color work with the reliability fixes. Hardware qualification is still
in progress. The download links continue to point to the published release.

## What changes on your deck

| Change | What you see | What you need to do |
| --- | --- | --- |
| Individual dial colors | Two CPU/GPU temperature readings can have different number colors, even though both are temperatures. | Open a multi-row dial's **Appearance > Reading colors**. Choose a preset or set each color. |
| Linked source selections | A saved reading and its color can follow a switch between Shared Memory and Gadget. | Configure an [explicit source link](data-sources.md#link-readings-across-providers). Similar names are never paired automatically. |
| Gadget freshness | **Age unknown** replaces a claim that unchanged registry values are definitely stale. | Check HWiNFO and Gadget reporting. A steady value alone cannot prove the producer is running. |
| Gadget history | Key and detail MIN/MAX/AVG modes show **N/A** instead of presenting the current value as history. | Use Current, or enable Shared Memory for HWiNFO history. Dials have separate local statistics. |
| Ambiguous Gadget names | Duplicate names are withheld instead of risking the wrong reading on a key. | Give them distinct names in HWiNFO and select them again. Some older reserved-name selections also need reselection. |
| Sparklines and local statistics | Subsecond changes can enter the graph. Observed data gaps and source, unit or type changes end the old history segment. | No setup change. A fresh segment after a gap is expected. |
| Alerts and contrast | Built-in numeric colors meet a 4.5:1 authored contrast floor. Warnings add a triangle; critical alerts add an octagon. | Check your custom colors on the actual display. They are kept as entered. |

If you used the **1.6.92 color preview**, the color wells and presets are
already familiar. The new work over that preview is source-link color
inheritance, the reliability behavior above, and the contrast and alert
changes. Upgrading from **1.6.0** adds both the colors and reliability work.

## Set the colors you want

**Signal** cycles through four hues. **Pairs** groups neighboring readings.
**Uniform** uses one hue. You can then change any individual color. **Auto**
removes that reading's override.

![Three-row and two-row dials with identical readings, comparing automatic text color against individual number colors.]({{ '/assets/img/dial-reading-colors-1.7.png' | relative_url }})

*Production dial renderer with fixed sample readings and generated histories.
The layouts and values are identical on both sides; only number colors change.*

![The 1.7 dial Appearance panel with the Signal preset and five individual reading colors.]({{ '/assets/img/pi-dial-reading-colors-1.7.png' | relative_url }})

*Actual settings-panel capture using live HWiNFO readings in a mock Stream
Deck host. This is not a photograph of the physical deck.*

Colors follow reading identity through rotation and reordering. On a
confirmed source link, an exact color for the displayed key wins; otherwise
its linked key's color is used. Alerts take priority, followed by valid
Custom Text. See [dial color settings](sensor-dial.md#reading-colors).

## Why a reading may now show less

The plugin should not label a current value as an average or choose between
two readings with the same Gadget name. Those cases now show unavailable
history or withhold the reading. Shared Memory remains the preferred source
because it supplies hardware identifiers, history and a consistency mutex.

![Key and dial status examples for a busy source, Shared Memory with no new data, and Gadget with unknown age.]({{ '/assets/img/reading-status-1.7.png' | relative_url }})

*Production status renderers with controlled failure scenarios. These are
rendered examples, not measurements from a hardware fault test.*

Gadget rereads each row to catch fields that change during a scan. That
catches some partial writes; it does not make the registry an atomic source.
The [source guide](data-sources.md) explains the remaining limits and pairing
steps.

## What the review caught

An adversarial review found a dial-history gap: select reading A, rotate to
B, let A disappear and return, then rotate back. A's old MIN/MAX could
survive. Retained sessions now check for missing or invalid readings and
source, unit, type or link changes while another reading is selected.
Ordinary rotation still preserves the session and does not count unseen
values as new samples.

Regression tests cover those cases. They establish software behavior, not
physical readability or long-run hardware stability. The release remains a
candidate until its hardware checks are complete.
