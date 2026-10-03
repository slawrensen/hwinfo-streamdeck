# Formative study plan (NOT RUN)

Nothing here has been run with people. The findings in REPORT.md come
from measurements on a simulated host and from expert walkthroughs by
review agents; none of that is a user study. This plan is the smallest
honest check of the choices this pass made. Drafted from the UX research
agent's plan (summarized in reviews/README.md) and adapted to the theme strip that
was built.

## What it should answer

- H1: the always-open theme strip draws a new user's first click away
  from picking a reading.
- H2: without visible names on the unselected swatches, people confuse
  the dark themes (Void, Graphite, Midnight) or pick a named theme when
  they meant Default (a wrong-scope pick).
- H3: people rarely open the "How … works" links, so a question the
  visible text no longer answers (issue #31: numbers vs accents) comes
  back.
- H4: keyboard and screen-reader users can reorder a dial's rotation with
  the list and its toolbar without help.
- H5: power users setting up many keys find the strip in the way.

## Who

6 core participants plus 1 or 2 keyboard or screen-reader users.

- Windows 10 or 11, owns a Stream Deck (at least two with a dial model),
  HWiNFO installed.
- 3 newcomers (never used this plugin, have not read its docs or issues
  in the last month) and 3 regulars (5 or more keys, or any dial).
- Screen reader or keyboard-only: which one, how long.
- Consent to screen and audio recording and to exporting the test
  profile's settings afterwards.

## Setup

- A dedicated test profile, backed up first; the participant's own deck.
- Two builds with the same plugin UUID and different versions (the app
  skips an install at an equal version): the 1.7.0 candidate before this
  pass (4bf09c0) and this pass. Order counterbalanced (AB for half, BA for
  half).
- A fixture profile with: one key following the shared theme, one key on
  Paper with a custom text color, one key whose saved reading is missing,
  one dial with a three-reading rotation.

## Tasks (same order in both builds)

| # | Script | Success |
| --- | --- | --- |
| P0 | Before anything: a still image of an empty key's panel. "This key is new; click where you would make it show your CPU temperature." | first click on the Reading search |
| T1 | "Make this key show your CPU temperature." | the right reading shows |
| T2 | "This key looks different from the others. Make it match them." | theme and text color both back to Default; picking a named theme counts as a wrong-scope error |
| T8 | "Make every key Ember without touching keys you styled yourself." | shared theme Ember, no per-key theme added |
| T5 | "Add GPU Hot Spot to the dial's rotation, put it first, and do not change what the dial shows now." | Hot Spot in the set at position 1, reading on the dial unchanged |
| T7 | Moderator closes HWiNFO. "What is wrong, and what would you do?" | names the cause and a fix |
| Q | After T2: "What changes if accents go by sensor type?" | graphs and badges, not the numbers |

## Measures

Completion, time, first click, errors (wrong scope, wrong reading,
unintended writes from a diff of the exported settings), section and
"How … works" opens, and a one-question ease rating plus confidence after
each task.

## What would change the design

- 2 or more first clicks in P0 land on the strip: shrink it further or
  show it only once a reading is picked.
- 2 or more wrong-scope picks in T2 or T8: make Default's scope louder
  (the chip names every theme since 2026-09-26, so hesitation between
  dark swatches is no longer the risk to watch; confusion between Default
  and the theme it follows is).
- T5 failures by keyboard or screen-reader users: revisit the listbox and
  toolbar pattern with them.
- Q answered wrong by 3 or more: move the accent sentence back to always
  visible under Accent colors as well.

## What 6 to 8 people cannot tell you

Differences between builds are not measurable at this size (two people
per cell; 2 of 2 against 0 of 2 is not significant), nor how common a
problem is in the wider user base, nor anything general from one or two
screen-reader users. Preference is not performance, and people recruited
from the issue tracker skew expert. What it can show: problems most
people hit.
