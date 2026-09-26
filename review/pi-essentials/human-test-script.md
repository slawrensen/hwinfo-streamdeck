# F01 human validation script (NOT RUN)

Status: **NOT RUN.** No person has used these panels in the Stream Deck
app. Every task number in this folder comes from an automated expert
walkthrough on a simulated host. This script is ready for a moderated
session; it is written so the moderator does not teach the new layout.

## Setup

- Windows 10 or 11, Stream Deck app 6.9 or later, HWiNFO running with
  Shared Memory Support on. Use a test profile, never a production one.
- Install the candidate build named in the review record (hash checked)
  on a machine that is not running a soak.
- Prepare one Sensor Reading key (configured: CPU temperature, warn 80,
  critical 90), one empty Sensor Reading key, one Sensor Dial with a
  three-reading rotation set, and one HWiNFO Control key.
- Record the screen and the Stream Deck app window at 100% and 150%
  Windows scaling. Note the device model.

## Moderator rules

- Read each task exactly as written. Do not name sections, labels or
  where things are.
- If asked "where is it?", answer "Where would you expect it?" once, then
  let the participant continue or give up.
- Stop a task at 3 minutes. Record success, time, wrong turns (a section
  opened or a control changed that the task did not need), and any
  setting written by mistake (check the key afterwards).
- After each task ask: "How sure are you that it is set the way you
  wanted? (1 not sure to 5 certain)".

## Tasks

| ID | Read aloud | Success when |
| --- | --- | --- |
| T1 | "Make the empty key show your GPU temperature." | The empty key shows a GPU temperature. |
| T2 | "Make the CPU key show one decimal and a calmer text color." | decimals 1; text dimmed or custom; nothing else changed. |
| T3 | "Show a second reading on the CPU key, underneath the first." | Two stacked readings on the device. |
| T4 | "What happens when the CPU gets hot? Change it so the warning comes at 75." | Participant states the current rule, then warn 75. |
| T5 | "Add the GPU hot spot to what the dial rotates through, and make it come first." | Hot spot in the set, first; the reading on the dial unchanged. |
| T6 | "Make a press on the CPU key open a page of all CPU readings." | A press opens the detail view (Every reading from this reading's source). |
| T7 | Unplug or stop the reading's source (moderator does this), then: "The key looks wrong. What is going on, and what can you do?" | Participant says the saved reading is kept and not found (or HWiNFO is down), and names a fix. |
| T8 | "Change the look of every HWiNFO key at once, without touching keys you styled yourself." | Shared theme changed; keys with their own theme unchanged. |
| T9 | "Save this key's setup so you could put it on another key later." | Participant copies the key's configuration document. |
| T10 | "Make the Control key reset stats only on the CPU dial." | command resetStats, reach current, target matches the dial's Link ID. |

## After the session

- Five-point ease rating for the panel overall; one sentence on what was
  hardest.
- Export each changed key's settings (Configuration documents) and diff
  against the pre-session export: any change not asked for is a finding.
- File findings with the task ID, the participant's words, and the
  screen-recording timestamp. Do not paraphrase participants into
  recommendations; keep what they did and said.
