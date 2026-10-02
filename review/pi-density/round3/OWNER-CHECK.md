# Your hands-on check (round 3 candidate)

About ten minutes on the real app. Nothing here needs a new profile
except step 7, which should use a throwaway one. Every step names what
to look for and what counts as a failure. I have not done any of these
on the hardware myself: the app was not mine to click.

1. **Theme line and inheritance.** Open any configured Sensor Reading
   key. Under the header: "Theme  Default (shared: Void)  Change" on one
   line, the eight named chips under it. Click **Ember**: the line reads
   "Ember (set on this key)" and **Make shared** takes Change's place;
   nothing below moves. Press **Make shared**: the line reads "Default
   (shared: Ember)" with Default checked, and every key on Default turns
   Ember. Then **Change**: Advanced opens at the shared Theme select; set
   it back to Void. Fail: the line and chips jump on a pick, a name is
   cut off, Make shared changes a different theme, or Change writes
   anything by itself.
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
   **Delete: done by the owner on d09 (2026-09-26).** Delete removed the
   selected reading from the rotation list and nothing else; the dial and
   its key stayed. (Emptying the list then ran the dial through every
   reading of its sensor, as designed; the panel note and the docs now say
   what an overview shows then.)
   **F2 and the Alt keys: done by the owner on d11 (2026-09-26).** F2
   opened the name field and Alt+Left, Alt+Right, Alt+Home and Alt+End
   moved the selected reading; the app took none of them. Settings after
   the check: only the readings ticked for it, and no name stored by an
   unchanged F2 and Enter. Step 8 passes.

9. **The final bundle's faces (RC review, 2026-10-02).** Only after the
   soak closes, install the final archive (its hash is in CONTINUATION,
   "Now (2026-10-02)"); the deck runs d20 until then. These faces changed
   after every earlier step here, and only the renderer and the app's own
   QtSvg have drawn them, never a deck.
   a. **Three-row keys.** Two Triple keys between them carry CPU Package,
      GPU Power, -12V and Battery (three readings each), on the + XL and,
      if you have one, a 72 px deck (MK.2, Mini or Neo). Each label stays
      clear of its number. Fail: a label touches or runs into its value.
   b. **Long unit on a two-reading key (only if you have one).** The
      plugin has no unit setting; a long unit comes from HWiNFO, such as a
      custom sensor whose unit is "requests/sec" with a value of four
      digits or more. On a Dual key the value shows whole, and the unit is
      shortened with "…" only when it would not fit. Fail: the number
      loses a digit.
   c. **Status keys.** Quit HWiNFO and wait about 20 s: the keys hold
      their last values for a few seconds (the plugin log said 11 s on
      your restart today), then show "Start HWiNFO / not detected" inside
      the key's visible area. "Shared Memory off" and "Sensor missing" are
      a known, deferred fit on the smallest keys; note them, they are not
      a new fail. Fail: "Start HWiNFO" is cut at the edge.
   d. **Ember alert rows.** On a three-row Overview dial in Ember, set
      Warn at and Critical at so one row is in warning and one critical.
      The amber row stands apart from Ember's own amber numbers. With
      **Color numbers by sensor type** ticked and Accent colors on By
      sensor type, the red row also stands apart from a temperature row.
      Fail: you cannot tell an alerting row from a calm one at a glance
      (if so, I record it as a known limit or deepen Ember's warning color
      after 1.7.0).
   e. **Control key.** Its face reads HWiNFO / CONTROL in Segoe UI,
      lighter than before, and a press still shows the small tick badge.
      Fail: the face is blank or the badge sticks.
   f. **Small text.** Units and three-row labels are lighter than in
      1.6.0 (Segoe UI in place of Tahoma). Fail: you find them hard to
      read at arm's length on the smallest keys you use.
   g. **The dial's title setting.** In a dial's panel, Reading shows
      **Title when the dial moves on** beside **Title on the dial**, on one
      line. Fail: the label wraps or pushes the select out of line.

Rollback, if anything is wrong:

```
pwsh -File <scratch>\bench\tools\deploy.ps1 -From %USERPROFILE%\hwinfo-bench-backup\2026-09-26-0857-f01q\com.lawrensen.hwinfo.sdPlugin
```
