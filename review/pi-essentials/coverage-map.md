# F01 control coverage map

One row per stored setting or panel control, per action. "Old" is `main`
at 2ca44e9 (1.6.0.0); "New" is this branch. Every setting that existed
keeps its stored path, type and default; nothing is renamed, removed or
re-typed (settings are append-only). No new stored field is added.

Legend

- **Scope**: `action` = this key/dial only (action settings); `global` =
  every HWiNFO key and dial on every Stream Deck (plugin global settings,
  marked "All keys and dials" in the panel); `panel` = local panel state,
  never stored.
- **Inherit**: how an absent or "" value resolves at runtime.
- **Vis**: when the control is shown. `always`, or the condition.
- **Role**: `E` essential (visible with the panel open, no fold opened),
  `C` common (one fold), `A` advanced.
- **Mutation**: every bound control writes only on a user change (never
  on load or render), through the shell's store: the in-memory document
  is updated at exactly the declared path and the whole document is sent
  with `setSettings` / `setGlobalSettings` (the SDK has no partial
  write). Text fields debounce 200 ms and never write mid-IME
  composition; number fields write only a valid number or empty.
- **Test**: `P:` scripts/e2e-pi-panels.mjs check (simulated host), `L:`
  scripts/e2e-pi-persistence.mjs leg, `U:` unit test file.

## Sensor Reading key (`ui/sensor-reading.html`)

