# Five reviews: set the shared theme from the gallery (2026-09-26)

Five independent AI reviewers (xhigh), one lens each. Scores 0 to 10.

| Option | UI | UX | UXR | A11y | Adversarial |
| --- | --- | --- | --- | --- | --- |
| A | 3 reject | 3 reject | 2 reject | 2 reject | 2 reject |
| B | 7 acceptable | 9 recommend | 8 recommend | 4 acceptable | 3 reject |
| C | 3 reject | 3 reject | 3 reject | 3 reject | 2 reject |
| D | 6 acceptable | 5 acceptable | 6 acceptable | 9 recommend | 8 recommend |
| E | 4 reject | 4 reject | 4 reject | 3 reject | 3 reject |
| F | 5 acceptable | 3 reject | 4 reject | 8 acceptable | 7 acceptable |
| X1 | 9 recommend | 5 acceptable | 5 acceptable | 5 acceptable | 4 reject |
| X2 |  |  | 7 acceptable | 3 reject | 2 reject |

Option ids are per reviewer after A to F (X1 and X2 mean different things in different reviews; see reviews.json).

Built: the UI reviewer's X1 (B made exact): **Make shared** in Change's slot on an explicit pick; the global theme first, then the key back to Default; focus to the Default chip; no right click, no mode, no confirmation. Guards added from the accessibility and adversarial reviews: the row ends 8 px before the link (90 px reserve at 312 px and wider, the fold row's narrow layout below 312 px), a double click never reaches Change, a held Enter shares once, the line updates without waiting for the plugin's echo, the announcement names the old shared theme. D (a chip gallery in Shared defaults) stays an option.
