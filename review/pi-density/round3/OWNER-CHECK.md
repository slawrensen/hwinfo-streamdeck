# Your hands-on check (round 3 candidate)

About ten minutes on the real app. Nothing here needs a new profile
except step 7, which should use a throwaway one. Every step names what
to look for and what counts as a failure. I have not done any of these
on the hardware myself: the app was not mine to click.

1. **Theme line and inheritance.** Open any configured Sensor Reading
   key. Under the header: "Theme  Default (shared: Void)  Change" on one
   line, the eight named chips under it. Click **Ember**: the line reads
   "Ember (set on this key)", Change disappears but nothing below moves.
   Click **Default** again, then **Change**: Advanced opens at the
   shared Theme select and nothing is written. Fail: the line and chips
   jump on a pick, a name is cut off, or Change writes anything.
2. **Fold pair.** The two chevron buttons at the top right: Open all
   (arrows apart) and Fold all (arrows together) look like one pair,
   same weight and size, no middle line. The Reload button next to the
   reading search draws the same kind of circular arrow at the same
   weight. Fail: one looks heavier, blurrier or off-center.
3. **Where a tick lands.** On a Sensor Dial with rotation groups, open
   its panel while a reading from group 2 is on the dial. The filled
   radio is group 2's, the search label says "Readings for <group 2>",
   and a reading you tick lands there. Fail: ticks land in group 1.
4. **Editing the rotation.** Select the last reading of group 1 and
   press **Later**: it moves to the start of group 2, the toolbar moves
   with it and the Later button stays under your pointer. Press the ×
   of a group that holds readings: it changes to "Remove group and its
   N readings?" and only the second press removes it; a double click
   only arms it. Fail: anything removed on one press, or the button you
   pressed slides away.
5. **Dial behavior lines.** Under "On the dial now" the line names what
   changes the reading (for Elite: "Turns and pressed turns change this
   too"). Tick Ignore turns under Controls: it says "Turns are ignored
   here." Fail: the line promises a gesture that does nothing on the
   hardware.
6. **Recovery.** Quit HWiNFO for a moment with a key panel open. The
   status box offers **Check again**; press it: a line says when the
   answer came back and that the plugin reads HWiNFO on its own. Start
   HWiNFO again: the box clears by itself. Fail: pressing it does
   nothing visible.
7. **The theme band folds.** On a key, click the Theme row: it folds to one
   row with the checked theme as a small chip in its own colors and where it
   comes from. Select another key: it stays folded; select a dial: its band
   is open (each panel kind keeps its own fold). Click the row again to open
   it. Fail: the chip is missing or wrong, a click on Change folds the band,
   or a fold sticks across panel kinds.

8. **Keys the app might keep (throwaway profile only, R52).** On a dial
   in a throwaway profile, click a reading in the rotation list, then
   press F2 (rename field opens), Alt+Left and Alt+Right (the reading
   moves), Alt+Home and Alt+End (it moves to either end) and Delete (it
   leaves the rotation). Then press Delete in the Title field of that
   dial: only a character is deleted. Fail: the app deletes the action
   or the key, or a key does nothing. If Delete misbehaves, I remove
   that binding before release; the Remove button stays.

Rollback, if anything is wrong:

```
pwsh -File <scratch>\bench\tools\deploy.ps1 -From %USERPROFILE%\hwinfo-bench-backup\2026-09-26-0857-f01q\com.lawrensen.hwinfo.sdPlugin
```