| Setting / control | Old location | Stored path : type | Default / absent | Scope | Inherit | Vis | Role | New location | Mutation | Test |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Primary reading | Sensor (top) | `readingKey` : string id | absent = no reading | action | none | always | E | Reading → Reading (combobox) | Enter or click commits; arrows, Escape, Tab never write | P: keyboard combobox checks; L: picker legs |
| Label | Label | `label` : string | "" = reading's own name | action | reading label | always | E | Reading → Label on the key | text, debounced, IME-safe | P: edit "label", IME checks |
| Layout | Layout | `keyLayout` : "single"\|"dual"\|"triple"\|"quad" | "single"; unknown markers draw single | action | none | always | E | Reading → Readings on this key | select change | P: edit "layout"; U: pi-preview drawnKeyLayout |
| Reading 2 | Second sensor | `secondaryReadingKey` : string | absent | action | none | layout ≠ single | C | Reading → Reading 2 | as primary picker | L: layout legs |
| Label 2 | Second label | `secondaryLabel` : string | "" | action | reading label | layout ≠ single | C | Reading → Label 2 | text | L |
| Row 2 stat | Second shows | `secondaryStatMode` : "follow"\|stat | "follow" | action | row 1 stat | layout dual | C | Reading → Row 2 shows | select | L |
| Reading 3 | Third sensor | `quadReadingKey3` : string | absent | action | none | triple/quad | C | Reading → Reading 3 | picker | L |
| Label 3 | Third label | `quadLabel3` : string | "" | action | reading label | triple/quad | C | Reading → Label 3 | text | L |
| Reading 4 | Fourth sensor | `quadReadingKey4` : string | absent | action | none | quad | C | Reading → Reading 4 | picker | L |
| Label 4 | Fourth label | `quadLabel4` : string | "" | action | reading label | quad | C | Reading → Label 4 | text | L |
| Layout degraded note | none (silent) | derived (`drawnKeyLayout`) | n/a | panel | n/a | chosen ≠ drawn | E | Reading → hint under Readings on this key; Reading summary | read-only | U: pi-model reading summary |
| Stat shown | Show | `statMode` : "current"\|"min"\|"max"\|"avg" | "current" | action | none | always | E | Display → Value shown | select | L |
| Decimals | Decimals | `decimals` : "auto"\|"0".."3" | "auto" | action | none | always | E | Display → Decimals | select | P: edit "decimals" |
| °F | Unit | `fahrenheit` : boolean | false | action | none | always | E | Display → Show temperatures in °F | checkbox | L |
| Graph | Layout → Display | `displayMode` : "sparkline"\|"bar"\|"ring"\|"none" (legacy `sparkline` boolean read, never rewritten) | sparkline | action | legacy `sparkline` | single layout | E | Display → Graph under the value | select | P: edit "graph" |
| Theme | Theme gallery | `theme` : string id | "" = follow shared | action | global `theme` | always | E | Display → Theme (radio group, "Default" first) | click, or arrow/Home/End in the group | P: edit "theme chip", gallery keyboard checks, unknown theme |
| Text mode | Text | `textMode` : ""\|"theme"\|"dim"\|"custom" | "" = follow shared | action | global `textMode` | always | E | Display → Text color ("Default (shared: …)") | select | P: edit "text mode" |
| Custom text color | Text color | `textColor` : "#RRGGBB" | absent (invalid draws theme text) | action | theme value color seed | textMode custom | C | Display → Custom text color (+ hex code) | color input change only | P: edit "custom color" |
| Dim secondary | Other text | `textDimSecondary` : boolean | false | action | none | textMode custom | C | Display → Dim labels, units and stats | checkbox | L |
| Quad cell colors | Cell colors | `quadColors` : string[] (extra entries kept) | preset colors | action | preset | quad | C | Display → Cell colors | per-index patch (`patchColors`) | P: edit "one cell color", lossless layout switches; U: pi-model patchColors |
| Cell labels | Cell labels | `quadLabels` : boolean | false | action | none | quad | C | Display → Show a small label in each cell | checkbox | L |
| Warn | Warn at | `warnValue` : string number | "" = off | action | none | always | C | Alerts → Warn at | valid number or empty; error text otherwise, nothing written | P: edit "warn"; U: pi-model alerts |
| Critical | Critical at | `critValue` : string number | "" = off | action | none | always | C | Alerts → Critical at | as Warn | U: pi-model alerts |
| Direction | Direction | `alertBelow` : boolean | false | action | none | always | C | Alerts → Alert when the value drops to or below | checkbox | L |
| Press behavior | Press does | `pressBehavior` : ""\|"open-details"\|"tap-cycle-hold-details" | "" = cycle stats | action | none | not Back tile | C | Press → A press | select | P: edit "press" |
| Back role | none (hint only) | `detailRole` : "back" (read only) | absent | action | n/a | Back tile | E | Header kind + role note; Press section hidden | never written | U: pi-model interaction |
| Details list | Detail contains | `detailMode` : "source"\|"custom"\|"filter" | "source" | action | none | press opens details | C | Press → Details list | select | L |
| Custom list | Add sensor + chips | `detailKeys` : string[] (non-string and over-cap entries kept) | [] | action | none | mode custom | C | Press → Add readings (checklist) + tile editor | list patch (`splitKeyList`) | P: lossless list checks; L: J/L legs |
| Tile plan | tile editor | `detailTiles` : object[] (unknown fields per tile kept; unreadable entries neither pruned nor rewritten) | absent | action | density | mode custom | A | Press → tile editor | per-tile patch (`patchEntry`) | P: lossless tile checks, "unreadable tiles are neither pruned nor rewritten"; L: tile legs |
| Filter | Filter | `detailFilter` : string | "" | action | none | mode filter | C | Press → Filter (+ live count) | text | L |
| Density | Tile shows | `detailDensity` : "1".."4" | "1" | action | none | press opens details | C | Press → Readings per tile | select | L |
| Detail title | Detail title | `detailTitle` : string | "" | action | source/pattern | press opens details | C | Press → Title tile text | text | L |
| Second Back | Second Back | `detailMirrorBack` : boolean | true | action | none | press opens details | C | Press → Also go back from this key's own position | checkbox | L |
| Shared theme | Advanced → Deck theme | global `theme` : string id | "void" (legacy installs "graphite") | global | n/a | Advanced open | A | Advanced → Shared defaults → Theme | select | P: shared-change race checks |
| Shared text | Advanced → Deck text | global `textMode` | "theme" | global | n/a | Advanced | A | Advanced → Shared defaults → Text color | select | L |
| Shared text color | Advanced → Text color | global `textColor` | absent | global | n/a | shared textMode custom | A | Advanced → Shared custom text color | color input change | L |
| Shared dim | Advanced → Other text | global `textDimSecondary` | false | global | n/a | shared custom | A | Advanced → Dim labels, units and stats | checkbox | L |
| Type accents | Advanced → Type accents | global `typeAccents` : "on"\|"off" | "on" | global | n/a | Advanced | A | Advanced → Accent colors | select | L |
| Data units | Advanced → Data units | global `dataUnits` | "decimal" | global | n/a | Advanced | A | Advanced → Data units | select | L |
| Data source | Advanced → Data source | global `source` | "auto" | global | n/a | Advanced | A | Advanced → Connection → Data source | select | L |
| Poll interval | Advanced → Poll every | global `pollIntervalMs` | "1000" | global | n/a | Advanced | A | Advanced → Connection → Read every | select | L |
| HWiNFO setup steps | First time? tip (top) | none | n/a | panel | n/a | Advanced, or revealed by the status block | A | Advanced → Connection → HWiNFO setup steps; "HWiNFO setup steps" button in Reading status | none | P: truth checks |
| Support report | Advanced → Support | none (clipboard) | n/a | panel | n/a | Advanced | A | Advanced → Support | none | L |
| Config: this key | Advanced → This key | whole action document | n/a | action | n/a | Advanced | A | Advanced → Configuration documents → This key's settings | Replace writes the whole document once (unknown fields kept) | L: config legs |
| Config: shared | Advanced → Deck | whole global document | n/a | global | n/a | Advanced | A | Advanced → Configuration documents → Shared settings | Replace needs a second click within 5 s | L: shared apply two-click |
| Live value line | Live value box | none | n/a | panel | n/a | always | E | Header: exact device face + reading + state | none | P: parity checks |
| Status / missing | picker placeholder only | none | n/a | panel | n/a | state-dependent | E | Reading status block + header state | none | P: truth checks; U: pi-preview |

