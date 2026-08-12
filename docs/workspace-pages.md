---
title: Workspace pages
nav_order: 4.6
---

A Sensor Reading key can switch the deck to a blank page you lay out yourself: press the CPU key and the deck jumps to your CPU workspace, with whatever keys you put there. Where a [drill-down](sensor-details) shows you a page the plugin fills, a workspace page is empty and stays yours. This is the follow-up to [issue #5](https://github.com/slawrensen/hwinfo-streamdeck/issues/5).

## What it is (and is not)

A workspace page is a page of a **plugin-managed profile**, not a native Stream Deck folder. The Stream Deck SDK does not let a plugin open a folder or any profile you made yourself, so the plugin ships one editable four-page profile per supported deck type ("HWiNFO Workspace" in the app's profile list) and switches to the page a key asks for.

Practical consequences:

- The first time you press a workspace key on a deck, the Stream Deck app asks to install that deck's workspace profile. If you accept, **that one press lands on page 1 whichever page the key is set to**, because the prompt consumes the original request; press the key again and it goes to the page you picked. If you decline, nothing switches and the key says so, and the next press asks again. Keys left on the default page 1 never see the difference, and at that moment all four pages are identical anyway.
- Every page ships empty except a Back key in the top-left cell. Everything else is yours to fill with ordinary keys, HWiNFO keys or anything else, in any layout.
- The plugin never paints, repairs or overwrites a workspace page. It only ever asks the app to switch to one.
- Back returns to the profile you came from. The app remembers one previous profile, not a trail, so if you hop from a workspace page into a drill-down and back, where the second Back lands is the app's restore behavior and not something this plugin stores.
- Four pages is permanent. The Stream Deck app never updates a profile you already have installed, and a workspace page holds your layout, so the bundle's identity is frozen: shipping a fifth page would mean a new profile and a fresh prompt, leaving everything you arranged behind on the old one.
- The pages are addressed by position. If you duplicate or delete pages in the Stream Deck app, the plugin cannot see that, and a key set to "page 3" still asks for the third page of whatever the profile now holds.
- Decks with no bundled workspace refuse the press and say so on the key. The panel names the deck when that happens.

## Turning it on

In the key's settings panel, under **Press**:

1. Set **Press** to "Open a workspace page".
2. Pick **Workspace page**, 1 to 4.
3. Press the key. Accept the install prompt the first time.

The key keeps showing its own live reading the whole time, so a workspace opener still earns its place on the deck. **Show** picks which stat that face displays, exactly as it does for any other Sensor Reading key.

## Getting back

Every workspace page ships with a Back key in the top-left cell. It is an ordinary key: move it where you like, or give it a sensor so it shows a live reading instead of the Back face. Its press stays fixed to Back whatever else you change about it.

If you delete it by accident, switch profiles from the Stream Deck app to get out, then delete the "HWiNFO Workspace" profile under Preferences, Profiles and press a workspace key again to reinstall a clean copy. Doing that discards the pages you arranged, so it is worth keeping one way out on every page.

## A workspace or a drill-down?

Both are opened by a key press and both come back with Back. Pick by who fills the page:

| | Drill-down | Workspace page |
| --- | --- | --- |
| Who fills it | The plugin, from the sensor you pressed | You |
| Content | Every reading of that sensor, paged | Whatever keys you place |
| Follows the key you pressed | Yes | No, the page is fixed per key |
| Pages | One per deck type | Four per deck type |
