---
title: Languages
nav_order: 11.5
description: See which languages the plugin ships in and what a new language needs before it ships.
---

**1.8.0 ships in English only.** When the Stream Deck app runs in another
language, the plugin's names, tooltips, key and dial faces and settings
panels stay in English. This page describes the groundwork 1.8.0 carries
and the rule I follow before adding a language.

## The rule for a new language

I add a language only when a named person who reads it natively reviews
it, and keeps reviewing the strings each release changes. No machine
translation ships without that review. Latin-script languages come first;
Japanese, Korean and Chinese also need the faces checked on a real deck.
The Stream Deck app's languages are German, English, Spanish, French,
Japanese, Korean and Simplified and Traditional Chinese (the file codes are
`de`, `en`, `es`, `fr`, `ja`, `ko`, `zh_CN` and `zh_TW`).

A language is ready when all of these hold:

1. **A named reviewer.** Their name goes in the pull request that adds the
   language, and they review the translated text against the same plain
   writing rules the English follows.
2. **A complete catalog.** `com.lawrensen.hwinfo.sdPlugin/<code>.json`
   carries every string `en.json` carries: the plugin `Name` and
   `Description`, each action's `Name`, `Tooltip` and dial
   `TriggerDescription`, and every key of the `Localization` block. The
   settings panels' strings need the same language next to the English in
   `ui/pi-strings.js` (today `npm run l10n` writes English only). The
   release copy check refuses a language file with a missing or unknown
   key, and a `Description` under the Marketplace's 250 characters.
3. **A face fit check.** Every string has to fit the key, the dial
   touchscreen and the touch strip, or be cut with an ellipsis where the
   renderer cuts by design. The pseudo-language test (every English string
   40% longer, with accented letters) passes today for the Tahoma key and
   dial status faces, strip messages and the marked panel sections at
   320 px (a select cuts a long option, and its open list shows it whole).
   With the Segoe UI face font, two places must be fixed before a longer
   language ships, and the test records them so they cannot be forgotten:
   - the status lines on a key (such as "Start HWiNFO") have a fixed size
     and no fit, so longer text runs off the key;
   - a dial status face's title and value line are cut by character count
     rather than width, so longer text can run past the touchscreen's edge.

   For Japanese, Korean and Chinese, I also check the faces on hardware,
   since the face fonts' width tables cover Latin, Greek and Cyrillic only.
4. **The docs and the listing.** The docs pages, the README and the Elgato
   Marketplace description in that language keep the line saying the plugin
   is not affiliated with REALiX, the maker of HWiNFO.

## Numbers

Numbers keep the `.` decimal separator in every language, on purpose. The
face layouts measure values with it, and the settings panels read typed
limits with it, so a reading looks the same on the deck and in the panel.

## Reading names in other scripts

A reading you rename in HWiNFO in Japanese, Cyrillic or another script
shows in its own letters on a key, in English 1.8.0 too: the plugin reads
HWiNFO's UTF-8 names, prices a Japanese, Korean or Chinese character at a
full em and a Cyrillic one from the font's own width, and cuts a name too
long for the key with an ellipsis instead of letting it run off. Renderer
tests hold this for a Japanese and a Cyrillic name on the one- and
three-reading keys; I have not yet looked at one on a deck.

## How it works

- The plugin asks the Stream Deck SDK for each face and hint string. The
  SDK reads `<code>.json` for the app's language, then `en.json`. If
  neither has the string, or the lookup fails, the plugin uses the English
  built into it, so a face never shows a raw key.
- `en.json` repeats the manifest's English word for word. A language file
  replaces the manifest's text in its language, so a test holds the two
  equal.
- The settings panels load `ui/pi-strings.js` before their other scripts.
  It follows the panel's browser language, the way the Elgato panel library
  does, and falls back to English. In English it changes nothing on the
  page.
- One catalog, `src/i18n-catalog.ts`, is the source of the English. Run
  `npm run l10n` after changing it or the manifest's names, description or
  tooltips; it writes `en.json` and `ui/pi-strings.js`, and a unit test
  fails until you do.

## What the catalog covers in 1.8.0

The catalog holds the key and dial status faces, the stat badges, the
settings panels' status sentences, the live preview's words, the strip's
empty-pane messages, and the fixed labels of the panel sections new in 1.8:
Strip, the alerts' Timing, Reading links, Calculated readings, Unit and
decimals per reading, and the key's Background and Words in the accent
color.

Still English-only in the code, to move before a first language ships:

- every other panel section's text, and the strings the panels build at run
  time (the strip's notes and captions, the links' status lines and the
  calculated readings' messages);
- the strip's LIVE and PAUSED marks and its missing-dial notes, and the
  Yes and No of a Gadget on/off reading;
- the support report, the plugin log and `npm run probe`, which stay in
  English for support.