## Sensor Dial (`ui/sensor-dial.html`)

| Setting / control | Old location | Stored path : type | Default / absent | Scope | Inherit | Vis | Role | New location | Mutation | Test |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Current reading | Sensor | `readingKey` | absent | action | none | always | E | Reading → On the dial now (combobox) | as key picker; turning the dial also changes it | P: keyboard checks |
| Title | Label | `label` | "" | action | reading or chip name | always | E | Reading → Title on the dial | text | L |
| Title after a turn | Label mode | `labelMode` : "auto"\|"fixed" | "auto" | action | none | always | E | Reading → Title after a turn | select | L |
| Rotation membership | ticks in the Sensor picker | `rotationKeys` : string[] (non-string entries kept) | [] = the picked sensor's readings | action | picked source | always | E | Reading → Readings to rotate through (checklist; one Tab stop, arrows inside) | tick adds/removes one key; never changes `readingKey`; kept entries stay at their stored index | P: "ticking adds to the rotation", "Tab leaves the rotation checklist in one step" |
| Rotation order | chip order (drag-free; re-pick) | `rotationKeys` order | pick order | action | none | set non-empty | E | Reading → chips with up/down buttons | one move per press; focus stays on the moved chip | P: T5 reorder checks |
| Rotation groups | Split into groups | `rotationGroups` : object[] (unknown fields per group kept; non-object entries kept in place; flat mirror kept) | absent | action | flat set | groups exist | C | Reading → group editor | per-group patch (`patchEntry`), kept entries merged back at their index | P: lossless group checks, "a non-object group entry keeps its place" |
| Per-reading names | chip rename | `rotationNames` : map (junk entries kept) | {} | action | HWiNFO label | chips | C | Reading → chip name (click or Enter) | one key patch (`patchNames`) | P: rename lossless check |
| View | View | `dialView` : "single"\|"tworow"\|"overview" | "single" | action | none | always | E | Display → View | select | P: edit "view" |
| Row labels | Row labels | `overviewLabels` | "shorten" | action | none | overview views | C | Display → Row labels | select | L |
| Context line | Context line | `overviewHeader` | "top" | action | none | three rows | C | Display → Context line | select | L |
| Separators | Separators | `overviewSeparators` | "on" | action | none | three rows | C | Display → Separators | select | L |
| Decimals | Decimals | `decimals` | "auto" | action | none | always | E | Display → Decimals | select | L |
| °F | Unit | `fahrenheit` | false | action | none | always | E | Display → Show temperatures in °F | checkbox | L |
| Theme | Theme gallery | `theme` | "" = follow | action | global `theme` | always | E | Display → Theme (radio group) | as key | P: gallery checks (key panel; same code) |
| Text mode / color / dim | Text, Text color, Other text | `textMode`, `textColor`, `textDimSecondary` | "", absent, false | action | global | as key | E/C | Display → Text color block | as key | L |
| Bar range | Bar min / Bar max | `barMin`, `barMax` : string number | "" = session low/high | action | session | always (applies to one-reading view) | C | Display → Bar from / Bar to | valid number or empty | L |
| Warn / Critical / Direction | Warn at, Critical at, Direction | `warnValue`, `critValue`, `alertBelow` | "", "", false | action | none | always | C | Alerts | as key; plugin stamps `alertUnit` on edit | U: pi-preview unit scope |
| Threshold unit anchor | none | `alertUnit` : string (plugin-written) | absent = legacy reach | action | n/a | n/a | n/a | shown in the Alerts summary ("°C readings only") | never written by the panel | U: pi-preview, pi-model |
| Alert-aware cycle | On alert | `alertInterrupt` : boolean | false | action | none | always | C | Alerts → Auto cycle jumps to a critical reading | checkbox | L |
| Controls preset | Dial gestures & advanced → Controls | `controlPreset` : "legacy"\|"elite"\|"custom" | "legacy" | action | none | always | C | Controls → Gestures | select; picking Custom while Elite is shown copies the Elite map into unset gestures (the person's change only, never an echo) | P: edit "gesture preset" |
| Six gestures | Rotate … Long touch | `gestureRotate`, `gesturePressedRotate`, `gestureShortPress`, `gestureLongPress`, `gestureTap`, `gestureTouchHold` | preset map | action | preset | preset custom | A | Controls → Gestures (Turn, Pressed turn, Short push, Long push, Touch tap, Long touch) | select | L |
| Touch zones | Touch zones | `touchZones` : "off"\|"two"\|"three" | "off" | action | none | preset ≠ legacy | C | Controls → Touch zones | select | U: pi-model dial summary |
| Ignore turns | Bump guard | `rotationDisabled` : boolean | false | action | none | always | C | Controls → Ignore turns | checkbox | L |
| Auto cycle | Auto cycle | `autoCycleMs` : "off"\|ms string | "off" | action | none | always | C | Controls → Auto cycle | select | L |
| Reset reach | Reset reach | `resetScope` : "current"\|"set"\|"all" | "current" | action | none | always | C | Controls → A stats reset clears | select | L |
| Link ID | Link ID | `linkId` : string | "" | action | none | always | C | Controls → Link ID | text | L |
| Shared defaults, Connection, Support, Config | Dial gestures & advanced | globals as key; whole documents | as key | global / action | n/a | Advanced | A | Advanced (same blocks as key) | as key | L |
| Face / live state | Live value box | none | n/a | panel | n/a | always | E | Header: exact touchscreen feedback face + state | none | P: parity dial checks |

## HWiNFO Control key (`ui/control.html`)

| Setting / control | Old location | Stored path : type | Default / absent | Scope | Inherit | Vis | Role | New location | Mutation | Test |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Command | Command | `command` : command id (unknown kept and shown as "Unknown command") | "next" | action | none | always | E | Command → When pressed; restated in the header | select | P: edit "command"; U: pi-model control |
| Target | Target | `target` : string (trimmed at runtime) | "" = every dial | action | none | always | E | Command → Target; header "Sends to …" | text | U: pi-model control |
| Reset reach | Reset reach | `resetScope` | "current" | action | none | reset commands | C | Command → A reset clears ("Every dial, everywhere" ignores Target, said in the header) | select | U: pi-model control |
| Support report | Support fold | none | n/a | panel | n/a | Advanced | A | Advanced | none | L |

## Detail view tile (`ui/detail-slot.html`)

No settings on either side. The panel explains the tile's role (Back,
title, pager or reading tile) and where to change it; `pi-slot.js` never
writes. Test: P: slot fixtures observe zero writes.

## Controls removed or merged

| Old control | Why | Where its job went |
| --- | --- | --- |
| "First time? HWiNFO setup" tip at the top of every panel | Shown to every configured user forever | Revealed by the status block when HWiNFO is unavailable or publishes nothing; also under Advanced → Connection |
| "Live value" box | Duplicated a value the header now shows as the device's own face | Header |
| Sensor picker rotation ticks on the dial | One control did two jobs (current reading and membership) | Separate combobox (current) and checklist (membership) |
| Row cap message ("showing 150 of …") | Cap removed | Picker renders every match |
