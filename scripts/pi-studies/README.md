# Property-inspector layout studies (not shipped)

Three bounded studies of the same real panel, used once to choose the
redesign's direction (see review/pi-essentials/README.md, "Layout studies").
They are injected into the shipped `sensor-reading.html` / `sensor-dial.html`
by the lab on the simulated host; nothing here is copied into the plugin
package, and the plugin never references this folder.

- **A. Essentials-first vertical panel**: the shipped markup and `pi.css`
  unchanged (no injection).
- **B. Compact task sections**: `study-b.css` + `study.js?b`: every section
  but Reading starts collapsed, label-left rows, the face shrinks into the
  Reading section.
- **C. Preview-led task panel**: `study-c.css` + `study.js?c`: a large face
  pinned at the top while scrolling, sections below it collapsed as a task
  list.

Run: `npx tsx scripts/pi-lab.mjs capture <out> --study b` (or `c`).
