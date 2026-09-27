# Review record

Five independent, read-only review agents ran against the same brief
(`BRIEF.md`), each with its own lab port so they could measure in
parallel, on 2026-09-25. They are AI reviewers, not people; their
walkthroughs are expert inspections, not a user study. Their scratch
files stayed outside the repository (`%TEMP%\hw-review-*`). A second,
verification-only pass by three of them ran on the final tree (see the
end).

| Agent | Question | Recommendation |
| --- | --- | --- |
| Pattern precedent (web research) | What mature narrow inspectors keep visible | B (always-open band); C contradicted by tooltip-only names; E by sticky cost |
| UX research | Personas, cognitive walkthroughs, heuristics, study plan | B, medium confidence, with two fixes (repair above the band; #31 line visible) |
| Accessibility and keyboard | axe + own traversal at 410 px, APG patterns, forced colors, zoom | B, high confidence (C: 19 focus issues, collapses in forced colors) |
| Information architecture and copy truth | IA, summaries, every changed sentence against the runtime | B, medium-high confidence; 4 P1 copy defects |
| Visual and interaction design | Ranked A to E, proposed a sixth placement | F (one-row strip), medium-high confidence; B if names are part of the identity |

## Decision

Built F with the safeguards the other four asked for: the name of what is
drawn is always visible beside the swatches (not in a tooltip), browsing a
swatch by pointer or keyboard names it in that line, each radio keeps its
full accessible name, and one line under the strip keeps the scope
("Default follows the shared theme", with its link) visible. F keeps every
guarantee B gave (never folded, on the first screen of the app's 410 px
panel for keys and dials, two Tab stops) at about half B's height, which
keeps the missing-reading repair and the dial's rotation search on the
first screen as well. The fallback, if people confuse the dark swatches
without names, is B's named two-row grid (UXR-PLAN.md).

## Findings and dispositions (first pass)

P0

| Finding (agent) | Disposition |
| --- | --- |
| Down Arrow from a typed search could not reach filtered results in either checklist (a11y; also in 4bf09c0) | Fixed: first visible result; e2e check "Down Arrow from a typed search reaches the first visible result" |
| Delete and F2 in a group list with no selection acted on another group's member (a11y) | Fixed: guarded, and focusing a list selects its first member; e2e check "Delete in group 1's list …" |

P1

| Finding (agent) | Disposition |
| --- | --- |
| A fails the owner's rule (dial palette at y 610; folds hide it) (all) | Placement changed (F) |
| B pushes the missing-reading repair off the first screen (UX, design) | Status block moved under the header, "Pick another reading" action added, F halves the band |
| Visible alert help wrong for bytes and rates (IA) | Fixed on key and dial; folded duplicate removed |
| Dial scope sentence omitted the bar ends (IA; verified in src/actions/sensor-dial.ts) | Fixed |
| Data source select truncated in a paired row (IA) | Full width again |
| #31 explanation hidden behind "How this works" (UX) | One visible line under Text color |
| Old `.hw-sub` subhead rule restyled every Advanced label (design) | Dead selector removed |
| Rotation selection ring 2.73:1 (design, a11y) | var(--hw-text) |
| Toolbar misaligned under grouped lists (design) | Indented with the lists and kept adjacent to the selected list. The fixed slot declined here was adopted in the second pass, after the cross-group click defect showed that a toolbar moving between groups shifts the list under the pointer |
| Focus sent off screen after Split/Merge (a11y) | Split focuses the new name, Merge the list, fallback scrolls |
| A field focused as a checklist closes landed under the header (a11y) | Scrolled back into view on the next frame |
| Detail picker's pinned row plus header covered a 410 px panel (a11y) | Unpinned below 600 px height; inline results capped at 38vh |
| No Windows High Contrast support (a11y) | forced-colors rules added (emulated only; real High Contrast NOT RUN) |

P2 fixed: hold, forced-source and empty-list copy; gesture verbs; Value
shown caveat; install-once sentence visible; Display summary drops the
theme and names °F and the graph; summary vocabulary ("read every", "data
units"); unknown shared theme reads as Void; "Temperature" over °F;
"Readings for <group>"; placeholders sized to fields; "Set Gestures (under
Controls)"; ←/→ glyphs; Control target help; °F cell alignment; picker
ellipsis; disclosure markers; ledes aligned; fold-all glyph center bar;
empty key's header; gallery updated in place; announcements repeat;
distinct "How … works" names; rename announced; toolbar title duplicates
removed.

Declined or kept, with reason:

- Missing rotation member shows its raw key (UX): kept; the key is the
  only identity left when HWiNFO no longer lists it, and a contract test
  pins it. The on-dial style no longer hides the missing warning.
- Alert-direction label shortened: reverted to the original wording,
  which the docs quote verbatim.
- An enlargement control for the dial face below 372 px width (brief):
  not added. At the app's measured 373 px width the face keeps its full
  176 px; it shrinks (to 112 px at 320) only on narrower panels, which the
  app was not seen to produce.
- Title attribute on the fold buttons: kept (icon-only buttons; the title
  adds the Alt-click hint the name does not).

## Second pass (verification only)

See `second-pass.md`.
