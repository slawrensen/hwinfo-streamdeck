/* Shared property-inspector logic: the searchable sensor picker(s), the live
   preview line, and the status hint. Persists selections through
   SDPIComponents.useSettings so sdpi-managed fields are never clobbered.
   The DOM contract lives in the panels that load this file
   (sensor-reading.html, sensor-dial.html): every element is looked up by
   id here, and a panel without a section simply leaves it inert. */
/* global SDPIComponents */
(() => {
	"use strict";

	// Build stamp: the panel names the code it actually runs, because the
	// webview outlives on-disk refreshes and caches sub-resources. Read
	// window.__hwPiVersion (or the console line) before trusting a repro.
	const PI_BUILD = "1.5.1.0-5";
	window.__hwPiVersion = PI_BUILD;
	console.log(`hwinfo PI build ${PI_BUILD}`);

	const { streamDeckClient, useSettings, useGlobalSettings } = SDPIComponents;

	const previewValueEl = document.getElementById("preview-value");
	const previewStatsEl = document.getElementById("preview-stats");
	const hintEl = document.getElementById("status-hint");
	const galleryEl = document.getElementById("theme-gallery");
	const rotationSetEl = document.getElementById("rotation-set"); // dial PI only
	const controlsCustomEl = document.getElementById("controls-custom"); // dial PI only
	const controlsZonesEl = document.getElementById("controls-zones"); // dial PI only
	const dualRowsEl = document.getElementById("dual-rows"); // reading PI only

	const MAX_ROWS = 150;
	const SENSOR_TYPE_NAMES = ["", "Temp", "Voltage", "Fan", "Current", "Power", "Clock", "Usage"];
	// One hex gate for every color field, mirroring the plugin parsers it
	// stands in for (detail-settings.ts, sensor-reading.ts, text-colors.ts).
	const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
	// Mirrors QUAD_DEFAULT_COLORS in src/ui/key-renderer.ts.
	const QUAD_DEFAULT_COLORS = ["#4CC2FF", "#FF7E8E", "#38CD89", "#D4AB33"];

	let tree = null; // [{ name, readings: [{ key, label, unit, value, type }] }]
	let treeFetchedOk = false; // last sensorTree arrived while HWiNFO was up
	let treeRequestPending = false;

	function requestTree() {
		treeRequestPending = true;
		streamDeckClient.send("sendToPlugin", { event: "getSensorTree" });
	}

	// All value formatting comes from the plugin (its measurement authority):
	// tree rows carry a `display` string and the preview a `display` object,
	// so the panel can never drift from what the key or dial face shows.

	function readingLabelOf(key) {
		if (tree !== null) {
			for (const group of tree) {
				for (const reading of group.readings) {
					if (reading.key === key) return reading.label;
				}
			}
		}
		return null;
	}

	// --- rotation set (dial PI only) -----------------------------------------
	// The readings dial rotation is limited to, ticked in the primary picker's
	// rows. Shown under the picker as one flat chips row, or split into named
	// groups (plain rotate stays inside a group, a gesture set to "Switch
	// sensor or group" jumps between them). rotationKeys is kept mirrored to
	// the union of all group keys, so set-wide consumers (stats, reset reach)
	// and older plugin versions after a rollback keep reading the flat set
	// unchanged. The plugin ignores anything under two non-empty groups; the
	// PI still renders those editing states. Declared before the pickers so
	// every reference below is initialized by the time async callbacks fire.
	let rotationKeys = [];
	let rotationGroups = null; // null = flat set; else [{ name, keys }]
	let rotationNames = {}; // per-reading display names, keyed by reading key
	let collectorIndex = 0; // which group new ticks land in (PI-local, not persisted)

	function adoptRotationKeys(value) {
		rotationKeys = Array.isArray(value) ? value.filter((k) => typeof k === "string") : [];
		renderRotationSet();
		primaryPicker.renderList();
	}

	function adoptRotationGroups(value) {
		rotationGroups = parseGroupsSetting(value);
		clampCollector();
		renderRotationSet();
		primaryPicker.renderList();
	}

	function adoptRotationNames(value) {
		rotationNames = parseNamesSetting(value);
		renderRotationSet();
	}

	const rotationBinding = rotationSetEl === null ? null : useSettings("rotationKeys", adoptRotationKeys, null);
	const groupsBinding = rotationSetEl === null ? null : useSettings("rotationGroups", adoptRotationGroups, null);
	// Per-reading names: shown on the chip, the overview rows, and as the
	// dial title while that reading is selected. Unticking a reading keeps
	// its name, so re-adding it restores the rename.
	const namesBinding = rotationSetEl === null ? null : useSettings("rotationNames", adoptRotationNames, null);

	// Settings are untyped JSON: keep non-empty string names only.
	function parseNamesSetting(value) {
		if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
		const names = {};
		for (const [key, name] of Object.entries(value)) {
			if (typeof name === "string" && name.trim() !== "") names[key] = name;
		}
		return names;
	}

	// Settings are untyped JSON: keep what renders (name string, string keys)
	// and treat an empty or non-array value as "no groups" (the flat set).
	function parseGroupsSetting(value) {
		if (!Array.isArray(value) || value.length === 0) return null;
		const groups = [];
		for (const entry of value) {
			if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
			const keys = Array.isArray(entry.keys) ? entry.keys.filter((k) => typeof k === "string" && k !== "") : [];
			groups.push({ name: typeof entry.name === "string" ? entry.name : "", keys });
		}
		return groups.length > 0 ? groups : null;
	}

	function unionKeys(groups) {
		const keys = [];
		for (const group of groups) {
			for (const key of group.keys) {
				if (!keys.includes(key)) keys.push(key);
			}
		}
		return keys;
	}

	function clampCollector() {
		const last = rotationGroups === null ? 0 : rotationGroups.length - 1;
		collectorIndex = Math.max(0, Math.min(collectorIndex, last));
	}

	function memberOfRotation(key) {
		return rotationGroups !== null ? rotationGroups.some((g) => g.keys.includes(key)) : rotationKeys.includes(key);
	}

	/**
	 * One write path for every set/group edit: persists the groups (when
	 * `writeGroups`; flat-set edits skip it so dials that never used groups
	 * never gain the field) AND the union mirror in rotationKeys, then
	 * refreshes the chips and syncs the list ticks in place, so the open
	 * list keeps its scroll position and every box matches the model.
	 */
	function writeRotation(writeGroups) {
		if (rotationGroups !== null) rotationKeys = unionKeys(rotationGroups);
		clampCollector();
		if (writeGroups) {
			// [] persists "no groups": the field is only ever written, never
			// removed, and the plugin ignores anything under two groups.
			groupsBinding[1](rotationGroups === null ? [] : rotationGroups.map((g) => ({ name: g.name, keys: [...g.keys] })));
		}
		rotationBinding[1](rotationKeys);
		renderRotationSet();
		for (const row of primaryPicker.list.querySelectorAll(".hw-row")) {
			const tick = row.querySelector(".hw-tick");
			if (tick !== null) tick.checked = memberOfRotation(row.dataset.key);
		}
	}

	function setRotationMembership(key, present) {
		if (rotationBinding === null || !key) return;
		if (present === memberOfRotation(key)) return;
		if (rotationGroups === null) {
			rotationKeys = present ? [...rotationKeys, key] : rotationKeys.filter((k) => k !== key);
		} else if (present) {
			// New ticks land in the marked collector group.
			const target = rotationGroups[collectorIndex];
			if (target !== undefined && !target.keys.includes(key)) target.keys.push(key);
		} else {
			// Unticking removes the reading from every group holding it.
			for (const group of rotationGroups) {
				group.keys = group.keys.filter((k) => k !== key);
			}
		}
		writeRotation(rotationGroups !== null);
	}

	function setChip(key, groupIndex) {
		const label = readingLabelOf(key);
		const chip = document.createElement("span");
		// "current" paints the chip of the reading on the dial right now, so
		// the open panel shows where rotation (and a group jump) landed.
		chip.className = "hw-set-chip" + (tree !== null && label === null ? " missing" : "") + (key === primaryPicker.selectedKey() ? " current" : "");
		chip.dataset.key = key;
		const name = document.createElement("span");
		name.className = "hw-set-name";
		name.textContent = rotationNames[key] ?? label ?? key;
		name.title = "Click to rename how this reading shows on the dial";
		const remove = document.createElement("button");
		remove.type = "button";
		remove.className = "hw-set-remove";
		remove.dataset.key = key;
		if (groupIndex !== null) remove.dataset.group = String(groupIndex);
		remove.title = groupIndex !== null ? "Remove from this group" : "Remove from the rotation set";
		remove.textContent = "×";
		chip.append(name, remove);
		return chip;
	}

	function setNote(text) {
		const note = document.createElement("div");
		note.className = "hw-set-note";
		// Counts, cap refusals and empty-list guidance change without focus
		// moving; a live region is the only way that reaches a screen reader.
		note.setAttribute("aria-live", "polite");
		note.textContent = text;
		return note;
	}

	function setActions(actions) {
		const row = document.createElement("div");
		row.className = "hw-set-actions";
		for (const [action, label] of actions) {
			const button = document.createElement("button");
			button.type = "button";
			button.dataset.setAction = action;
			button.textContent = label;
			row.appendChild(button);
		}
		return row;
	}

	function groupHeader(group, index) {
		const head = document.createElement("div");
		head.className = "hw-group-head";
		const collector = document.createElement("input");
		collector.type = "radio";
		collector.name = "hw-collector";
		collector.className = "hw-collector";
		collector.checked = index === collectorIndex;
		collector.dataset.group = String(index);
		collector.title = "New ticks land in this group";
		const name = document.createElement("input");
		name.type = "text";
		name.className = "hw-group-name";
		name.value = group.name;
		name.placeholder = `Group ${index + 1}`;
		name.dataset.group = String(index);
		name.title = "Group name; the dial shows it when a jump lands here";
		name.spellcheck = false;
		const remove = document.createElement("button");
		remove.type = "button";
		remove.className = "hw-group-remove";
		remove.dataset.group = String(index);
		remove.title = "Remove this group (its readings leave the rotation)";
		remove.textContent = "×";
		head.append(collector, name, remove);
		return head;
	}

	function updateRotationHelp() {
		const help = document.getElementById("rotation-help");
		if (help === null) return;
		// Keep the flat-mode sentence order in sync with the static fallback
		// in sensor-dial.html (empty-set default leads).
		help.textContent =
			rotationGroups === null
				? "Leave the set empty to rotate through every reading of the picked sensor. Tick readings in the sensor list above to limit rotation to just those, in the order you tick them."
				: "Ticks land in the group marked by the radio. “Switch sensor or group” (Elite press+rotate) jumps between groups showing the group name and keeps plain rotate inside one; any control map without that gesture (Legacy always, Custom until you map it) rotates through all groups as one flat list.";
	}

	function renderRotationSet() {
		if (rotationSetEl === null) return;
		// Never rebuild under a focused name field: a settings echo (rotation
		// moved, autocycle stepped) would clobber the typing mid-word.
		if (rotationSetEl.contains(document.activeElement) && document.activeElement.classList.contains("hw-group-name")) return;
		const frag = document.createDocumentFragment();
		if (rotationGroups === null) {
			for (const key of rotationKeys) {
				frag.appendChild(setChip(key, null));
			}
			frag.appendChild(
				setNote(
					rotationKeys.length === 0
						? "Empty: rotation moves through all readings of the picked sensor."
						: rotationKeys.length === 1
							? "Only one reading picked. Rotation needs two or more to move."
							: `Rotation moves through these ${rotationKeys.length} readings only.`
				)
			);
			frag.appendChild(setActions([["split", "Split into groups"]]));
		} else {
			rotationGroups.forEach((group, index) => {
				frag.appendChild(groupHeader(group, index));
				const chips = document.createElement("div");
				chips.className = "hw-set-chips";
				for (const key of group.keys) {
					chips.appendChild(setChip(key, index));
				}
				if (group.keys.length === 0) {
					chips.appendChild(setNote("Empty: tick readings above to fill this group."));
				}
				frag.appendChild(chips);
			});
			const populated = rotationGroups.filter((g) => g.keys.length > 0).length;
			frag.appendChild(
				setNote(
					rotationGroups.length === 1
						? "One group only: it acts as a plain rotation set until you add a second."
						: populated < 2
							? `${rotationGroups.length} groups. They take effect once two of them hold readings; until then rotation runs as one flat list.`
							: `${rotationGroups.length} groups. Rotation needs two or more readings in a group to move inside it.`
				)
			);
			frag.appendChild(setActions([["add", "Add group"], ["merge", "Merge back into one set"]]));
		}
		rotationSetEl.replaceChildren(frag);
		updateRotationHelp();
	}

	// --- custom detail list (reading PI only) --------------------------------
	// The ordered readings a drill-down key lists in "custom" mode, stored as
	// stable reading keys in detailKeys. The collector picker adds (rows and
	// whole sources), the chips row orders and removes; a missing reading
	// keeps its place and is marked, never silently substituted. Writes
	// happen only on explicit edits: the list is never rewritten on read.
	const detailListEl = document.getElementById("detail-list");
	const DETAIL_KEYS_MAX = 128; // mirrors the plugin parser's cap
	const DETAIL_TILES_MAX = 128; // mirrors detailTilesOf's own cap, distinct in the parser
	let detailKeys = [];
	// This key's own sensor: the runtime shows it on the Back tile and
	// filters it out of the list, so the panel must refuse to add it and
	// must park an adopted copy (hand-edited, or the opener re-picked onto
	// a listed sensor) outside the tile walk instead of dressing chips the
	// deck will not list. Followed via followSetting at init: the primary
	// picker's own re-pick is never echoed back, so a subscription alone
	// goes stale the moment the user re-picks in this very panel.
	let detailPrimaryKey = "";
	const detailBinding = detailListEl === null ? null : useSettings("detailKeys", adoptDetailKeys, null);
	// The hand-grouped tile plan (detailTiles) and the uniform density it
	// falls back to past its end. The plan is POSITIONAL: sizes stay put
	// while readings flow through them, exactly like the list's ordering.
	// detailDensity is followed via followSetting at init for the same
	// reason as the primary: the Tile shows select's own write is never
	// echoed back to this panel.
	let detailTiles = [];
	let detailUniform = 1;
	const detailTilesBinding = detailListEl === null ? null : useSettings("detailTiles", adoptDetailTiles, null);
	// Merge-only sibling of the tiles binding (no callback, no debounce, no
	// save): it stages detailTiles into the shared settings store so the
	// following detailKeys write persists BOTH fields in ONE setSettings
	// frame. Two staggered frames leave a window where only one half of a
	// list edit survives (a torn pair is exactly the restaffed-quad bug).
	const detailTilesStage = detailListEl === null ? null : useSettings("detailTiles", undefined, null, false);

	function adoptDetailTiles(value) {
		// Mirror the plugin parser (detailTilesOf): per-entry, per-field
		// salvage, so the panel always shows what the runtime would build.
		detailTiles = !Array.isArray(value)
			? []
			: value.slice(0, DETAIL_TILES_MAX).map((entry) => {
					const raw = typeof entry === "object" && entry !== null && !Array.isArray(entry) ? entry : {};
					const size = raw.size === 2 || raw.size === "2" ? 2 : raw.size === 3 || raw.size === "3" ? 3 : raw.size === 4 || raw.size === "4" ? 4 : 1;
					// Arrays only, like the parser: a hand-edited string or
					// object must not salvage into dressing the deck ignores.
					const rawLabels = Array.isArray(raw.labels) ? raw.labels : [];
					const rawColors = Array.isArray(raw.colors) ? raw.colors : [];
					const labels = [];
					const colors = [];
					for (let i = 0; i < size; i++) {
						labels.push(typeof rawLabels[i] === "string" ? rawLabels[i].trim() : "");
						colors.push(typeof rawColors[i] === "string" && HEX_COLOR.test(rawColors[i]) ? rawColors[i] : null);
					}
					return { size, labels, colors, cellLabels: raw.cellLabels !== false };
				});
		revalidateDetailAim();
		renderDetailList();
	}

	function adoptDetailUniform(value) {
		const next = value === 2 || value === "2" ? 2 : value === 3 || value === "3" ? 3 : value === 4 || value === "4" ? 4 : 1;
		// followSetting polls every 400 ms: a no-op tick must not rebuild
		// #detail-list under an in-flight chip drag or landing flash.
		if (next === detailUniform) return;
		detailUniform = next;
		revalidateDetailAim(); // the regrouped walk may have no cell for a standing aim
		renderDetailList(); // the implicit fill grouping follows Tile shows
	}

	/** The list as the DECK builds it: detailKeys minus the adopted
	 * primary (detail-group.ts filters it onto the Back tile), the only
	 * order the tile walk, cell indices and the note may count in. */
	function listedDetailKeys() {
		return detailKeys.filter((k) => k !== detailPrimaryKey);
	}

	/** A listed position back to its detailKeys slot: positions at or
	 * past the adopted primary's raw slot shift one to step over it;
	 * identity when the primary is not in the list. */
	function rawDetailIndex(listedIdx) {
		const primaryAt = detailKeys.indexOf(detailPrimaryKey);
		return primaryAt >= 0 && listedIdx >= primaryAt ? listedIdx + 1 : listedIdx;
	}

	/** The whole LISTED list as tiles: explicit plan entries, then the
	 * uniform fill, each { head listedIndex, size, spec|null }. */
	function detailTileWalk() {
		const tiles = [];
		const listed = listedDetailKeys();
		let cursor = 0;
		while (cursor < listed.length) {
			const spec = tiles.length < detailTiles.length ? detailTiles[tiles.length] : null;
			const size = spec !== null ? spec.size : detailUniform;
			tiles.push({ head: cursor, size, spec });
			cursor += size;
		}
		return tiles;
	}

	/** One deep copy of a tile plan: materialization and the staged write
	 * both need one, and the model must never be mutated in place. */
	function cloneTiles(tiles) {
		return tiles.map((t) => ({ size: t.size, labels: [...t.labels], colors: [...t.colors], cellLabels: t.cellLabels }));
	}

	/** A walk tile's spec at exactly the cells it fills, always a fresh
	 * copy: a fill tile becomes an explicit default entry, and a partial
	 * trailing spec sheds the cells it does not fill (a partial spec
	 * anywhere but the tail would swallow the next tile's head). */
	function occupancySpec(tile, occupied) {
		const spec = tile.spec !== null ? tile.spec : { size: tile.size, labels: Array.from({ length: tile.size }, () => ""), colors: Array.from({ length: tile.size }, () => null), cellLabels: true };
		const size = Math.min(spec.size, occupied);
		return { size, labels: spec.labels.slice(0, size), colors: spec.colors.slice(0, size), cellLabels: spec.cellLabels };
	}

	/** Extends the plan with default entries (at the uniform fill size,
	 * the size every tile past the plan renders at) so tile `through`
	 * exists explicitly and can be edited. */
	function materializedTiles(through) {
		const next = cloneTiles(detailTiles);
		for (let t = detailTiles.length; t <= through; t++) {
			next.push({ size: detailUniform, labels: Array.from({ length: detailUniform }, () => ""), colors: Array.from({ length: detailUniform }, () => null), cellLabels: true });
		}
		return next;
	}

	/** Materializes the plan through `tileIdx`, hands that tile to
	 * `mutate`, persists: every per-tile control funnels through here. */
	function editTile(tileIdx, mutate) {
		const next = materializedTiles(tileIdx);
		mutate(next[tileIdx]);
		writeDetailTiles(next);
	}

	/** Every list or tile edit persists through here: detailTiles staged
	 * (merged, unsaved), detailKeys saved, so the app stores one frame
	 * carrying BOTH fields. Solo edits re-assert the other field for free,
	 * which also self-heals a store that went stale. */
	function writeDetailState() {
		// An edit can shorten the walk out from under a standing aim (a
		// shrink consuming the last tile, a size cycle swallowing the
		// fill) or grow the aimed tile past what any marker paints.
		revalidateDetailAim();
		detailTilesStage[1](cloneTiles(detailTiles));
		detailBinding[1]([...detailKeys]);
		renderDetailList();
		detailPicker?.renderList(); // membership ticks follow the edit
	}

	function writeDetailTiles(next) {
		// Trailing entries that only restate the uniform fill are noise:
		// prune them so the stored plan stays exactly the hand-made part.
		const isDefault = (t) => t.size === detailUniform && t.cellLabels === true && t.labels.every((l) => l === "") && t.colors.every((c) => c === null);
		while (next.length > 0 && isDefault(next[next.length - 1])) {
			next.pop();
		}
		detailTiles = next;
		writeDetailState();
	}

	function adoptDetailKeys(value) {
		// Mirror the plugin parser: duplicates drop at their first occurrence
		// (hand-edited settings could hold them, and indexOf-based move and
		// remove need one chip per key), and the same cap applies, so the
		// panel never shows chips past what the runtime lists.
		const seen = new Set();
		detailKeys = Array.isArray(value) ? value.filter((k) => typeof k === "string" && k !== "" && !seen.has(k) && seen.add(k)).slice(0, DETAIL_KEYS_MAX) : [];
		revalidateDetailAim();
		renderDetailList();
		detailPicker?.renderList(); // membership ticks follow external writes too
	}

	function adoptDetailPrimary(value) {
		const next = typeof value === "string" ? value : "";
		// Same no-op guard as adoptDetailUniform: the 400 ms follow poll
		// re-delivers the unchanged key forever.
		if (next === detailPrimaryKey) return;
		detailPrimaryKey = next;
		revalidateDetailAim(); // the walk excludes the primary, so a re-pick reshapes it
		renderDetailList(); // the parked Back-tile chip follows the opener's sensor
		detailPicker?.renderList();
		updateFilterCount(); // the primary is excluded from filter matches too
	}

	// --- live filter match count (reading PI only) ---------------------------
	// The panel already holds the sensor tree, so the filter field can say
	// exactly what its pattern gathers before the user ever presses the key.
	let detailFilterValue = "";

	/** Mirrors compileDetailFilter in src/detail/detail-settings.ts (same
	 * wildcard grammar, same source-plus-label candidate, same iterative
	 * two-pointer walk, same code-unit fold); keep in sync. Not a RegExp:
	 * the `*` to `.*` translation backtracks exponentially on hostile
	 * patterns ("*?a" repeated stalls one test for minutes within the
	 * 128-char caps), while this walk is O(pattern x candidate). Case
	 * folds per UTF-16 code unit the way the runtime's old non-unicode
	 * `i` regex canonicalized: uppercase, except a non-ASCII unit never
	 * folds onto an ASCII one (so the panel count and the deck view
	 * agree on µ, ß, and friends); `?` eats exactly one unit, `*` any
	 * run, and a wildcard-free pattern matches as a substring. */
	const GLOB_STAR = 42; // "*".charCodeAt(0)
	const GLOB_QUERY = 63; // "?".charCodeAt(0)

	function foldCodeUnit(code) {
		if (code < 128) {
			return code >= 97 && code <= 122 ? code - 32 : code;
		}
		const upper = String.fromCharCode(code).toUpperCase();
		if (upper.length !== 1) return code;
		const upperCode = upper.charCodeAt(0);
		return upperCode < 128 ? code : upperCode;
	}

	function foldedUnits(text) {
		const units = new Array(text.length);
		for (let i = 0; i < text.length; i++) {
			units[i] = foldCodeUnit(text.charCodeAt(i));
		}
		return units;
	}

	function detailFilterMatcher(pattern) {
		const anchored = /[*?]/.test(pattern) ? pattern : `*${pattern}*`;
		const p = foldedUnits(anchored);
		return (candidate) => {
			const s = foldedUnits(candidate);
			let pi = 0;
			let si = 0;
			let star = -1;
			let mark = 0;
			while (si < s.length) {
				// The literal branch skips the star unit: a candidate's own
				// literal "*" must never swallow the wildcard before its
				// backtrack anchor is recorded (mirrors the runtime fix).
				if (pi < p.length && (p[pi] === GLOB_QUERY || (p[pi] !== GLOB_STAR && p[pi] === s[si]))) {
					pi++;
					si++;
				} else if (pi < p.length && p[pi] === GLOB_STAR) {
					star = pi;
					pi++;
					mark = si;
				} else if (star !== -1) {
					// Backtrack to the last star, retrying one candidate
					// unit later: linear, never nested.
					pi = star + 1;
					mark++;
					si = mark;
				} else {
					return false;
				}
			}
			while (pi < p.length && p[pi] === GLOB_STAR) pi++;
			return pi === p.length;
		};
	}

	function updateFilterCount() {
		const el = document.getElementById("detail-filter-count");
		if (el === null) return;
		const pattern = detailFilterValue.trim().slice(0, 128);
		if (pattern === "") {
			el.hidden = false;
			el.textContent = "Type a pattern; the view refuses to open while it is empty.";
			return;
		}
		if (tree === null) {
			el.hidden = true;
			return;
		}
		const matches = detailFilterMatcher(pattern);
		let count = 0;
		for (const group of tree) {
			// matchName is the RAW source name ("" for orphans), the exact
			// candidate the runtime filter matches; group.name may carry the
			// "Unknown sensor" display fallback the runtime never sees.
			const sourceName = group.matchName ?? group.name;
			for (const reading of group.readings) {
				if (reading.key !== detailPrimaryKey && matches(`${sourceName} ${reading.label}`)) count++;
			}
		}
		el.hidden = false;
		el.textContent = count === 0 ? "Matches nothing right now; the view would open empty (0 / 0)." : `Matches ${count} reading${count === 1 ? "" : "s"} right now.`;
	}

	// The armed per-tile add: clicking a tile's + marker aims the collector
	// at that tile, and the next picks land inside it (growing it to four),
	// instead of appending to the end of the list. null = plain append.
	// The marker itself sits at the exact cell the next pick fills, so the
	// landing point is always painted, never guessed.
	let detailArm = null;

	const DETAIL_RESTING_PLACEHOLDER = "Search sensors to add…";

	/** Quietly drops a standing aim and restores the resting search text
	 * (no focus, no render): writeDetailState's past-end check, the splice
	 * re-anchor and a stale-aim append all disarm through here. */
	function disarmDetailAim() {
		detailArm = null;
		const search = detailSearchEl();
		if (search !== null) search.placeholder = DETAIL_RESTING_PLACEHOLDER;
	}

	/** An aim is only honest while its landing is painted. The walk can
	 * reshape without passing writeDetailState (Tile shows and a primary
	 * re-pick arrive through followSetting; external edits through the
	 * adopt paths), and a funnel edit can grow the aimed tile into a FULL
	 * quad, which renderDetailList paints no marker on. Every reshape
	 * calls here: a stale aim otherwise keeps promising a tile the next
	 * pick cannot honor. The full-quad test mirrors renderDetailList's
	 * own occupied/fullQuad math. */
	function revalidateDetailAim() {
		if (detailArm === null) return;
		const tile = detailTileWalk()[detailArm.tileIdx];
		if (tile === undefined || (tile.size >= 4 && listedDetailKeys().length - tile.head >= 4)) {
			disarmDetailAim();
		}
	}
	// The reading key that just landed (pick, drop, arrow move): its chip
	// re-renders with a short flash and is scrolled into view, then the
	// receipt clears. Purely visual; never persisted.
	let detailLanded = "";
	// The walk index of the tile being dragged whole, null outside a tile
	// drag. dragover cannot read the payload (values hide until drop), so
	// this is how tile drags and chip drags stay distinguishable mid-air.
	let detailTileDrag = null;

	function detailSearchEl() {
		return document.getElementById("pickerd-search");
	}

	function armDetailAdd(tileIdx) {
		detailArm = tileIdx === null || (detailArm !== null && detailArm.tileIdx === tileIdx) ? null : { tileIdx };
		// Render first, focus second: focusing opens the list, whose
		// onOpenChange scrolls the FRESH armed marker into view.
		renderDetailList();
		const search = detailSearchEl();
		if (search !== null) {
			search.placeholder = detailArm === null ? DETAIL_RESTING_PLACEHOLDER : `Adding into tile ${detailArm.tileIdx + 1}; click its + again to finish.`;
			search.focus({ preventScroll: true });
		}
	}

	/** False when the add was refused (the primary, a duplicate, or the
	 * 128 cap): the tick that triggered it repaints instead of lying. */
	function addDetailKey(key) {
		// The primary is refused, not added-and-hidden: it already shows on
		// the Back tile, and the runtime filters it out of the list.
		if (!key || key === detailPrimaryKey || detailKeys.includes(key) || detailKeys.length >= DETAIL_KEYS_MAX) return false;
		if (detailArm !== null) {
			const walk = detailTileWalk();
			const tile = walk[detailArm.tileIdx];
			if (tile !== undefined) {
				const occupied = Math.min(tile.size, listedDetailKeys().length - tile.head);
				const next = materializedTiles(detailArm.tileIdx);
				if (occupied >= next[detailArm.tileIdx].size && next[detailArm.tileIdx].size < 4) {
					// The tile is full but can grow: the pick becomes its next cell.
					next[detailArm.tileIdx].size += 1;
					next[detailArm.tileIdx].labels.push("");
					next[detailArm.tileIdx].colors.push(null);
				}
				const cell = Math.min(occupied, next[detailArm.tileIdx].size - 1);
				// tile.head and cell are LISTED positions; the splice lands
				// at the matching detailKeys slot, past a parked primary.
				detailKeys.splice(rawDetailIndex(tile.head + cell), 0, key);
				detailTiles = next; // staged and saved together in writeDetailState
				if (Math.min(next[detailArm.tileIdx].size, listedDetailKeys().length - tile.head) >= 4) {
					armDetailAdd(detailArm.tileIdx); // full quad: disarm, and the end marker lights
				}
				// After the possible disarm re-render, so the receipt survives
				// onto the write's own render.
				detailLanded = key;
				writeDetailState();
				return true;
			}
			disarmDetailAim();
		}
		detailLanded = key;
		detailKeys.push(key);
		writeDetailState();
		return true;
	}

	/** Removing a reading shrinks the tile that held it, whatever built
	 * that tile (hand-grouped or uniform fill): the readings below must
	 * never flow up to restaff a layout the user is looking at. The freed
	 * cell comes back deliberately, through the tile's +. A touched fill
	 * tile materializes into the plan first, the same freeze the size
	 * cycler applies; a tile losing its only cell leaves the plan with it. */
	function removeDetailKey(key) {
		if (!detailKeys.includes(key)) {
			return;
		}
		// The tile lookup runs in LISTED space: the parked primary has no
		// listed position (idx -1), so removing its chip shrinks no tile.
		const idx = listedDetailKeys().indexOf(key);
		const walk = detailTileWalk();
		const tileIdx = idx < 0 ? -1 : walk.findIndex((t) => idx >= t.head && idx < t.head + t.size);
		let next = null;
		if (tileIdx >= 0) {
			const cell = idx - walk[tileIdx].head;
			next = materializedTiles(tileIdx);
			if (next[tileIdx].size <= 1) {
				// The tile's only cell: the tile goes with it, and an aim at
				// or past it re-anchors.
				next.splice(tileIdx, 1);
				if (detailArm !== null && detailArm.tileIdx === tileIdx) {
					disarmDetailAim();
				} else if (detailArm !== null && detailArm.tileIdx > tileIdx) {
					detailArm = { tileIdx: detailArm.tileIdx - 1 };
				}
			} else {
				next[tileIdx].size -= 1;
				next[tileIdx].labels.splice(cell, 1);
				next[tileIdx].colors.splice(cell, 1);
			}
		}
		detailKeys = detailKeys.filter((k) => k !== key);
		if (next !== null) {
			writeDetailTiles(next);
		} else {
			writeDetailState();
		}
	}

	/** The dressing sequence over the LISTED positions (spec cells where
	 * the plan reaches, empty over the uniform fill), respliced exactly
	 * like the keys and poured back over the same walk shape. Returns
	 * the plan to persist, or null when no plan exists and none is
	 * needed (a flat list stays flat: reordering plain chips must not
	 * invent one). A fill tile materializes only when a traveling label
	 * or color actually lands in it. */
	function movedDressingPlan(from, to) {
		const walk = detailTileWalk();
		const listed = listedDetailKeys();
		const occupiedOf = (tile) => Math.min(tile.size, listed.length - tile.head);
		const dressing = [];
		for (const tile of walk) {
			for (let c = 0; c < occupiedOf(tile); c++) {
				dressing.push(tile.spec !== null ? { label: tile.spec.labels[c] ?? "", color: tile.spec.colors[c] ?? null } : { label: "", color: null });
			}
		}
		const [moved] = dressing.splice(from, 1);
		dressing.splice(to > from ? to - 1 : to, 0, moved);
		let through = detailTiles.length - 1;
		let cursor = 0;
		walk.forEach((tile, idx) => {
			const occupied = occupiedOf(tile);
			for (let c = 0; c < occupied; c++) {
				const d = dressing[cursor + c];
				if ((d.label !== "" || d.color !== null) && idx > through) through = idx;
			}
			cursor += occupied;
		});
		if (through < 0) return null;
		const next = materializedTiles(through);
		cursor = 0;
		walk.forEach((tile, idx) => {
			const occupied = occupiedOf(tile);
			if (idx <= through) {
				for (let c = 0; c < occupied; c++) {
					next[idx].labels[c] = dressing[cursor + c].label;
					next[idx].colors[c] = dressing[cursor + c].color;
				}
			}
			cursor += occupied;
		});
		return next;
	}

	/** Drag reorder: move `key` so it sits at LISTED position `to` (the
	 * indices the chips render at). The parked primary is itself never
	 * movable (listed index -1); a move crossing it may shift its raw
	 * detailKeys slot by one, which nothing observes (the runtime
	 * filters it out wherever it sits, the panel parks it first). Tile
	 * sizes never change here, but a cell's label and color belong to
	 * the CHIP in it, so the dressing rides the same splice the keys do,
	 * through in-tile reorders and boundary-crossing walks alike. */
	function moveDetailKey(key, to) {
		const from = listedDetailKeys().indexOf(key);
		if (from < 0 || to < 0 || to > listedDetailKeys().length) return;
		if (to === from || to === from + 1) return; // dropped where it already sits: nothing to write
		const plan = movedDressingPlan(from, to);
		const rawFrom = detailKeys.indexOf(key);
		const rawTo = rawDetailIndex(to);
		detailKeys.splice(rawFrom, 1);
		detailKeys.splice(rawTo > rawFrom ? rawTo - 1 : rawTo, 0, key);
		detailLanded = key;
		if (plan !== null) {
			writeDetailTiles(plan);
		} else {
			writeDetailState();
		}
	}

	/** A chip dragged onto another CHIP, onto tile chrome (the nearest
	 * chip edge decides the cell), or onto the trailing ghost (targetKey
	 * null). Inside one tile that is a plain cell reorder. A chip
	 * CROSSING tiles used to be a flat list move: the tile it left
	 * kept its size and swallowed the next reading, so every boundary
	 * shifted and the chip seemed to land anywhere but where it was
	 * dropped. Now the move is membership-stable, the same rule removal
	 * and the whole-tile move follow: the source tile shrinks by the
	 * cell it lost (dissolving when emptied), and the target grows a
	 * cell at the exact drop position. A FULL target cannot grow, so the
	 * chip parks beside it as its own one-cell tile instead of
	 * teleporting the flow. The chip's label and color belong to the
	 * CHIP, not the cell it sat in, so they travel with it wherever it
	 * lands. A ghost drop appends past the last tile, where the uniform
	 * fill dresses the tail; a DRESSED chip leaving for the ghost has
	 * nothing past the plan to hold its label or color, so the walk
	 * freezes into the plan (the same materialization any tile edit
	 * applies) and the chip appends as its own one-cell tile. */
	function moveDetailChip(key, targetKey, after) {
		const listed = listedDetailKeys();
		const from = listed.indexOf(key);
		if (from < 0) return;
		const walk = detailTileWalk();
		const tileOf = (idx) => walk.findIndex((t) => idx >= t.head && idx < t.head + t.size);
		const fromTileIdx = tileOf(from);
		const tIdx = targetKey === null ? -1 : listed.indexOf(targetKey);
		if (targetKey !== null && tIdx < 0) return;
		const targetTileIdx = targetKey === null ? -1 : tileOf(tIdx);
		if (targetKey !== null && fromTileIdx === targetTileIdx) {
			moveDetailKey(key, after ? tIdx + 1 : tIdx); // cell order inside one tile: boundaries cannot shear, dressing rides the same splice
			return;
		}
		const cell = from - walk[fromTileIdx].head;
		const fromSpec = walk[fromTileIdx].spec;
		const dressing = { label: fromSpec !== null ? (fromSpec.labels[cell] ?? "") : "", color: fromSpec !== null ? (fromSpec.colors[cell] ?? null) : null };
		const dressed = dressing.label !== "" || dressing.color !== null;
		const next =
			targetKey === null && dressed
				? walk.map((tile) => occupancySpec(tile, Math.min(tile.size, listed.length - tile.head)))
				: materializedTiles(Math.max(fromTileIdx, targetTileIdx));
		let dissolved = false;
		if (next[fromTileIdx].size <= 1) {
			next.splice(fromTileIdx, 1);
			dissolved = true;
		} else {
			next[fromTileIdx].size -= 1;
			next[fromTileIdx].labels.splice(cell, 1);
			next[fromTileIdx].colors.splice(cell, 1);
		}
		let landAt;
		if (targetKey === null) {
			landAt = listed.length - 1; // append past the tail (one shorter once the chip is pulled out)
			if (dressed) {
				next.push({ size: 1, labels: [dressing.label], colors: [dressing.color], cellLabels: true });
			}
		} else {
			const target = walk[targetTileIdx];
			const targetAt = dissolved && fromTileIdx < targetTileIdx ? targetTileIdx - 1 : targetTileIdx;
			const cellInTarget = tIdx - target.head + (after ? 1 : 0);
			if (target.size < 4) {
				next[targetAt].size += 1;
				next[targetAt].labels.splice(cellInTarget, 0, dressing.label);
				next[targetAt].colors.splice(cellInTarget, 0, dressing.color);
				landAt = tIdx + (after ? 1 : 0) - (from < tIdx + (after ? 1 : 0) ? 1 : 0);
			} else {
				// Full target: the chip becomes its own tile on the dropped
				// side, and the spec splice keeps every later tile's members.
				const sideBefore = !after && tIdx === target.head;
				const spliceAt = sideBefore ? targetAt : targetAt + 1;
				next.splice(spliceAt, 0, { size: 1, labels: [dressing.label], colors: [dressing.color], cellLabels: true });
				const boundary = sideBefore ? target.head : target.head + Math.min(target.size, listed.length - target.head);
				landAt = boundary - (from < boundary ? 1 : 0);
				if (detailArm !== null && detailArm.tileIdx >= spliceAt) {
					detailArm = { tileIdx: detailArm.tileIdx + 1 };
				}
			}
		}
		detailKeys.splice(detailKeys.indexOf(key), 1);
		detailKeys.splice(rawDetailIndex(landAt), 0, key);
		if (dissolved) {
			if (detailArm !== null && detailArm.tileIdx === fromTileIdx) {
				disarmDetailAim();
			} else if (detailArm !== null && detailArm.tileIdx > fromTileIdx) {
				detailArm = { tileIdx: detailArm.tileIdx - 1 };
			}
		}
		detailLanded = key;
		writeDetailTiles(next);
	}

	/** Move a WHOLE tile: its members leave as one run and land in front
	 * of the tile at `insertBefore` (walk indices before the move;
	 * walk.length appends at the end). The dressing travels with its
	 * members, so grouping stays positional without restaffing: only the
	 * final tile of a walk can be partial, and a partial spec crossing
	 * other tiles would swallow their heads, so a partial tile shrinks
	 * to the cells it actually fills before it travels, and a partial
	 * tile being landed after shrinks the same way. A standing aim names
	 * tiles by index and every index may now mean a different tile, so
	 * the aim always disarms. */
	function moveDetailTile(fromIdx, insertBefore) {
		const walk = detailTileWalk();
		const from = walk[fromIdx];
		if (from === undefined || insertBefore < 0 || insertBefore > walk.length) return;
		if (insertBefore === fromIdx || insertBefore === fromIdx + 1) return;
		const listed = listedDetailKeys();
		const members = listed.slice(from.head, Math.min(from.head + from.size, listed.length));
		if (members.length === 0) return;
		const specs = walk.map((tile) => occupancySpec(tile, Math.min(tile.size, listed.length - tile.head)));
		const movedSpec = specs[fromIdx];
		const finalIdx = insertBefore > fromIdx ? insertBefore - 1 : insertBefore;
		specs.splice(fromIdx, 1);
		specs.splice(finalIdx, 0, movedSpec);
		// Landing offset in the REDUCED listed order: the tiles left of the
		// landing slot keep their exact member counts (removing a whole
		// run preserves every other tile's contiguity).
		const reduced = walk.filter((_, i) => i !== fromIdx);
		let landAt = 0;
		for (let i = 0; i < finalIdx; i++) {
			const tile = reduced[i];
			landAt += Math.min(tile.size, listed.length - tile.head);
		}
		for (const k of members) {
			detailKeys.splice(detailKeys.indexOf(k), 1);
		}
		detailKeys.splice(rawDetailIndex(landAt), 0, ...members);
		disarmDetailAim();
		detailLanded = members[0]; // the moved tile's first chip carries the flash
		writeDetailTiles(specs);
	}

	function addDetailSource(group) {
		let landed = "";
		for (const reading of group.readings) {
			if (reading.key !== detailPrimaryKey && !detailKeys.includes(reading.key) && detailKeys.length < DETAIL_KEYS_MAX) {
				detailKeys.push(reading.key);
				landed = reading.key; // the block's last chip carries the flash
			}
		}
		if (landed === "") return;
		// The block appends; a standing aim would claim a landing that never
		// happened. Disarm before the receipt so the disarm re-render cannot
		// eat the flash (the addDetailKey order).
		if (detailArm !== null) armDetailAdd(detailArm.tileIdx);
		detailLanded = landed;
		writeDetailState();
	}

	function detailChip(key, index, tile, tileIdx, cellIdx) {
		const label = readingLabelOf(key);
		const chip = document.createElement("span");
		chip.className = "hw-set-chip" + (tree !== null && label === null ? " missing" : "");
		chip.dataset.key = key;
		// Real-mouse drag between tiles (the arrows stay for keyboards and
		// synthetic input, which native drag never registers for). Dropping
		// ON a chip inserts before it; state writes only on a real drop.
		chip.draggable = true;
		chip.addEventListener("dragstart", (ev) => {
			ev.dataTransfer.setData("text/plain", key);
			ev.dataTransfer.effectAllowed = "move";
			chip.classList.add("dragging");
		});
		chip.addEventListener("dragend", () => {
			// The drop may have landed anywhere (or nowhere): sweep every
			// indicator so no caret or lit frame outlives the gesture.
			for (const el of detailListEl.querySelectorAll(".dragging, .drop-before, .drop-after, .drop-append")) {
				el.classList.remove("dragging", "drop-before", "drop-after", "drop-append");
			}
		});
		chip.addEventListener("dragover", (ev) => {
			if (detailTileDrag !== null) return; // a whole-tile drag targets tile boundaries, not cells
			ev.preventDefault();
			ev.dataTransfer.dropEffect = "move";
			// An honest caret: the midpoint decides before or after, and the
			// edge bar (box-shadow, layout-neutral) marks the true index.
			const rect = chip.getBoundingClientRect();
			const after = ev.clientX > rect.left + rect.width / 2;
			chip.classList.toggle("drop-after", after);
			chip.classList.toggle("drop-before", !after);
		});
		chip.addEventListener("dragleave", () => chip.classList.remove("drop-before", "drop-after"));
		chip.addEventListener("drop", (ev) => {
			if (detailTileDrag !== null) return; // bubbles on to the holder's tile handler
			ev.preventDefault();
			ev.stopPropagation();
			const rect = chip.getBoundingClientRect();
			const after = ev.clientX > rect.left + rect.width / 2;
			chip.classList.remove("drop-before", "drop-after");
			const dragged = ev.dataTransfer.getData("text/plain");
			if (dragged !== "" && dragged !== key) moveDetailChip(dragged, key, after);
		});
		const name = document.createElement("span");
		name.className = "hw-set-name";
		name.textContent = label ?? key;
		if (tree !== null && label === null) {
			name.title = "Not in the current HWiNFO layout; keeps its place and shows as missing";
		}
		// The cell's label override lives ON the name (click to rename, the
		// rotation-chip idiom) instead of an always-visible input: the chip
		// stays narrow enough for a pair to read as a pair. The missing
		// title set above outranks the rename hint. An adopted primary
		// never reaches here: the walk runs over listedDetailKeys and its
		// chip parks outside the tiles (parkedPrimaryChip).
		chip.dataset.tile = String(tileIdx);
		chip.dataset.cell = String(cellIdx);
		const override = tile.spec !== null ? (tile.spec.labels[cellIdx] ?? "") : "";
		if (override !== "") {
			name.textContent = override;
			name.classList.add("renamed");
		}
		if (name.title === "") {
			name.title = "This cell's label on the tile. Click to edit; empty keeps the reading's own.";
		}
		// The rename affordance must exist for keyboards too: the span
		// joins the tab order and Enter/Space reach the same swap the
		// click handler runs (the delegated keydown below forwards here).
		name.tabIndex = 0;
		name.setAttribute("role", "button");
		if (key === detailLanded) {
			chip.classList.add("landed");
		}
		// Buttons dressed as glyphs need names: without these every remove
		// on the page announces as the same bare "×" to assistive tech.
		const spokenName = label ?? key;
		const up = document.createElement("button");
		up.type = "button";
		up.className = "hw-detail-move";
		up.dataset.move = "-1";
		up.title = "Move up the list";
		up.setAttribute("aria-label", `Move ${spokenName} up the list`);
		up.textContent = "↑";
		up.disabled = index === 0;
		const down = document.createElement("button");
		down.type = "button";
		down.className = "hw-detail-move";
		down.dataset.move = "1";
		down.title = "Move down the list";
		down.setAttribute("aria-label", `Move ${spokenName} down the list`);
		down.textContent = "↓";
		down.disabled = index === listedDetailKeys().length - 1;
		const remove = document.createElement("button");
		remove.type = "button";
		remove.className = "hw-set-remove";
		remove.dataset.key = key;
		remove.title = "Remove from the detail list";
		remove.setAttribute("aria-label", `Remove ${spokenName} from the detail list`);
		remove.textContent = "×";
		chip.append(name);
		if (tile.size === 4) {
			// Quad cells carry identity colors, like a standalone quad key.
			const well = document.createElement("input");
			well.type = "color";
			well.className = "hw-tile-color";
			well.title = "This cell's identity color on the quad tile";
			well.value = (tile.spec !== null ? tile.spec.colors[cellIdx] : null) ?? QUAD_DEFAULT_COLORS[cellIdx] ?? "#4CC2FF";
			well.addEventListener("change", () => {
				editTile(tileIdx, (t) => {
					t.colors[cellIdx] = well.value;
				});
			});
			chip.append(well);
		}
		chip.append(up, down, remove);
		return chip;
	}

	/** The adopted primary's chip, parked in its own holder OUTSIDE the
	 * tile flow: the deck shows this reading on the Back tile and builds
	 * the tiles over the list WITHOUT it, so it may not occupy a cell,
	 * shift any dressing or count in the note. Remove works (no tile
	 * shrinks; see removeDetailKey); rename stays refused and reorder,
	 * overrides and colors do not apply (it has no cell). */
	function parkedPrimaryChip() {
		const label = readingLabelOf(detailPrimaryKey);
		const holder = document.createElement("span");
		const chip = document.createElement("span");
		chip.className = "hw-set-chip" + (tree !== null && label === null ? " missing" : "");
		chip.dataset.key = detailPrimaryKey;
		const name = document.createElement("span");
		name.className = "hw-set-name";
		name.textContent = `${label ?? detailPrimaryKey} (Back tile)`;
		name.title = "This key's own sensor: it shows on the Back tile and is not listed in the view";
		const remove = document.createElement("button");
		remove.type = "button";
		remove.className = "hw-set-remove";
		remove.dataset.key = detailPrimaryKey;
		remove.title = "Remove from the detail list";
		remove.textContent = "×";
		chip.append(name, remove);
		holder.appendChild(chip);
		return holder;
	}

	/** One caret at a time: clears every drop indicator in the list
	 * except `keep`. Nearest-edge painting marks chips the pointer is
	 * not over, which no per-element dragleave ever clears. */
	function sweepCarets(keep) {
		for (const el of detailListEl.querySelectorAll(".drop-before, .drop-after, .drop-append")) {
			if (el !== keep) el.classList.remove("drop-before", "drop-after", "drop-append");
		}
	}

	/** The insertion point a pointer over tile chrome honestly means:
	 * the nearest chip edge. Same-row chips win (the vertical distance
	 * dominates the metric), then the nearest by x; the midpoint picks
	 * the side, exactly the rule a drop directly on a chip applies. The
	 * dragged chip itself never counts. */
	function nearestChipEdge(holder, x, y) {
		let best = null;
		for (const chip of holder.querySelectorAll(".hw-set-chip:not(.dragging)")) {
			const rect = chip.getBoundingClientRect();
			const dx = Math.max(rect.left - x, 0, x - rect.right);
			const dy = Math.max(rect.top - y, 0, y - rect.bottom);
			const score = dy * 1000 + dx;
			if (best === null || score < best.score) {
				best = { chip, score, after: x > rect.left + rect.width / 2 };
			}
		}
		return best;
	}

	/** Tile chrome routes a chip drag to the nearest chip edge: every
	 * pixel of the tile is a drop zone whose landing is the painted
	 * caret, never a hidden end-of-tile jump. Whole-tile drags bypass
	 * this (the holder's boundary handlers run first and stop them). */
	function wireTileChromeDrop(holder) {
		holder.addEventListener("dragover", (ev) => {
			if (detailTileDrag !== null) return;
			ev.preventDefault();
			ev.dataTransfer.dropEffect = "move";
			const overChip = ev.target instanceof Element ? ev.target.closest(".hw-set-chip") : null;
			if (overChip !== null) {
				sweepCarets(overChip); // its own dragover painted the caret
				return;
			}
			const edge = nearestChipEdge(holder, ev.clientX, ev.clientY);
			if (edge === null) {
				sweepCarets(null);
				return;
			}
			sweepCarets(edge.chip);
			edge.chip.classList.toggle("drop-after", edge.after);
			edge.chip.classList.toggle("drop-before", !edge.after);
		});
		holder.addEventListener("drop", (ev) => {
			if (detailTileDrag !== null) return; // the boundary handler above stopped real tile drops already
			if (ev.target instanceof Element && ev.target.closest(".hw-set-chip") !== null) return; // the chip's own drop handled it
			ev.preventDefault();
			sweepCarets(null);
			const dragged = ev.dataTransfer.getData("text/plain");
			if (dragged === "") return;
			// The same honest nearest-edge the dragover painted, recomputed
			// from the drop itself (a synthetic drop has no dragover).
			const edge = nearestChipEdge(holder, ev.clientX, ev.clientY);
			if (edge !== null) moveDetailChip(dragged, edge.chip.dataset.key, edge.after);
		});
	}

	/** The trailing ghost: a chip dropped on it leaves its tile and
	 * appends past the tail (its dressing deciding between the uniform
	 * fill and a one-cell tile of its own; see moveDetailChip), and a
	 * whole tile dropped on it moves to the end. */
	function wireGhostDrop(ghost) {
		ghost.addEventListener("dragover", (ev) => {
			ev.preventDefault();
			ev.dataTransfer.dropEffect = "move";
			sweepCarets(ghost);
			ghost.classList.add("drop-append");
		});
		ghost.addEventListener("dragleave", () => ghost.classList.remove("drop-append"));
		ghost.addEventListener("drop", (ev) => {
			ev.preventDefault();
			ghost.classList.remove("drop-append");
			if (detailTileDrag !== null) {
				moveDetailTile(detailTileDrag, detailTileWalk().length);
				detailTileDrag = null;
				return;
			}
			const dragged = ev.dataTransfer.getData("text/plain");
			if (dragged !== "") moveDetailChip(dragged, null, false);
		});
	}

	/** The + marker sitting at the exact cell the next pick would fill in
	 * its tile. `lit` marks THE current landing point (one at a time);
	 * `armed` marks the aimed tile. Full quads render no marker at all. */
	function detailAddMarker(arm, armed, lit) {
		const add = document.createElement("button");
		add.type = "button";
		add.className = "hw-add" + (armed ? " armed" : "") + (lit ? " lit" : "");
		add.dataset.arm = arm;
		add.title = armed ? "Picks land here. Click again to finish." : lit ? "New picks land here." : "Send the next picks into this tile. It can grow to four cells.";
		add.setAttribute("aria-label", arm === "end" ? "Send the next picks into a new tile" : `Send the next picks into tile ${Number(arm) + 1}`);
		add.setAttribute("aria-pressed", armed ? "true" : "false"); // the armed state is otherwise class-and-title only
		add.textContent = "+";
		return add;
	}

	function renderDetailList() {
		if (detailListEl === null) return;
		// A tree echo or preview tick must never destroy an in-progress
		// cell rename (the rotation editor holds the same line).
		const active = document.activeElement;
		if (active !== null && active.classList.contains("hw-cell-rename")) return;
		const frag = document.createDocumentFragment();
		const listed = listedDetailKeys();
		const walk = detailTileWalk();
		// The parked primary leads, the way the Back tile leads the view.
		if (detailPrimaryKey !== "" && detailKeys.includes(detailPrimaryKey)) {
			frag.appendChild(parkedPrimaryChip());
		}
		// The unarmed landing point: the last tile with a free cell, else
		// the trailing ghost tile that stands for "a new tile at the end".
		const lastTile = walk.length > 0 ? walk[walk.length - 1] : null;
		const lastHasRoom = lastTile !== null && listed.length - lastTile.head < lastTile.size;
		walk.forEach((tile, tileIdx) => {
			const holder = document.createElement("span");
			holder.className = "hw-tile" + (tile.spec !== null ? " planned" : "");
			// A whole-tile drag targets TILE boundaries: the holder's upper
			// half lands the dragged tile before this one, the lower half
			// after it. Registered before wireAppendDrop so a tile payload
			// can stop the key-append path on the same element.
			holder.addEventListener("dragover", (ev) => {
				if (detailTileDrag === null) return;
				ev.preventDefault();
				ev.stopImmediatePropagation();
				ev.dataTransfer.dropEffect = "move";
				const rect = holder.getBoundingClientRect();
				const after = ev.clientY > rect.top + rect.height / 2;
				sweepCarets(holder); // the gap fallback paints holders too; one caret at a time
				holder.classList.toggle("drop-after", after);
				holder.classList.toggle("drop-before", !after);
			});
			holder.addEventListener("dragleave", () => holder.classList.remove("drop-before", "drop-after"));
			holder.addEventListener("drop", (ev) => {
				if (detailTileDrag === null) return;
				ev.preventDefault();
				ev.stopImmediatePropagation();
				// The same honest midpoint the dragover painted, recomputed
				// from the drop itself (a synthetic drop has no dragover).
				const rect = holder.getBoundingClientRect();
				const after = ev.clientY > rect.top + rect.height / 2;
				holder.classList.remove("drop-before", "drop-after");
				moveDetailTile(detailTileDrag, after ? tileIdx + 1 : tileIdx);
				detailTileDrag = null;
			});
			// A drop on the tile itself (not a chip) lands at the nearest
			// chip edge, the same caret the dragover paints: no pixel of
			// the tile is a hidden jump to its end.
			wireTileChromeDrop(holder);
			// A span, not a button: this webview never starts an HTML5 drag
			// from a button element (chips are spans and drag fine), so a
			// button grip is a handle that cannot grab. Keyboard access
			// comes from tabIndex plus the delegated keydown.
			const grip = document.createElement("span");
			grip.className = "hw-tile-grip";
			grip.setAttribute("role", "button");
			grip.tabIndex = 0;
			grip.dataset.tile = String(tileIdx);
			grip.draggable = true;
			grip.title = "Drag to move this whole tile; arrow keys move it too";
			grip.setAttribute("aria-label", `Move tile ${tileIdx + 1}; arrow keys reorder it from the keyboard`);
			grip.textContent = "⠿";
			grip.addEventListener("dragstart", (ev) => {
				detailTileDrag = tileIdx;
				ev.dataTransfer.setData("text/plain", `tile:${tileIdx}`);
				ev.dataTransfer.effectAllowed = "move";
				holder.classList.add("dragging");
			});
			grip.addEventListener("dragend", () => {
				detailTileDrag = null;
				for (const el of detailListEl.querySelectorAll(".dragging, .drop-before, .drop-after, .drop-append")) {
					el.classList.remove("dragging", "drop-before", "drop-after", "drop-append");
				}
			});
			holder.appendChild(grip);
			const size = document.createElement("button");
			size.type = "button";
			size.className = "hw-tile-size";
			size.dataset.tile = String(tileIdx);
			size.title = "Cells on this tile; click to cycle 1, 2, 3, 4";
			size.textContent = `×${tile.size}`;
			holder.appendChild(size);
			if (tile.size === 4) {
				const abc = document.createElement("button");
				abc.type = "button";
				abc.className = "hw-tile-abc";
				abc.dataset.tile = String(tileIdx);
				const on = tile.spec === null ? true : tile.spec.cellLabels;
				abc.title = on ? "Cell labels shown; click for color-coded bare values" : "Bare values; click to show cell labels";
				abc.textContent = on ? "Abc" : "123";
				holder.appendChild(abc);
			}
			for (let c = 0; c < tile.size; c++) {
				const index = tile.head + c;
				const key = listed[index];
				if (key === undefined) break;
				holder.appendChild(detailChip(key, index, tile, tileIdx, c));
			}
			const occupied = Math.min(tile.size, listed.length - tile.head);
			const fullQuad = tile.size >= 4 && occupied >= 4;
			if (!fullQuad) {
				const armed = detailArm !== null && detailArm.tileIdx === tileIdx;
				const lit = detailArm === null && tileIdx === walk.length - 1 && lastHasRoom;
				holder.appendChild(detailAddMarker(String(tileIdx), armed, lit));
			}
			frag.appendChild(holder);
		});
		if (walk.length === 0 || !lastHasRoom) {
			// Appending would start a NEW tile: say so with a ghost tile whose
			// marker is the landing point.
			const ghost = document.createElement("span");
			ghost.className = "hw-tile ghost";
			wireGhostDrop(ghost);
			ghost.appendChild(detailAddMarker("end", false, detailArm === null));
			frag.appendChild(ghost);
		}
		// The note counts what the deck lists (the parked primary is on the
		// Back tile, not a tile cell); the cap stays on the RAW length, the
		// exact bound the runtime parser applies to detailKeys.
		frag.appendChild(
			setNote(
				listed.length === 0
					? "Empty: add readings above, in the order the detail view should list them."
					: detailKeys.length >= DETAIL_KEYS_MAX
						? `${listed.length} readings across ${walk.length} tiles. That is the cap; remove one to add another.`
						: `${listed.length} reading${listed.length === 1 ? "" : "s"} across ${walk.length} tile${walk.length === 1 ? "" : "s"}. Grouping is positional: readings flow through the tile sizes in list order, and readings past your groups follow the Tile shows setting.`
			)
		);
		detailListEl.replaceChildren(frag);
		if (detailLanded !== "") {
			detailListEl.querySelector(".hw-set-chip.landed")?.scrollIntoView({ block: "nearest" });
			detailLanded = "";
		}
	}

	// --- sensor pickers -------------------------------------------------------
	// One factory, one instance per search box. The tree is shared; membership
	// ticks render wherever a config supplies tick/onTick (the dial's rotation
	// list, the reading PI's collector). Each picker owns its open/typed state
	// so the reading PI's pickers never fight.
	const pickers = [];

	function createPicker(config) {
		const searchEl = config.search;
		const listEl = config.list;
		let selectedKey = "";
		let listOpen = false;
		// True only after a real keystroke in the search box; cleared whenever
		// the box is programmatically rewritten. The old proxy (box text
		// differs from the selection display) misfired when rotation moved the
		// selection under a focused box: the stale display text filtered the
		// list to nothing.
		let searchTyped = false;

		// Immediate (non-debounced) persistence; third arg null disables debounce.
		// A picker without a `setting` (the detail-list collector) binds nothing:
		// its rows feed `onPick` instead of a persisted selection.
		const [getKey, setKey] =
			config.setting === undefined
				? [() => Promise.resolve(""), () => {}]
				: useSettings(
						config.setting,
						(value) => {
							selectedKey = typeof value === "string" ? value : "";
							showSelection();
							renderList();
							config.onSelectionEcho?.(); // chip highlight follows the move
							// Rotating the dial (or autocycle) moves the selection while the
							// list is open: keep the highlighted row in view so the movement
							// is visible. "nearest" only scrolls when it left the viewport,
							// and a hand-typed filter is never yanked around.
							if (listOpen && !searchTyped) {
								listEl.querySelector(".hw-row.selected")?.scrollIntoView({ block: "nearest" });
							}
						},
						null
					);

		function findSelected() {
			if (tree === null || selectedKey === "") return null;
			for (const group of tree) {
				for (const reading of group.readings) {
					if (reading.key === selectedKey) return { group, reading };
				}
			}
			return null;
		}

		function showSelection() {
			if (document.activeElement === searchEl && listOpen && searchTyped) return; // don't fight the user mid-search
			searchTyped = false;
			const found = findSelected();
			if (found !== null) {
				searchEl.value = `${found.reading.label}  ·  ${found.group.name}`;
				searchEl.placeholder = "Search sensors…";
				searchEl.classList.remove("missing");
			} else if (selectedKey !== "") {
				// Never put the warning into .value; it would act as a search filter.
				searchEl.value = "";
				searchEl.placeholder = "⚠ selected sensor not present. Pick again";
				searchEl.classList.add("missing");
			} else {
				searchEl.value = "";
				// The collector never holds a selection (no bound setting), and
				// its placeholder is owned by the HTML resting text and
				// armDetailAdd's aim line: the generic reset here would wipe a
				// standing aim's receipt on every close and tree echo.
				if (config.setting !== undefined) searchEl.placeholder = "Search sensors…";
				searchEl.classList.remove("missing");
			}
		}

		function tokensOf(text) {
			return text.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
		}

		function renderList() {
			if (!listOpen) return;
			if (tree === null) {
				listEl.innerHTML = `<div class="hw-more">Loading sensors…</div>`;
				return;
			}
			const raw = searchEl.value;
			// Only a filter the user actually typed filters the list.
			const filtering = searchTyped && raw !== "";
			const tokens = filtering ? tokensOf(raw) : [];

			const frag = document.createDocumentFragment();
			let shown = 0;
			let hidden = 0;
			for (let gi = 0; gi < tree.length; gi++) {
				const group = tree[gi];
				const groupLower = group.name.toLowerCase();
				let header = null;
				for (const reading of group.readings) {
					const hay = `${groupLower} ${reading.label.toLowerCase()}`;
					if (tokens.length > 0 && !tokens.every((t) => hay.includes(t))) continue;
					if (shown >= MAX_ROWS) {
						hidden++;
						continue;
					}
					if (header === null) {
						header = document.createElement("div");
						header.className = "hw-group";
						header.textContent = group.name;
						if (config.onGroupAdd !== undefined) {
							// "Add this whole source" in one press, straight from the
							// same tree data the pickers already share.
							const addAll = document.createElement("button");
							addAll.type = "button";
							addAll.className = "hw-group-add";
							// Bound by position in the rendered tree, not by name:
							// source names are not unique (identical hardware, user
							// renames, the "Unknown sensor" orphan fallback), and a
							// name lookup would always resolve to the first twin.
							addAll.dataset.groupIndex = String(gi);
							addAll.title = "Add every reading of this source";
							addAll.textContent = "+ all";
							header.appendChild(addAll);
						}
						frag.appendChild(header);
					}
					const row = document.createElement("div");
					row.className = "hw-row" + (reading.key === selectedKey ? " selected" : "");
					row.dataset.key = reading.key;
					if (config.tick !== undefined) {
						// One membership pattern wherever a list HAS membership
						// (the rotation set and the drill-down list): a checkbox
						// at the row head. The old ✓ glyph is gone with it.
						const state = config.tick(reading.key);
						const tick = document.createElement("input");
						tick.type = "checkbox";
						tick.className = "hw-tick";
						tick.checked = state.on;
						tick.disabled = state.disabled === true;
						tick.title = state.title;
						row.appendChild(tick);
					}
					const label = document.createElement("span");
					label.className = "hw-label";
					label.textContent = reading.label;
					const val = document.createElement("span");
					val.className = "hw-val";
					const typeName = SENSOR_TYPE_NAMES[reading.type] || "";
					val.textContent = `${reading.display ?? ""}${typeName ? " · " + typeName : ""}`;
					row.append(label, val);
					frag.appendChild(row);
					shown++;
				}
			}
			if (shown === 0) {
				const none = document.createElement("div");
				none.className = "hw-more";
				none.textContent = tokens.length > 0 ? "No sensors match." : "No sensors reported. Check HWiNFO's sensor window.";
				frag.appendChild(none);
			}
			if (hidden > 0) {
				const more = document.createElement("div");
				more.className = "hw-more";
				more.textContent = `…${hidden} more. Refine the search.`;
				frag.appendChild(more);
			}
			listEl.replaceChildren(frag);
		}

		function openList() {
			if (listOpen) return;
			listOpen = true;
			listEl.hidden = false;
			renderList();
			const sel = listEl.querySelector(".hw-row.selected");
			if (sel) sel.scrollIntoView({ block: "center" });
			config.onOpenChange?.(true);
		}

		function closeList() {
			const was = listOpen;
			listOpen = false;
			listEl.hidden = true;
			showSelection();
			if (was) config.onOpenChange?.(false);
		}

		function selectRow(row) {
			if (!row || !row.dataset.key) return;
			if (config.onPick !== undefined) {
				// Collector mode: a row click toggles membership and keeps the
				// list open, so building a custom detail list is one click per
				// reading instead of reopen-search-click cycles.
				config.onPick(row.dataset.key);
				renderList();
				return;
			}
			selectedKey = row.dataset.key;
			setKey(selectedKey);
			closeList();
			config.onSelectionEcho?.(); // own writes are not echoed back
		}

		searchEl.addEventListener("focus", () => {
			searchEl.select();
			openList();
		});

		// After a selection the input keeps focus (the row's mousedown is
		// preventDefault-ed), so no focus event fires; reopen on click too.
		searchEl.addEventListener("mousedown", () => {
			if (!listOpen && document.activeElement === searchEl) {
				searchEl.select();
				openList();
			}
		});

		searchEl.addEventListener("input", () => {
			searchTyped = true;
			openList();
			renderList();
		});

		searchEl.addEventListener("keydown", (ev) => {
			if (ev.key === "Escape") {
				closeList();
				searchEl.blur();
			} else if (ev.key === "Enter" && listOpen) {
				// Only treat Enter as "pick the top row" when the user actually typed
				// a filter (same condition renderList uses). With the box still showing
				// the current selection (or the ⚠ missing-sensor placeholder), the list
				// is the full unfiltered tree, whose top row is unrelated; picking it
				// would silently swap the user's saved sensor. Just close instead.
				if (searchTyped && searchEl.value !== "") {
					selectRow(listEl.querySelector(".hw-row"));
				} else {
					closeList();
				}
			}
		});

		// mousedown fires before the input's blur, keeping selection handling simple.
		listEl.addEventListener("mousedown", (ev) => {
			const groupAdd = ev.target.closest(".hw-group-add");
			if (groupAdd !== null && config.onGroupAdd !== undefined) {
				ev.preventDefault();
				const group = (tree ?? [])[Number(groupAdd.dataset.groupIndex)];
				if (group !== undefined) {
					config.onGroupAdd(group);
					renderList();
				}
				return;
			}
			const row = ev.target.closest(".hw-row");
			if (!row) return;
			// Membership ticks toggle natively on the CLICK that follows; fighting
			// that from mousedown left the box visually inverted. Let it be.
			if (ev.target.classList.contains("hw-tick")) return;
			ev.preventDefault();
			selectRow(row);
		});

		if (config.onTick !== undefined) {
			// The checkbox's own activation already flipped it; adopt its new state.
			listEl.addEventListener("click", (ev) => {
				if (!ev.target.classList.contains("hw-tick") || ev.target.disabled) return;
				const row = ev.target.closest(".hw-row");
				if (row?.dataset.key) config.onTick(row.dataset.key, ev.target.checked);
			});
		}

		if (config.refresh) {
			config.refresh.addEventListener("click", () => {
				tree = null;
				renderList();
				requestTree();
			});
		}

		const picker = {
			root: searchEl.closest(".hw-picker"),
			list: listEl,
			/** A second DOM region treated as "inside" by the outside-click
			 * closer: the detail collector keeps its list open while the user
			 * aims, renames or reorders in the tile list below it. */
			alsoWithin: config.alsoWithin ?? null,
			isOpen: () => listOpen,
			close: closeList,
			selectedKey: () => selectedKey,
			renderList,
			/** Refresh after the shared tree changed (labels resolve, rows fill). */
			onTree: () => {
				showSelection();
				renderList();
			},
			/** Pull the initial value (useSettings callbacks fire on echoes only). */
			init: () =>
				getKey().then((value) => {
					selectedKey = typeof value === "string" ? value : "";
					showSelection();
					config.onSelectionEcho?.(); // the set may render before the key arrives
				})
		};
		pickers.push(picker);
		return picker;
	}

	const primaryConfig = {
		search: document.getElementById("picker-search"),
		refresh: document.getElementById("picker-refresh"),
		list: document.getElementById("picker-list"),
		setting: "readingKey",
		onSelectionEcho: renderRotationSet
	};
	if (rotationSetEl !== null) {
		primaryConfig.tick = (key) => ({
			on: memberOfRotation(key),
			title: rotationGroups === null ? "Include in the rotation set" : "Include in the marked rotation group"
		});
		primaryConfig.onTick = setRotationMembership;
	}
	const primaryPicker = createPicker(primaryConfig);

	// The extra-slot pickers (reading PI only in the markup): slot 2 serves
	// the dual AND quad layouts, slots 3 and 4 are quad-only.
	const extraPicker = (n, setting) => {
		const searchEl = document.getElementById(`picker${n}-search`);
		return searchEl === null
			? null
			: createPicker({
					search: searchEl,
					refresh: document.getElementById(`picker${n}-refresh`),
					list: document.getElementById(`picker${n}-list`),
					setting
				});
	};
	const secondaryPicker = extraPicker(2, "secondaryReadingKey");
	const quadPicker3 = extraPicker(3, "quadReadingKey3");
	const quadPicker4 = extraPicker(4, "quadReadingKey4");

	// The detail-list collector: no bound setting; rows and "+ all" group
	// buttons feed the ordered detailKeys list instead.
	const detailPicker =
		detailListEl === null
			? null
			: createPicker({
					search: document.getElementById("pickerd-search"),
					list: document.getElementById("pickerd-list"),
					// The row body is the same toggle as its checkbox: one
					// affordance, two hit areas. Adds respect the armed tile;
					// removals shrink the tile that held the reading.
					onPick: (key) => {
						if (key === detailPrimaryKey) return;
						if (detailKeys.includes(key)) removeDetailKey(key);
						else addDetailKey(key);
					},
					tick: (key) =>
						key === detailPrimaryKey
							? { on: true, disabled: true, title: "This key's own sensor: the Back tile already shows it." }
							: { on: detailKeys.includes(key), title: "Ticked readings are in the view. Untick to remove; the tile that held it shrinks." },
					onTick: (key, next) => {
						if (next) {
							// A refused add (the 128 cap) leaves the native
							// checkbox flipped: repaint the rows so the box
							// shows the membership that exists.
							if (addDetailKey(key) === false) detailPicker.renderList();
						} else {
							removeDetailKey(key);
						}
					},
					onGroupAdd: addDetailSource,
					// Aiming, renaming and reordering in the tile list must not
					// close the results: the list below the dock counts as
					// inside the picker.
					alsoWithin: detailListEl,
					// While picking, the Add sensor row pins to the top and the
					// landing marker is brought on screen, so results and the
					// slot they fill stay co-visible.
					onOpenChange: (open) => {
						document.getElementById("detail-custom")?.classList.toggle("picking", open);
						if (open) detailListEl.querySelector(".hw-add.armed, .hw-add.lit")?.scrollIntoView({ block: "nearest" });
					}
				});

	document.addEventListener("mousedown", (ev) => {
		// composedPath, not target.closest: toggling a rotation tick re-renders
		// the rows mid-bubble, detaching ev.target; closest() on a detached node
		// would misread the click as outside the picker and close the list.
		// Checked per picker so opening one never strands the other open.
		const path = ev.composedPath();
		for (const picker of pickers) {
			if (picker.isOpen() && !path.includes(picker.root) && !(picker.alsoWithin !== null && path.includes(picker.alsoWithin))) picker.close();
		}
	});

	function setHint(text) {
		hintEl.hidden = !text;
		hintEl.textContent = text || "";
	}

	function renderPreview(p) {
		const live = previewValueEl.closest(".hw-preview-live");
		if (p.display) {
			// Plugin-formatted and plugin-colored: the same measurement text and
			// resolved theme/Text colors the face itself renders with.
			previewValueEl.textContent = `${p.display.value} ${p.display.unit}`.trim();
			previewStatsEl.textContent = p.display.stats;
			previewValueEl.style.color = p.display.valueColor;
			previewStatsEl.style.color = p.display.statsColor;
			if (live !== null) {
				live.classList.add("themed");
				live.style.background = p.display.bg;
			}
		} else {
			previewValueEl.style.color = "";
			previewStatsEl.style.color = "";
			if (live !== null) {
				live.classList.remove("themed");
				live.style.background = "";
			}
			if (p.missing) {
				previewValueEl.textContent = "sensor missing";
				previewStatsEl.textContent = "";
			} else if (p.state !== "ok") {
				previewValueEl.textContent = "—";
				previewStatsEl.textContent = "";
			} else {
				previewValueEl.textContent = "pick a sensor";
				previewStatsEl.textContent = "";
			}
		}
		// The stats line clips to one line (pi.css); the title carries the full text.
		previewStatsEl.title = previewStatsEl.textContent;
	}

	// The sdpi store notifies subscribers on didReceiveSettings only, and the
	// app does NOT echo a PI's own setSettings back to it, so picking a value
	// in this very panel never fires the subscription. Poll the LOCAL settings
	// cache (no round trip) so dependent rows follow while the panel is open.
	const followSetting = (setting, apply) => {
		const [get] = useSettings(setting, apply, null);
		get().then(apply);
		setInterval(() => get().then(apply), 400);
	};

	// Drive an sdpi textfield's placeholder: attribute so the markup stays
	// truthful, rendered input for the repaint (the component's placeholder
	// property wants a localized-message object and throws on plain strings,
	// and its attribute observer never repaints a changed value). Callers'
	// 400 ms polls re-assert it if the component re-renders over it.
	const setPlaceholder = (el, hint) => {
		if (el === null) return;
		if (el.getAttribute("placeholder") !== hint) el.setAttribute("placeholder", hint);
		const input = (el.shadowRoot ?? el).querySelector("input");
		if (input !== null && input.placeholder !== hint) input.placeholder = hint;
	};

	// Control preset (dial PI only): the custom gesture rows only exist for
	// "custom", the touch-zone picker for anything beyond legacy.
	if (controlsCustomEl !== null) {
		// Switching Elite to Custom seeds Elite's map into every gesture field
		// still unset, so "Elite minus one gesture" is a one-select change
		// instead of rebuilding the whole map from the Legacy fallbacks.
		// Fields the user ever set are never touched, and Legacy to Custom
		// needs no writes because the unset fallbacks ARE the Legacy commands.
		const ELITE_MAP = [
			["gestureRotate", "step"],
			["gesturePressedRotate", "stepGroup"],
			["gestureShortPress", "pauseResume"],
			["gestureLongPress", "resetStats"],
			["gestureTap", "cycleStat"],
			["gestureTouchHold", "backToCurrent"]
		];
		const gestureBindings = ELITE_MAP.map(([setting]) => useSettings(setting, () => {}, null));
		const seedFromElite = () => {
			ELITE_MAP.forEach(([setting, command], index) => {
				const [getGesture, setGesture] = gestureBindings[index];
				getGesture().then((value) => {
					if (typeof value === "string" && value !== "") return; // user-set: keep
					setGesture(command);
					// The sdpi store does not notify components of the PI's own
					// writes; poke the select so it displays the seeded command.
					const el = document.querySelector(`sdpi-select[setting="${setting}"]`);
					if (el) el.value = command;
				});
			});
		};
		let lastPreset = null;
		const applyPreset = (value) => {
			const preset = value === "elite" || value === "custom" ? value : "legacy";
			if (lastPreset === "elite" && preset === "custom") seedFromElite();
			lastPreset = preset;
			controlsCustomEl.hidden = preset !== "custom";
			if (controlsZonesEl !== null) controlsZonesEl.hidden = preset === "legacy";
		};
		followSetting("controlPreset", applyPreset);
	}

	// Key layout (reading PI only): the second-slot rows serve every multi
	// layout (slots 1 and 2 ARE the single/dual fields, so switching layouts
	// keeps both sensors), the "Second shows" pin is dual-only, the third
	// slot serves "triple" and "quad" (the triple's third row IS quad slot
	// 3), the quad rows (slot 4, cell colors, micro-labels) are quad-only,
	// and the Display row hides on every multi layout (their faces have no
	// sparkline/bar/ring strip). All of this is visibility only: no setting
	// is ever written by a layout change.
	if (dualRowsEl !== null) {
		const secondSlotEl = document.getElementById("second-slot");
		const thirdSlotEl = document.getElementById("third-slot");
		const tripleHelpEl = document.getElementById("triple-help");
		const thirdLabelEl = document.getElementById("third-label");
		const quadRowsEl = document.getElementById("quad-rows");
		const displayItemEl = document.getElementById("display-item");
		const layoutHintEl = document.getElementById("layout-hint");
		// quadLabel3 doubles as the triple's third-row label, and in the quad
		// grid the Label and Second label fields feed the top two cells: all
		// of them hard-cut to 4 characters there, so every field's promise
		// swaps with the mode (the static placeholders stay the non-quad
		// truth; setPlaceholder carries the sdpi drive).
		const mainLabelEl = document.querySelector('sdpi-textfield[setting="label"]');
		const secondLabelEl = document.querySelector('sdpi-textfield[setting="secondaryLabel"]');
		const labelHints = (quad) => {
			const hint = quad ? "Short name; 4 characters show" : "Custom label (default: sensor name)";
			for (const el of [thirdLabelEl, mainLabelEl, secondLabelEl]) setPlaceholder(el, hint);
		};
		const applyLayout = (value) => {
			const dual = value === "dual";
			const triple = value === "triple";
			const quad = value === "quad";
			if (secondSlotEl !== null) secondSlotEl.hidden = !dual && !triple && !quad;
			dualRowsEl.hidden = !dual;
			if (thirdSlotEl !== null) thirdSlotEl.hidden = !triple && !quad;
			if (tripleHelpEl !== null) tripleHelpEl.hidden = !triple;
			if (quadRowsEl !== null) quadRowsEl.hidden = !quad;
			if (displayItemEl !== null) displayItemEl.hidden = dual || triple || quad;
			labelHints(quad);
			// The face silently keeps its single layout until the extra slots
			// hold a pick (deliberate rollback-safe degrade); the panel says
			// why instead of letting the select look broken.
			const picked = (p) => p !== null && p.selectedKey() !== "";
			if (layoutHintEl !== null) layoutHintEl.hidden = !((dual && !picked(secondaryPicker)) || (triple && !picked(secondaryPicker) && !picked(quadPicker3)) || (quad && !picked(secondaryPicker) && !picked(quadPicker3) && !picked(quadPicker4)));
		};
		followSetting("keyLayout", applyLayout);
	}

	// Press behavior (reading PI only): the detail rows exist only when a
	// press opens details, the custom-list editor only in custom mode, and
	// the Show help stays truthful about what a press actually does. A
	// baked Back role (the revision-2 detail profiles' top-left tile)
	// hides the whole Press section instead and shows the fixed-role note:
	// the press is pinned to Back, so offering press choices would lie.
	// All of this is visibility and text: no setting is ever written by a
	// toggle, and detailRole is only ever read, never written.
	const detailConfigEl = document.getElementById("detail-config");
	if (detailConfigEl !== null) {
		const detailCustomEl = document.getElementById("detail-custom");
		const showHelpEl = document.getElementById("show-help");
		const pressBlockEl = document.getElementById("press-block");
		const roleNoteEl = document.getElementById("role-note");
		let pressValue;
		let backRole = false;
		// One renderer over both polled facts, so whichever poll answers
		// last still leaves the panel consistent.
		const applyPressState = () => {
			const details = !backRole && (pressValue === "open-details" || pressValue === "tap-cycle-hold-details");
			detailConfigEl.hidden = !details;
			if (pressBlockEl !== null) pressBlockEl.hidden = backRole;
			if (roleNoteEl !== null) roleNoteEl.hidden = !backRole;
			if (showHelpEl !== null) {
				showHelpEl.textContent = backRole
					? "Show picks the stat this tile displays. Pressing it always returns to the previous profile."
					: pressValue === "open-details"
						? "Pressing the key opens the sensor details view; Show picks the stat on this key's own face."
						: pressValue === "tap-cycle-hold-details"
							? "A short tap cycles current → min → max → avg; holding half a second opens sensor details."
							: "Pressing the key cycles current → min → max → avg.";
			}
		};
		followSetting("pressBehavior", (value) => {
			pressValue = value;
			applyPressState();
		});
		// The exact inverse of the plugin's parser: ONLY the exact "back"
		// marker activates the fixed role; junk and future values leave the
		// panel (like the runtime) on ordinary press behavior.
		followSetting("detailRole", (value) => {
			backRole = value === "back";
			applyPressState();
		});
		const detailFilterEl = document.getElementById("detail-filter");
		followSetting("detailMode", (value) => {
			// The exact inverse of the plugin's parser: ONLY the exact marker
			// shows its editor, so a junk or future value never surfaces
			// controls the runtime would ignore.
			if (detailCustomEl !== null) detailCustomEl.hidden = value !== "custom";
			if (detailFilterEl !== null) detailFilterEl.hidden = value !== "filter";
		});
		followSetting("detailFilter", (value) => {
			detailFilterValue = typeof value === "string" ? value : "";
			updateFilterCount();
		});
		// One-shot support note: the plugin answers from its managed-profile
		// registry, so the panel owns no device table of its own.
		streamDeckClient.send("sendToPlugin", { event: "getDetailSupport" });
	}

	// Display select (reading PI only): one control for the single layout's
	// extra strip. It shows the EFFECTIVE mode (a valid displayMode wins,
	// else the legacy sparkline checkbox's state), and any change writes only
	// displayMode, so pre-Display profiles are never rewritten on read.
	const displayModeEl = document.getElementById("display-mode");
	if (displayModeEl !== null) {
		const [getDisplayMode, setDisplayMode] = useSettings("displayMode", () => {}, null);
		const [getSparkline] = useSettings("sparkline", () => {}, null);
		// Assign only on a real change: rewriting a select's value can dismiss
		// its open popup in this webview.
		const show = (mode) => {
			if (displayModeEl.value !== mode) displayModeEl.value = mode;
		};
		const showDisplayMode = () => {
			getDisplayMode().then((mode) => {
				if (mode === "sparkline" || mode === "bar" || mode === "ring" || mode === "none") {
					show(mode);
					return;
				}
				getSparkline().then((sparkline) => {
					show(sparkline === true ? "sparkline" : "none");
				});
			});
		};
		displayModeEl.addEventListener("change", () => {
			setDisplayMode(displayModeEl.value);
		});
		showDisplayMode();
		setInterval(showDisplayMode, 400);
	}

	// Dial view (dial PI only): the overview rows serve both multi-row
	// views; the Context line and Separators selects are three-row only.
	// The bar-range section hides on the multi-row views. Hide-on-match
	// polarity on purpose: an unset dialView (legacy single) stays visible;
	// a `!== "single"` check would hide it for every legacy profile.
	const overviewRowsEl = document.getElementById("overview-rows");
	if (overviewRowsEl !== null) {
		const overviewThreeEl = document.getElementById("overview-three-rows");
		const barRangeEl = document.getElementById("bar-range");
		const warnEl = document.querySelector('sdpi-textfield[setting="warnValue"]');
		const critEl = document.querySelector('sdpi-textfield[setting="critValue"]');
		const applyView = (value) => {
			overviewRowsEl.hidden = value !== "overview" && value !== "tworow";
			if (overviewThreeEl !== null) overviewThreeEl.hidden = value !== "overview";
			if (barRangeEl !== null) barRangeEl.hidden = value === "tworow" || value === "overview";
			// The multi-row views draw no bar: alerts tint the row VALUE
			// there (the dial renderer's alert indicator), so the threshold
			// placeholders must promise the mechanism the view really has.
			const single = value !== "tworow" && value !== "overview";
			setPlaceholder(warnEl, single ? "bar turns amber (display units)" : "row value turns amber (display units)");
			setPlaceholder(critEl, single ? "bar turns red (display units)" : "row value turns red (display units)");
		};
		followSetting("dialView", applyView);
	}

	// Quad cell colors (reading PI only): one preset select plus four
	// per-cell wells, all writing the single quadColors setting. The plugin
	// salvages per entry, so a bad hex costs exactly that cell; the select
	// snaps to "Custom" whenever the wells match no preset.
	const quadPresetEl = document.getElementById("quad-color-preset");
	if (quadPresetEl !== null) {
		const QUAD_PRESETS = {
			signal: QUAD_DEFAULT_COLORS,
			pairs: ["#4CC2FF", "#4CC2FF", "#FF7E8E", "#FF7E8E"],
			uniform: ["#4CC2FF", "#4CC2FF", "#4CC2FF", "#4CC2FF"]
		};
		const cellInputs = [1, 2, 3, 4].map((n) => document.getElementById(`quad-color-${n}`));
		let quadColors = [...QUAD_DEFAULT_COLORS];
		const adoptQuadColors = (value) => {
			const raw = Array.isArray(value) ? value : [];
			quadColors = QUAD_DEFAULT_COLORS.map((fallback, i) => (typeof raw[i] === "string" && HEX_COLOR.test(raw[i]) ? raw[i] : fallback));
		};
		const showQuadColors = () => {
			cellInputs.forEach((input, i) => {
				if (input !== null) input.value = quadColors[i].toLowerCase();
			});
			const match = Object.keys(QUAD_PRESETS).find((name) => QUAD_PRESETS[name].every((c, i) => c.toLowerCase() === quadColors[i].toLowerCase()));
			quadPresetEl.value = match ?? "custom";
		};
		const applyQuadColors = (value) => {
			adoptQuadColors(value);
			showQuadColors();
		};
		const [getQuadColors, writeQuadColors] = useSettings("quadColors", applyQuadColors, null);
		quadPresetEl.addEventListener("change", () => {
			const preset = QUAD_PRESETS[quadPresetEl.value];
			if (preset === undefined) return; // "Custom" is a display state, not a preset
			quadColors = [...preset];
			writeQuadColors([...quadColors]);
			showQuadColors();
		});
		cellInputs.forEach((input, i) => {
			if (input === null) return;
			// change (picker closed), not input: no write per drag frame.
			input.addEventListener("change", () => {
				quadColors[i] = input.value;
				writeQuadColors([...quadColors]);
				showQuadColors();
			});
		});
		getQuadColors().then(applyQuadColors);
	}

	// --- theme preset gallery -------------------------------------------------
	// Tokens come from the plugin (parsed themes.json) over the message channel;
	// the deck-wide default renders as the leading "Deck default" chip and the
	// seven presets follow. Clicking writes the per-key "theme" setting ("" =
	// follow deck default); the key/dial re-renders immediately: live preview.

	let themesConfig = null; // { defaultTheme, effectiveDeckTheme, themes: { id: { bg, ... } } }
	let themeOverride = "";

	const setThemeOverride = useSettings(
		"theme",
		(value) => {
			themeOverride = typeof value === "string" ? value : "";
			renderGallery();
		},
		null
	)[1];

	// A monochrome "link" glyph marking the follow chip. Drawn (not an emoji or
	// theme color) so it stays legible on any resolved palette, sitting on a
	// translucent dark badge.
	const FOLLOW_GLYPH =
		'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
		'<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>' +
		'<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';

	function themeChip(id, palette, name, selected) {
		// The leading chip (id "") follows the deck-wide theme. It must preview
		// the resolved palette truthfully yet never read as a twin of the preset
		// it currently resolves to, so it gets a dashed frame + link badge
		// (structure, not typography). It follows; it doesn't pin.
		const isDeck = id === "";
		const chip = document.createElement("button");
		chip.type = "button";
		chip.className = "hw-theme" + (selected ? " selected" : "") + (isDeck ? " hw-theme-deck" : "");
		chip.dataset.theme = id;
		chip.title = name;
		const face = document.createElement("span");
		face.className = "hw-theme-face";
		face.style.background = palette.bg;
		const value = document.createElement("span");
		value.className = "hw-theme-value";
		value.style.color = palette.value;
		value.textContent = isDeck ? "auto" : "64";
		const spark = document.createElement("span");
		spark.className = "hw-theme-spark";
		spark.style.background = palette.accent;
		face.append(value, spark);
		if (isDeck) {
			const badge = document.createElement("span");
			badge.className = "hw-theme-badge";
			badge.innerHTML = FOLLOW_GLYPH;
			face.appendChild(badge);
		}
		const label = document.createElement("span");
		label.className = "hw-theme-name";
		label.textContent = name;
		chip.append(face, label);
		return chip;
	}

	// The RESOLVED deck default: effectiveDeckTheme when the payload knows
	// it, else the spec default. Callers null-guard themesConfig first.
	// The plugin resolves the effective deck default (theme store, incl.
	// legacy migration); never guess it from raw global settings here.
	function resolvedDeckId() {
		return themesConfig.themes[themesConfig.effectiveDeckTheme] ? themesConfig.effectiveDeckTheme : themesConfig.defaultTheme;
	}

	function renderGallery() {
		if (themesConfig === null) return;
		const frag = document.createDocumentFragment();
		const deckId = resolvedDeckId();
		const deckDisplay = deckId.charAt(0).toUpperCase() + deckId.slice(1);
		const deckChip = themeChip("", themesConfig.themes[deckId], "Deck default", themeOverride === "");
		deckChip.title = "Deck default · " + deckDisplay;
		frag.appendChild(deckChip);
		const help = document.getElementById("theme-help");
		if (help !== null) {
			// The deck row lives under a different fold per PI; keep the static
			// HTML fallbacks in both PIs in sync with these two strings.
			const isDial = document.title.includes("Dial");
			help.textContent = "Pick a preset for this " + (isDial ? "dial" : "key") + " only, or the dashed “Deck default” chip (currently " + deckDisplay + ") to follow the deck-wide theme set under " + (isDial ? "Dial gestures & advanced" : "Advanced") + ".";
		}
		for (const [id, palette] of Object.entries(themesConfig.themes)) {
			frag.appendChild(themeChip(id, palette, id.charAt(0).toUpperCase() + id.slice(1), themeOverride === id));
		}
		galleryEl.replaceChildren(frag);
	}

	galleryEl.addEventListener("click", (ev) => {
		const chip = ev.target.closest(".hw-theme");
		if (!chip) return;
		themeOverride = chip.dataset.theme;
		setThemeOverride(themeOverride);
		renderGallery();
	});
	// The plugin pushes a fresh themes payload (with effectiveDeckTheme)
	// whenever the deck theme changes; no global-settings guessing here.
	streamDeckClient.send("sendToPlugin", { event: "getThemes" });

	// --- Text setting (issue #2) ----------------------------------------------
	// The Text selects are sdpi-managed; this block reveals the conditional
	// Custom rows (color well + dim checkbox) for the local and the deck-wide
	// scope, and binds the color wells. Wells write only on change, so absent
	// settings stay absent; an unset well shows the resolved theme's value
	// color: the truthful "custom starts from what you see" seed.
	function themeValueSeed() {
		if (themesConfig === null) return "#ffffff";
		const palette = themesConfig.themes[themeOverride] ?? themesConfig.themes[resolvedDeckId()];
		return palette ? palette.value.toLowerCase() : "#ffffff";
	}

	function bindTextControls(customEl, colorEl, useStore) {
		if (customEl === null || colorEl === null) return;
		const [getMode] = useStore("textMode", () => {}, null);
		const [getColor, setColor] = useStore("textColor", () => {}, null);
		const refresh = () => {
			getMode().then((mode) => {
				customEl.hidden = mode !== "custom";
			});
			getColor().then((color) => {
				if (document.activeElement === colorEl) return; // picker open: don't fight it
				const shown = typeof color === "string" && HEX_COLOR.test(color) ? color.toLowerCase() : themeValueSeed();
				if (colorEl.value !== shown) colorEl.value = shown;
			});
		};
		// change (picker closed), not input: no write per drag frame.
		colorEl.addEventListener("change", () => setColor(colorEl.value));
		refresh();
		setInterval(refresh, 400);
	}

	bindTextControls(document.getElementById("text-custom"), document.getElementById("text-color"), useSettings);
	bindTextControls(document.getElementById("deck-text-custom"), document.getElementById("deck-text-color"), useGlobalSettings);

	streamDeckClient.sendToPropertyInspector.subscribe((ev) => {
		const p = ev && ev.payload;
		if (!p || typeof p !== "object") return;
		if (p.event === "themes") {
			themesConfig = p;
			renderGallery();
			return;
		}
		if (p.event === "detailSupport") {
			// The note starts hidden and empty; the one-shot reply only ever
			// needs to reveal it on an unsupported deck.
			const note = document.getElementById("detail-unsupported");
			if (note !== null && p.supported !== true) {
				note.hidden = false;
				note.textContent = `Sensor details are not available on this deck (${p.model ?? "unsupported device"}): no bundled detail view fits its layout. Everything else on this key keeps working normally.`;
			}
			return;
		}
		if (p.event === "sensorTree") {
			tree = p.groups;
			treeFetchedOk = p.state === "ok";
			treeRequestPending = false;
			setHint(p.hint);
			for (const picker of pickers) picker.onTree();
			renderRotationSet(); // chip labels resolve once the tree is here
			renderDetailList(); // detail chip labels too
			updateFilterCount(); // and the live filter match count
		} else if (p.event === "preview") {
			renderPreview(p);
			setHint(p.hint);
			// The tree was fetched while HWiNFO was down; refresh it now that
			// data is flowing, so the picker isn't stuck on "No sensors reported".
			if (p.state === "ok" && !treeFetchedOk && !treeRequestPending) {
				requestTree();
			}
		}
	});

	primaryPicker.init();
	if (secondaryPicker !== null) secondaryPicker.init();
	if (quadPicker3 !== null) quadPicker3.init();
	if (quadPicker4 !== null) quadPicker4.init();
	if (detailBinding !== null) {
		detailListEl.addEventListener("keydown", (ev) => {
			// The tile grip's keyboard leg: arrows move the whole tile the
			// way a drag does, and focus follows the moved tile's grip.
			const grip = ev.target instanceof Element ? ev.target.closest(".hw-tile-grip") : null;
			if (grip !== null && (ev.key === "ArrowUp" || ev.key === "ArrowDown")) {
				ev.preventDefault(); // arrows scroll the panel otherwise
				const idx = Number(grip.dataset.tile);
				moveDetailTile(idx, ev.key === "ArrowUp" ? idx - 1 : idx + 2);
				const moved = detailListEl.querySelector(".hw-set-chip.landed")?.closest(".hw-tile")?.querySelector(".hw-tile-grip");
				if (moved !== null && moved !== undefined) moved.focus();
				return;
			}
			// The rename affordance is a span; Enter/Space must reach the
			// same swap the mouse gets, or renaming is pointer-only.
			if (ev.key !== "Enter" && ev.key !== " ") return;
			const nameEl = ev.target instanceof Element ? ev.target.closest(".hw-set-name") : null;
			if (nameEl === null) return;
			ev.preventDefault(); // Space scrolls the panel otherwise
			nameEl.click(); // re-enters the delegated click path below
		});
		// Dead-zone insurance: the list's own padding, the gaps between
		// tiles and the note are drop zones too. A chip drag routes to the
		// nearest tile's nearest chip edge (the ghost appends), a whole-tile
		// drag to the nearest tile boundary, so no pixel of the editor
		// silently swallows a gesture. Handlers on chips, holders and the
		// ghost run first (bubbling) and preventDefault, which is the
		// signal this fallback must stand down.
		const nearestListTarget = (x, y) => {
			let best = null;
			for (const holder of detailListEl.querySelectorAll(".hw-tile:not(.dragging)")) {
				const rect = holder.getBoundingClientRect();
				const dx = Math.max(rect.left - x, 0, x - rect.right);
				const dy = Math.max(rect.top - y, 0, y - rect.bottom);
				const score = dy * 1000 + dx;
				if (best === null || score < best.score) {
					best = { holder, score, rect };
				}
			}
			return best;
		};
		detailListEl.addEventListener("dragover", (ev) => {
			if (ev.defaultPrevented) return;
			ev.preventDefault();
			ev.dataTransfer.dropEffect = "move";
			const target = nearestListTarget(ev.clientX, ev.clientY);
			if (target === null) return;
			if (target.holder.classList.contains("ghost")) {
				sweepCarets(target.holder);
				target.holder.classList.add("drop-append");
				return;
			}
			if (detailTileDrag !== null) {
				const after = ev.clientY > target.rect.top + target.rect.height / 2;
				sweepCarets(target.holder);
				target.holder.classList.toggle("drop-after", after);
				target.holder.classList.toggle("drop-before", !after);
				return;
			}
			const edge = nearestChipEdge(target.holder, ev.clientX, ev.clientY);
			if (edge === null) {
				sweepCarets(null);
				return;
			}
			sweepCarets(edge.chip);
			edge.chip.classList.toggle("drop-after", edge.after);
			edge.chip.classList.toggle("drop-before", !edge.after);
		});
		detailListEl.addEventListener("drop", (ev) => {
			if (ev.defaultPrevented) return;
			ev.preventDefault();
			sweepCarets(null);
			const target = nearestListTarget(ev.clientX, ev.clientY);
			if (target === null) return;
			const ghost = target.holder.classList.contains("ghost");
			if (detailTileDrag !== null) {
				const tiles = [...detailListEl.querySelectorAll(".hw-tile:not(.ghost)")];
				const idx = tiles.indexOf(target.holder);
				const after = ev.clientY > target.rect.top + target.rect.height / 2;
				moveDetailTile(detailTileDrag, ghost || idx < 0 ? detailTileWalk().length : after ? idx + 1 : idx);
				detailTileDrag = null;
				return;
			}
			const dragged = ev.dataTransfer.getData("text/plain");
			if (dragged === "") return;
			if (ghost) {
				moveDetailChip(dragged, null, false);
				return;
			}
			const edge = nearestChipEdge(target.holder, ev.clientX, ev.clientY);
			if (edge !== null) moveDetailChip(dragged, edge.chip.dataset.key, edge.after);
		});
		detailListEl.addEventListener("dragleave", (ev) => {
			// Leaving the list entirely: no caret may outlive the pointer.
			if (!(ev.relatedTarget instanceof Node) || !detailListEl.contains(ev.relatedTarget)) sweepCarets(null);
		});
		detailListEl.addEventListener("click", (ev) => {
			const move = ev.target.closest(".hw-detail-move");
			if (move !== null && !move.disabled) {
				const key = move.closest(".hw-set-chip")?.dataset.key;
				// Neighbors in LISTED order (a parked primary between the raw
				// slots stays put); the shared mover carries the chip's label
				// and color with it, in-tile and across a tile boundary alike.
				const from = listedDetailKeys().indexOf(key);
				const to = from + Number(move.dataset.move);
				if (from >= 0 && to >= 0 && to < listedDetailKeys().length) {
					moveDetailKey(key, to > from ? to + 1 : to);
					// The render destroyed the pressed arrow and focus fell to
					// body; the arrows are the keyboard affordance, so chained
					// moves (Enter, Enter) must keep working. Follow onto the
					// landed chip's same arrow, or its twin at a list edge.
					const landedChip = detailListEl.querySelector(".hw-set-chip.landed");
					const sameArrow = landedChip?.querySelector(`.hw-detail-move[data-move="${move.dataset.move}"]`);
					const followTo = sameArrow !== undefined && sameArrow !== null && !sameArrow.disabled ? sameArrow : (landedChip?.querySelector(".hw-detail-move:not([disabled])") ?? null);
					if (followTo !== null) followTo.focus();
				}
				return;
			}
			const add = ev.target.closest(".hw-add");
			if (add !== null) {
				armDetailAdd(add.dataset.arm === "end" ? null : Number(add.dataset.arm));
				return;
			}
			const nameEl = ev.target.closest(".hw-set-name");
			if (nameEl !== null) {
				// Cell rename, the rotation-chip idiom: the name swaps to an
				// input prefilled with the override; the placeholder shows
				// the reading's own label; commit on change, Enter blurs.
				const chip = nameEl.closest(".hw-set-chip");
				const chipKey = chip?.dataset.key;
				if (chip === null || chipKey === undefined || chipKey === detailPrimaryKey) return;
				const tileIdx = Number(chip.dataset.tile);
				const cellIdx = Number(chip.dataset.cell);
				const spec = detailTiles[tileIdx];
				const input = document.createElement("input");
				input.type = "text";
				input.className = "hw-group-name hw-chip-rename hw-cell-rename";
				input.dataset.tile = String(tileIdx);
				input.dataset.cell = String(cellIdx);
				input.value = spec !== undefined ? (spec.labels[cellIdx] ?? "") : "";
				input.placeholder = readingLabelOf(chipKey) ?? chipKey;
				input.spellcheck = false;
				nameEl.replaceWith(input);
				input.focus();
				input.select();
				return;
			}
			const size = ev.target.closest(".hw-tile-size");
			if (size !== null) {
				// Cycling a tile's size materializes the plan through it, so
				// an implicit fill tile becomes editable the moment it is
				// touched; a wrap back to the uniform default prunes itself.
				editTile(Number(size.dataset.tile), (t) => {
					const grown = t.size === 4 ? 1 : t.size + 1;
					t.size = grown;
					t.labels = Array.from({ length: grown }, (_, i) => t.labels[i] ?? "");
					t.colors = Array.from({ length: grown }, (_, i) => t.colors[i] ?? null);
				});
				return;
			}
			const abc = ev.target.closest(".hw-tile-abc");
			if (abc !== null) {
				editTile(Number(abc.dataset.tile), (t) => {
					t.cellLabels = !t.cellLabels;
				});
				return;
			}
			const remove = ev.target.closest(".hw-set-remove");
			if (remove !== null) {
				removeDetailKey(remove.dataset.key);
			}
		});
		// Arming must not steal focus from the search: with focus intact the
		// results stay open and the pick flow never restarts.
		detailListEl.addEventListener("mousedown", (ev) => {
			if (ev.target.closest(".hw-add") !== null) ev.preventDefault();
		});
		// Cell-rename commit and teardown, byte-parallel to the rotation
		// chips: change writes once, blur without an edit restores the span,
		// Enter blurs. The quad color well keeps its own change listener;
		// the class guard keeps the two apart.
		detailListEl.addEventListener("change", (ev) => {
			const input = ev.target;
			if (!(input instanceof HTMLInputElement) || !input.classList.contains("hw-cell-rename")) return;
			editTile(Number(input.dataset.tile), (t) => {
				t.labels[Number(input.dataset.cell)] = input.value.trim();
			});
		});
		detailListEl.addEventListener("focusout", (ev) => {
			if (ev.target instanceof HTMLInputElement && ev.target.classList.contains("hw-cell-rename")) {
				setTimeout(renderDetailList, 0);
			}
		});
		detailListEl.addEventListener("keydown", (ev) => {
			if (ev.key === "Enter" && ev.target instanceof HTMLInputElement && ev.target.classList.contains("hw-cell-rename")) {
				ev.target.blur();
			}
		});
		detailBinding[0]().then(adoptDetailKeys);
		detailTilesBinding[0]().then(adoptDetailTiles);
		// The opener's sensor and the uniform density are edited by OTHER
		// controls in this panel (the primary picker, the Tile shows
		// select), and the app never echoes a PI's own writes: follow the
		// local store so the parked chip, the collector gates and the fill
		// walk track those edits while the panel is open.
		followSetting("readingKey", adoptDetailPrimary);
		followSetting("detailDensity", adoptDetailUniform);
	}
	if (rotationBinding !== null) {
		rotationSetEl.addEventListener("click", (ev) => {
			// Chip rename: the name swaps to an inline input; commit on
			// change (Enter blurs, like group names), empty restores the
			// HWiNFO label.
			const nameEl = ev.target.closest(".hw-set-name");
			if (nameEl) {
				const key = nameEl.closest(".hw-set-chip")?.dataset.key;
				if (!key) return;
				const input = document.createElement("input");
				input.type = "text";
				input.className = "hw-group-name hw-chip-rename";
				input.value = rotationNames[key] ?? "";
				input.placeholder = readingLabelOf(key) ?? key;
				input.dataset.key = key;
				input.spellcheck = false;
				nameEl.replaceWith(input);
				input.focus();
				input.select();
				return;
			}
			const groupRemove = ev.target.closest(".hw-group-remove");
			if (groupRemove) {
				const index = Number(groupRemove.dataset.group);
				if (rotationGroups !== null && rotationGroups[index] !== undefined) {
					rotationGroups.splice(index, 1);
					if (rotationGroups.length === 0) {
						// Removing the last group keeps the button's promise
						// ("its readings leave the rotation"): back to flat
						// mode with an empty set, not a silent merge.
						rotationGroups = null;
						rotationKeys = [];
					}
					writeRotation(true);
				}
				return;
			}
			const remove = ev.target.closest(".hw-set-remove");
			if (remove) {
				// A grouped chip leaves its own group only (the editor never
				// creates overlap, but hand-edited settings may hold a reading
				// in several groups); a flat chip leaves the set entirely.
				const index = Number(remove.dataset.group);
				if (remove.dataset.group !== undefined && rotationGroups !== null && rotationGroups[index] !== undefined) {
					rotationGroups[index].keys = rotationGroups[index].keys.filter((k) => k !== remove.dataset.key);
					writeRotation(true);
				} else {
					setRotationMembership(remove.dataset.key, false);
				}
				return;
			}
			const collector = ev.target.closest(".hw-collector");
			if (collector) {
				const index = Number(collector.dataset.group);
				if (Number.isInteger(index)) collectorIndex = index;
				return;
			}
			const action = ev.target.closest("button[data-set-action]");
			if (action === null) return;
			if (action.dataset.setAction === "split") {
				// Group 1 inherits the current set; new ticks land in group 2.
				rotationGroups = [
					{ name: "", keys: [...rotationKeys] },
					{ name: "", keys: [] }
				];
				collectorIndex = 1;
				writeRotation(true);
			} else if (action.dataset.setAction === "add") {
				rotationGroups = rotationGroups ?? [{ name: "", keys: [...rotationKeys] }];
				rotationGroups.push({ name: "", keys: [] });
				collectorIndex = rotationGroups.length - 1;
				writeRotation(true);
			} else if (action.dataset.setAction === "merge") {
				rotationKeys = unionKeys(rotationGroups ?? []);
				rotationGroups = null;
				writeRotation(true);
			}
		});
		// Group and chip names commit on change (blur or Enter); Enter blurs
		// so the deferred re-render (skipped while a field is focused) happens.
		rotationSetEl.addEventListener("change", (ev) => {
			if (!(ev.target instanceof HTMLInputElement)) return;
			if (ev.target.classList.contains("hw-chip-rename")) {
				const key = ev.target.dataset.key;
				const name = ev.target.value.trim();
				if (name === "") delete rotationNames[key];
				else rotationNames[key] = name;
				namesBinding[1]({ ...rotationNames });
				renderRotationSet();
				return;
			}
			if (!ev.target.classList.contains("hw-group-name")) return;
			const index = Number(ev.target.dataset.group);
			if (rotationGroups === null || rotationGroups[index] === undefined) return;
			rotationGroups[index].name = ev.target.value.trim();
			writeRotation(true);
		});
		// A rename abandoned unchanged (blur without an edit) fires no change
		// event; restore the chip's span once focus has left the input.
		rotationSetEl.addEventListener("focusout", (ev) => {
			if (ev.target instanceof HTMLInputElement && ev.target.classList.contains("hw-chip-rename")) {
				setTimeout(renderRotationSet, 0);
			}
		});
		rotationSetEl.addEventListener("keydown", (ev) => {
			if (ev.key === "Enter" && ev.target instanceof HTMLInputElement && ev.target.classList.contains("hw-group-name")) {
				ev.target.blur();
				renderRotationSet();
			}
		});
		rotationBinding[0]().then(adoptRotationKeys);
		groupsBinding[0]().then(adoptRotationGroups);
		namesBinding[0]().then(adoptRotationNames);
	}

	// --- config export and apply (any panel with #config-key) ------------
	// The document IS the action's settings object, canonically ordered:
	// no parallel schema to drift, and fields a build does not know ride
	// along untouched (the futureBlob discipline). Apply replaces the
	// whole document through the socket and reloads the panel: the
	// per-field sdpi stores cache what they last saw, and a reload is the
	// one honest way to make every control adopt a wholesale write.
	const configKeyEl = document.getElementById("config-key");
	if (configKeyEl !== null) {
		const configDeckEl = document.getElementById("config-deck");
		const configNote = document.getElementById("config-note");
		const canonical = (doc) => {
			const out = {};
			for (const field of Object.keys(doc ?? {}).sort()) {
				out[field] = doc[field];
			}
			return JSON.stringify(out, null, "\t");
		};
		const say = (text) => {
			configNote.hidden = false;
			configNote.textContent = text;
		};
		const fill = async () => {
			// Asymmetric client shapes: getSettings resolves the payload
			// envelope, getGlobalSettings resolves the bare settings object.
			const own = await streamDeckClient.getSettings();
			configKeyEl.value = canonical(own?.settings);
			configDeckEl.value = canonical(await streamDeckClient.getGlobalSettings());
		};
		// Filling is a read; it happens when the fold opens, never a write.
		const fold = document.querySelector('details[data-fold="advanced"]');
		fold?.addEventListener("toggle", () => {
			if (fold.open) fill();
		});
		const copy = (el) => async () => {
			const text = el.value;
			try {
				await navigator.clipboard.writeText(text);
			} catch {
				el.select();
				document.execCommand("copy");
			}
			say("Copied.");
		};
		const apply = (el, write, what) => () => {
			let doc;
			try {
				doc = JSON.parse(el.value);
			} catch (err) {
				say(`Refused: not JSON (${err.message}).`);
				return;
			}
			if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
				say("Refused: the document must be one JSON object.");
				return;
			}
			write(doc);
			say(`Applied the ${what} document; reloading the panel.`);
			setTimeout(() => window.location.reload(), 350);
		};
		document.getElementById("config-key-copy")?.addEventListener("click", copy(configKeyEl));
		document.getElementById("config-deck-copy")?.addEventListener("click", copy(configDeckEl));
		document.getElementById("config-key-apply")?.addEventListener("click", apply(configKeyEl, (doc) => streamDeckClient.setSettings(doc), "key"));
		document.getElementById("config-deck-apply")?.addEventListener("click", apply(configDeckEl, (doc) => streamDeckClient.setGlobalSettings(doc), "deck"));
	}
	requestTree();
})();
