---
title: Themes & colors
nav_order: 6
description: Compare the seven themes and control text, accents and shared defaults.
---

Pick a theme in the strip below a key or dial's settings header. Choose **Default** to follow the shared theme, or a named preset for that key or dial only. A key's **Background** can show the page background set in the Stream Deck app ([Background](sensor-reading.md#background), new in 1.8).

For a see-through touch strip, use **Display → Background** on a dial. [Transparent backgrounds](sensor-dial.md#transparent-background) are available in 1.7.1. **Stars**, **Dusk** and **Nebula** draw a picture of the plugin's own across the whole deck ([Deck backgrounds](#deck-backgrounds-stars-dusk-and-nebula), new in 1.8).

## The seven presets

<ul class="theme-gallery" aria-label="Seven theme samples">
	<li class="theme-sample"><figure><img src="{{ '/assets/img/showcase/theme-tiles/void.webp' | relative_url }}" width="144" height="144" loading="lazy" decoding="async" alt="Void sample key with white temperature text on black."><figcaption><strong>Void</strong>Black with white values. Default for new installs.</figcaption></figure></li>
	<li class="theme-sample"><figure><img src="{{ '/assets/img/showcase/theme-tiles/graphite.webp' | relative_url }}" width="144" height="144" loading="lazy" decoding="async" alt="Graphite sample key on a dark slate background."><figcaption><strong>Graphite</strong>Dark slate (<code>#1A1C22</code>). Retained by installs configured before themes.</figcaption></figure></li>
	<li class="theme-sample"><figure><img src="{{ '/assets/img/showcase/theme-tiles/ultraviolet.webp' | relative_url }}" width="144" height="144" loading="lazy" decoding="async" alt="Ultraviolet sample key with a lavender accent on dark violet."><figcaption><strong>Ultraviolet</strong>Dark violet with a lavender accent.</figcaption></figure></li>
	<li class="theme-sample"><figure><img src="{{ '/assets/img/showcase/theme-tiles/midnight.webp' | relative_url }}" width="144" height="144" loading="lazy" decoding="async" alt="Midnight sample key with a light blue accent on dark blue."><figcaption><strong>Midnight</strong>Dark blue with a light blue accent.</figcaption></figure></li>
	<li class="theme-sample"><figure><img src="{{ '/assets/img/showcase/theme-tiles/forest.webp' | relative_url }}" width="144" height="144" loading="lazy" decoding="async" alt="Forest sample key with a green accent on dark green."><figcaption><strong>Forest</strong>Dark green with a green accent.</figcaption></figure></li>
	<li class="theme-sample"><figure><img src="{{ '/assets/img/showcase/theme-tiles/ember.webp' | relative_url }}" width="144" height="144" loading="lazy" decoding="async" alt="Ember sample key with amber text and accents on black."><figcaption><strong>Ember</strong>Black with amber text and accents.</figcaption></figure></li>
	<li class="theme-sample"><figure><img src="{{ '/assets/img/showcase/theme-tiles/paper.webp' | relative_url }}" width="144" height="144" loading="lazy" decoding="async" alt="Paper sample key with dark text on a light background."><figcaption><strong>Paper</strong>Light (<code>#E9E6DE</code>) with dark text.</figcaption></figure></li>
</ul>

<p class="theme-caption">Sample renderings from the plugin. <a data-image-viewer data-image-caption="Seven theme presets, layouts and alert states. Sample renderings from the plugin." href="{{ '/assets/img/themes-contact-sheet.png' | relative_url }}">Open the full comparison for layouts and alert states.</a></p>

The layout stays consistent when you change themes. [Individual dial colors](sensor-dial.md#reading-colors) can distinguish readings within the same theme.

## The display system

Built-in value, unit and numeric session-statistic colors have a calculated **4.5:1 contrast floor** against their authored backgrounds. Dimmed labels stay at least as readable as units.

That floor does **not** cover badges, a **Custom color** for text, individually chosen reading/cell/tile colors, or text drawn directly on a picture with **Clear**. For **Glass**, contrast is calculated against the panel over its worst-case picture. **Tint** and **Outline** use the outline behind each word. A key's **Background** follows the same rules over the page background, and a key in alert keeps its alert face ([Background](sensor-reading.md#background)). Physical readability still requires device testing.

Use a readable custom foreground and check it on your display, especially over a bright or busy strip picture. See the [background limits](sensor-dial.md#transparent-background).

## Per-key vs. shared

Set the shared theme in **Advanced → Shared defaults → Theme**. It applies to every HWiNFO key and dial set to **Default**, across all connected decks.

A named preset stays local. This lets you keep one dial in Ember while the rest follow Midnight, for example.

**Background** and **Words in the accent color** (new in 1.8, on the key and the dial panel alike) set the shared [Background](sensor-reading.md#background) and accent words for every key, dial and [strip display](strip-display.md) whose own choice is **Default**. One with its own choice keeps it. Below them, a line counts the keys, dials and strips on screen that keep their own choice, for example "4 dials and 1 strip use their own background". **Use it everywhere** (press it twice: the first press asks) sets every HWiNFO key, dial and strip back to **Default** for these two choices only: the ones on screen at once, the others the next time they appear. A choice made after that stays.

### Precedence

A per-key or per-dial theme wins over the shared theme. Change that key or dial to **Default** to make it follow again.

### The "Default" chip

**Default** follows the shared choice; it is not a separate color palette. Its dashed frame and link mark distinguish it from the preset it currently uses. The theme line says where the colors come from, such as **Default (shared: Void)** or **Ember (set on this key)**.

- **Change** opens the shared Theme setting.
- **Make shared** appears when a local theme differs from the shared one. It makes that theme shared, returns the key or dial to Default, and keeps its appearance.

<a class="image-link" data-image-viewer href="{{ '/assets/img/pi-theme-share.png' | relative_url }}" aria-label="Enlarge image"><img src="{{ '/assets/img/pi-theme-share.png' | relative_url }}" width="800" height="420" loading="lazy" decoding="async" alt="The top of a key&#x27;s settings panel: the header with the key&#x27;s live face in Ember, then the theme line reading Theme, Ember (set on this key) and a Make shared link, above eight named chips: Default, Void, Graphite, Ultraviolet, Midnight, Forest, Ember, selected, and Paper."></a>

*Settings-panel capture.*

Folding the strip keeps the chosen chip and its source visible. A new key with no reading shows the theme after you select one.

## Deck backgrounds: Stars, Dusk and Nebula

> **New in 1.8, checked on my Stream Deck + XL.** These three looks ran on my + XL; on the other decks they place a picture on (+, XL, 15-key and Neo) they are checked in renderer tests only.

**Stars**, **Dusk** and **Nebula** are the last three choices under a key's or dial's **Background**, in the strip display's **Background**, and under **Advanced → Shared defaults → Background**. Instead of showing a picture set in the Stream Deck app, the plugin draws its own: one picture across the deck, of which each key and dial draws its part. Each part is placed from Elgato's published layout of the device's display, so a cloud, the glow or the band of stars continues behind the gaps between keys and into the touch strip.

<div class="deck-gallery">
	<figure><a class="image-link" data-image-viewer data-image-group="deck-backgrounds" data-image-caption="Stars on the Midnight theme, with six independent dials. Sample rendering." data-image-credit="Device image: Elgato." href="{{ '/assets/img/deck-stars-1.8.jpg' | relative_url }}" aria-label="Enlarge the Stars deck"><img src="{{ '/assets/img/deck-stars-1.8.jpg' | relative_url }}" width="1600" height="1432" loading="lazy" decoding="async" alt="A Stream Deck + XL, front on, on the Midnight theme with Background Stars: small stars of different sizes sit in the dark blue behind the readings of all 36 keys and six dials, and a faint lighter band crosses the keys."></a><figcaption><strong>Stars</strong>On Midnight, with six independent dials.</figcaption></figure>
	<figure><a class="image-link" data-image-viewer data-image-group="deck-backgrounds" data-image-caption="Dusk on the Ultraviolet theme, with a Trend graph across the strip. Sample rendering." data-image-credit="Device image: Elgato." href="{{ '/assets/img/deck-dusk-1.8.jpg' | relative_url }}" aria-label="Enlarge the Dusk deck"><img src="{{ '/assets/img/deck-dusk-1.8.jpg' | relative_url }}" width="1600" height="1432" loading="lazy" decoding="async" alt="The same deck on the Ultraviolet theme with Background Dusk: the two lower key rows glow blue-violet, brightest at the bottom left, the top rows stay nearly black with a few stars, and the touch strip under them is dark behind a two-reading Trend graph."></a><figcaption><strong>Dusk</strong>On Ultraviolet, with a <a href="strip-display.html">Trend graph</a> across the strip.</figcaption></figure>
	<figure><a class="image-link" data-image-viewer data-image-group="deck-backgrounds" data-image-caption="Nebula on the Void theme, with an Area graph across the strip. Sample rendering." data-image-credit="Device image: Elgato." href="{{ '/assets/img/deck-nebula-1.8.jpg' | relative_url }}" aria-label="Enlarge the Nebula deck"><img src="{{ '/assets/img/deck-nebula-1.8.jpg' | relative_url }}" width="1600" height="1432" loading="lazy" decoding="async" alt="The same deck on the Void theme with Background Nebula: soft teal and blue clouds cross the lower key rows and continue into the touch strip, behind an Area graph of one reading, while the top row stays black."></a><figcaption><strong>Nebula</strong>On Void, with an Area graph across the strip.</figcaption></figure>
</div>

*Production-rendered fixed sample data on Elgato's own image of the Stream Deck + XL, not device captures. Device image: Elgato.*

| Background | What the plugin draws |
| --- | --- |
| **Stars** | The theme's background with a faint diagonal band and small stars of different sizes and brightness; a few have a soft glow. |
| **Dusk** | One soft glow rising from below the keys, brightest on the lower key rows and fading toward the top, in two colors that follow the theme (blue to violet on Void, Graphite and Midnight; violet to blue on Ultraviolet and Ember; green to teal on Forest), with a few early stars in the dark part. The touch strip draws the same glow at a fifth of its light, so the strip stays dark under its words. |
| **Nebula** | Soft clouds in two colors that follow the theme (blue and teal on Void, Graphite and Midnight; violet and blue on Ultraviolet and Ember; green and blue on Forest), over the theme's background made darker, with a few faint stars. The clouds stop where the theme's value color would lose its lead over the labels, so they are fainter on Ember than on the cool themes. |

- **Same sky every time.** Each deck draws its own picture, chosen from the device's id, and draws the same one every time the plugin starts. Nothing moves: a face changes only when its readings do.
- **Text.** Built-in values, units, labels and statistics keep 4.5:1 contrast against the brightest color the picture can draw behind them (a calculation), so labels and units draw lighter than on Theme. No star is drawn under a word. A **Custom color** for text stays exact.
- **No alert colors.** The picture never uses amber, orange or red, and a key in alert keeps its alert face.
- **Devices.** Keys and dials line up on the Stream Deck + XL and +; keys on the Stream Deck XL, the 15-key Stream Deck and the Neo. On another device, and for a key inside a Multi Action, each key draws its own small picture that does not line up with its neighbours. Keys of other plugins and empty cells do not show the picture.
- **Stars and Sky color.** On these three looks, **Stars** (All, Few or Off) sets how many stars draw and **Sky color** (Theme, Deep, Warmer, Cooler or Mono) moves the picture's colors. Both are also in **Advanced → Shared defaults**. On **Paper** the art does not draw: the panel says so under **Background** and shows both settings as idle. The **Stars** look keeps at least Few, so it offers no Off.
- **Paper** draws Theme with any of the three looks.
- **Cost.** The picture is drawn as SVG with each key image: no image files. On a full + XL page it adds under 1.6 KB per key image at the median (a unit test).

## A space picture behind the deck

The Stream Deck app can show one picture behind all the keys of a page and another behind the touch strip (right-click a key or the strip, **Set from File...**). That is the way to put a photograph behind the plugin: it costs nothing per frame, and it also shows in empty cells. Set the keys' and dials' **Background** to **Tint** or **Outline** (or **Glass**) so built-in text keeps its 4.5:1 floor over the picture. A dark, calm picture such as a deep field reads best.

<a class="image-link" data-image-viewer href="{{ '/assets/img/deck-deep-field-1.8.jpg' | relative_url }}" aria-label="Enlarge image" data-image-credit="Webb&#x27;s First Deep Field: NASA, ESA, CSA, and STScI. Cropped to the display. Device image: Elgato." data-image-credit-url="https://esawebb.org/images/weic2209a/" data-image-license="CC BY 4.0 (deep field)" data-image-license-url="https://creativecommons.org/licenses/by/4.0/"><img src="{{ '/assets/img/deck-deep-field-1.8.jpg' | relative_url }}" width="1600" height="1432" loading="lazy" decoding="async" alt="A Stream Deck + XL, front on, with all 36 Sensor Reading keys and six dials on Outline over Webb&#x27;s First Deep Field: galaxies and stars on a black sky show at full strength behind every key and dial, and each word has a thin dark outline."></a>

*Production-rendered fixed sample data on Elgato's device image, not a device capture: every key and dial on **Outline** on the Void theme. Picture: Webb's First Deep Field ([NASA, ESA, CSA, and STScI](https://esawebb.org/images/weic2209a/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), cropped), standing in for a page and strip picture set in the Stream Deck app. Device image: Elgato.*

The plugin ships no pictures. Many space pictures can be used freely, under conditions:

- **NASA** material is generally not under copyright in the United States. Acknowledge NASA as the source. Pictures on NASA sites credited to someone else, and NASA logos, are not covered, and nothing may suggest NASA endorses what you make.
- **ESA/Hubble** ([esahubble.org](https://esahubble.org/copyright/)) and **ESA/Webb** ([esawebb.org](https://esawebb.org/copyright/)) pictures are under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/): give the picture's credit line in full, link the license, and say what you changed (cropped, darkened).
- **Webb** pictures are credited "NASA, ESA, CSA, and STScI".
- Check each picture's own credit line: some list more names, and those belong in the credit too.

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

<a class="image-link" data-image-viewer href="{{ '/assets/img/pi-key-text.png' | relative_url }}" aria-label="Enlarge image"><img src="{{ '/assets/img/pi-key-text.png' | relative_url }}" width="800" height="284" loading="lazy" decoding="async" alt="Text color on Custom color, with the Custom text color well set to #660000 and the unticked Dim labels, units and stats (the value keeps the exact color) checkbox."></a>

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
