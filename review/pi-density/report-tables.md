### Content height at the app's panel (378x410), px

| Panel and state | 4bf09c0 | this pass | change |
| --- | ---: | ---: | ---: |
| key-empty default | 1042 | 748 | -28% |
| key-configured default | 1042 | 748 | -28% |
| key-configured all-open | 2583 | 2256 | -13% |
| key-configured all-folded | 320 | 403 | +26% |
| key-dense default | 1386 | 988 | -29% |
| key-dense all-open | 2927 | 2512 | -14% |
| key-triple default | 1177 | 850 | -28% |
| key-details all-open | 3211 | 2886 | -10% |
| key-back default | 1114 | 820 | -26% |
| key-missing default | 1184 | 872 | -26% |
| key-stale default | 1184 | 892 | -25% |
| key-unavailable default | 1200 | 908 | -24% |
| dial-configured default | 1278 | 1159 | -9% |
| dial-configured all-open | 3183 | 3249 | +2% |
| dial-configured all-folded | 352 | 419 | +19% |
| dial-groups default | 1903 | 1656 | -13% |
| dial-groups all-open | 3916 | 3887 | -1% |
| dial-custom-gestures all-open | 3403 | 3365 | -1% |
| dial-missing default | 1390 | 1251 | -10% |
| dial-unavailable default | 1346 | 1216 | -10% |
| control-default default | 392 | 387 | -1% |
| control-reset all-open | 596 | 576 | -3% |
| slot-reading default | 233 | 229 | -2% |

### Key default and all-open across the matrix, px (before → after)

| State | 320x400 | 320x560 | 378x410 | 380x560 | 380x720 | 400x800 | 560x800 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| key-configured default | 1090 → 776 | 1090 → 776 | 1042 → 748 | 1042 → 748 | 1042 → 748 | 1042 → 748 | 931 → 748 |
| key-configured all-open | 2728 → 2365 | 2728 → 2365 | 2583 → 2256 | 2583 → 2256 | 2583 → 2256 | 2567 → 2256 | 2360 → 2114 |
| key-dense all-open | 3073 → 2622 | 3073 → 2622 | 2927 → 2512 | 2927 → 2512 | 2927 → 2512 | 2911 → 2496 | 2703 → 2341 |
| key-details all-open | 3392 → 3066 | 3392 → 3066 | 3211 → 2886 | 3211 → 2886 | 3211 → 2886 | 3195 → 2870 | 2854 → 2607 |
| dial-configured default | 1406 → 1236 | 1406 → 1236 | 1278 → 1159 | 1278 → 1159 | 1278 → 1159 | 1232 → 1159 | 1121 → 1111 |
| dial-configured all-open | 3425 → 3471 | 3425 → 3471 | 3183 → 3249 | 3183 → 3249 | 3183 → 3249 | 3089 → 3233 | 2817 → 2965 |
| dial-groups all-open | 4189 → 4159 | 4189 → 4159 | 3916 → 3887 | 3886 → 3887 | 3886 → 3887 | 3775 → 3871 | 3390 → 3570 |

### Header cost and the palette at 378x410

| Panel | pinned before | pinned after | header px before | header px after | palette y before | palette y after (always open) |
| --- | --- | --- | ---: | ---: | --- | --- |
| key-configured default | no | yes | 0 | 89 | 662 below the first screen | 116 in view |
| key-configured all-folded | no | yes | 0 | 89 | 463 (in a folded section) | 116 in view |
| key-unavailable default | no | yes | 0 | 89 | 820 below the first screen | 277 in view |
| key-missing default | no | yes | 0 | 89 | 804 below the first screen | 240 in view |
| dial-configured default | no | yes | 0 | 105 | 791 below the first screen | 132 in view |
| dial-configured all-folded | no | yes | 0 | 105 | 377 (in a folded section) | 132 in view |
| dial-unavailable default | no | yes | 0 | 105 | 859 below the first screen | 293 in view |

### Task reachability at 378x410 (keyboard from the top, nothing focused)

| Task | Fixture | What | Tab + Enter before | after | target y before | after | first screen before | after | covered by header after |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| T1 | key-empty | Pick a reading | 3 | 4 | 173 | 271 | yes | yes | no |
| T2 | key-configured | Theme gallery | 12 | 2 | 662 | 116 | no | yes | no |
| T2 | dial-configured | Theme gallery (dial) | 23 | 2 | 791 | 132 | no | yes | no |
| T2 | key-configured | Text color (this key) | 14 | 10 | 844 | 424 | no | no | no |
| T2 | key-configured | Decimals | 9 | 12 | 423 | 514 | no | no | no |
| T3 | key-configured | Readings on this key | 6 | 8 | 304 | 326 | yes | yes | no |
| T3 | key-dense | Reading 4 picker | 13 | 13 | 583 | 503 | no | no | no |
| T4 | key-configured | Warn threshold | 16 + 1 | 17 + 1 | 982 | 695 | no | no | no |
| T5 | dial-configured | Rotation search | 16 | 7 | 444 | 393 | no | yes | no |
| T5 | dial-groups | Rotation search (groups) | 24 | 7 | 562 | 393 | no | yes | no |
| T5 | dial-groups | Rotation list (reorder) | 9 | 11 | 302 | 490 | yes | no | no |
| T6 | key-configured | Press behavior | 17 + 1 | 18 + 1 | 1017 | 726 | no | no | no |
| T6 | dial-configured | Dial gestures preset | 30 + 1 | 23 + 1 | 1253 | 1137 | no | no | no |
| T7 | key-missing | Recovery action | 5 | 2 | 329 | 177 | yes | yes | no |
| T7 | key-unavailable | Recovery action | 5 | 2 | 345 | 214 | yes | yes | no |
| T8 | key-configured | Shared theme | 18 + 1 | 20 + 2 | 1121 | 840 | no | no | no |
| T9 | key-configured | This key's config document | 27 + 1 | 23 + 2 | 1761 | 899 | no | no | no |

Horizontal overflow, worst state in the matrix: before 0 px, after 0 px. Settings writes while measuring: before 0, after 0.
