/* Shared property-inspector logic: the reading pickers (an accessible
   combobox for one reading, native checklists for membership), the rotation
   set and custom detail list editors, the theme gallery and color wells,
   the configuration documents, and each panel's section summaries.
   Persists through SDPIComponents.useSettings so a write merges one field
   into the whole stored document and never clobbers another. The DOM
   contract lives in the panels that load this file (sensor-reading.html,
   sensor-dial.html): every element is looked up by id here, and a panel
   without a section simply leaves it inert. pi-shell.js (loaded first)
   owns the header, the status line and the native control bindings. */
/* global SDPIComponents, hwShell */
(() => {
	"use strict";

	// Build stamp: the panel names the code it actually runs, because the
	// webview outlives on-disk refreshes and caches sub-resources. Read
	// window.__hwPiVersion (or the console line) before trusting a repro.
	const PI_BUILD = "1.7.0.0-d27";
	window.__hwPiVersion = PI_BUILD;
	console.log(`hwinfo PI build ${PI_BUILD}`);

	const { streamDeckClient, useSettings, useGlobalSettings } = SDPIComponents;
	const hw = hwShell;
	const model = hw.model;

	const galleryEl = document.getElementById("theme-gallery");
	const rotationSetEl = document.getElementById("rotation-set"); // dial PI only
	const controlsCustomEl = document.getElementById("controls-custom"); // dial PI only
	const controlsZonesEl = document.getElementById("controls-zones"); // dial PI only
	const dualRowsEl = document.getElementById("dual-rows"); // reading PI only

	const SENSOR_TYPE_NAMES = ["", "Temp", "Voltage", "Fan", "Current", "Power", "Clock", "Usage"];
	// One hex gate for every color field, mirroring the plugin's shared
	// HEX6 in src/ui/text-colors.ts (unsharable across the webview boundary).
	const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
	// Mirrors QUAD_DEFAULT_COLORS in src/ui/key-renderer.ts.
	const QUAD_DEFAULT_COLORS = ["#4CC2FF", "#FF7E8E", "#38CD89", "#D4AB33"];
	const COLOR_PRESETS = {
		signal: QUAD_DEFAULT_COLORS,
		pairs: ["#4CC2FF", "#4CC2FF", "#FF7E8E", "#FF7E8E"],
		uniform: ["#4CC2FF", "#4CC2FF", "#4CC2FF", "#4CC2FF"]
	};

	let tree = null; // [{ name, readings: [{ key, keys, label, unit, value, type, display }] }]
	// Every key a tree row answers to, mapped to its { group, reading }: the
	// row's own key and each alias the runtime resolves to it (a confirmed
	// cross-source link, a legacy Gadget key the provider republishes), in
	// the row's `keys`. A row's own key always wins over another row's
	// alias. Rebuilt with the tree, so every lookup below is one map read.
	let treeIndex = new Map();
	let treeFetchedOk = false; // last sensorTree arrived while HWiNFO was up
	let treeHasSnapshot = false; // ok or stale, unlike an unavailable empty tree
	let detailsSupported = null; // the plugin's one-shot detail-view answer for this deck
	let treeRequestPending = false;
	let treeSource;

	function requestTree() {
		treeRequestPending = true;
		streamDeckClient.send("sendToPlugin", { event: "getSensorTree" });
	}

	function setTree(groups) {
		tree = groups;
		treeIndex = new Map();
		if (tree === null) return;
		for (const group of tree) {
			for (const reading of group.readings) treeIndex.set(reading.key, { group, reading });
		}
		for (const group of tree) {
			for (const reading of group.readings) {
				for (const alias of Array.isArray(reading.keys) ? reading.keys : []) {
					if (!treeIndex.has(alias)) treeIndex.set(alias, { group, reading });
				}
			}
		}
	}

	// All value formatting comes from the plugin (its measurement authority):
	// tree rows carry a `display` string and the preview a `display` object,
	// so the panel can never drift from what the key or dial face shows.

	/** The tree row a saved key resolves to ({ group, reading }), or null:
	 * the row keyed by it, else the row whose alias list carries it. What
	 * the runtime resolves through a confirmed link, this panel names,
	 * ticks and colors through the same row. The saved key itself is never
	 * rewritten and no name matching happens: a key no row lists is absent. */
	function treeEntryOf(key) {
		return typeof key === "string" ? (treeIndex.get(key) ?? null) : null;
	}

	/** Every key that names the same measurement as `key`: the key itself
	 * first, then the row's own key and its aliases, the order the dial
	 * walks for a row's color and name. A key no row resolves stands alone. */
	function readingKeysOf(key) {
		const keys = [key];
		const entry = treeEntryOf(key);
		if (entry !== null) {
			for (const alias of [entry.reading.key, ...(Array.isArray(entry.reading.keys) ? entry.reading.keys : [])]) {
				if (!keys.includes(alias)) keys.push(alias);
			}
		}
		return keys;
	}

	/** Whether two saved keys name one measurement. */
	function sameReading(a, b) {
		return a === b || readingKeysOf(a).includes(b);
	}

	function readingLabelOf(key) {
		return treeEntryOf(key)?.reading.label ?? null;
	}

	/** A saved key the last snapshot does not list, including a held stale
	 * snapshot, just like the live preview's missing-reading check. The
	 * empty tree of an unavailable source would accuse every saved key of
	 * being gone, while the panel's own hint says HWiNFO is not running. */
	function keyIsMissing(key) {
		return treeHasSnapshot && readingLabelOf(key) === null;
	}

	// --- reading keys in the config document ---------------------------------
	// A stored reading key is HWiNFO's stable identity ("f0000301:0:8000005"),
	// which is exactly what the runtime needs and exactly what nobody can read.
	// The config document appends the reading's friendly name to every key it
	// carries, so a person or an agent can see what a list holds and reorder it
	// by moving whole lines. Apply strips the name straight back off: settings
	// store the key alone, because a stored name is a parallel schema that goes
	// stale the moment HWiNFO renames the sensor. A Gadget key ("g:<source>:
	// <label>", the names as HWiNFO writes them) already reads as a name and
	// carries spaces of its own, so it is written whole and never named.

	/** The settings fields whose values are reading keys. Scalars hold one,
	 * arrays hold a list, and a rotation group holds its list under `keys`. */
	const KEY_SCALAR_FIELDS = ["readingKey", "secondaryReadingKey", "quadReadingKey3", "quadReadingKey4"];
	const KEY_LIST_FIELDS = ["detailKeys", "rotationKeys"];

	/** The key alone. Leading whitespace is a hand indent, never identity:
	 * no key starts with it. A Gadget key ("g:") is then kept whole to its
	 * last character: its spaces are HWiNFO's own (issue #21 meets custom
	 * mode; cutting at the first one left "g:Test" behind and every chip
	 * missing), and a label ending in whitespace is a different reading
	 * from the one without, so trimming the tail swapped identities through
	 * Copy and Apply. Every other key (colon-separated hex, a g2: token)
	 * never contains whitespace, so it ends at the first run of it and
	 * anything after is an appended name. Mirrors bareReadingKey in
	 * src/detail/detail-settings.ts; keep the two together. */
	function bareKey(value) {
		if (typeof value !== "string") return value;
		const lead = value.trimStart();
		return lead.startsWith("g:") ? lead : (lead.split(/\s+/)[0] ?? "");
	}

	/** The key with its friendly name appended, or the bare key when no name
	 * resolves: the reading is not in the current HWiNFO layout, or the tree
	 * has not arrived yet. An unnamed hex key in the document is itself the
	 * signal that the reading is missing; a Gadget key names its reading
	 * already and stays bare. */
	function namedKey(value) {
		const key = bareKey(value);
		if (typeof key !== "string" || key === "" || key.startsWith("g:")) return key;
		const label = readingLabelOf(key);
		return label === null ? key : `${key}  ${label}`;
	}

	/** Runs `fn` over every reading key in a settings document, leaving every
	 * other field untouched (the futureBlob discipline: a field this build
	 * does not know rides along exactly as it arrived). */
	function mapReadingKeys(doc, fn) {
		if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return doc;
		const out = { ...doc };
		for (const field of KEY_SCALAR_FIELDS) {
			if (typeof out[field] === "string") out[field] = fn(out[field]);
		}
		for (const field of KEY_LIST_FIELDS) {
			if (Array.isArray(out[field])) out[field] = out[field].map((k) => (typeof k === "string" ? fn(k) : k));
		}
		if (Array.isArray(out.rotationGroups)) {
			out.rotationGroups = out.rotationGroups.map((group) =>
				typeof group === "object" && group !== null && Array.isArray(group.keys) ? { ...group, keys: group.keys.map((k) => (typeof k === "string" ? fn(k) : k)) } : group
			);
		}
		return out;
	}

	// --- rotation set (dial PI only) -----------------------------------------
	// The readings dial rotation is limited to, ticked in the rotation
	// checklist (its own list: the Reading combobox above picks what is on
	// the dial NOW, the checklist picks what rotation moves THROUGH). Shown as
	// one flat chips row, or split into named groups (plain rotate stays
	// inside a group, a gesture set to "Switch sensor or group" jumps between
	// them). rotationKeys is kept mirrored to the union of all group keys, so
	// set-wide consumers (stats, reset reach) and older plugin versions after
	// a rollback keep reading the flat set unchanged. The plugin ignores
	// anything under two non-empty groups; the PI still renders those editing
	// states. Every write is lossless: a group's unknown fields, list entries
	// this build cannot read, and names the parser skipped ride along as
	// stored. Declared before the pickers so every reference below is
	// initialized by the time async callbacks fire.
	let rotationPicker = null; // the dial's membership checklist, created with the pickers
	let rotationKeys = [];
	let rotationKeysKept = []; // raw entries this build does not edit (non-strings)
	let rotationKeysKeptAt = []; // ...and where they were stored
	let rotationGroups = null; // null = flat set; else [{ name, keys, raw, base, keysKept, keysKeptAt }]
	let rotationGroupsKept = []; // raw group entries that are not objects
	let rotationGroupsKeptAt = [];
	let rotationNamesRaw = {}; // the stored map, junk entries included
	let rotationNames = {}; // per-reading display names, keyed by reading key
	let collectorIndex = 0; // which group new ticks land in (PI-local, not persisted)
	// On a fresh page the ticks go to the group holding the reading on the
	// dial, not always group 1; settled once, never while the person works
	// (round 3, R36).
	let collectorSettled = false;
	// What the stored control map does with groups, for the one groups line:
	// the gestures set to "Switch sensor or group", and what a plain turn does.
	let groupJumpers = ["pressed turn"];
	let turnCommand = "step";
	let presetNow = "elite";

	function adoptRotationKeys(value) {
		const split = model.splitKeyList(value);
		rotationKeys = split.known;
		rotationKeysKept = split.kept;
		rotationKeysKeptAt = split.keptAt;
		renderRotationSet();
		rotationPicker?.renderList();
	}

	function adoptRotationGroups(value) {
		const parsed = parseGroupsSetting(value);
		rotationGroups = parsed.groups;
		rotationGroupsKept = parsed.kept;
		rotationGroupsKeptAt = parsed.keptAt;
		clampCollector();
		renderRotationSet();
		rotationPicker?.renderList();
	}

	function adoptRotationNames(value) {
		rotationNamesRaw = typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
		rotationNames = parseNamesSetting(value);
		renderRotationSet();
	}

	const rotationBinding = rotationSetEl === null ? null : useSettings("rotationKeys", adoptRotationKeys, null);
	const groupsBinding = rotationSetEl === null ? null : useSettings("rotationGroups", adoptRotationGroups, null);
	// Stages rotationGroups without saving, so the rotationKeys save that
	// follows carries both fields in ONE frame (the detail list's pattern:
	// two frames leave a window where only half of an edit survives).
	const groupsStage = rotationSetEl === null ? null : useSettings("rotationGroups", undefined, null, false);
	// Per-reading names: shown on the chip, the overview rows, and as the
	// dial title while that reading is selected. Unticking a reading keeps
	// its name, so re-adding it restores the rename.
	const namesBinding = rotationSetEl === null ? null : useSettings("rotationNames", adoptRotationNames, null);

	// Settings are untyped JSON: keep non-empty string names only.
	function parseNamesSetting(value) {
		if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
		const names = {};
		for (const [key, name] of Object.entries(value)) {
			if (typeof name === "string" && name.trim() !== "") model.setOwn(names, key, name);
		}
		return names;
	}

	// Settings are untyped JSON: groups render from their name string and
	// string keys; an empty or non-array value is "no groups" (the flat
	// set). Each group keeps its raw entry so a write re-emits the fields
	// and key entries this build does not know exactly as stored.
	function parseGroupsSetting(value) {
		if (!Array.isArray(value) || value.length === 0) return { groups: null, kept: [], keptAt: [] };
		const groups = [];
		const kept = [];
		const keptAt = [];
		value.forEach((entry, index) => {
			if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
				kept.push(entry);
				keptAt.push(index);
				return;
			}
			const split = model.splitKeyList(entry.keys);
			const name = typeof entry.name === "string" ? entry.name : "";
			groups.push({ name, keys: split.known, keysKept: split.kept, keysKeptAt: split.keptAt, raw: entry, base: { name, keys: model.mergeKept(split.known, split.kept, split.keptAt) } });
		});
		return { groups: groups.length > 0 ? groups : null, kept, keptAt };
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

	/** A key and its aliases are one member: the dial steps a measurement
	 * once however many of its keys the set holds, so a live row whose
	 * saved twin is in the set ticks as in. */
	function memberOfRotation(key) {
		const keys = readingKeysOf(key);
		const holds = (list) => list.some((k) => keys.includes(k));
		return rotationGroups !== null ? rotationGroups.some((g) => holds(g.keys)) : holds(rotationKeys);
	}

	/** A reading's per-member name: saved under the key it shows as, else
	 * under a confirmed alias of it, the walk the dial title takes. */
	function readingNameOf(key) {
		for (const k of readingKeysOf(key)) {
			if (Object.hasOwn(rotationNames, k)) return rotationNames[k];
		}
		return undefined;
	}

	/** A group's stored form: only the fields the edit changed are rewritten. */
	function serializeGroup(group) {
		return model.patchEntry(group.raw, group.base, { name: group.name, keys: model.mergeKept(group.keys, group.keysKept, group.keysKeptAt) }, ["name", "keys"]);
	}

	/**
	 * One write path for every set/group edit: persists the groups (when
	 * `writeGroups`; flat-set edits skip it so dials that never used groups
	 * never gain the field) AND the union mirror in rotationKeys, then
	 * refreshes the chips and syncs the list ticks in place, so the open
	 * list keeps its scroll position and every box matches the model.
	 */
	function writeRotation(writeGroups, { render = true } = {}) {
		if (rotationGroups !== null) rotationKeys = unionKeys(rotationGroups);
		clampCollector();
		if (writeGroups) {
			// [] persists "no groups": the field is only ever written, never
			// removed, and the plugin ignores anything under two groups.
			groupsStage[1](model.mergeKept(rotationGroups === null ? [] : rotationGroups.map(serializeGroup), rotationGroupsKept, rotationGroupsKeptAt));
		}
		rotationBinding[1](model.mergeKept(rotationKeys, rotationKeysKept, rotationKeysKeptAt));
		if (render) speakingNotes(renderRotationSet);
		if (rotationPicker !== null) {
			for (const tick of rotationPicker.list.querySelectorAll(".hw-row .hw-tick")) {
				tick.checked = memberOfRotation(tick.closest(".hw-row").dataset.key);
			}
		}
	}

	function setRotationMembership(key, present) {
		if (rotationBinding === null || !key) return;
		// Already in through the key or an alias of it: nothing to write; a
		// second endpoint would only be a duplicate the runtime collapses.
		if (present === memberOfRotation(key)) return;
		// Leaving takes the key and every alias of its reading out, so one
		// untick never leaves the same measurement in under another key.
		const keys = readingKeysOf(key);
		if (rotationGroups === null) {
			rotationKeys = present ? [...rotationKeys, key] : rotationKeys.filter((k) => !keys.includes(k));
		} else if (present) {
			// New ticks land in the marked collector group.
			const target = rotationGroups[collectorIndex];
			if (target !== undefined && !target.keys.includes(key)) target.keys.push(key);
		} else {
			// Unticking removes the reading from every group holding it.
			for (const group of rotationGroups) {
				group.keys = group.keys.filter((k) => !keys.includes(k));
			}
		}
		writeRotation(rotationGroups !== null);
	}

	// The rotation editor: one listbox per list (the flat set, or each
	// group), one Tab stop each, after the search that adds readings, and
	// ONE toolbar (Earlier, Later, Rename, Remove) that acts on the selected
	// member (W3C APG rearrangeable listbox: the options hold no controls of
	// their own). The selection is the editor's own, panel-local and never
	// written; the reading on the dial now is a separate mark (a fill),
	// and membership is the checklist's ticks. Selecting a member never
	// changes what is on the dial.
	let rotationSel = null; // { key, group: number | null }
	// Until the person selects a member, the selection follows the reading
	// on the dial (it may load after the list, and rotation moves it).
	let rotationSelChosen = false;

	function rotationLists() {
		return rotationGroups === null ? [{ group: null, keys: rotationKeys }] : rotationGroups.map((g, i) => ({ group: i, keys: g.keys }));
	}

	/** The selection if it still names a member, else the reading on the
	 * dial, else the first member; null for an empty rotation. */
	function resolveRotationSel(prev) {
		const lists = rotationLists();
		if (prev !== null && lists.some((l) => l.group === prev.group && l.keys.includes(prev.key))) return prev;
		const onDial = primaryPicker.selectedKey();
		for (const l of lists) {
			const k = l.keys.find((x) => sameReading(x, onDial));
			if (k !== undefined) return { key: k, group: l.group };
		}
		const first = lists.find((l) => l.keys.length > 0);
		return first === undefined ? null : { key: first.keys[0], group: first.group };
	}

	function rotationNameOf(key) {
		return readingNameOf(key) ?? readingLabelOf(key) ?? key;
	}

	/** The sensor a saved key's reading comes from, or null. */
	function sourceNameOf(key) {
		return treeEntryOf(key)?.group.name ?? null;
	}

	/** Where a saved key's row sits in HWiNFO's list (sensor, then reading). */
	function treeOrderOf(key) {
		const entry = treeEntryOf(key);
		if (entry === null || tree === null) return Number.MAX_SAFE_INTEGER;
		return tree.indexOf(entry.group) * 10000 + entry.group.readings.indexOf(entry.reading);
	}

	/** When another member of `scope` shows the same name as `key` (two
	 * drives' "Drive Temperature"), a short tag that tells them apart: the
	 * first word of this sensor's name that no twin's sensor name has
	 * ("#1" from "Drive [#1]: ...", "CPU" against "GPU", "980" against
	 * "990"), shortened; when the sensor names give nothing apart, the
	 * reading's place among its twins in HWiNFO's list. Every twin gets a
	 * different tag. Null when the name is unique (round 3, R07; re-review
	 * VY02, BY04, PY07). */
	function twinTagOf(key, scope, nameOf) {
		const shown = nameOf(key);
		const source = sourceNameOf(key);
		if (source === null) return null;
		const twins = scope.filter((k) => !sameReading(k, key) && nameOf(k) === shown && sourceNameOf(k) !== null);
		if (twins.length === 0) return null;
		const words = (name) => name.split(/[\s:,()]+/).filter(Boolean).map((w) => w.replace(/^\[(#\d+)\]$/, "$1"));
		const others = twins.map(sourceNameOf);
		if (!others.includes(source)) {
			const theirs = new Set(others.flatMap(words));
			const own = words(source).find((w) => !theirs.has(w));
			const cut = (w) => (w.length > 12 ? `${w.slice(0, 11)}…` : w);
			// Two tags cut to the same prefix tell nothing apart.
			const tagOf = (name) => {
				const rest = new Set([source, ...others].filter((n) => n !== name).flatMap(words));
				const w = words(name).find((x) => !rest.has(x));
				return w === undefined ? null : cut(w);
			};
			if (own !== undefined && others.every((n) => tagOf(n) !== cut(own))) return cut(own);
		}
		const order = [key, ...twins].sort((a, b) => treeOrderOf(a) - treeOrderOf(b));
		return `no. ${order.indexOf(key) + 1}`;
	}

	/** A member's name as spoken and in tooltips: the shown name, plus its
	 * sensor when another member shows the same name. */
	function twinSpokenName(key, scope, nameOf) {
		return twinTagOf(key, scope, nameOf) === null ? nameOf(key) : `${nameOf(key)} from ${sourceNameOf(key)}`;
	}

	/** Every member of the rotation, across groups: the scope in which two
	 * equal names need telling apart (the toolbar names one of them). */
	function rotationScope() {
		return rotationGroups === null ? rotationKeys : unionKeys(rotationGroups);
	}

	function rotationSpokenName(key) {
		return twinSpokenName(key, rotationScope(), rotationNameOf);
	}

	function twinPill(tag, source) {
		const pill = document.createElement("span");
		pill.className = "hw-chip-badge hw-chip-source";
		pill.textContent = tag;
		pill.title = source;
		pill.setAttribute("aria-hidden", "true"); // spoken as "from <sensor>"
		return pill;
	}

	// What a missing member says: the device face's own word ("Sensor
	// missing") on a visible pill, and why in the tooltip (round 3, R05).
	const MISSING_TITLE = "Not in HWiNFO's current list: keeps its place and is skipped until it returns";
	function missingPill() {
		const pill = document.createElement("span");
		pill.className = "hw-chip-badge hw-chip-missing";
		pill.textContent = "missing";
		return pill;
	}

	/** A list counted the way the runtime steps it: one entry per
	 * measurement (a confirmed link's two keys are one), and live only when
	 * the current snapshot lists it. */
	function rotationCounts(keys) {
		const all = [];
		for (const key of keys) {
			if (!all.some((k) => sameReading(k, key))) all.push(key);
		}
		const missing = all.filter(keyIsMissing).length;
		return { total: all.length, live: all.length - missing, missing };
	}

	function skippedNote(missing) {
		return missing === 1 ? "the missing one is skipped until HWiNFO lists it again" : `the ${missing} missing ones are skipped until HWiNFO lists them again`;
	}

	function rotationOption(key, groupIndex, index, count) {
		const label = readingLabelOf(key);
		// Alias-aware (linked readings): present, current and named under any
		// of the reading's keys.
		const missing = keyIsMissing(key);
		const current = sameReading(key, primaryPicker.selectedKey());
		const custom = readingNameOf(key);
		const option = document.createElement("div");
		option.setAttribute("role", "option");
		option.id = `rot-${groupIndex === null ? "f" : groupIndex}-${index}`;
		// "current" paints the reading on the dial right now, so the open
		// panel shows where rotation (and a group jump) landed. The mark never
		// changes the chip's size.
		option.className = "hw-set-chip" + (missing ? " missing" : "") + (current ? " current" : "");
		option.dataset.key = key;
		if (groupIndex !== null) option.dataset.group = String(groupIndex);
		const selected = rotationSel !== null && rotationSel.key === key && rotationSel.group === groupIndex;
		option.setAttribute("aria-selected", selected ? "true" : "false");
		option.setAttribute("aria-posinset", String(index + 1));
		option.setAttribute("aria-setsize", String(count));
		const tag = twinTagOf(key, rotationScope(), rotationNameOf);
		const from = tag === null ? "" : ` (${sourceNameOf(key)})`;
		option.title = missing ? MISSING_TITLE : (custom !== undefined && label !== null ? `${label}${from}, shown on the dial as ${custom}` : `${label ?? key}${from}`) + (current ? "; on the dial now" : "");
		const name = document.createElement("span");
		name.className = "hw-set-name" + (custom !== undefined ? " renamed" : "");
		name.textContent = custom ?? label ?? key;
		option.append(name);
		if (tag !== null) {
			option.append(twinPill(tag, sourceNameOf(key)));
			// The option's name is its text: the tag alone would be read as
			// "#1"; the sensor's full name follows it for screen readers.
			const spoken = document.createElement("span");
			spoken.className = "hw-sr-only";
			spoken.textContent = ` from ${sourceNameOf(key)}`;
			option.append(spoken);
		}
		if (current) {
			// Spoken, never drawn: a drawn word widened this one chip, so the
			// list rewrapped and the panel jumped each time the dial moved on.
			// The header above names the reading in words.
			const spoken = document.createElement("span");
			spoken.className = "hw-sr-only";
			spoken.textContent = " on dial";
			option.append(spoken);
		}
		if (missing) option.append(missingPill());
		return option;
	}

	function rotationListbox(keys, groupIndex, label) {
		const list = document.createElement("div");
		list.className = "hw-set-list";
		list.setAttribute("role", "listbox");
		list.setAttribute("aria-label", label);
		list.setAttribute("aria-orientation", "horizontal");
		list.setAttribute("aria-describedby", "rotation-keys-help");
		list.setAttribute("aria-keyshortcuts", "Alt+ArrowLeft Alt+ArrowRight Alt+Home Alt+End F2 Delete");
		list.tabIndex = 0;
		list.dataset.group = groupIndex === null ? "" : String(groupIndex);
		keys.forEach((key, i) => list.appendChild(rotationOption(key, groupIndex, i, keys.length)));
		const selected = list.querySelector('[aria-selected="true"]');
		if (selected !== null) list.setAttribute("aria-activedescendant", selected.id);
		return list;
	}

	/** The one toolbar, built once and moved under the list that holds the
	 * selection (never while it holds focus). Roving Tab stop inside. */
	const rotationTools = (() => {
		if (rotationSetEl === null) return null;
		const bar = document.createElement("div");
		bar.className = "hw-set-tools";
		bar.setAttribute("role", "toolbar");
		bar.setAttribute("aria-label", "Selected reading");
		for (const [tool, glyph, word] of [
			["earlier", "←", "Earlier"],
			["later", "→", "Later"],
			["rename", "", "Rename"],
			["remove", "×", "Remove"]
		]) {
			const button = document.createElement("button");
			button.type = "button";
			button.dataset.tool = tool;
			button.tabIndex = tool === "earlier" ? 0 : -1;
			if (glyph !== "") {
				const g = document.createElement("span");
				g.setAttribute("aria-hidden", "true");
				g.textContent = `${glyph} `;
				button.appendChild(g);
			}
			const label = document.createElement("span");
			label.textContent = word;
			button.appendChild(label);
			bar.appendChild(button);
		}
		// Every grouped list reserves the toolbar's real height (its margins
		// included), which grows when a narrow or zoomed panel wraps it, so
		// selecting in another group still moves nothing.
		if (typeof ResizeObserver === "function") {
			new ResizeObserver(() => {
				if (!bar.isConnected) return;
				rotationSetEl.style.setProperty("--hw-tools-h", `${Math.ceil(bar.getBoundingClientRect().height) + 6}px`);
			}).observe(bar);
		}
		return bar;
	})();

	/** Where the selection sits: its list's keys and its index there. */
	function rotationSelPlace() {
		if (rotationSel === null) return null;
		const list = rotationLists().find((l) => l.group === rotationSel.group);
		const index = list === undefined ? -1 : list.keys.indexOf(rotationSel.key);
		return index < 0 ? null : { keys: list.keys, index };
	}

	// The list's own shortcuts, named in each tool's tooltip and on the list
	// (aria-keyshortcuts). Delete joined them once the owner checked that
	// the Stream Deck app leaves it to the panel (2026-09-26; round 3, R37,
	// R52).
	const TOOL_KEYS = { earlier: "Alt+Left", later: "Alt+Right", rename: "F2", remove: "Delete" };

	/** Names and enables the toolbar for the current selection. A button
	 * that cannot act says so with aria-disabled and stays focusable, so a
	 * move that reaches the end never drops focus to the page. */
	function syncRotationTools() {
		if (rotationTools === null) return;
		const place = rotationSelPlace();
		const name = place === null ? "" : rotationSpokenName(rotationSel.key);
		const where = rotationSel === null || rotationSel.group === null ? "the rotation" : `group ${rotationSel.group + 1}`;
		// At a group's edge Earlier and Later move the member into the
		// neighbor group, and say so in their names (round 3, R23).
		const groupName = (i) => `group ${i + 1}${rotationGroups?.[i]?.name ? ` (${rotationGroups[i].name})` : ""}`;
		const g = rotationSel?.group ?? null;
		const intoPrev = place !== null && place.index === 0 && g !== null && g > 0;
		const intoNext = place !== null && place.index === place.keys.length - 1 && g !== null && rotationGroups !== null && g < rotationGroups.length - 1;
		const spec = {
			earlier: [place !== null && (place.index > 0 || intoPrev), intoPrev ? `Earlier: move ${name} to the end of ${groupName(g - 1)}` : `Move ${name} earlier`],
			later: [place !== null && (place.index < place.keys.length - 1 || intoNext), intoNext ? `Later: move ${name} to the start of ${groupName(g + 1)}` : `Move ${name} later`],
			rename: [place !== null, `Rename ${name} on the dial`],
			remove: [place !== null, `Remove ${name} from ${where}`]
		};
		for (const button of rotationTools.querySelectorAll("button[data-tool]")) {
			const [enabled, label] = spec[button.dataset.tool];
			button.setAttribute("aria-disabled", enabled ? "false" : "true");
			button.setAttribute("aria-label", label);
			button.title = TOOL_KEYS[button.dataset.tool] === undefined ? label : `${label} (${TOOL_KEYS[button.dataset.tool]} in the list)`;
		}
	}

	/** Puts the toolbar right after the list holding the selection. */
	function placeRotationTools() {
		if (rotationTools === null) return;
		const lists = [...rotationSetEl.querySelectorAll(".hw-set-list")];
		if (lists.length === 0) {
			rotationTools.remove();
			return;
		}
		const want = rotationSel === null || rotationSel.group === null ? "" : String(rotationSel.group);
		const home = lists.find((l) => l.dataset.group === want) ?? lists[0];
		const slot = home.nextElementSibling !== null && home.nextElementSibling.classList.contains("hw-set-tools-slot") ? home.nextElementSibling : null;
		if (slot !== null) {
			if (rotationTools.parentElement !== slot) slot.appendChild(rotationTools);
		} else if (home.nextElementSibling !== rotationTools) home.after(rotationTools);
	}

	/** Selects one member (a UI move, never a write) and keeps every list's
	 * aria state and the toolbar in step. */
	function selectRotationMember(key, group, { focus = false } = {}) {
		rotationSel = { key, group };
		rotationSelChosen = true;
		for (const list of rotationSetEl.querySelectorAll(".hw-set-list")) {
			let active = null;
			for (const option of list.querySelectorAll('[role="option"]')) {
				const on = option.dataset.key === key && (option.dataset.group === undefined ? null : Number(option.dataset.group)) === group;
				option.setAttribute("aria-selected", on ? "true" : "false");
				if (on) active = option;
			}
			if (active !== null) {
				list.setAttribute("aria-activedescendant", active.id);
				active.scrollIntoView({ block: "nearest" });
				if (focus) list.focus({ preventScroll: true });
			}
		}
		placeRotationTools();
		syncRotationTools();
	}

	/** Where focus goes after the next rebuild, when the action that
	 * caused it knows better than the memory of what held focus (the
	 * control it pressed is gone). One-shot. */
	let rotationPendingFocus = null;

	/** Focus memory across a rebuild: which list, tool or action held it. */
	function rotationFocusMemo() {
		const a = document.activeElement;
		if (a === null || !rotationSetEl.contains(a)) return null;
		if (a.matches(".hw-set-list")) return { list: true };
		if (a.matches(".hw-set-tools button")) return { tool: a.dataset.tool };
		if (a.matches("button[data-set-action]")) return { setAction: a.dataset.setAction };
		if (a.matches(".hw-collector")) return { collector: a.dataset.group };
		if (a.matches(".hw-group-remove")) return { groupRemove: a.dataset.group };
		return null;
	}

	function rotationFocusRestore(memo) {
		if (rotationPendingFocus !== null) {
			const pick = rotationPendingFocus;
			rotationPendingFocus = null;
			const target = pick();
			if (target instanceof HTMLElement) {
				target.focus({ preventScroll: true });
				target.scrollIntoView({ block: "nearest" });
				return;
			}
		}
		if (memo === null || rotationSetEl.contains(document.activeElement)) return;
		let target = null;
		const selGroup = rotationSel === null || rotationSel.group === null ? "" : String(rotationSel.group);
		if (memo.list === true) target = rotationSetEl.querySelector(`.hw-set-list[data-group="${selGroup}"]`) ?? rotationSetEl.querySelector(".hw-set-list");
		else if (memo.tool !== undefined) target = rotationTools?.isConnected ? rotationTools.querySelector(`button[data-tool="${memo.tool}"]`) : rotationSetEl.querySelector(".hw-set-list");
		else if (memo.setAction !== undefined) target = rotationSetEl.querySelector(`button[data-set-action="${memo.setAction}"]`);
		else if (memo.collector !== undefined) target = rotationSetEl.querySelector(`.hw-collector[data-group="${memo.collector}"]`);
		else if (memo.groupRemove !== undefined) target = rotationSetEl.querySelector(`.hw-group-remove[data-group="${memo.groupRemove}"]`);
		// Nothing left to hold it (the last member went): back to the search,
		// scrolled into view rather than left above the top of the panel.
		if (target !== null) target.focus({ preventScroll: true });
		else quietFocus(document.getElementById("pickerr-search"));
	}

	/** Moves focus to a search box without opening its list. */
	function quietFocus(searchEl) {
		if (searchEl === null) return;
		searchEl.dataset.quietFocus = "1";
		searchEl.focus();
		delete searchEl.dataset.quietFocus; // already focused: no focus event came
	}

	/** Arm-then-confirm for a destructive press, the panel's Replace
	 * idiom: the first press arms the button, which then says in words
	 * what will go; the second press confirms. A press within 450 ms of
	 * arming is ignored, so a double click only arms, and the shell never
	 * lets a held key's repeats count as a press. The arm lives in module
	 * state keyed by what it would remove (the button's armId), so an echo
	 * that rebuilds the editor (a turn, an auto cycle step, a sensor list)
	 * keeps it on the rebuilt button; the person moving focus elsewhere, or
	 * the group changing, drops it (round 3, re-review PY04, AY02). The
	 * accessible name starts with the visible words. Returns "armed",
	 * "wait" or "confirm". */
	let rotationArm = null; // { id, at, text, label }
	let rotationRebuilding = false;
	function armPress(button, armedText, armedLabel, spoken, detail = 0) {
		const id = button.dataset.armId;
		// The second (or third) click of one multi-click gesture only waits,
		// whatever the system's double-click time (external review AX13).
		if (rotationArm !== null && rotationArm.id === id) return detail > 1 || performance.now() - rotationArm.at < 450 ? "wait" : "confirm";
		rotationArm = { id, at: performance.now(), text: armedText, label: `${armedText} ${armedLabel}` };
		applyArm(button);
		hw.announce("rotation-order", spoken, { repeat: true });
		return "armed";
	}

	/** Dresses a (re)built button as armed when the standing arm names it. */
	function applyArm(button) {
		const arm = rotationArm;
		if (arm === null || button.dataset.armId !== arm.id) return;
		if (button.dataset.idleText === undefined) {
			button.dataset.idleText = button.textContent;
			button.dataset.idleLabel = button.getAttribute("aria-label") ?? "";
		}
		button.dataset.armed = "true";
		button.textContent = arm.text;
		button.setAttribute("aria-label", arm.label);
		button.addEventListener(
			"blur",
			() => {
				// A rebuild removing the focused button is not the person
				// leaving it; the rebuilt button carries the arm on.
				if (rotationRebuilding || rotationArm !== arm) return;
				rotationArm = null;
				button.dataset.armed = "false";
				button.textContent = button.dataset.idleText;
				if (button.dataset.idleLabel === "") button.removeAttribute("aria-label");
				else button.setAttribute("aria-label", button.dataset.idleLabel);
			},
			{ once: true }
		);
	}

	/** Leave-flush registration for a name field the panel commits itself:
	 * the first keystroke registers a commit with the shell's leave flush
	 * (mouseleave, window blur), so text typed just before another key is
	 * selected is saved like every bound field's; the field's own change
	 * drops it. Never commits mid-composition. */
	const leaveCommits = new WeakMap();
	function registerLeaveCommit(input, commit) {
		if (leaveCommits.has(input)) return;
		const flush = () => {
			if (input.dataset.composing === "1") return;
			hw.dropLeaveFlush(flush);
			leaveCommits.delete(input);
			if (input.isConnected) commit();
		};
		leaveCommits.set(input, flush);
		hw.addLeaveFlush(flush);
	}
	function dropLeaveCommit(input) {
		const flush = leaveCommits.get(input);
		if (flush === undefined) return;
		hw.dropLeaveFlush(flush);
		leaveCommits.delete(input);
	}
	document.addEventListener("compositionstart", (ev) => {
		if (ev.target instanceof HTMLInputElement) ev.target.dataset.composing = "1";
	});
	document.addEventListener("compositionend", (ev) => {
		if (ev.target instanceof HTMLInputElement) delete ev.target.dataset.composing;
	});

	// Notes speak only when a person's edit changed them; a panel opening or
	// a sensor list arriving redraws them silently (round 3, re-review AY11).
	let notesSpeak = false;
	/** Runs a render a person's edit caused, so its notes are spoken. */
	function speakingNotes(render) {
		const was = notesSpeak;
		notesSpeak = true;
		try {
			render();
		} finally {
			notesSpeak = was;
		}
	}
	function setNote(text, channel = null) {
		const note = document.createElement("div");
		note.className = "hw-set-note";
		note.textContent = text;
		// Counts, cap refusals and empty-list guidance change without focus
		// moving; the shell's one persistent live region carries the change.
		if (channel !== null) hw.announce(channel, text, { quiet: !notesSpeak });
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
		collector.setAttribute("aria-label", `New ticks go to group ${index + 1}${group.name !== "" ? ` (${group.name})` : ""}`);
		// The label around the radio is its hit area (24 px); a press on it
		// checks the radio and fires the same change as a press on the mark.
		const hit = document.createElement("label");
		hit.className = "hw-collector-hit";
		hit.title = collector.title;
		hit.appendChild(collector);
		const name = document.createElement("input");
		name.type = "text";
		name.className = "hw-group-name";
		name.value = group.name;
		name.placeholder = `Group ${index + 1}`;
		name.dataset.group = String(index);
		name.title = "Group name; the dial shows it when a jump lands here";
		name.setAttribute("aria-label", `Name of group ${index + 1}`);
		name.spellcheck = false;
		const remove = document.createElement("button");
		remove.type = "button";
		remove.className = "hw-group-remove";
		remove.dataset.group = String(index);
		remove.title = "Remove this group (its readings leave the rotation)";
		remove.setAttribute("aria-label", `Remove group ${index + 1}; its readings leave the rotation`);
		remove.textContent = "×";
		// The whole stored group names the arm, so a changed name, reading or
		// kept entry disarms it; a joined string let two different groups
		// share one (external review AX30). Key order is not a change.
		remove.dataset.armId = model.sortedJson(["remove", index, serializeGroup(group)]);
		applyArm(remove);
		head.append(hit, name, remove);
		return head;
	}

	/** "a pressed turn", "a turn and a long push": the gestures, as words. */
	function gestureList(names) {
		const a = names.map((n) => `a ${n}`);
		return a.length < 2 ? (a[0] ?? "") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`;
	}

	function updateRotationHelp() {
		const help = document.getElementById("rotation-help");
		if (help === null) return;
		// A plain rotation needs no paragraph here: the note under the chips
		// says what rotates, and the help under the search says how ticking
		// and ordering work. Groups get one line derived from the stored
		// control map: where new ticks go, what stays inside a group and
		// what jumps; or, when nothing can jump, what happens instead, with
		// the way to the gestures (round 3, R19, R42). The order sentence
		// under the search gives way to the slots' own hint.
		const orderHelp = document.getElementById("pickerr-order-help");
		if (orderHelp !== null) orderHelp.hidden = rotationGroups !== null;
		help.hidden = rotationGroups === null;
		if (rotationGroups === null) {
			help.replaceChildren();
			delete help.dataset.signature;
			return;
		}
		const turnsOff = hw.state.settings.rotationDisabled === true;
		// Two touch zones take every tap for the sides: a tap set to switch
		// groups never fires there (round 3, re-review PY05).
		const zones = hw.state.preview?.effective?.controls?.touchZones;
		const live = groupJumpers.filter((g) => !(turnsOff && g.endsWith("turn")) && !(zones === "two" && g === "tap"));
		const jumpers = live;
		const inside = !turnsOff && turnCommand === "step" ? "Turns stay inside a group; " : "";
		// Groups act only once two of them hold readings (the runtime's
		// rotationGroupsOf); until then the line speaks of what will happen,
		// so it never contradicts the note above it.
		const active = model.groupsActive({ rotationGroups: rotationGroups.map((g) => ({ keys: g.keys })) });
		let text;
		let link = false;
		if (jumpers.length > 0 && active) {
			const who = gestureList(jumpers);
			text = `New ticks go to the marked group. ${inside}${inside === "" ? who.charAt(0).toUpperCase() + who.slice(1) : who} jumps to the next group and shows its name.`;
		} else if (jumpers.length > 0) {
			text = `New ticks go to the marked group. Once two groups hold readings, ${inside === "" ? "" : "turns stay inside a group and "}${gestureList(jumpers)} jumps between them.`;
		} else if (groupJumpers.length > 0 && turnsOff) {
			text = "New ticks go to the marked group. Ignore turns is on, so nothing jumps between groups.";
		} else if (groupJumpers.includes("tap") && zones === "two" && hw.state.preview?.effective?.controls?.switchesGroups === true) {
			link = true;
			text = `New ticks go to the marked group. ${inside === "" ? "The" : `${inside}the`} tap set to Switch sensor or group never fires with two touch zones, so nothing jumps between groups. `;
		} else {
			link = true;
			text = `New ticks go to the marked group. ${presetNow === "legacy" ? "Legacy gestures cannot switch groups" : "No gesture here is set to Switch sensor or group"}${turnsOff ? ", and Ignore turns is on. " : ", so turns run through all groups as one list, in group order. "}`;
		}
		const signature = `${text}|${link}`;
		if (help.dataset.signature === signature) return;
		help.dataset.signature = signature;
		help.textContent = text;
		if (link) {
			const button = document.createElement("button");
			button.type = "button";
			button.className = "hw-link";
			button.dataset.reveal = "f-preset";
			button.textContent = "Change gestures";
			help.appendChild(button);
		}
	}

	// The groups line follows the control map (preset and Custom gestures).
	function syncGroupsHelp() {
		updateRotationHelp();
	}

	/** What moves the reading on the dial, from the plugin's resolved
	 * control map plus Ignore turns and auto cycle, as plural words; null
	 * until the first preview names the map. */
	function dialMovers(st) {
		const c = st.preview?.effective?.controls;
		if (c === undefined) return null;
		const moves = (command) => command === "step" || command === "stepGroup";
		const s = st.settings;
		const turnsOff = s.rotationDisabled === true;
		const words = [];
		if (!turnsOff && moves(c.rotate)) words.push("turns");
		if (!turnsOff && moves(c.pressedRotate) && c.pressedRotate !== c.rotate) words.push("pressed turns");
		if (moves(c.shortPress) || (c.preset !== "legacy" && moves(c.longPress))) words.push("pushes");
		if (c.touchZones !== "off") words.push("the strip's sides");
		else if (moves(c.tap)) words.push("taps");
		if (moves(c.touchHold)) words.push("long touches");
		if (model.autoCycleMsOf(s) !== null) words.push("auto cycle");
		return { words, turnsOff };
	}

	function joinWords(words) {
		return words.length < 2 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
	}

	// Under the dial's picker: what else changes the reading on the dial,
	// from the effective map, never a fixed "turning changes this" (round
	// 3, R29). Under the rotation: when the reading on the dial is not in
	// the set, the next step leaves it for good, so the panel says where it
	// goes (R18).
	const pickerMovesEl = document.getElementById("picker-moves");
	const rotationOutsideEl = document.getElementById("rotation-outside");
	hw.on("render", (st) => {
		updateRotationHelp();
		const movers = dialMovers(st);
		if (pickerMovesEl !== null && movers !== null) {
			const said = joinWords(movers.words);
			// The runtime holds the dial (advance() returns) while HWiNFO is
			// unavailable or the reading on it is missing; the line says so
			// instead of promising movement (round 3, re-review BY02).
			const text =
				st.preview?.state === "unavailable"
					? "Nothing moves the dial until HWiNFO data returns."
					: st.preview?.missing === true
						? "Nothing moves the dial while its reading is missing; pick another to move on."
						: movers.words.length === 0
							? movers.turnsOff
								? "Turns are ignored here."
								: "No gesture on this dial changes this."
							: `${said.charAt(0).toUpperCase()}${said.slice(1)} change${movers.words.length === 1 && said === "auto cycle" ? "s" : ""} this too.`;
			if (pickerMovesEl.textContent !== text) pickerMovesEl.textContent = text;
		}
		if (rotationOutsideEl === null) return;
		const onDial = st.settings.readingKey;
		let outside = "";
		if (movers !== null && movers.words.length > 0 && typeof onDial === "string" && onDial !== "" && readingLabelOf(onDial) !== null && rotationScope().length > 0 && !memberOfRotation(onDial)) {
			// Where the runtime enters: the first live member of the first
			// group that holds readings (two or more such groups), else of
			// the whole set.
			const holding = rotationGroups === null ? [] : rotationGroups.filter((g) => g.keys.length > 0);
			const list = holding.length >= 2 ? holding[0].keys : rotationScope();
			const target = list.find((k) => !keyIsMissing(k));
			if (target !== undefined) outside = `${readingNameOf(onDial) ?? readingLabelOf(onDial)} is on the dial but not in this rotation; the next step moves to ${rotationNameOf(target)} and does not come back.`;
		}
		if (rotationOutsideEl.textContent !== outside) rotationOutsideEl.textContent = outside;
		rotationOutsideEl.hidden = outside === "";
	});

	function renderRotationSet() {
		if (rotationSetEl === null) return;
		syncGroupsHelp();
		renderReadingColors();
		// Never rebuild under a focused name field: a settings echo (rotation
		// moved, autocycle stepped) would clobber the typing mid-word.
		if (rotationSetEl.contains(document.activeElement) && document.activeElement.classList.contains("hw-group-name")) return;
		const memo = rotationFocusMemo();
		rotationSel = resolveRotationSel(rotationSelChosen ? rotationSel : null);
		if (!collectorSettled && rotationGroups !== null) {
			// Settled once, on the first render that knows the dial's
			// reading, whether or not a group holds it: it never moves while
			// the person works (round 3, re-review PY08, AY09).
			const onDial = primaryPicker.selectedKey();
			const holder = rotationGroups.findIndex((g) => g.keys.some((k) => sameReading(k, onDial)));
			if (holder >= 0) collectorIndex = holder;
			if (holder >= 0 || onDial !== "" || typeof hw.state.settings.readingKey !== "string") collectorSettled = true;
		}
		const frag = document.createDocumentFragment();
		if (rotationGroups === null) {
			if (rotationKeys.length > 0) frag.appendChild(rotationListbox(rotationKeys, null, "Rotation order"));
			// Counted like the runtime steps: a missing member keeps its place
			// but is not moved through, and the note says so (round 3, R05).
			const { total, live, missing } = rotationCounts(rotationKeys);
			frag.appendChild(
				setNote(
					total === 0
						? "Empty: rotation moves through all readings of the picked sensor; an overview shows the one on the dial and the ones after it."
						: total === 1
							? "Only one reading picked. Rotation needs two or more to move."
							: missing === 0
								? `Rotation moves through these ${total} readings only, in this order.`
								: live >= 2
									? `Rotation moves through ${live} of these ${total} readings, in this order; ${skippedNote(missing)}.`
									: `${live === 0 ? "None" : "Only one"} of these ${total} readings is in HWiNFO's list now, so rotation does not move until ${live === 0 ? "they return" : "another returns"}.`,
					"rotation"
				)
			);
			frag.appendChild(setActions([["split", "Split into groups"]]));
		} else {
			rotationGroups.forEach((group, index) => {
				frag.appendChild(groupHeader(group, index));
				if (group.keys.length > 0) {
					frag.appendChild(rotationListbox(group.keys, index, `Group ${index + 1}${group.name !== "" ? `, ${group.name}` : ""}`));
					// Every grouped list keeps a toolbar-high slot, filled by the
					// one toolbar under the selected list: selecting in another
					// group moves nothing on screen (a press never lands on a
					// control that slid under the pointer).
					const slot = document.createElement("div");
					slot.className = "hw-set-tools-slot";
					slot.dataset.group = String(index);
					// While the toolbar is under another list, the slot says how
					// to bring it here instead of standing empty. One line at any
					// width (the CSS never lets it wrap), so the slot keeps the
					// toolbar's height. Screen readers get the toolbar's own
					// description instead.
					const hint = document.createElement("span");
					hint.className = "hw-set-tools-hint";
					hint.setAttribute("aria-hidden", "true");
					hint.textContent = "Select one to move, rename or remove it";
					slot.appendChild(hint);
					frag.appendChild(slot);
				}
				else frag.appendChild(setNote("Empty: tick readings in the search above to fill this group."));
			});
			const populated = rotationGroups.filter((g) => g.keys.length > 0).length;
			const { missing } = rotationCounts(unionKeys(rotationGroups));
			const skipped = missing === 0 ? "" : ` ${missing === 1 ? "One missing reading is" : `${missing} missing readings are`} skipped until HWiNFO lists ${missing === 1 ? "it" : "them"} again.`;
			frag.appendChild(
				setNote(
					(rotationGroups.length === 1
						? "One group only: it acts as a plain rotation set until you add a second."
						: populated < 2
							? `${rotationGroups.length} groups. They take effect once two of them hold readings; until then rotation runs as one flat list.`
							: groupJumpers.length === 0
							? `${rotationGroups.length} groups; with these gestures they act as one list.`
							: `${rotationGroups.length} groups. Rotation needs two or more readings in a group to move inside it.`) + skipped,
					"rotation"
				)
			);
			const actions = setActions([["add", "Add group"], ["merge", "Merge back into one set"]]);
			const merge = actions.querySelector('button[data-set-action="merge"]');
			merge.dataset.armId = model.sortedJson(["merge", rotationGroups.map(serializeGroup), rotationGroupsKept]);
			applyArm(merge);
			frag.appendChild(actions);
		}
		// An arm whose button is gone (the group changed) is dropped.
		if (rotationArm !== null && frag.querySelector(`[data-arm-id="${CSS.escape(rotationArm.id)}"]`) === null) rotationArm = null;
		rotationRebuilding = true;
		rotationSetEl.replaceChildren(frag);
		rotationRebuilding = false;
		syncAddLabel();
		placeRotationTools();
		syncRotationTools();
		rotationFocusRestore(memo);
		updateRotationHelp();
		hw.scheduleRender();
	}

	/** With groups, the search says which group its ticks land in. */
	function syncAddLabel() {
		const addLabel = document.getElementById("pickerr-label");
		if (addLabel === null) return;
		const target = rotationGroups?.[collectorIndex];
		const text = target === undefined ? "Readings to rotate through" : `Readings for ${target.name !== "" ? target.name : `group ${collectorIndex + 1}`}`;
		if (addLabel.textContent !== text) addLabel.textContent = text;
	}

	/** Moves the selected member one place (the order rotation steps
	 * through), keeps it selected and says where it landed. */
	function moveSelectedRotation(delta, { fromList = false, edge = false } = {}) {
		const place = rotationSelPlace();
		if (place === null) return;
		const { key, group } = rotationSel;
		rotationSelChosen = true;
		const reveal = () => {
			// A keyboard move keeps the moved chip in view; a toolbar press
			// never scrolls (round 3, R21).
			if (fromList) rotationSetEl.querySelector('[role="option"][aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
		};
		// Alt+Home and Alt+End: to the first or last place of its list.
		const to = edge ? (delta < 0 ? 0 : place.keys.length - 1) : place.index + delta;
		if (to >= 0 && to < place.keys.length) {
			if (to === place.index) return;
			const list = group === null ? rotationKeys : rotationGroups[group].keys;
			list.splice(to, 0, list.splice(place.index, 1)[0]);
			writeRotation(group !== null);
			reveal();
			hw.announce("rotation-order", `${rotationSpokenName(key)}, ${to + 1} of ${place.keys.length}`, { repeat: true });
			return;
		}
		// Past a group's edge: into the neighbor group, at its near end.
		if (edge || group === null || rotationGroups === null) return;
		const into = group + delta;
		const target = rotationGroups[into];
		if (target === undefined) return;
		rotationGroups[group].keys = rotationGroups[group].keys.filter((k) => k !== key);
		if (!target.keys.some((k) => sameReading(k, key))) {
			if (delta < 0) target.keys.push(key);
			else target.keys.unshift(key);
		}
		const landed = target.keys.findIndex((k) => sameReading(k, key));
		rotationSel = { key: target.keys[landed], group: into };
		writeRotation(true);
		reveal();
		hw.announce("rotation-order", `${rotationSpokenName(key)}, moved to group ${into + 1}${target.name !== "" ? ` (${target.name})` : ""}, ${landed + 1} of ${target.keys.length}`, { repeat: true });
	}

	/** Removes the selected member from its list (a group member leaves that
	 * group only; a flat member leaves the set with its aliases), then
	 * selects the member now at the same place, else the new last one. */
	function removeSelectedRotation() {
		const place = rotationSelPlace();
		if (place === null) return;
		const { key, group } = rotationSel;
		const name = rotationSpokenName(key);
		rotationSelChosen = true;
		if (group !== null && rotationGroups !== null && rotationGroups[group] !== undefined) {
			rotationGroups[group].keys = rotationGroups[group].keys.filter((k) => k !== key);
			const left = rotationGroups[group].keys;
			rotationSel = left.length > 0 ? { key: left[Math.min(place.index, left.length - 1)], group } : null;
			writeRotation(true);
		} else {
			const aliases = readingKeysOf(key);
			const left = rotationKeys.filter((k) => !aliases.includes(k));
			rotationSel = left.length > 0 ? { key: left[Math.min(place.index, left.length - 1)], group: null } : null;
			setRotationMembership(key, false);
		}
		hw.announce("rotation-order", rotationSel === null ? `Removed ${name}. The list is empty.` : `Removed ${name}. ${rotationSpokenName(rotationSel.key)} selected.`, { repeat: true });
	}

	/** The rename field for the selected member, under the toolbar. */
	function startRotationRename() {
		if (rotationSelPlace() === null || rotationTools === null) return;
		rotationSelChosen = true;
		document.getElementById("rot-rename-row")?.remove();
		const key = rotationSel.key;
		const row = document.createElement("div");
		row.className = "hw-field hw-rename-row";
		row.id = "rot-rename-row";
		const label = document.createElement("label");
		label.htmlFor = "rot-rename";
		label.textContent = `Name on the dial for ${twinSpokenName(key, rotationScope(), (k) => readingLabelOf(k) ?? k)}`;
		const input = document.createElement("input");
		input.type = "text";
		input.id = "rot-rename";
		input.className = "hw-group-name hw-chip-rename";
		input.value = readingNameOf(key) ?? "";
		input.placeholder = "Empty uses HWiNFO's name";
		input.dataset.key = key;
		input.spellcheck = false;
		input.autocomplete = "off";
		row.append(label, input);
		rotationTools.after(row);
		input.focus();
		input.select();
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
	let detailSourceKeys = [];
	// Each adopted key's stored spelling (a pasted friendly name, spacing):
	// a write keeps it for every key it did not add (external review AX37).
	let detailKeyRaw = new Map();
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
	let detailSourceTiles = [];
	let detailDuplicatesHidden = false;
	// Each listed reading's stored cell entries (label, color, automatic
	// flag) as last read from storage, with what this build parses from
	// them. A write gives a cell back its reading's stored entry while that
	// value is unchanged, wherever the reading moved, so entries this build
	// cannot read and labels stored with spaces survive every edit
	// (external review AX19). Recaptured from stored data only, never from
	// the panel's own unsaved plan.
	const CELL_FIELDS = ["labels", "colors", "automaticColors"];
	const CELL_NEUTRAL = { labels: "", colors: null, automaticColors: false };
	let detailCellRaw = new Map();
	let detailFromStorage = false;
	let detailProjectionVersion = 0;
	let detailUniform = 1;
	const detailTilesBinding = detailListEl === null ? null : useSettings("detailTiles", adoptDetailTiles, null);
	// Merge-only sibling of the tiles binding (no callback, no debounce, no
	// save): it stages detailTiles into the shared settings store so the
	// following detailKeys write persists BOTH fields in ONE setSettings
	// frame. Two staggered frames leave a window where only one half of a
	// list edit survives (a torn pair is exactly the restaffed-quad bug).
	const detailTilesStage = detailListEl === null ? null : useSettings("detailTiles", undefined, null, false);

	// Entries past the parser's cap, kept exactly as stored behind every write.
	let detailTilesKept = [];

	/** One stored cell as this build reads it: the parser's per-field
	 * salvage (detailTilesOf), shared by the plan's reader and a reading
	 * taking over a dormant cell. */
	function parseCell(label, color, automatic) {
		const hue = typeof color === "string" && HEX_COLOR.test(color) ? color : null;
		return { labels: typeof label === "string" ? label.trim() : "", colors: hue, automaticColors: hue !== null && automatic === true };
	}

	function adoptDetailTiles(value) {
		// Mirror the plugin parser (detailTilesOf): per-entry, per-field
		// salvage, so the panel always shows what the runtime would build.
		// Each tile also keeps its raw entry and the values parsed from it:
		// a write rewrites only the fields an edit changed, so a tile's
		// unknown fields and its untouched (even junk) fields stay stored
		// exactly as they were. Salvage is for display, never for storage.
		detailFromStorage = true;
		detailTilesKept = Array.isArray(value) ? value.slice(DETAIL_TILES_MAX) : [];
		detailSourceTiles = !Array.isArray(value)
			? []
			: value.slice(0, DETAIL_TILES_MAX).map((entry) => {
					const raw = typeof entry === "object" && entry !== null && !Array.isArray(entry) ? entry : {};
					const size = raw.size === 2 || raw.size === "2" ? 2 : raw.size === 3 || raw.size === "3" ? 3 : raw.size === 4 || raw.size === "4" ? 4 : 1;
					// Arrays only, like the parser: a hand-edited string or
					// object must not salvage into dressing the deck ignores.
					const rawLabels = Array.isArray(raw.labels) ? raw.labels : [];
					const rawColors = Array.isArray(raw.colors) ? raw.colors : [];
					const rawAutomatic = Array.isArray(raw.automaticColors) ? raw.automaticColors : [];
					const labels = [];
					const colors = [];
					const automaticColors = [];
					for (let i = 0; i < size; i++) {
						const cell = parseCell(rawLabels[i], rawColors[i], rawAutomatic[i]);
						labels.push(cell.labels);
						colors.push(cell.colors);
						automaticColors.push(cell.automaticColors);
					}
					const tile = { size, labels, colors, cellLabels: raw.cellLabels !== false, automaticColors };
					return { ...tile, raw: entry, base: { size, labels: [...labels], colors: [...colors], cellLabels: tile.cellLabels, automaticColors: storedAutomatic(automaticColors) } };
				});
		projectDetailState();
		revalidateDetailAim();
		renderDetailList();
	}

	/** A tile's stored form. A tile from storage rewrites only the fields
	 * that changed; a tile the editor created writes all four. In every cell
	 * list, a cell takes back its reading's stored entry while that
	 * reading's value is unchanged (so an entry this build cannot read, or a
	 * label with spaces, moves with its reading through removals, resizes,
	 * swaps and drags). Entries no reading wears (dormant cells, and entries
	 * stored past the tile's cells) are written back as stored, in the order
	 * the structural edits left them (external review AX12, AX19, AX47).
	 * `keys` are the readings in the tile's cells, in order. */
	function serializeTile(tile, keys = []) {
		const current = { size: tile.size, labels: [...tile.labels], colors: [...tile.colors], cellLabels: tile.cellLabels, automaticColors: storedAutomatic(tile.automaticColors) };
		const rawIsObject = tile.raw !== null && typeof tile.raw === "object" && !Array.isArray(tile.raw);
		let out;
		if (tile.raw === undefined) {
			out = current;
			if (out.automaticColors === undefined) delete out.automaticColors;
		} else {
			out = model.patchEntry(tile.raw, tile.base, current, ["size", "labels", "colors", "cellLabels", "automaticColors"]);
			if (!rawIsObject) return out;
		}
		// A four-reading tile gives a moved chip the identity color it showed,
		// stored as an automatic hue. For a reading whose stored color this
		// build cannot read, the stored entry travels instead.
		const wornDefault = (i) => tile.automaticColors[i] === true && QUAD_DEFAULT_COLORS.includes(tile.colors[i]);
		const dormant = tile.dormantCells ?? [];
		const carriedEntry = (key, field, i) => {
			if (key === undefined) return dormant[i]?.[field];
			const entry = detailCellRaw.get(key);
			const cell = entry?.[field];
			if (cell === undefined) return undefined;
			if (cell.parsed === cellParsed(tile, field, i)) return cell;
			const color = entry.colors;
			const unreadColor = color !== undefined && color.parsed === null && color.raw !== null;
			return (field === "colors" || field === "automaticColors") && unreadColor && wornDefault(i) ? cell : undefined;
		};
		for (const field of CELL_FIELDS) {
			const stored = rawIsObject && Array.isArray(tile.raw[field]) ? tile.raw[field] : null;
			const carried = Array.from({ length: tile.size }, (_, i) => carriedEntry(keys[i], field, i));
			const carriesData = carried.some((cell) => cell !== undefined && cell.raw !== cell.parsed);
			// A field stored absent, or in a shape this build cannot read,
			// stays as stored unless an edit wrote it or a reading brings its
			// own entries into it. Removing, resizing or moving cells writes
			// nothing into it while every cell still reads as neutral
			// (external review AX58).
			if (stored === null && !carriesData) {
				const neutral = tile.raw !== undefined && Object.hasOwn(tile.raw, field) && Array.from({ length: tile.size }, (_, i) => cellParsed(tile, field, i)).every((v) => v === CELL_NEUTRAL[field]);
				if (neutral) out[field] = tile.raw[field];
				if (neutral || out[field] === tile.raw?.[field]) continue;
			}
			const values = carried.map((cell, i) => (cell === undefined ? cellParsed(tile, field, i) : cell.raw));
			let last = dormant.length;
			while (last > tile.size && dormant[last - 1]?.[field] === undefined) last--;
			for (let i = tile.size; i < last; i++) values.push(dormant[i]?.[field] === undefined ? CELL_NEUTRAL[field] : dormant[i][field].raw);
			if (stored !== null) {
				// A stored list shorter than the cells stays that short: a
				// missing entry already reads as neutral (AX33). Its end moves
				// with the structural edits (AX47), and a reading whose entry
				// was stored keeps an explicit slot.
				const end = tile.storedLengths?.[field] ?? stored.length;
				const stores = (i) => (i < tile.size && keys[i] !== undefined ? detailCellRaw.get(keys[i])?.[field] : dormant[i]?.[field]) !== undefined;
				while (values.length > end && values[values.length - 1] === CELL_NEUTRAL[field] && !stores(values.length - 1)) values.pop();
			}
			out[field] = values;
		}
		return out;
	}

	/** automaticColors as stored: only when some cell's hue is automatic
	 * (1.7 provenance: a chosen hue renders exactly, an automatic one keeps
	 * its contrast lift); absent otherwise. */
	function storedAutomatic(automaticColors) {
		return Array.isArray(automaticColors) && automaticColors.some(Boolean) ? [...automaticColors] : undefined;
	}

	// Only a change of Readings per tile in this panel is a person's edit and
	// is spoken; the panel opening and a value arriving from elsewhere repaint
	// quietly (external review AX24).
	let detailDensityEdited = false;
	document.getElementById("f-density")?.addEventListener("change", () => {
		detailDensityEdited = true;
	});
	function adoptDetailUniform(value) {
		const next = value === 2 || value === "2" ? 2 : value === 3 || value === "3" ? 3 : value === 4 || value === "4" ? 4 : 1;
		// A repeated value must not rebuild #detail-list under an in-flight
		// chip drag or landing flash.
		if (next === detailUniform) return;
		const edited = detailDensityEdited;
		detailDensityEdited = false;
		detailUniform = next;
		projectDetailState();
		revalidateDetailAim(); // the regrouped walk may have no cell for a standing aim
		// The implicit fill grouping follows Readings per tile.
		if (edited) speakingNotes(renderDetailList);
		else renderDetailList();
	}

	/** Whether a key is the opener's own reading, by the key itself or by
	 * an alias of it: the runtime shows that reading on the Back tile and
	 * filters every key resolving to it out of the list (detail-group.ts). */
	function isDetailPrimary(key) {
		return detailPrimaryKey !== "" && sameReading(key, detailPrimaryKey);
	}

	/** The listed key that names the same reading as `key`, if any: an
	 * alias already in the list is that reading's one membership, the way
	 * the runtime keeps one tile per measurement. */
	function listedAliasOf(key) {
		return detailKeys.find((k) => sameReading(k, key));
	}

	/** The list as the DECK builds it: detailKeys minus the adopted
	 * primary (detail-group.ts filters it onto the Back tile), the only
	 * order the tile walk, cell indices and the note may count in. */
	function listedDetailKeys() {
		return detailKeys.filter((k) => !isDetailPrimary(k));
	}

	/** Mirror projectDetailTiles and customKeys in detail-group.ts. Keep
	 * saved source copies so a tree/link update is read-only and unlinking
	 * restores the authored layout. Only an explicit detail edit commits
	 * the visible projection through writeDetailState. */
	/** What this build parses from one stored cell entry. */
	function cellParsed(tile, field, i) {
		return field === "automaticColors" ? tile.automaticColors[i] === true : tile[field][i];
	}

	function captureDetailCells() {
		detailCellRaw = new Map();
		const listed = detailSourceKeys.filter((k) => !isDetailPrimary(k));
		let head = 0;
		for (const tile of detailSourceTiles) {
			// Cells no reading fills as stored are dormant, and so are entries
			// stored past the tile's cells. Their entries follow the cells
			// through every removal and insertion, past the tile's size too,
			// until a reading lands in one (AX29, AX47). A cell whose reading
			// moves away is not dormant; its entries travel with the reading.
			const filled = Math.max(0, Math.min(tile.size, listed.length - head));
			tile.dormantCells = [];
			const raw = tile.raw;
			if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
				tile.storedLengths = Object.fromEntries(CELL_FIELDS.map((field) => [field, Array.isArray(raw[field]) ? raw[field].length : 0]));
				const length = Math.max(tile.size, ...CELL_FIELDS.map((field) => (Array.isArray(raw[field]) ? raw[field].length : 0)));
				for (let i = 0; i < length; i++) {
					const entry = {};
					for (const field of CELL_FIELDS) {
						if (Array.isArray(raw[field]) && i < raw[field].length) entry[field] = { raw: raw[field][i], parsed: cellParsed(tile, field, i) };
					}
					if (i < filled) detailCellRaw.set(listed[head + i], entry);
					else if (Object.keys(entry).length > 0) tile.dormantCells[i] = entry;
				}
			}
			head += tile.size;
		}
	}

	/** Whether a reading's stored cell entries hold anything this build's
	 * own values would not restate: an entry it cannot read, a label with
	 * spaces, an automatic flag on no color. */
	function cellCarriesData(key) {
		const entry = detailCellRaw.get(key);
		return entry !== undefined && CELL_FIELDS.some((field) => entry[field] !== undefined && entry[field].raw !== entry[field].parsed);
	}

	function projectDetailState() {
		if (detailFromStorage) captureDetailCells();
		const before = JSON.stringify([detailKeys, detailTiles.map((t) => t.size)]);
		const source = detailSourceKeys.filter((k) => !isDetailPrimary(k));
		const seen = new Set();
		const kept = new Set(source.filter((key) => {
			const identity = treeEntryOf(key)?.reading.key ?? key;
			if (seen.has(identity)) return false;
			seen.add(identity);
			return true;
		}));
		detailDuplicatesHidden = kept.size !== source.length;
		detailKeys = detailSourceKeys.filter((key) => isDetailPrimary(key) || kept.has(key));
		detailTiles = cloneTiles(detailSourceTiles);
		if (detailDuplicatesHidden) {
			let head = 0;
			detailTiles = detailTiles.flatMap((spec) => {
				const cells = Array.from({ length: spec.size }, (_, i) => i).filter((i) => source[head + i] === undefined || kept.has(source[head + i]));
				head += spec.size;
				return cells.length === 0 ? [] : [{ size: cells.length, labels: cells.map((i) => spec.labels[i]), colors: cells.map((i) => spec.colors[i]), cellLabels: spec.cellLabels, automaticColors: cells.map((i) => spec.automaticColors[i]), raw: spec.raw, base: spec.base, dormantCells: [...cells.map((i) => spec.dormantCells?.[i]), ...(spec.dormantCells?.slice(spec.size) ?? [])], storedLengths: spec.storedLengths === undefined ? undefined : Object.fromEntries(CELL_FIELDS.map((field) => [field, spec.storedLengths[field] - Array.from({ length: spec.size }, (_, i) => i).filter((i) => !cells.includes(i) && i < spec.storedLengths[field]).length])) }];
			});
		}
		if (before !== JSON.stringify([detailKeys, detailTiles.map((t) => t.size)])) {
			// Numeric tile targets cannot survive a changed projection. A
			// held press can keep its old DOM until mouseup; reject that
			// control instead of applying it to a different reading.
			detailProjectionVersion++;
			detailTileDrag = null;
			disarmDetailAim();
		}
	}

	function currentDetailTarget(target) {
		const holder = target.closest(".hw-tile");
		return holder === null || holder.dataset.projection === String(detailProjectionVersion);
	}

	/** A listed position back to its detailKeys slot: every parked
	 * primary entry (the opener's key, or an alias of it) is stepped
	 * over; identity when none is in the list. A position past the end
	 * lands past the end of detailKeys. */
	function rawDetailIndex(listedIdx) {
		let listed = 0;
		for (let raw = 0; raw < detailKeys.length; raw++) {
			if (isDetailPrimary(detailKeys[raw])) continue;
			if (listed === listedIdx) return raw;
			listed++;
		}
		return detailKeys.length;
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

	/** How many READINGS a walk tile actually holds. Only the last tile of a
	 * walk can hold fewer than its size, and that tile is where every
	 * size-versus-occupancy bug has lived: the deck builds a tile's face out
	 * of the readings in it (composeChunkFace branches on the chunk length),
	 * so this, never `size`, decides whether a tile is a quad, and a quad is
	 * the only face that paints per-cell identity colors. Pass `listed` where
	 * the caller already holds it, so a mover reads one consistent list. */
	function tileReadings(tile, listed = listedDetailKeys()) {
		return Math.min(tile.size, listed.length - tile.head);
	}

	/** One deep copy of a tile plan: materialization and the staged write
	 * both need one, and the model must never be mutated in place. */
	function cloneTiles(tiles) {
		return tiles.map((t) => ({ size: t.size, labels: [...t.labels], colors: [...t.colors], cellLabels: t.cellLabels, automaticColors: [...t.automaticColors], raw: t.raw, base: t.base, dormantCells: t.dormantCells?.slice(), storedLengths: t.storedLengths === undefined ? undefined : { ...t.storedLengths } }));
	}

	/** A structural edit at `cell` of a tile: a removal (delta -1) or an
	 * insertion (+1). Its dormant entries and the end of each stored list
	 * move with the cells after it (external review AX47). */
	function spliceStored(tile, cell, delta) {
		if (delta < 0) tile.dormantCells?.splice(cell, 1);
		else tile.dormantCells?.splice(cell, 0, undefined);
		if (tile.storedLengths === undefined) return;
		for (const field of CELL_FIELDS) {
			if (cell < tile.storedLengths[field]) tile.storedLengths[field] += delta;
		}
	}

	/** A walk tile's spec at exactly the cells it fills, always a fresh
	 * copy: a fill tile becomes an explicit default entry, and a partial
	 * trailing spec sheds the cells it does not fill (a partial spec
	 * anywhere but the tail would swallow the next tile's head). Cells no
	 * reading filled when the plan was read keep their stored entries past
	 * the new size (dormantCells, external review AX29). */
	function occupancySpec(tile, occupied) {
		const spec = tile.spec !== null ? tile.spec : { size: tile.size, labels: Array.from({ length: tile.size }, () => ""), colors: Array.from({ length: tile.size }, () => null), cellLabels: true };
		const size = Math.min(spec.size, occupied);
		return { size, labels: spec.labels.slice(0, size), colors: spec.colors.slice(0, size), cellLabels: spec.cellLabels, automaticColors: Array.from({ length: size }, (_, i) => spec.automaticColors?.[i] === true), raw: spec.raw, base: spec.base, dormantCells: spec.dormantCells?.slice(), storedLengths: spec.storedLengths === undefined ? undefined : { ...spec.storedLengths } };
	}

	/** Extends the plan with default entries (at the uniform fill size,
	 * the size every tile past the plan renders at) so tile `through`
	 * exists explicitly and can be edited. */
	function materializedTiles(through) {
		const next = cloneTiles(detailTiles);
		for (let t = detailTiles.length; t <= through; t++) {
			next.push({ size: detailUniform, labels: Array.from({ length: detailUniform }, () => ""), colors: Array.from({ length: detailUniform }, () => null), cellLabels: true, automaticColors: Array.from({ length: detailUniform }, () => false) });
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

	/** A tree update can reshape the walk while a rename/color editor is
	 * open. Find its saved key again instead of dressing a new occupant of
	 * the old tile/cell. A now-hidden duplicate has no editable cell. */
	function editDetailCell(key, mutate) {
		const index = listedDetailKeys().indexOf(key);
		if (index < 0) return;
		const walk = detailTileWalk();
		const tileIdx = walk.findIndex((tile) => index >= tile.head && index < tile.head + tile.size);
		if (tileIdx >= 0) editTile(tileIdx, (spec) => mutate(spec, index - walk[tileIdx].head));
	}

	/** Every list or tile edit persists through here: detailTiles staged
	 * (merged, unsaved), detailKeys saved, so the app stores one frame
	 * carrying BOTH fields. Solo edits re-assert the other field for free,
	 * which also self-heals a store that went stale. */
	function writeDetailState() {
		// A reading that lands in a dormant cell (a pick, or a resize that
		// flows one in) takes the cell over. An entry holding nothing just
		// gives up its slot. A reading bringing entries it wears here keeps
		// them, and the dormant entry moves one cell on. Otherwise the reading
		// wears the stored entry, as the deck draws that cell, and owns it
		// from here: written once, at the reading. Pushing every entry on
		// wrote readable ones twice and grew the lists on each refill
		// (external review AX47, review of d14).
		const listed = listedDetailKeys();
		let at = 0;
		for (const tile of detailTiles) {
			for (let i = 0; i < tile.size && at + i < listed.length; i++) {
				const entry = tile.dormantCells?.[i];
				if (entry === undefined) continue;
				if (CELL_FIELDS.every((field) => entry[field] === undefined || entry[field].raw === CELL_NEUTRAL[field])) {
					tile.dormantCells[i] = undefined;
					continue;
				}
				const own = detailCellRaw.get(listed[at + i]);
				if (own !== undefined && CELL_FIELDS.some((field) => own[field] !== undefined && own[field].raw !== CELL_NEUTRAL[field] && own[field].parsed === cellParsed(tile, field, i))) {
					spliceStored(tile, i, 1);
					continue;
				}
				const shown = parseCell(entry.labels?.raw, entry.colors?.raw, entry.automaticColors?.raw);
				for (const field of CELL_FIELDS) {
					tile[field][i] = shown[field];
					if (entry[field] !== undefined) entry[field].parsed = shown[field];
				}
				detailCellRaw.set(listed[at + i], entry);
				tile.dormantCells[i] = undefined;
			}
			at += tile.size;
		}
		// An explicit edit accepts the shown layout. Update both source
		// copies before publishing so a later tree cannot resurrect it.
		detailSourceKeys = [...detailKeys];
		detailSourceTiles = cloneTiles(detailTiles);
		detailDuplicatesHidden = false;
		detailFromStorage = false;
		// An edit can shorten the walk out from under a standing aim (a
		// shrink consuming the last tile, a size cycle swallowing the
		// fill) or grow the aimed tile past what any marker paints.
		revalidateDetailAim();
		let head = 0;
		const serialized = detailTiles.map((tile) => {
			const keys = listed.slice(head, head + tile.size);
			head += tile.size;
			return serializeTile(tile, keys);
		});
		detailTilesStage[1]([...serialized, ...detailTilesKept]);
		detailBinding[1](model.mergeKept(detailKeys.map((key) => detailKeyRaw.get(key) ?? key), detailKeysKept, detailKeysKeptAt));
		// A person's edit: its note (the count, the cap) is spoken, like the
		// rotation's; opening the panel or a sensor list arriving stays quiet.
		speakingNotes(renderDetailList);
		detailPicker?.renderList(); // membership ticks follow the edit
	}

	function writeDetailTiles(next) {
		// Trailing entries that only restate the uniform fill are noise:
		// prune them so the stored plan stays exactly the hand-made part.
		// Only AUTOMATIC default hues are redundant: a chosen color equal to a
		// palette hue deliberately bypasses the automatic contrast floor. A
		// quad wearing exactly the automatic default colors renders the same
		// as one storing none, so a shuffle that lands every cell back on its
		// own default prunes away instead of freezing a tile into the plan.
		// A stored tile carrying fields this build does not know is never
		// "only restating the fill": pruning it would drop those fields.
		// Nor is one this build cannot fully read: a non-object entry or a
		// known field holding a value the parser salvages ({ size: 6 }).
		const KNOWN = ["size", "labels", "colors", "cellLabels", "automaticColors"];
		const readable = (t) => {
			if (t.raw === undefined) return true; // materialized here, never stored
			const r = t.raw;
			if (typeof r !== "object" || r === null || Array.isArray(r)) return false;
			if (Object.keys(r).some((k) => !KNOWN.includes(k))) return false;
			if (r.size !== undefined && ![1, 2, 3, 4, "1", "2", "3", "4"].includes(r.size)) return false;
			if (r.labels !== undefined && !(Array.isArray(r.labels) && r.labels.every((l) => typeof l === "string"))) return false;
			if (r.colors !== undefined && !(Array.isArray(r.colors) && r.colors.every((c) => c === null || (typeof c === "string" && HEX_COLOR.test(c))))) return false;
			if (r.automaticColors !== undefined && !(Array.isArray(r.automaticColors) && r.automaticColors.every((a) => typeof a === "boolean"))) return false;
			return r.cellLabels === undefined || typeof r.cellLabels === "boolean";
		};
		const isDefault = (t) => readable(t) && t.size === detailUniform && t.cellLabels === true && t.labels.every((l) => l === "") && t.colors.every((c, i) => c === null || (t.size === 4 && t.automaticColors[i] === true && c === QUAD_DEFAULT_COLORS[i]));
		// A reading whose stored cell entries hold data this build would not
		// restate keeps an explicit tile: one that lands past the plan (a
		// resize or a move into the fill) gets default entries through its
		// tile, and a trailing tile holding one, or storing entries past its
		// cells, is not pruned (external review AX18, AX19).
		const listed = listedDetailKeys();
		const heads = [];
		let head = 0;
		for (const t of next) {
			heads.push(head);
			head += t.size;
		}
		let need = next.length - 1;
		for (let t = next.length; head < listed.length; t++) {
			if (listed.slice(head, head + detailUniform).some(cellCarriesData)) need = t;
			head += detailUniform;
		}
		for (let t = next.length; t <= need; t++) {
			heads.push(heads.length === 0 ? 0 : heads[heads.length - 1] + next[next.length - 1].size);
			next.push({ size: detailUniform, labels: Array.from({ length: detailUniform }, () => ""), colors: Array.from({ length: detailUniform }, () => null), cellLabels: true, automaticColors: Array.from({ length: detailUniform }, () => false) });
		}
		const carriesData = (t, i) => {
			if (t.dormantCells?.some((cell) => CELL_FIELDS.some((field) => cell?.[field] !== undefined && cell[field].raw !== CELL_NEUTRAL[field]))) return true;
			return listed.slice(heads[i], heads[i] + t.size).some(cellCarriesData);
		};
		while (next.length > 0 && isDefault(next[next.length - 1]) && !carriesData(next[next.length - 1], next.length - 1)) {
			next.pop();
		}
		detailTiles = next;
		writeDetailState();
	}

	// Stored entries the editor does not show: non-strings and strings past
	// the cap. A write appends them after the edited list, unchanged, so a
	// newer version's entries (or a hand-built tail) are never dropped.
	let detailKeysKept = [];
	let detailKeysKeptAt = [];

	function adoptDetailKeys(value) {
		// Mirror the plugin parser: a key sheds any friendly name pasted after
		// it (the config document writes one), duplicates drop at their first
		// occurrence (hand-edited settings could hold them, and indexOf-based
		// move and remove need one chip per key; the runtime ignores the
		// repeats too), and the same cap applies, so the panel never shows
		// chips past what the runtime lists.
		// Kept entries (non-strings, blanks, entries past the cap) go back
		// where they were stored on the next write. Repeats are not kept: a
		// removed key must not survive as its own duplicate.
		const seen = new Set();
		const known = [];
		const kept = [];
		const keptAt = [];
		detailKeyRaw = new Map();
		(Array.isArray(value) ? value : []).forEach((entry, index) => {
			const key = typeof entry === "string" ? bareKey(entry) : "";
			if (typeof entry === "string" && key !== "" && seen.has(key)) return;
			if (typeof entry !== "string" || key === "" || known.length >= DETAIL_KEYS_MAX) {
				kept.push(entry);
				keptAt.push(index);
				return;
			}
			seen.add(key);
			known.push(key);
			detailKeyRaw.set(key, entry);
		});
		detailSourceKeys = known;
		detailKeysKept = kept;
		detailKeysKeptAt = keptAt;
		detailFromStorage = true;
		projectDetailState();
		revalidateDetailAim();
		renderDetailList();
		detailPicker?.renderList(); // membership ticks follow external writes too
	}

	function adoptDetailPrimary(value) {
		const next = typeof value === "string" ? value : "";
		// Same no-op guard as adoptDetailUniform: a settings echo re-delivers
		// the unchanged key.
		if (next === detailPrimaryKey) return;
		detailPrimaryKey = next;
		projectDetailState();
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
				// The primary is skipped by the key or an alias of it, the
				// runtime's readingMatchesKey: a dormant saved key still
				// names the live row on the Back tile.
				if (!isDetailPrimary(reading.key) && matches(`${sourceName} ${reading.label}`)) count++;
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

	const DETAIL_RESTING_PLACEHOLDER = "Search readings to add";
	const DETAIL_CAP_PLACEHOLDER = "At the cap; remove a reading to add another.";

	/** The search box's aim line always states the CURRENT aim. Movers
	 * renumber detailArm.tileIdx when an earlier tile dissolves or a park
	 * lands (removeDetailKey, moveDetailChip); every such edit funnels
	 * through revalidateDetailAim, so syncing here keeps the promised
	 * tile number equal to the painted marker's. */
	function syncDetailAimPlaceholder() {
		const search = detailSearchEl();
		if (search !== null) search.placeholder = detailArm === null ? DETAIL_RESTING_PLACEHOLDER : `Adding into tile ${detailArm.tileIdx + 1}; click its + again to finish.`;
	}

	/** Quietly drops a standing aim and restores the resting search text
	 * (no focus, no render): writeDetailState's past-end check, the splice
	 * re-anchor and a stale-aim append all disarm through here. */
	function disarmDetailAim() {
		detailArm = null;
		syncDetailAimPlaceholder();
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
		if (tile === undefined || tileReadings(tile) >= 4 || detailKeys.length >= DETAIL_KEYS_MAX) {
			disarmDetailAim();
			return;
		}
		syncDetailAimPlaceholder();
	}
	// The reading key that just landed (pick, drop, arrow move): its chip
	// re-renders with a short flash and is scrolled into view, then the
	// receipt clears. Purely visual; never persisted.
	let detailLanded = "";
	// The walk index of the tile being dragged whole, null outside a tile
	// drag. dragover cannot read the payload (values hide until drop), so
	// this is how tile drags and chip drags stay distinguishable mid-air.
	let detailTileDrag = null;

	// A mouse press inside the list must survive what the press itself tears
	// down. Opening a cell rename swaps the name span for an input; the NEXT
	// press anywhere in the list blurs that input, and the blur is the
	// press's own default action, so the commit (change, straight into
	// editTile) or the abandon (focusout) rebuilds the whole list between
	// mousedown and mouseup. replaceChildren detaches the control under the
	// pointer, Blink drops the click, and the press does nothing at all.
	// Writes still go out at once, because a cell's tile and cell indices
	// are only valid before another edit reshapes the walk. Only the
	// REPAINT waits for the press to finish.
	let detailPressing = false;
	let detailRenderQueued = false;
	// A repaint queued by a person's edit still speaks its note when it runs.
	let detailQueuedSpeaks = false;
	let detailPressTimer = 0;
	// The press's one release listener: the ceiling takes it down too, so
	// presses whose release never reached the window cannot pile listeners
	// up (external review AX56).
	function queueDetailRelease() {
		clearTimeout(detailPressTimer);
		detailPressTimer = setTimeout(releaseDetailPress, 0);
	}
	function releaseDetailPress() {
		clearTimeout(detailPressTimer);
		window.removeEventListener("mouseup", queueDetailRelease);
		detailPressing = false;
		if (!detailRenderQueued) return;
		detailRenderQueued = false;
		const speaks = detailQueuedSpeaks;
		detailQueuedSpeaks = false;
		if (speaks) speakingNotes(renderDetailList);
		else renderDetailList();
	}

	function detailSearchEl() {
		return document.getElementById("pickerd-search");
	}

	function armDetailAdd(tileIdx) {
		// The cap refuses to arm: an aim at the cap is a promise no pick
		// can keep (addDetailKey refuses every add there).
		if (detailKeys.length >= DETAIL_KEYS_MAX) {
			disarmDetailAim();
			const search = detailSearchEl();
			if (search !== null) search.placeholder = DETAIL_CAP_PLACEHOLDER;
			return;
		}
		detailArm = tileIdx === null || (detailArm !== null && detailArm.tileIdx === tileIdx) ? null : { tileIdx };
		// Render first, focus second: focusing opens the list, whose
		// onOpenChange scrolls the FRESH armed marker into view.
		renderDetailList();
		const search = detailSearchEl();
		if (search !== null) {
			syncDetailAimPlaceholder();
			search.focus({ preventScroll: true });
		}
	}

	/** False when the add was refused (the primary, a duplicate, or the
	 * 128 cap): the tick that triggered it repaints instead of lying. */
	function addDetailKey(key) {
		// The primary is refused, not added-and-hidden: it already shows on
		// the Back tile, and the runtime filters it out of the list. So is
		// a reading the list already holds under another of its keys: the
		// deck builds one tile for it, so the panel shows one chip.
		if (!key || isDetailPrimary(key) || listedAliasOf(key) !== undefined || detailKeys.length >= DETAIL_KEYS_MAX) return false;
		if (detailArm !== null) {
			const walk = detailTileWalk();
			const tile = walk[detailArm.tileIdx];
			if (tile !== undefined) {
				const occupied = tileReadings(tile);
				const next = materializedTiles(detailArm.tileIdx);
				if (occupied >= next[detailArm.tileIdx].size && next[detailArm.tileIdx].size < 4) {
					// The tile is full but can grow: the pick becomes its next cell.
					next[detailArm.tileIdx].size += 1;
					next[detailArm.tileIdx].labels.push("");
					next[detailArm.tileIdx].colors.push(null);
					next[detailArm.tileIdx].automaticColors.push(false);
				}
				const cell = Math.min(occupied, next[detailArm.tileIdx].size - 1);
				// tile.head and cell are LISTED positions; the splice lands
				// at the matching detailKeys slot, past a parked primary.
				detailKeys.splice(rawDetailIndex(tile.head + cell), 0, key);
				detailTiles = next; // staged and saved together in writeDetailState
				if (tileReadings({ size: next[detailArm.tileIdx].size, head: tile.head }) >= 4) {
					speakingNotes(() => armDetailAdd(detailArm.tileIdx)); // full quad: disarm, and the end marker lights
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
				spliceStored(next[tileIdx], cell, -1);
				next[tileIdx].size -= 1;
				next[tileIdx].labels.splice(cell, 1);
				next[tileIdx].colors.splice(cell, 1);
				next[tileIdx].automaticColors.splice(cell, 1);
			}
		}
		detailKeys = detailKeys.filter((k) => k !== key);
		detailKeyRaw.delete(key); // a key added back later is written bare
		if (next !== null) {
			writeDetailTiles(next);
		} else {
			writeDetailState();
		}
	}

	/** What a chip WEARS in the cell it currently sits in: its stored
	 * label, and its stored color or, on a quad, the identity color that
	 * cell renders by default. Stored hues travel anywhere, whether chosen
	 * or previously carried automatic colors. The separate `automatic`
	 * flag keeps their rendering provenance. An unstored default is only
	 * worn by a full quad, never by a partial tail's dual/triple face. */
	function wornDressing(tile, cell) {
		const stored = tile.spec !== null ? (tile.spec.colors[cell] ?? null) : null;
		return {
			label: tile.spec !== null ? (tile.spec.labels[cell] ?? "") : "",
			color: stored ?? (tileReadings(tile) === 4 ? (QUAD_DEFAULT_COLORS[cell] ?? null) : null),
			stored: stored !== null,
			automatic: stored === null || tile.spec.automaticColors[cell] === true
		};
	}

	/** The dressing sequence over the LISTED positions, respliced exactly
	 * like the keys and poured back over the same walk shape. Returns the
	 * plan to persist, or null when no plan exists and none is needed (a
	 * flat list stays flat: reordering plain chips must not invent one).
	 *
	 * Only cells that CHANGED occupant take the traveling dressing; every
	 * other cell keeps exactly what was stored, so a move never
	 * materializes a fill tile it did not touch. On a quad the traveling
	 * value is what the chip wore, so the identity colors follow their
	 * readings instead of staying with the positions and recoloring
	 * everything that shuffles under them. */
	function movedDressingPlan(from, to) {
		const walk = detailTileWalk();
		const listed = listedDetailKeys();
		const occupiedOf = (tile) => tileReadings(tile, listed);
		const stored = [];
		const worn = [];
		const tileAt = [];
		const cellAt = [];
		walk.forEach((tile, idx) => {
			for (let c = 0; c < occupiedOf(tile); c++) {
				stored.push({ label: tile.spec !== null ? (tile.spec.labels[c] ?? "") : "", color: tile.spec !== null ? (tile.spec.colors[c] ?? null) : null, automatic: tile.spec?.automaticColors[c] === true });
				worn.push(wornDressing(tile, c));
				tileAt.push(idx);
				cellAt.push(c);
			}
		});
		const after = listed.slice();
		const travel = worn.slice();
		const at = to > from ? to - 1 : to;
		after.splice(at, 0, ...after.splice(from, 1));
		travel.splice(at, 0, ...travel.splice(from, 1));
		// A cell keeps its stored dressing while its occupant is unchanged. An
		// inherited default lands only where it is worn, a tile holding four
		// readings. Carrying one into an implicit partial tail would freeze
		// that tail out of the uniform fill to store an invisible color.
		const dressing = listed.map((key, i) => {
			if (after[i] === key) return stored[i];
			const t = walk[tileAt[i]];
			const d = travel[i];
			const color = occupiedOf(t) === 4 || d.stored ? d.color : null;
			return { label: d.label, color, automatic: color !== null && d.automatic };
		});
		let through = detailTiles.length - 1;
		dressing.forEach((d, i) => {
			if ((d.label !== "" || d.color !== null) && tileAt[i] > through) through = tileAt[i];
		});
		if (through < 0) return null;
		const next = materializedTiles(through);
		dressing.forEach((d, i) => {
			if (tileAt[i] > through) return;
			next[tileAt[i]].labels[cellAt[i]] = d.label;
			next[tileAt[i]].colors[cellAt[i]] = d.color;
			next[tileAt[i]].automaticColors[cellAt[i]] = d.automatic;
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
		const occupiedOf = (tile) => tileReadings(tile, listed);
		const cell = from - walk[fromTileIdx].head;
		const dressing = wornDressing(walk[fromTileIdx], cell);
		// Preserve the old carry gate: only a label or STORED hue freezes a
		// tail/ghost into the plan. A stored automatic hue travels just as it
		// did before, while its provenance keeps the contrast correction.
		const dressed = dressing.label !== "" || dressing.stored;
		const carried = (renders) => (renders === 4 || dressing.stored ? dressing.color : null);
		const automatic = (renders) => carried(renders) !== null && dressing.automatic;
		const parkedSpec = () => ({ size: 1, labels: [dressing.label], colors: [carried(1)], cellLabels: true, automaticColors: [automatic(1)] });
		const next =
			targetKey === null && dressed
				? walk.map((tile) => occupancySpec(tile, occupiedOf(tile)))
				: materializedTiles(Math.max(fromTileIdx, targetTileIdx));
		let dissolved = false;
		// The tile goes when its last READING leaves, not when its stored size
		// happens to be 1: a partial tail holding one reading in a wider spec
		// would otherwise survive as an entry no walk can reach.
		if (occupiedOf(walk[fromTileIdx]) <= 1) {
			next.splice(fromTileIdx, 1);
			dissolved = true;
		} else {
			spliceStored(next[fromTileIdx], cell, -1);
			next[fromTileIdx].size -= 1;
			next[fromTileIdx].labels.splice(cell, 1);
			next[fromTileIdx].colors.splice(cell, 1);
			next[fromTileIdx].automaticColors.splice(cell, 1);
		}
		let landAt;
		let parkedAt = null; // where a full-target park spliced a tile in, else null
		if (targetKey === null) {
			landAt = listed.length - 1; // append past the tail (one shorter once the chip is pulled out)
			if (dressed) {
				next.push(parkedSpec());
				// Rebuilt from the walk: stored tiles past it stay stored,
				// after the parked one (external review AX17).
				next.push(...cloneTiles(detailTiles.slice(walk.length)));
			}
		} else {
			const target = walk[targetTileIdx];
			const targetAt = dissolved && fromTileIdx < targetTileIdx ? targetTileIdx - 1 : targetTileIdx;
			const cellInTarget = tIdx - target.head + (after ? 1 : 0);
			// Room is a question about READINGS, not about the stored size: only
			// the tail tile can be partial, and there the two disagree. A tile
			// with a free cell already has the cell, so it takes the chip
			// without growing (growing it would declare more cells than the
			// list can fill, and the walk would stop short of every later
			// entry, burying the chip's own dressing with them).
			const spare = occupiedOf(target) < target.size;
			if (tileTakesCell(target)) {
				if (!spare) next[targetAt].size += 1;
				spliceStored(next[targetAt], cellInTarget, 1);
				next[targetAt].labels.splice(cellInTarget, 0, dressing.label);
				next[targetAt].colors.splice(cellInTarget, 0, carried(occupiedOf(target) + 1));
				next[targetAt].automaticColors.splice(cellInTarget, 0, automatic(occupiedOf(target) + 1));
				// The splice pushed the trailing EMPTY cell past the tile's own
				// size; a spec must stay exactly as long as it says it is.
				next[targetAt].labels.length = next[targetAt].size;
				next[targetAt].colors.length = next[targetAt].size;
				next[targetAt].automaticColors.length = next[targetAt].size;
				landAt = tIdx + (after ? 1 : 0) - (from < tIdx + (after ? 1 : 0) ? 1 : 0);
			} else {
				// Full target: the chip becomes its own tile on the dropped
				// side, and the spec splice keeps every later tile's members.
				const sideBefore = !after && tIdx === target.head;
				parkedAt = sideBefore ? targetAt : targetAt + 1;
				next.splice(parkedAt, 0, parkedSpec());
				const boundary = sideBefore ? target.head : target.head + occupiedOf(target);
				landAt = boundary - (from < boundary ? 1 : 0);
			}
		}
		detailKeys.splice(detailKeys.indexOf(key), 1);
		detailKeys.splice(rawDetailIndex(landAt), 0, key);
		// A standing aim names its tile by index, and this move can change two
		// of them. Re-anchor in the order the plan actually changed: the source
		// dissolve first, because that shift is measured in the walk the aim was
		// set against, THEN the park, because parkedAt is already an index into
		// the shrunken plan. Both at once, in the other order, moved the aim one
		// tile too far or read the shifted aim as the dissolved tile and threw
		// it away, so the next pick landed in a tile nobody aimed at.
		if (dissolved) {
			if (detailArm !== null && detailArm.tileIdx === fromTileIdx) {
				disarmDetailAim();
			} else if (detailArm !== null && detailArm.tileIdx > fromTileIdx) {
				detailArm = { tileIdx: detailArm.tileIdx - 1 };
			}
		}
		if (parkedAt !== null && detailArm !== null && detailArm.tileIdx >= parkedAt) {
			detailArm = { tileIdx: detailArm.tileIdx + 1 };
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
		const specs = walk.map((tile) => occupancySpec(tile, tileReadings(tile, listed)));
		const movedSpec = specs[fromIdx];
		const finalIdx = insertBefore > fromIdx ? insertBefore - 1 : insertBefore;
		specs.splice(fromIdx, 1);
		specs.splice(finalIdx, 0, movedSpec);
		// Stored tiles past the walk (no reading reaches them) stay stored,
		// after the moved ones (external review AX17).
		specs.push(...cloneTiles(detailTiles.slice(walk.length)));
		// Landing offset in the REDUCED listed order: the tiles left of the
		// landing slot keep their exact member counts (removing a whole
		// run preserves every other tile's contiguity).
		const reduced = walk.filter((_, i) => i !== fromIdx);
		let landAt = 0;
		for (let i = 0; i < finalIdx; i++) {
			const tile = reduced[i];
			landAt += tileReadings(tile, listed);
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
			if (!isDetailPrimary(reading.key) && listedAliasOf(reading.key) === undefined && detailKeys.length < DETAIL_KEYS_MAX) {
				detailKeys.push(reading.key);
				landed = reading.key; // the block's last chip carries the flash
			}
		}
		if (landed === "") return;
		// The block appends; a standing aim would claim a landing that never
		// happened. Disarm before the receipt so the disarm re-render cannot
		// eat the flash (the addDetailKey order).
		if (detailArm !== null) speakingNotes(() => armDetailAdd(detailArm.tileIdx));
		detailLanded = landed;
		writeDetailState();
	}

	function detailChip(key, index, tile, tileIdx, cellIdx, fullQuad) {
		const label = readingLabelOf(key);
		const chip = document.createElement("span");
		chip.className = "hw-set-chip" + (keyIsMissing(key) ? " missing" : "");
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
			// Allow the drop and stand the container fallback down; the caret
			// itself belongs to the holder (wireTileChromeDrop), which runs a
			// moment later on the same event and is the only place that knows
			// whether this tile can take the cell or will park the chip beside
			// it. A bar painted here would be swept there anyway.
			ev.preventDefault();
			ev.dataTransfer.dropEffect = "move";
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
		if (keyIsMissing(key)) {
			name.title = MISSING_TITLE;
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
		name.setAttribute("aria-label", `Rename this cell's label, now ${name.textContent}${keyIsMissing(key) ? ", missing from HWiNFO's list" : ""}`);
		if (key === detailLanded) {
			chip.classList.add("landed");
		}
		// Buttons dressed as glyphs need names: without these every remove
		// on the page announces as the same bare "×" to assistive tech.
		const detailName = (k) => readingLabelOf(k) ?? k;
		const spokenName = twinSpokenName(key, listedDetailKeys(), detailName);
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
		const tag = twinTagOf(key, listedDetailKeys(), detailName);
		if (tag !== null && override === "") chip.append(twinPill(tag, sourceNameOf(key)));
		if (keyIsMissing(key)) chip.append(missingPill());
		if (fullQuad) {
			// Quad cells carry identity colors, like a standalone quad key. A
			// tile is a quad when four READINGS sit in it: that is the only
			// chunk the deck paints identity colors on (see renderDetailList).
			const well = document.createElement("input");
			well.type = "color";
			well.className = "hw-tile-color";
			well.title = "This cell's identity color on the quad tile";
			well.value = (tile.spec !== null ? tile.spec.colors[cellIdx] : null) ?? QUAD_DEFAULT_COLORS[cellIdx] ?? "#4CC2FF";
			well.addEventListener("change", () => {
				editDetailCell(key, (t, cell) => {
					t.colors[cell] = well.value;
					t.automaticColors[cell] = false;
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
	function parkedPrimaryChip(key) {
		const label = readingLabelOf(key);
		const holder = document.createElement("span");
		const chip = document.createElement("span");
		chip.className = "hw-set-chip" + (keyIsMissing(key) ? " missing" : "");
		chip.dataset.key = key;
		const name = document.createElement("span");
		// `parked` opts out of the rename affordance: this chip holds no cell,
		// so the delegated click refuses it, and the text cursor and hover
		// underline every other name wears were an invitation to nothing.
		name.className = "hw-set-name parked";
		name.textContent = `${label ?? key} (Back tile)`;
		name.title = "This key's own sensor: it shows on the Back tile and is not listed in the view";
		const remove = document.createElement("button");
		remove.type = "button";
		remove.className = "hw-set-remove";
		remove.dataset.key = key;
		remove.title = "Remove from the detail list";
		// Named for the same reason every other glyph button is: a bare "×"
		// announces as nothing at all.
		remove.setAttribute("aria-label", `Remove ${label ?? key} from the detail list`);
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

	/** The room test every chip drop shares, in the mover's own terms (see
	 * moveDetailChip): a tile takes another cell while it still has a free
	 * one (only the tail can) or can still grow to four. A tile with
	 * neither parks the chip beside it as its own one-cell tile. */
	function tileTakesCell(tile) {
		return tileReadings(tile) < tile.size || tile.size < 4;
	}

	/** Paints the caret the DROP will actually honor. A chip edge is honest
	 * while the target tile can take the cell, and while the drag started
	 * inside that same tile (a plain cell reorder, which every edge
	 * honors). Otherwise the chip parks beside the tile, so the honest
	 * caret is the TILE's own edge, the bar a whole-tile drag paints. A bar
	 * between two cells of a full quad promised a landing the mover has
	 * never been able to give. */
	function paintDropEdge(holder, edge) {
		if (edge === null) {
			sweepCarets(null);
			return;
		}
		const tile = detailTileWalk()[Number(edge.chip.dataset.tile)];
		const source = detailListEl.querySelector(".hw-set-chip.dragging");
		const inTile = source !== null && source.dataset.tile === edge.chip.dataset.tile;
		if (tile !== undefined && !inTile && !tileTakesCell(tile)) {
			// Where the park splices: before only on the head cell's near half.
			const before = !edge.after && edge.chip.dataset.cell === "0";
			sweepCarets(holder);
			holder.classList.toggle("drop-before", before);
			holder.classList.toggle("drop-after", !before);
			return;
		}
		sweepCarets(edge.chip);
		edge.chip.classList.toggle("drop-after", edge.after);
		edge.chip.classList.toggle("drop-before", !edge.after);
	}

	/** Tile chrome routes a chip drag to the nearest chip edge: every
	 * pixel of the tile is a drop zone whose landing is the painted
	 * caret, never a hidden end-of-tile jump. Whole-tile drags bypass
	 * this (the holder's boundary handlers run first and stop them).
	 * This handler owns the caret for the whole tile, chips included: a
	 * chip painting its own would be swept a moment later by the holder's
	 * own sweepCarets, and only one place can know whether the drop is a
	 * cell insert or a park. */
	function wireTileChromeDrop(holder) {
		holder.addEventListener("dragover", (ev) => {
			if (detailTileDrag !== null) return;
			ev.preventDefault();
			ev.dataTransfer.dropEffect = "move";
			const overChip = ev.target instanceof Element ? ev.target.closest(".hw-set-chip") : null;
			const chipRect = overChip?.getBoundingClientRect();
			// A pointer over a chip means that chip's own midpoint; anywhere
			// else on the chrome means the nearest chip edge. One painter
			// settles both, because either can turn out to be a park.
			const edge =
				overChip !== null && chipRect !== undefined
					? { chip: overChip, after: ev.clientX > chipRect.left + chipRect.width / 2 }
					: nearestChipEdge(holder, ev.clientX, ev.clientY);
			paintDropEdge(holder, edge);
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
	 * `armed` marks the aimed tile. Full quads render no marker at all.
	 * At the cap no marker is lit and every marker says so: no pick can
	 * land anywhere until a reading goes. */
	function detailAddMarker(arm, armed, lit, atCap = false) {
		const add = document.createElement("button");
		add.type = "button";
		add.className = "hw-add" + (armed ? " armed" : "") + (lit ? " lit" : "");
		add.dataset.arm = arm;
		add.title = atCap ? DETAIL_CAP_PLACEHOLDER : armed ? "Picks land here. Click again to finish." : lit ? "New picks land here." : "Send the next picks into this tile. It can grow to four cells.";
		add.setAttribute("aria-label", atCap ? DETAIL_CAP_PLACEHOLDER : arm === "end" ? "Send the next picks into a new tile" : `Send the next picks into tile ${Number(arm) + 1}`);
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
		if (detailPressing) {
			detailRenderQueued = true; // repaint once the press that caused this resolves
			if (notesSpeak) detailQueuedSpeaks = true;
			return;
		}
		const frag = document.createDocumentFragment();
		const listed = listedDetailKeys();
		const walk = detailTileWalk();
		if (detailDuplicatesHidden) frag.appendChild(setNote("Linked duplicate entries are hidden. Editing this list saves the shown layout; unlinking before an edit restores the original."));
		// The parked primary leads, the way the Back tile leads the view: the
		// opener's own key, or an alias of it, wherever the list holds one.
		for (const key of detailKeys) {
			if (isDetailPrimary(key)) frag.appendChild(parkedPrimaryChip(key));
		}
		// The unarmed landing point: the last tile with a free cell, else
		// the trailing ghost tile that stands for "a new tile at the end".
		const lastTile = walk.length > 0 ? walk[walk.length - 1] : null;
		const lastHasRoom = lastTile !== null && listed.length - lastTile.head < lastTile.size;
		const atCap = detailKeys.length >= DETAIL_KEYS_MAX;
		walk.forEach((tile, tileIdx) => {
			const holder = document.createElement("span");
			holder.className = "hw-tile" + (tile.spec !== null ? " planned" : "");
			holder.dataset.projection = String(detailProjectionVersion);
			// A whole-tile drag targets TILE boundaries: the holder's left
			// half lands the dragged tile before this one, the right half
			// after it. The list is a wrapping flex row and the tiles are
			// inline-flex, so two short tiles share a row: a top/bottom
			// midpoint cannot tell same-row neighbours apart, and the chips
			// inside already split on x. Registered before wireAppendDrop so
			// a tile payload can stop the key-append path on the same element.
			holder.addEventListener("dragover", (ev) => {
				if (detailTileDrag === null) return;
				ev.preventDefault();
				ev.stopImmediatePropagation();
				ev.dataTransfer.dropEffect = "move";
				const rect = holder.getBoundingClientRect();
				const after = ev.clientX > rect.left + rect.width / 2;
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
				const after = ev.clientX > rect.left + rect.width / 2;
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
				if (!currentDetailTarget(grip)) { ev.preventDefault(); return; }
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
			size.setAttribute("aria-label", `Tile ${tileIdx + 1}: ${tile.size} cell${tile.size === 1 ? "" : "s"}; click to cycle 1, 2, 3, 4`);
			size.textContent = `×${tile.size}`;
			holder.appendChild(size);
			// The quad knobs follow the READINGS, not the stored size. Only the
			// tail tile can hold fewer readings than its size says, and the deck
			// builds its face from the readings it actually has: a chunk of one,
			// two or three takes a single, dual or triple face, and those read
			// neither the cell-labels switch nor the identity colors. Offering
			// either on a half-filled ×4 tail put a control on the panel whose
			// click the key could not honor, with nothing to say why.
			const occupied = tileReadings(tile, listed);
			const fullQuad = tile.size >= 4 && occupied >= 4;
			if (fullQuad) {
				const abc = document.createElement("button");
				abc.type = "button";
				abc.className = "hw-tile-abc";
				abc.dataset.tile = String(tileIdx);
				const on = tile.spec === null ? true : tile.spec.cellLabels;
				abc.title = on ? "Cell labels shown; click for color-coded bare values" : "Bare values; click to show cell labels";
				abc.setAttribute("aria-label", on ? `Tile ${tileIdx + 1}: cell labels shown; click for color-coded bare values` : `Tile ${tileIdx + 1}: bare values; click to show cell labels`);
				abc.textContent = on ? "Abc" : "123";
				holder.appendChild(abc);
			}
			for (let c = 0; c < tile.size; c++) {
				const index = tile.head + c;
				const key = listed[index];
				if (key === undefined) break;
				holder.appendChild(detailChip(key, index, tile, tileIdx, c, fullQuad));
			}
			if (!fullQuad) {
				const armed = detailArm !== null && detailArm.tileIdx === tileIdx;
				const lit = !atCap && detailArm === null && tileIdx === walk.length - 1 && lastHasRoom;
				holder.appendChild(detailAddMarker(String(tileIdx), armed, lit, atCap));
			}
			frag.appendChild(holder);
		});
		if (walk.length === 0 || !lastHasRoom) {
			// Appending would start a NEW tile: say so with a ghost tile whose
			// marker is the landing point.
			const ghost = document.createElement("span");
			ghost.className = "hw-tile ghost";
			ghost.dataset.projection = String(detailProjectionVersion);
			wireGhostDrop(ghost);
			ghost.appendChild(detailAddMarker("end", false, !atCap && detailArm === null, atCap));
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
						: `${listed.length} reading${listed.length === 1 ? "" : "s"} across ${walk.length} tile${walk.length === 1 ? "" : "s"}. Grouping is positional: readings flow through the tile sizes in list order, and readings past your groups follow Readings per tile.`,
				"detail"
			)
		);
		detailListEl.replaceChildren(frag);
		if (detailLanded !== "") {
			detailListEl.querySelector(".hw-set-chip.landed")?.scrollIntoView({ block: "nearest" });
			detailLanded = "";
		}
	}

	// --- sensor pickers -------------------------------------------------------
	// One factory, two widgets. A picker bound to a setting is an editable
	// combobox over a listbox (W3C APG, list autocomplete, manual selection):
	// typing filters, arrow keys move the highlight (aria-activedescendant)
	// without committing, Enter or a click commits, Escape closes and puts
	// the box back to the saved choice, Tab leaves without committing. A
	// picker with membership (the detail collector, the dial's rotation list)
	// is a search box over a native checklist: every row is a real checkbox
	// with its label, so nothing interactive hides inside a listbox option.
	// Every matching reading renders: no row budget, so a deep selection is
	// always reachable and visible when the list opens.
	const pickers = [];
	let optionSeq = 0;

	function createPicker(config) {
		const searchEl = config.search;
		const listEl = config.list;
		const combobox = config.setting !== undefined;
		// A checklist's boxes leave the Tab order (arrows move among them),
		// and its scroller must not become a Tab stop of its own either.
		if (!combobox) listEl.tabIndex = -1;
		let selectedKey = "";
		let listOpen = false;
		// True only after a real keystroke in the search box; cleared whenever
		// the box is programmatically rewritten, so a stale display text can
		// never filter the list.
		let searchTyped = false;
		let activeKey = ""; // the highlighted option (combobox only)
		// One id per reading key, numbered as keys appear: an encoded key
		// could throw (a lone surrogate) or collide ("Core 0" and "Core_200")
		// (external review AX75, AX76).
		const pickerId = `p${++optionSeq}`;
		const optionIds = new Map();
		const optionId = (key) => {
			if (!optionIds.has(key)) optionIds.set(key, `${pickerId}-${optionIds.size}`);
			return optionIds.get(key);
		};

		// Immediate (non-debounced) persistence; third arg null disables debounce.
		// A picker without a `setting` binds nothing: its rows feed `onTick`.
		const [getKey, setKey] = !combobox
			? [() => Promise.resolve(""), () => {}]
			: useSettings(
					config.setting,
					(value) => {
						const previous = selectedKey;
						selectedKey = typeof value === "string" ? value : "";
						// A dial turn (or autocycle) carries the outline along unless
						// the person moved it with the keys: one row reads as chosen.
						if (listOpen && !searchTyped && activeKey === previous) activeKey = selectedKey;
						showSelection();
						renderList();
						config.onSelectionEcho?.(); // chip highlight follows the move
						// Rotating the dial (or autocycle) moves the selection while the
						// list is open: keep the selected row in view so the movement is
						// visible, never while the person is typing a filter.
						if (listOpen && !searchTyped) listEl.querySelector(".hw-row.selected")?.scrollIntoView({ block: "nearest" });
					},
					null
				);

		/** The tree row the selection resolves to, by its key or an alias of
		 * it; null while the tree is absent, nothing is selected, or the
		 * reading is not in HWiNFO's current output. */
		function findSelected() {
			return selectedKey === "" ? null : treeEntryOf(selectedKey);
		}

		function showSelection() {
			if (document.activeElement === searchEl && listOpen && searchTyped) return; // don't fight the user mid-search
			searchTyped = false;
			if (!combobox) {
				searchEl.value = "";
				return;
			}
			const found = findSelected();
			if (found !== null) {
				searchEl.value = `${found.reading.label}  ·  ${found.group.name}`;
				searchEl.placeholder = "Search readings";
				// The box ends in an ellipsis when narrow; the whole name and
				// its source (what tells two same-named readings apart) stay
				// on hover, and in the box itself once focused.
				searchEl.title = `${found.reading.label} · ${found.group.name}`;
				searchEl.classList.remove("missing");
			} else if (selectedKey !== "" && treeHasSnapshot) {
				// Missing only when HWiNFO answered with a snapshot (ok or stale)
				// that lacks it; a tree from an unavailable source accuses nothing.
				// Never put the warning into .value; it would act as a search filter.
				// The box is 198 px wide at the shipped panel width, so the cue is
				// short enough to read whole and the title carries the rest.
				searchEl.value = "";
				searchEl.placeholder = "Saved reading not found. Search to pick another";
				searchEl.title = "The reading saved here is not in HWiNFO's current list. Search to pick another.";
				searchEl.classList.add("missing");
			} else if (selectedKey !== "" && tree !== null) {
				// No usable list (HWiNFO down): the saved reading is unknown,
				// not missing, and stays exactly as it is.
				searchEl.value = "";
				searchEl.placeholder = "Saved reading kept (no HWiNFO data to show it)";
				searchEl.title = "";
				searchEl.classList.remove("missing");
			} else {
				// Nothing picked, or a tree fetched while the source was down: an
				// unavailable source lists no readings, which says nothing about
				// the saved key. Stay neutral until a live tree can answer.
				searchEl.value = "";
				searchEl.title = "";
				// The collector never holds a selection (no bound setting), and
				// its placeholder is owned by the HTML resting text and
				// armDetailAdd's aim line: the generic reset here would wipe a
				// standing aim's receipt on every close and tree echo.
				if (config.setting !== undefined) searchEl.placeholder = selectedKey !== "" ? "Loading readings" : "Search readings";
				searchEl.classList.remove("missing");
			}
		}

		function tokensOf(text) {
			return text.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
		}

		function options() {
			return Array.from(listEl.querySelectorAll(".hw-row:not([hidden])"));
		}

		// The row wearing the outline, tracked by element: a close, a typed
		// filter or a dial turn moves activeKey without a repaint, and clearing
		// by the previous key left one stale outline per move.
		let activeEl = null;
		function setActive(key, scroll = true) {
			activeKey = key;
			const found = built?.byKey.get(key)?.el ?? null;
			if (activeEl !== null && activeEl !== found) activeEl.classList.remove("active");
			activeEl = found;
			if (found !== null) found.classList.add("active");
			if (combobox) {
				if (found !== null) searchEl.setAttribute("aria-activedescendant", found.id);
				else searchEl.removeAttribute("aria-activedescendant");
			}
			if (found !== null && scroll) found.scrollIntoView({ block: "nearest" });
		}

		// The list is built once per tree and then filtered in place: a
		// keystroke toggles `hidden` on the rows whose match changed and
		// repaints nothing else, so typing stays fast with thousands of
		// readings and never loses the list's scroll position.
		let built = null; // { tree, rows: [{ key, el, box, hay, tick, badge }], byKey, boxes: [{ box, rows }], none }
		const ROW_PX = 28; // a rendered .hw-row: 24 px content plus its padding
		const GROUP_HEAD_PX = 27; // .hw-group line plus padding

		function build() {
			const frag = document.createDocumentFragment();
			const rows = [];
			const byKey = new Map();
			const boxes = [];
			for (let gi = 0; gi < tree.length; gi++) {
				const group = tree[gi];
				const box = document.createElement("div");
				box.className = "hw-optgroup";
				const header = document.createElement("div");
				header.className = "hw-group";
				header.id = `${pickerId}-g${gi}`;
				const title = document.createElement("span");
				title.textContent = group.name;
				header.appendChild(title);
				// Each source is a named group in both kinds of list, so a
				// screen reader tells Drive #0's "Drive Temperature" from
				// Drive #1's on entering the group.
				box.setAttribute("role", "group");
				box.setAttribute("aria-labelledby", header.id);
				header.setAttribute("role", "presentation");
				if (config.onGroupAdd !== undefined) {
					// "Add this whole source" in one press. Bound by position in
					// the rendered tree, not by name: source names are not unique
					// (identical hardware, user renames, the orphan fallback).
					const addAll = document.createElement("button");
					addAll.type = "button";
					addAll.className = "hw-group-add";
					addAll.dataset.groupIndex = String(gi);
					addAll.textContent = "+ all";
					addAll.setAttribute("aria-label", `Add every reading of ${group.name}`);
					if (!combobox) addAll.tabIndex = -1; // the checklist is one Tab stop; arrows move inside it
					header.appendChild(addAll);
				}
				box.appendChild(header);
				const groupLower = group.name.toLowerCase();
				const members = [];
				for (const reading of group.readings) {
					const typeName = SENSOR_TYPE_NAMES[reading.type] || "";
					let row;
					let tick = null;
					if (combobox) {
						row = document.createElement("div");
						row.setAttribute("role", "option");
						row.id = optionId(reading.key);
						row.setAttribute("aria-selected", "false");
						row.className = "hw-row";
					} else {
						// A native checklist row: the label IS the hit area, the box
						// its state, the name everything a screen reader needs.
						row = document.createElement("label");
						row.className = "hw-row";
						tick = document.createElement("input");
						tick.type = "checkbox";
						tick.className = "hw-tick";
						// One Tab stop for the whole checklist: the search box. Down
						// Arrow enters the list, arrows move, Tab leaves it.
						tick.tabIndex = -1;
						row.appendChild(tick);
					}
					row.dataset.key = reading.key;
					const label = document.createElement("span");
					label.className = "hw-label";
					label.textContent = reading.label;
					const val = document.createElement("span");
					val.className = "hw-val";
					val.textContent = `${reading.display ?? ""}${typeName ? " · " + typeName : ""}`;
					row.append(label, val);
					if (tick !== null) tick.setAttribute("aria-label", [reading.label, group.name, reading.display ?? "", typeName].filter((part) => part !== "").join(", "));
					box.appendChild(row);
					const entry = { key: reading.key, el: row, hay: `${groupLower} ${reading.label.toLowerCase()}`, tick, badge: null, selected: false, marker: "" };
					rows.push(entry);
					members.push(entry);
					byKey.set(reading.key, entry);
				}
				// Off-screen groups skip rendering (content-visibility in
				// pi.css); their placeholder height is estimated from the real
				// row geometry so a scroll to a deep row lands on it.
				box.style.containIntrinsicSize = `auto ${GROUP_HEAD_PX + members.length * ROW_PX}px`;
				boxes.push({ box, rows: members });
				frag.appendChild(box);
			}
			const none = document.createElement("div");
			none.className = "hw-more";
			none.hidden = true;
			// A listbox holds options only: its message is a disabled one.
			if (combobox) {
				none.setAttribute("role", "option");
				none.setAttribute("aria-disabled", "true");
			}
			frag.appendChild(none);
			listEl.replaceChildren(frag);
			built = { tree, rows, byKey, boxes, none };
		}

		function renderList() {
			if (!listOpen) return;
			if (tree === null) {
				built = null;
				const loading = document.createElement("div");
				loading.className = "hw-more";
				loading.textContent = "Loading readings…";
				if (combobox) {
					loading.setAttribute("role", "option");
					loading.setAttribute("aria-disabled", "true");
				}
				listEl.replaceChildren(loading);
				return;
			}
			if (built === null || built.tree !== tree) build();
			// Only a filter the user actually typed filters the list.
			const raw = searchEl.value;
			const tokens = searchTyped && raw !== "" ? tokensOf(raw) : [];
			let shown = 0;
			// Alias-aware: a saved key the tree lists under a linked key
			// highlights the live row it names.
			const selectedRowKey = findSelected()?.reading.key ?? selectedKey;
			for (const { box, rows } of built.boxes) {
				let inBox = 0;
				for (const row of rows) {
					const visible = tokens.length === 0 || tokens.every((t) => row.hay.includes(t));
					if (row.el.hidden === visible) row.el.hidden = !visible;
					if (visible) inBox++;
					if (combobox) {
						const selected = row.key === selectedRowKey;
						if (row.selected !== selected) {
							row.selected = selected;
							row.el.classList.toggle("selected", selected);
							row.el.setAttribute("aria-selected", selected ? "true" : "false");
						}
					} else {
						const state = config.tick(row.key);
						if (row.tick.checked !== state.on) row.tick.checked = state.on;
						const disabled = state.disabled === true;
						if (row.tick.disabled !== disabled) row.tick.disabled = disabled;
						if (row.tick.title !== state.title) row.tick.title = state.title;
					}
					const marker = config.marker?.(row.key) ?? "";
					if (row.marker !== marker) {
						row.marker = marker;
						if (row.badge === null) {
							row.badge = document.createElement("span");
							row.badge.className = "hw-now";
							row.el.appendChild(row.badge);
						}
						row.badge.textContent = marker;
						row.badge.hidden = marker === "";
					}
				}
				const boxHidden = inBox === 0;
				if (box.hidden !== boxHidden) box.hidden = boxHidden;
				shown += inBox;
			}
			const noneText = shown > 0 ? "" : tokens.length > 0 ? `No readings match "${raw.trim()}".` : "HWiNFO publishes no readings right now.";
			if (built.none.textContent !== noneText) built.none.textContent = noneText;
			built.none.hidden = shown > 0;
			if (combobox) {
				// The highlight survives filtering while its row still shows.
				const activeRow = built.byKey.get(activeKey);
				if (activeKey !== "" && (activeRow === undefined || activeRow.el.hidden)) setActive("", false);
				else setActive(activeKey, false);
			}
		}

		/** Centers a row inside the list's own scroller, never moving the
		 * page (the page moves only in revealOpenList, on a person's open). */
		function centerInList(row) {
			const lr = listEl.getBoundingClientRect();
			const rr = row.getBoundingClientRect();
			listEl.scrollTop += rr.top - lr.top - (listEl.clientHeight - rr.height) / 2;
		}

		/** An open the person started (a click, the first typed character,
		 * Down Arrow) brings the list into view: the page scrolls just
		 * enough for the list's bottom to fit, never past the field's
		 * label under the pinned header, at once, and never back on close.
		 * A focus alone, an echo or a refresh never moves the page (round
		 * 3, R17). */
		let revealed = false; // once per open: the person's own scrolling wins after that
		function revealOpenList() {
			if (revealed) return;
			revealed = true;
			const overflow = listEl.getBoundingClientRect().bottom - window.innerHeight;
			if (overflow <= 0) return;
			const root = document.documentElement;
			const head = root.hasAttribute("data-pin") && !root.hasAttribute("data-pin-off") ? document.querySelector(".hw-head[data-pin]") : null;
			const pinned = head === null ? 0 : head.getBoundingClientRect().bottom;
			const field = searchEl.closest(".hw-field") ?? searchEl;
			const by = Math.min(overflow, field.getBoundingClientRect().top - pinned - 8);
			if (by > 0) {
				window.scrollBy({ top: by, behavior: "instant" });
				hw.markPanelScroll(); // the next press at this point is not a pick
			}
		}

		function openList(reveal = false) {
			if (listOpen) {
				if (reveal) revealOpenList();
				return;
			}
			listOpen = true;
			listEl.hidden = false;
			if (combobox) searchEl.setAttribute("aria-expanded", "true");
			activeKey = combobox ? selectedKey : "";
			renderList();
			const toSelected = () => {
				const row = listEl.querySelector(".hw-row.selected");
				if (row !== null) centerInList(row);
			};
			toSelected();
			if (reveal) revealOpenList();
			// Groups above the saved row render on the way and may settle to a
			// slightly different height; one follow-up frame keeps it in view.
			requestAnimationFrame(() => {
				if (listOpen && !searchTyped) toSelected();
			});
			config.onOpenChange?.(true);
		}

		function closeList() {
			const was = listOpen;
			listOpen = false;
			revealed = false;
			listEl.hidden = true;
			if (combobox) searchEl.setAttribute("aria-expanded", "false");
			searchEl.removeAttribute("aria-activedescendant");
			setActive("", false);
			showSelection();
			if (was) config.onOpenChange?.(false);
		}

		function commit(key) {
			if (!combobox || !key) return;
			selectedKey = key;
			setKey(selectedKey);
			closeList();
			config.onSelectionEcho?.(); // own writes are not echoed back
		}

		searchEl.addEventListener("focus", () => {
			searchEl.select();
			// A focus the panel moves here itself (the control that held it
			// was just removed) lands quietly: the list opens on the person's
			// own focus, click or typing, never as a side effect.
			if (searchEl.dataset.quietFocus === "1") {
				delete searchEl.dataset.quietFocus;
				return;
			}
			openList(pointerOpening);
			pointerOpening = false;
		});

		// After a selection the input keeps focus (the option's mousedown is
		// preventDefault-ed), so no focus event fires; reopen on click too.
		// A click on the open box closes it again, like a select, and puts the
		// saved choice back; while a search is typed a click only moves the
		// caret.
		// A click that opens the list selects the whole text on its mouseup:
		// the click itself drops a caret after the focus handler selected,
		// and typing would then splice into the old name instead of
		// replacing it.
		let selectOnUp = false;
		let pointerOpening = false;
		searchEl.addEventListener("mousedown", () => {
			if (document.activeElement !== searchEl) {
				selectOnUp = true; // the focus handler opens it
				pointerOpening = true;
				return;
			}
			if (!listOpen) {
				selectOnUp = true;
				openList(true);
			} else if (!searchTyped) {
				closeList();
			}
		});
		searchEl.addEventListener("mouseup", () => {
			if (!selectOnUp) return;
			selectOnUp = false;
			if (listOpen && !searchTyped) searchEl.select();
		});

		searchEl.addEventListener("input", (ev) => {
			// The first typed character brings the list into view; later ones
			// and IME composition leave the page where the person has it.
			const first = !searchTyped && !ev.isComposing;
			searchTyped = true;
			openList(first);
			if (combobox) activeKey = "";
			renderList();
		});

		searchEl.addEventListener("keydown", (ev) => {
			if (ev.isComposing) return; // an IME owns these keys mid-composition
			if (ev.key === "Escape") {
				if (listOpen) {
					ev.preventDefault();
					ev.stopPropagation();
					closeList(); // restores the saved choice; commits nothing
				}
				return;
			}
			if (!combobox) {
				if (ev.key === "ArrowDown") {
					// Into the checklist: the first box takes focus.
					openList(true);
					// The first result the filter left visible: a hidden row
					// cannot take focus, and focusing it would strand the key.
					const first = Array.from(listEl.querySelectorAll(".hw-tick:not(:disabled), .hw-group-add")).find((el) => el.closest("[hidden]") === null) ?? null;
					if (first !== null) {
						ev.preventDefault();
						first.focus();
					}
				}
				return;
			}
			if (ev.key === "ArrowDown" || ev.key === "ArrowUp" || ev.key === "PageDown" || ev.key === "PageUp") {
				ev.preventDefault();
				openList(ev.key === "ArrowDown");
				const rows = options();
				if (rows.length === 0) return;
				const at = rows.findIndex((r) => r.dataset.key === activeKey);
				const step = ev.key === "ArrowDown" ? 1 : ev.key === "ArrowUp" ? -1 : ev.key === "PageDown" ? 10 : -10;
				const next = at < 0 ? (step > 0 ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, at + step));
				setActive(rows[next].dataset.key);
			} else if (ev.key === "Enter" && listOpen) {
				ev.preventDefault();
				// Enter commits the highlighted option. With no highlight, it
				// commits the top match only when the person typed a filter;
				// otherwise the list is the whole unfiltered tree, whose top row
				// is unrelated, and picking it would silently swap the saved
				// reading. Just close instead.
				if (activeKey !== "") commit(activeKey);
				else if (searchTyped && searchEl.value !== "") commit(options()[0]?.dataset.key);
				else closeList();
			} else if (ev.key === "Tab" && listOpen) {
				closeList(); // leaving commits nothing
			}
		});

		searchEl.addEventListener("blur", () => {
			// Focus left the widget (not into its own checklist): close quietly.
			setTimeout(() => {
				const inside = listEl.contains(document.activeElement) || document.activeElement === searchEl || (config.alsoWithin !== undefined && config.alsoWithin !== null && config.alsoWithin.contains(document.activeElement));
				if (listOpen && !inside && combobox) closeList();
			}, 0);
		});

		// Group "+ all": acts on mousedown (keeping the search focused, the
		// list open and the press from blurring) and on click for keyboards,
		// never twice for one mouse press.
		let groupAddAt = 0;
		const groupAdd = (button) => {
			const group = (tree ?? [])[Number(button.dataset.groupIndex)];
			if (group !== undefined && config.onGroupAdd !== undefined) {
				config.onGroupAdd(group);
				renderList();
			}
		};
		listEl.addEventListener("mousedown", (ev) => {
			const add = ev.target.closest(".hw-group-add");
			if (add !== null) {
				ev.preventDefault();
				groupAddAt = performance.now();
				groupAdd(add);
				return;
			}
			if (!combobox) return; // checklist rows are native labels
			const row = ev.target.closest(".hw-row");
			if (!row) return;
			ev.preventDefault(); // keep focus in the box
			commit(row.dataset.key);
		});
		listEl.addEventListener("click", (ev) => {
			const add = ev.target.closest(".hw-group-add");
			if (add !== null) {
				if (performance.now() - groupAddAt > 400) groupAdd(add);
				return;
			}
		});
		if (!combobox) {
			// The box's own activation already flipped it; adopt its new state.
			listEl.addEventListener("change", (ev) => {
				const tick = ev.target;
				if (!(tick instanceof HTMLInputElement) || !tick.classList.contains("hw-tick") || tick.disabled) return;
				const row = tick.closest(".hw-row");
				if (row?.dataset.key) config.onTick(row.dataset.key, tick.checked);
			});
			listEl.addEventListener("keydown", (ev) => {
				if (ev.key === "Escape") {
					ev.preventDefault();
					closeList();
					searchEl.focus({ preventScroll: true });
					return;
				}
				// Roving focus over the visible boxes and "+ all" buttons: the
				// list is one stop in the Tab order however long it is.
				if (!["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp"].includes(ev.key)) return;
				const items = Array.from(listEl.querySelectorAll(".hw-tick:not(:disabled), .hw-group-add")).filter((el) => el.closest("[hidden]") === null);
				const at = items.indexOf(document.activeElement);
				if (at < 0) return;
				ev.preventDefault();
				const step = { ArrowDown: 1, ArrowUp: -1, PageDown: 10, PageUp: -10 }[ev.key];
				const next = ev.key === "Home" ? 0 : ev.key === "End" ? items.length - 1 : at + step;
				if (next < 0) searchEl.focus({ preventScroll: true });
				else items[Math.min(next, items.length - 1)].focus();
			});
		}

		if (config.refresh) {
			config.refresh.addEventListener("click", () => {
				setTree(null);
				// No tree in hand is not an answer to "is this key missing".
				treeFetchedOk = false;
				treeHasSnapshot = false;
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
			/** Lets go of the search box, so the page regaining focus later
			 * does not reopen the list on its own. */
			release: () => searchEl.blur(),
			/** A search is being typed (the list is filtered by it). */
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
		// The keyboard's way out, on the same rule the outside mousedown uses:
		// Tab moves focus on and the overlay list would stay open over the
		// fields that now hold it. Read the focus that is ARRIVING, and only
		// when it is a node: a focusout to nothing (the window lost focus)
		// must not close the list out from under the user.
		picker.root?.addEventListener("focusout", (ev) => {
			const to = ev.relatedTarget;
			if (!(to instanceof Node)) return;
			if (picker.root.contains(to)) return;
			if (picker.alsoWithin !== null && picker.alsoWithin.contains(to)) return;
			closeList();
		});
		pickers.push(picker);
		return picker;
	}

	const primaryPicker = createPicker({
		search: document.getElementById("picker-search"),
		refresh: document.getElementById("picker-refresh"),
		list: document.getElementById("picker-list"),
		setting: "readingKey",
		onSelectionEcho: () => {
			renderRotationSet();
			rotationPicker?.renderList();
			hw.scheduleRender();
		}
	});

	// The dial's rotation membership: its own checklist, so ticking what
	// rotation moves through never changes what is on the dial now.
	if (rotationSetEl !== null && document.getElementById("pickerr-search") !== null) {
		rotationPicker = createPicker({
			search: document.getElementById("pickerr-search"),
			list: document.getElementById("pickerr-list"),
			tick: (key) => ({
				on: memberOfRotation(key),
				title: rotationGroups === null ? "In the rotation set" : "In a rotation group (new ticks go to the marked group)"
			}),
			onTick: setRotationMembership,
			marker: (key) => (sameReading(key, primaryPicker.selectedKey()) ? "on dial" : ""),
			alsoWithin: rotationSetEl
		});
	}

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
					setting,
					onSelectionEcho: () => hw.scheduleRender()
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
					// Membership is per reading, not per spelling: a row whose saved
					// twin is listed reads as in (1.7 linked readings).
					tick: (key) =>
						isDetailPrimary(key)
							? { on: true, disabled: true, title: "This key's own reading: the Back tile already shows it." }
							: { on: listedAliasOf(key) !== undefined, title: "Ticked readings are in the view. Untick to remove; the tile that held it shrinks." },
					onTick: (key, next) => {
						if (next) {
							// A refused add (the 128 cap) leaves the native
							// checkbox flipped: repaint the rows so the box
							// shows the membership that exists.
							if (addDetailKey(key) === false) detailPicker.renderList();
						} else {
							removeDetailKey(listedAliasOf(key) ?? key);
						}
					},
					onGroupAdd: addDetailSource,
					// Aiming, renaming and reordering in the tile list must not
					// close the results: the list below the dock counts as
					// inside the picker.
					alsoWithin: detailListEl,
					// While picking, the Add readings row pins to the top and the
					// landing marker is brought on screen, so results and the
					// slot they fill stay co-visible.
					onOpenChange: (open) => {
						document.getElementById("detail-custom")?.classList.toggle("picking", open);
						if (open) detailListEl.querySelector(".hw-add.armed, .hw-add.lit")?.scrollIntoView({ block: "nearest" });
						// Near the end of the section the sticky dock is pushed up by
						// its container and can slide under the pinned header; bring
						// it back down to sit just below the header.
						if (open) {
							const dock = document.getElementById("detail-add-dock");
							const head = document.querySelector(".hw-head[data-pin]");
							if (dock !== null && head !== null && getComputedStyle(head).position === "sticky") {
								const overlap = head.getBoundingClientRect().bottom - dock.getBoundingClientRect().top;
								if (overlap > 0) window.scrollBy(0, -Math.ceil(overlap));
							}
							// The field being typed in never ends above the view:
							// at 200% zoom the header is not pinned and the dock
							// does not stick, so bringing the landing + into view
							// could scroll the search itself off the top (round 3,
							// re-review AY09, present since 4bf09c0).
							const field = document.getElementById("pickerd-search")?.closest(".hw-field") ?? null;
							if (field !== null) {
								const pinned = head !== null && getComputedStyle(head).position === "sticky" ? head.getBoundingClientRect().bottom : 0;
								const above = pinned - field.getBoundingClientRect().top;
								if (above > 0) window.scrollBy(0, -Math.ceil(above));
							}
						}
					}
				});

	document.addEventListener("mousedown", (ev) => {
		// composedPath, not target.closest: toggling a tick re-renders rows
		// mid-bubble, detaching ev.target; closest() on a detached node would
		// misread the click as outside the picker and close the list.
		// Checked per picker so opening one never strands the other open.
		const path = ev.composedPath();
		for (const picker of pickers) {
			if (picker.isOpen() && !path.includes(picker.root) && !(picker.alsoWithin !== null && path.includes(picker.alsoWithin))) picker.close();
		}
	});

	// A help link opens in the user's own browser through the app. Followed
	// in place it would replace this 400 px panel with the docs page, and the
	// inspector has no way back; target="_blank" on the markup is the fallback
	// for a host that never sees this click.
	document.addEventListener("click", (ev) => {
		const link = ev.target instanceof Element ? ev.target.closest("a[href^='http']") : null;
		if (link === null) return;
		ev.preventDefault();
		streamDeckClient.send("openUrl", { url: link.href });
	});

	// A click outside the panel (the app's own controls, its canvas, another
	// window) never reaches this page as a mousedown: the page only loses
	// focus, while activeElement still names the search box. Close every
	// open list then, putting its saved choice back, and let go of the box.
	const dismissAll = () => {
		for (const picker of pickers) {
			if (!picker.isOpen()) continue;
			picker.close();
			picker.release();
		}
	};
	window.addEventListener("blur", dismissAll);
	// Only a click or a focus change closes a list, never the pointer
	// wandering out: overshooting the panel's edge while browsing is common
	// and must not throw the list away (owner, bench 2026-09-23). The cost
	// is known: the app's controls that take no focus (the disabled Title
	// field, the grey surround, the canvas background) send this page
	// nothing at all, so a click there leaves the list open until the next
	// click anywhere else. The list is a view and never writes, so waiting
	// is harmless.
	// Focus leaving a checklist (Tab past its last box) closes it too.
	document.addEventListener("focusin", (ev) => {
		const target = ev.target;
		let closed = false;
		for (const picker of pickers) {
			if (!picker.isOpen()) continue;
			const inside = picker.root.contains(target) || (picker.alsoWithin !== null && picker.alsoWithin.contains(target));
			if (!inside) {
				picker.close();
				closed = true;
			}
		}
		// Closing an inline checklist shrinks the page after the browser
		// already scrolled the new focus into view, which can leave it under
		// the pinned header: bring it back on the next frame (scroll padding
		// keeps it clear of the header).
		if (closed && target instanceof Element) requestAnimationFrame(() => target.scrollIntoView({ block: "nearest" }));
	});

	// The app never echoes a panel's own write, and several controls here
	// follow what another control writes (the tile editor follows Tile
	// shows, the layout rows follow Readings on this key). The shell sees
	// every save the store makes and every echo, so a follower re-reads its
	// setting on each: no timers, and nothing runs while nothing changes.
	const followSetting = (setting, apply) => {
		const [get] = useSettings(setting, apply, null);
		get().then(apply);
		hw.on("settings", () => get().then(apply));
	};
	const setPlaceholder = (el, hint) => {
		if (el !== null && el.placeholder !== hint) el.placeholder = hint;
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
		// Documents that arrived from outside the panel. A seed belongs to the
		// document the person picked Custom in: one that arrived since (a
		// replaced or newer document) gets no Elite fields (external review
		// AX34).
		let received = 0;
		hw.on("settings", (ev) => {
			if (ev.origin === "echo") received += 1;
		});
		const seedFromElite = (pickedAt) =>
			Promise.all(
				ELITE_MAP.map(([, command], index) => {
					const [getGesture, setGesture] = gestureBindings[index];
					return getGesture().then((value) => {
						if (received !== pickedAt) return;
						if (typeof value === "string" && value !== "") return; // user-set: keep
						setGesture(command);
					});
				})
			).then(() => hw.resyncBound(ELITE_MAP.map(([setting]) => setting))); // the store never echoes the panel's own writes; only the gesture selects re-read, so the preset select is never set back
		const presetOf = (value) => (value === "elite" || value === "custom" ? value : "legacy");
		// Seeding is the person's act: it runs only when they pick Custom
		// while Elite is shown, never on an echo or a replaced document. The
		// document-level capture listener sees the choice before the shell
		// saves it, so "before" is still the preset they switched from. The
		// seed itself waits for the next task: a browser-dispatched change
		// runs microtasks between listeners, so seeding here would write
		// (and re-read the store) before the shell's own listener saved the
		// pick, and every write would still carry Elite.
		// Rotation groups only steer the dial while some gesture can cross a
		// group boundary (schemeCanSwitchGroups, src/controls.ts): Elite maps
		// one to press+rotate, Legacy maps none, and a Custom map has one only
		// where the person picked it. The note by the groups editor says so and
		// hides itself the moment the map can switch; followSetting re-runs on
		// every save, so a Custom gesture change re-checks it.
		const GESTURE_WORDS = ["turn", "pressed turn", "push", "long push", "tap", "long touch"];
		const showGroupsHelp = async (preset) => {
			const map = preset === "custom" ? await Promise.all(gestureBindings.map(([getGesture]) => getGesture())) : preset === "elite" ? ELITE_MAP.map(([, command]) => command) : [];
			groupJumpers = GESTURE_WORDS.filter((_, index) => map[index] === "stepGroup");
			turnCommand = preset === "legacy" ? "step" : (map[0] ?? "step");
			presetNow = preset;
			renderRotationSet();
		};
		let shownPreset = null;
		const presetEl = document.getElementById("f-preset");
		document.addEventListener(
			"change",
			(ev) => {
				if (ev.target !== presetEl || presetEl === null) return;
				const pickedAt = received;
				if (shownPreset === "elite" && presetOf(presetEl.value) === "custom") setTimeout(() => seedFromElite(pickedAt), 0);
			},
			true
		);
		followSetting("controlPreset", (value) => {
			const preset = presetOf(value);
			shownPreset = preset;
			controlsCustomEl.hidden = preset !== "custom";
			if (controlsZonesEl !== null) controlsZonesEl.hidden = preset === "legacy";
			showGroupsHelp(preset);
		});

		// What each gesture does NOW, from the plugin's resolved scheme (the
		// function the dial itself runs), with what other settings do to it:
		// Ignore turns makes turns no-ops, two touch zones take the tap, and
		// a pause gesture with auto cycle off has nothing to pause. Under
		// Custom the selects below already name each gesture, so only the
		// gestures another setting changes are listed.
		const controlsNowEl = document.getElementById("controls-now");
		hw.on("render", (st) => {
			if (controlsNowEl === null) return;
			const c = st.preview?.effective?.controls;
			const s = st.settings;
			const rows = [];
			if (c !== undefined) {
				const cycling = model.autoCycleMsOf(s) !== null;
				const reach = s.resetScope === "all" ? " (every dial, everywhere)" : s.resetScope === "set" ? " (the whole rotation set)" : "";
				const say = (cmd) => `${model.gestureWords(cmd, s)}${cmd === "pauseResume" && !cycling ? " (auto cycle is off)" : ""}${cmd === "resetStats" ? reach : ""}`;
				const turnsOff = s.rotationDisabled === true;
				const turn = (cmd) => (turnsOff ? ["ignored (Ignore turns is on)", true] : [say(cmd), cmd === "none"]);
				if (c.rotate === c.pressedRotate) rows.push(["Turn", ...turn(c.rotate), turnsOff]);
				else rows.push(["Turn", ...turn(c.rotate), turnsOff], ["Pressed turn", ...turn(c.pressedRotate), turnsOff]);
				// Legacy fires its push on the way down: there is no long push.
				if (c.preset === "legacy" || c.shortPress === c.longPress) rows.push(["Push", say(c.shortPress), c.shortPress === "none", false]);
				else rows.push(["Push", say(c.shortPress), c.shortPress === "none", false], ["Long push", say(c.longPress), c.longPress === "none", false]);
				if (c.touchZones === "two") rows.push(["Touch", "the sides switch readings; a tap does not fire", false, true]);
				else if (c.touchZones === "three") rows.push(["Touch", `the sides switch readings; the center ${say(c.tap)}`, false, true]);
				else rows.push(["Touch", say(c.tap), c.tap === "none", false]);
				rows.push(["Long touch", say(c.touchHold), c.touchHold === "none", false]);
			}
			// Custom: only what another setting changes about the map.
			const shown = c !== undefined && c.preset === "custom" ? rows.filter((r) => r[3]) : rows;
			const signature = JSON.stringify(shown);
			if (controlsNowEl.dataset.signature === signature) return;
			controlsNowEl.dataset.signature = signature;
			const frag = document.createDocumentFragment();
			for (const [term, text, off] of shown) {
				const dt = document.createElement("dt");
				dt.textContent = term;
				const dd = document.createElement("dd");
				dd.textContent = text;
				if (off) dd.className = "off";
				frag.append(dt, dd);
			}
			controlsNowEl.replaceChildren(frag);
		});
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
		const quadDisplayEl = document.getElementById("quad-display");
		const displayItemEl = document.getElementById("display-item");
		const layoutHintEl = document.getElementById("layout-hint");
		// quadLabel3 doubles as the triple's third-row label, and in the quad
		// grid the Label and Second label fields feed the top two cells: all
		// of them hard-cut to 4 characters there, so every field's promise
		// swaps with the mode (the static placeholders stay the non-quad
		// truth).
		const mainLabelEl = document.getElementById("f-label");
		const secondLabelEl = document.getElementById("f-label2");
		const alertsFirstEl = document.getElementById("alerts-first");
		// The slot label fields sit beside their picker, so their empty-field
		// hint is short; the main label field is full width.
		const labelHints = (quad) => {
			setPlaceholder(mainLabelEl, quad ? "Short name, 4 chars max" : "The reading's own name");
			for (const el of [thirdLabelEl, secondLabelEl]) setPlaceholder(el, quad ? "4 chars max" : "Own name");
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
			if (quadDisplayEl !== null) quadDisplayEl.hidden = !quad;
			if (displayItemEl !== null) displayItemEl.hidden = dual || triple || quad;
			// Alerts read reading 1 alone; with several readings the Alerts
			// section says so where the thresholds are typed.
			if (alertsFirstEl !== null) alertsFirstEl.hidden = !(dual || triple || quad);
			labelHints(quad);
			// The face silently keeps its single layout until the extra slots
			// hold a pick (deliberate rollback-safe degrade); the panel says
			// why instead of letting the select look broken.
			const picked = (p) => p !== null && p.selectedKey() !== "";
			if (layoutHintEl !== null) layoutHintEl.hidden = !((dual && !picked(secondaryPicker)) || (triple && !picked(secondaryPicker) && !picked(quadPicker3)) || (quad && !picked(secondaryPicker) && !picked(quadPicker3) && !picked(quadPicker4)));
		};
		// followSetting re-reads on every save and echo, so a pick in another
		// slot that ends the degrade re-evaluates the hint too.
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
		const roleHelpEl = document.getElementById("press-role-help");
		const headKindEl = document.getElementById("head-kind");
		let pressValue;
		let backRole = false;
		// One renderer over both polled facts, so whichever poll answers
		// last still leaves the panel consistent.
		const applyPressState = () => {
			const details = !backRole && (pressValue === "open-details" || pressValue === "tap-cycle-hold-details");
			detailConfigEl.hidden = !details;
			if (pressBlockEl !== null) pressBlockEl.hidden = backRole;
			if (roleNoteEl !== null) roleNoteEl.hidden = !backRole;
			if (roleHelpEl !== null) roleHelpEl.hidden = !backRole;
			if (headKindEl !== null) headKindEl.textContent = backRole ? "Back tile · sensor detail view" : "Sensor Reading key";
			if (showHelpEl !== null) {
				showHelpEl.textContent = backRole
					? "Value shown picks the stat this tile displays. Pressing it always returns to the previous profile."
					: pressValue === "open-details"
						? "Pressing the key opens the sensor details view; Value shown picks the stat on this key's own face."
						: pressValue === "tap-cycle-hold-details"
							? "A short tap cycles current → min → max → avg; holding half a second opens sensor details."
							: "Pressing the key cycles current → min → max → avg. With Shared Memory these are HWiNFO's own, since HWiNFO started; Gadget has none, so they show N/A.";
			}
			hw.scheduleRender();
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
		const rangeHelpEl = document.getElementById("display-help");
		const show = (mode) => {
			if (displayModeEl.value !== mode) displayModeEl.value = mode;
			// The range sentence is about Bar and Ring only.
			if (rangeHelpEl !== null) rangeHelpEl.hidden = mode !== "bar" && mode !== "ring";
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
			show(displayModeEl.value);
		});
		showDisplayMode();
		hw.on("settings", showDisplayMode);
	}

	// Dial view (dial PI only): the overview rows serve both multi-row
	// views; the Context line and Separators selects are three-row only.
	// The bar-range section hides on the multi-row views. Hide-on-match
	// polarity on purpose: an unset dialView (legacy single) stays visible;
	// a `!== "single"` check would hide it for every legacy profile.
	const overviewRowsEl = document.getElementById("overview-rows");
	if (overviewRowsEl !== null) {
		const overviewThreeEl = document.getElementById("overview-three-rows");
		const sensorValueColorsEl = document.getElementById("sensor-value-colors");
		const barRangeEl = document.getElementById("bar-range");
		const warnEl = document.getElementById("f-warn");
		const critEl = document.getElementById("f-crit");
		const applyView = (value) => {
			overviewRowsEl.hidden = value !== "overview" && value !== "tworow";
			if (sensorValueColorsEl !== null) sensorValueColorsEl.hidden = overviewRowsEl.hidden;
			if (overviewThreeEl !== null) overviewThreeEl.hidden = value !== "overview";
			if (barRangeEl !== null) barRangeEl.hidden = value === "tworow" || value === "overview";
			// The multi-row views draw no bar: alerts tint the row VALUE
			// there (the dial renderer's alert indicator), so the threshold
			// placeholders must promise the mechanism the view really has.
			const single = value !== "tworow" && value !== "overview";
			setPlaceholder(warnEl, single ? "Off (bar turns amber)" : "Off (row value turns amber)");
			setPlaceholder(critEl, single ? "Off (bar turns red)" : "Off (row value turns red)");
		};
		followSetting("dialView", applyView);
	}
	// An unbound checkbox (no data-setting) avoids the binder's truthy
	// coercion of malformed settings.
	// Loading paints exact true without saving; only a user's edit persists.
	const sensorColorsToggle = document.getElementById("sensor-value-colors-toggle");
	if (sensorColorsToggle !== null) {
		let painting = false;
		const [, write] = useSettings("sensorValueColors", () => {}, null);
		followSetting("sensorValueColors", (value) => {
			painting = true;
			sensorColorsToggle.checked = value === true;
			painting = false;
		});
		sensorColorsToggle.addEventListener("change", () => {
			if (!painting) write(sensorColorsToggle.checked);
		});
	}

	// Quad cell colors (reading PI only): one preset select plus four
	// per-cell wells, all writing the single quadColors setting. The plugin
	// salvages per entry, so a bad hex costs exactly that cell; the select
	// snaps to "Custom" whenever the wells match no preset.
	const quadPresetEl = document.getElementById("quad-color-preset");
	if (quadPresetEl !== null) {
		const QUAD_PRESETS = COLOR_PRESETS;
		const cellInputs = [1, 2, 3, 4].map((n) => document.getElementById(`quad-color-${n}`));
		let quadColors = [...QUAD_DEFAULT_COLORS];
		let quadColorsRaw = undefined; // the stored list, entries past four and junk included
		const adoptQuadColors = (value) => {
			quadColorsRaw = value;
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
			// "Custom" is a display state, not a preset; a name the table only
			// inherits is none either (external review AX74).
			if (!Object.hasOwn(QUAD_PRESETS, quadPresetEl.value)) return;
			const preset = QUAD_PRESETS[quadPresetEl.value];
			quadColors = [...preset];
			// A preset sets the four cells; anything stored past them stays.
			quadColorsRaw = model.patchColors(quadColorsRaw, { 0: preset[0], 1: preset[1], 2: preset[2], 3: preset[3] }, QUAD_DEFAULT_COLORS);
			writeQuadColors(quadColorsRaw);
			showQuadColors();
		});
		cellInputs.forEach((input, i) => {
			if (input === null) return;
			// change (picker closed), not input: no write per drag frame.
			input.addEventListener("change", () => {
				quadColors[i] = input.value;
				// One cell changed: only that entry is rewritten.
				quadColorsRaw = model.patchColors(quadColorsRaw, { [i]: input.value }, QUAD_DEFAULT_COLORS);
				writeQuadColors(quadColorsRaw);
				showQuadColors();
			});
		});
		getQuadColors().then(applyQuadColors);
	}

	// Dial colors use the quad's preset/well idiom, but store identities rather
	// than slots: rotation, group changes and reordering never move a color.
	const readingColorList = document.getElementById("reading-color-list");
	const readingColorPreset = document.getElementById("reading-color-preset");
	let readingColors = {};
	let readingColorsSignature = "";
	const readingColorBinding = readingColorList === null ? null : useSettings("readingColors", adoptReadingColors, null);

	function adoptReadingColors(value) {
		// Keep unknown/dormant entries through edits, just like useSettings
		// keeps unknown top-level fields. Invalid colors only affect display.
		readingColors = typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
		renderReadingColors();
	}

	/** One row per measurement: the set's saved keys (the keys the dial
	 * rows use) when a set exists, else the picked reading's whole source
	 * under its live keys; the pick itself adds a row only when no listed
	 * key already names its reading. */
	function readingColorKeys() {
		const picked = primaryPicker.selectedKey();
		const set = rotationGroups === null ? rotationKeys : unionKeys(rotationGroups);
		const keys = set.length > 0 ? set : (treeEntryOf(picked)?.group.readings.map((r) => r.key) ?? []);
		const rows = [];
		for (const key of [...keys, picked]) {
			if (key !== "" && !rows.some((row) => sameReading(row, key))) rows.push(key);
		}
		return rows;
	}

	/** The color a row renders, resolved the way the dial resolves it
	 * (src/ui/sensor-value-color.ts): the row's own key first, then every
	 * alias of its reading, first valid hex wins. Returns { color, key }
	 * so the well can name the key the color is saved under, or null. */
	function readingColorOf(key) {
		for (const k of readingKeysOf(key)) {
			const color = Object.hasOwn(readingColors, k) ? readingColors[k] : undefined;
			if (typeof color === "string" && HEX_COLOR.test(color)) return { color, key: k };
		}
		return null;
	}

	/** `colors` without any entry for `key`'s reading: the key and every
	 * alias of it, so a reset clears what the dial paints and a choice
	 * leaves exactly one explicit entry per measurement. Entries for other
	 * readings' keys, dormant or unknown, stay exactly as they are. */
	function withoutReadingColor(colors, key) {
		const next = { ...colors };
		for (const k of readingKeysOf(key)) delete next[k];
		return next;
	}

	function renderReadingColors() {
		if (readingColorList === null) return;
		const colorKeys = readingColorKeys();
		const colorName = (k) => readingNameOf(k) ?? readingLabelOf(k) ?? k;
		const rows = colorKeys.map((key) => {
			const found = readingColorOf(key);
			const tag = twinTagOf(key, colorKeys, colorName);
			return { key, name: twinSpokenName(key, colorKeys, colorName), shown: tag === null ? colorName(key) : `${colorName(key)} ${tag}`, color: found === null ? null : found.color, from: found === null ? key : found.key };
		});
		// An automatic well shows the color the dial draws for that row (the
		// resolved theme's value color), not a fixed white; display only.
		const autoColor = themeValueSeed();
		const signature = JSON.stringify([rows, autoColor]);
		if (signature === readingColorsSignature) return;
		readingColorPreset.value = rows.every((r) => r.color === null) ? "automatic" : (Object.keys(COLOR_PRESETS).find((preset) => rows.every((r, i) => r.color?.toUpperCase() === COLOR_PRESETS[preset][i % 4])) ?? "custom");
		// Settings echoes and rotation must not close a native color picker.
		if (readingColorList.contains(document.activeElement) && document.activeElement.type === "color") return;
		readingColorsSignature = signature;
		const frag = document.createDocumentFragment();
		rows.forEach(({ key, name, shown, color, from }, index) => {
			const row = document.createElement("div");
			row.className = "hw-quad-colors";
			const well = document.createElement("input");
			well.type = "color";
			well.id = `reading-color-${index}`;
			well.dataset.key = key;
			well.value = color ?? autoColor;
			// A color inherited through a link names the key it is saved
			// under, so the panel says where a color it did not write came from.
			well.title = `${name}: ${color ?? "Automatic; choose a number color"}${from === key ? "" : ` (saved under ${from})`}`;
			const label = document.createElement("label");
			label.htmlFor = well.id;
			label.textContent = shown;
			label.title = `${name} (${key})`;
			const reset = document.createElement("button");
			reset.type = "button";
			reset.textContent = "Auto";
			reset.title = `Use automatic number color for ${name}`;
			reset.setAttribute("aria-label", reset.title);
			reset.disabled = color === null;
			reset.addEventListener("click", () => {
				const next = withoutReadingColor(readingColors, key);
				readingColorBinding[1](next);
				adoptReadingColors(next);
			});
			// Same commit boundary as quad wells: no writes per drag frame.
			well.addEventListener("change", () => {
				const next = model.setOwn(withoutReadingColor(readingColors, key), key, well.value);
				readingColorBinding[1](next);
				adoptReadingColors(next);
			});
			row.append(well, label, reset);
			frag.appendChild(row);
		});
		readingColorList.replaceChildren(frag);
	}

	if (readingColorBinding !== null) {
		readingColorPreset.addEventListener("change", () => {
			const preset = readingColorPreset.value;
			if (preset !== "automatic" && !Object.hasOwn(COLOR_PRESETS, preset)) return;
			// Every listed reading loses its entries under every key it has,
			// then a preset writes the row key: one explicit entry per
			// measurement, and Automatic clears exactly what the dial paints.
			// One copy of the map, edited in place (MS01).
			const next = { ...readingColors };
			readingColorKeys().forEach((key, index) => {
				for (const k of readingKeysOf(key)) delete next[k];
				if (preset !== "automatic") model.setOwn(next, key, COLOR_PRESETS[preset][index % 4]);
			});
			readingColorBinding[1](next);
			adoptReadingColors(next);
		});
		readingColorList.addEventListener("focusout", () => queueMicrotask(renderReadingColors));
		followSetting("readingColors", adoptReadingColors);
	}

	// One press, one action: a held Enter clicks a button again on every key
	// repeat, and a remove moves focus to the next remove, so a held key
	// emptied a list (d10 rotation, external review AX20 details). On every
	// control that removes, merges or replaces, a repeat does nothing.
	const ONE_PRESS = '.hw-set-remove, .hw-group-remove, .hw-set-tools button[data-tool="remove"], [data-set-action="merge"], #config-key-apply, #config-deck-apply';
	document.addEventListener(
		"keydown",
		(ev) => {
			if (ev.repeat && (ev.key === "Enter" || ev.key === " ") && ev.target instanceof Element && ev.target.closest(ONE_PRESS) !== null) ev.preventDefault();
		},
		true
	);

	// --- theme preset gallery -------------------------------------------------
	// Tokens come from the plugin (parsed themes.json) over the message channel;
	// the shared default renders as the leading "Default" chip and the seven
	// presets follow. The gallery is one radio group (APG): a single Tab stop
	// on the checked chip, arrow keys, Home and End move and pick. Picking
	// writes the per-action "theme" setting ("" = follow the shared theme);
	// the key or dial re-renders at once and the header shows its new face.

	let themesConfig = null; // { defaultTheme, effectiveDeckTheme, themes: { id: { bg, ... } }, themeOrder }
	/** A themes message the gallery can draw: a default among its themes,
	 * none named "" (that id is the Default chip's), and every palette
	 * carrying hex colors for what a chip paints (the label color frames
	 * only the Default chip, so it may be absent).
	 * Anything else is ignored and the last good gallery stays (external
	 * review AX51). */
	function drawableThemes(p) {
		const themes = p.themes;
		if (themes === null || typeof themes !== "object" || Array.isArray(themes)) return false;
		if (typeof p.defaultTheme !== "string" || !Object.hasOwn(themes, p.defaultTheme) || Object.hasOwn(themes, "")) return false;
		// Absent is fine (the default stands); anything but a string would
		// throw where the gallery looks it up (external review AX60).
		if (p.effectiveDeckTheme !== undefined && typeof p.effectiveDeckTheme !== "string") return false;
		const hex = (value) => typeof value === "string" && HEX_COLOR.test(value);
		return Object.values(themes).every((palette) => palette !== null && typeof palette === "object" && hex(palette.bg) && hex(palette.value) && hex(palette.accent) && (palette.label === undefined || hex(palette.label)));
	}

	/** The themes in their defined order. The app delivers the themes object
	 * with its keys sorted, so the order comes from the payload's list; any
	 * theme the list does not name follows in the object's order. */
	function themeOrderOf(config) {
		const listed = Array.isArray(config.themeOrder) ? config.themeOrder.filter((id) => typeof id === "string" && Object.hasOwn(config.themes, id)) : [];
		return [...new Set([...listed, ...Object.keys(config.themes)])];
	}
	let themeOverride = "";
	// Counts every change to this key's theme, picked here or delivered, so
	// a Make shared that finishes after a later pick leaves that pick alone.
	let themeChoice = 0;

	const setThemeOverride = useSettings(
		"theme",
		(value) => {
			const next = typeof value === "string" ? value : "";
			if (next !== themeOverride) themeChoice += 1;
			themeOverride = next;
			renderGallery();
		},
		null
	)[1];

	// A monochrome "link" glyph marking the follow chip, drawn (not an
	// emoji) in the followed palette's value color, the same color as the
	// word beside it.
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
		chip.setAttribute("role", "radio");
		chip.setAttribute("aria-checked", selected ? "true" : "false");
		chip.tabIndex = selected ? 0 : -1;
		const face = document.createElement("span");
		face.className = "hw-theme-face";
		face.style.background = palette.bg;
		face.setAttribute("aria-hidden", "true");
		const value = document.createElement("span");
		value.className = "hw-theme-value";
		value.style.color = palette.value;
		// The chip names its theme on the face, in that palette's own text
		// color: the palette and its name read as one thing, and no theme is
		// known only by hover. Default says so, after its link mark.
		value.textContent = isDeck ? "Default" : name;
		const spark = document.createElement("span");
		spark.className = "hw-theme-spark";
		spark.style.background = palette.accent;
		face.append(value, spark);
		if (isDeck) {
			// The mark and the dashed frame are drawn in the palette they
			// follow (its value and label colors), so they read on a light
			// palette as well as a dark one and stay quieter than the
			// selection ring (round 3, R28).
			const badge = document.createElement("span");
			badge.className = "hw-theme-badge";
			badge.innerHTML = FOLLOW_GLYPH;
			badge.style.color = palette.value;
			face.style.borderColor = palette.label;
			face.appendChild(badge);
		}
		const label = document.createElement("span");
		label.className = "hw-theme-name";
		label.textContent = name;
		chip.append(face, label);
		return chip;
	}

	// The RESOLVED deck default. A known theme stored in the shared settings
	// is the one the plugin draws (src/ui/theme-store.ts), including one this
	// panel has just written, so an older themes payload cannot contradict
	// it. Without one, the plugin's answer stands (effectiveDeckTheme, which
	// includes the legacy migration), else the spec default. Callers
	// null-guard themesConfig first.
	function resolvedDeckId() {
		const shared = hw.state.globals.theme;
		if (typeof shared === "string" && Object.hasOwn(themesConfig.themes, shared)) return shared;
		return Object.hasOwn(themesConfig.themes, themesConfig.effectiveDeckTheme) ? themesConfig.effectiveDeckTheme : themesConfig.defaultTheme;
	}

	// The band's one line says which theme is drawn and where it comes from,
	// in the Text select's idiom: "Default (shared: Void)" with Change for the
	// shared theme, or "Ember (set on this key)". It never follows the
	// pointer or focus, because every chip carries its own name (round 3,
	// R04, R38). Change sits outside the ellipsizing span so it keeps its
	// whole hit area, and holds its place (invisible) on an explicit pick,
	// so a pick never moves the chips. The help line under the chips shows
	// only where it adds a fact: a key with no reading, an unknown stored
	// value. Once it has shown, its slot stays for the page's life, so the
	// first reading picked on an empty key moves nothing under the pointer.
	const themeCurrentEl = document.getElementById("theme-current");
	const themeChangeEl = document.getElementById("theme-change");
	const themeDescEl = document.getElementById("theme-desc");
	const themeHelpEl = document.getElementById("theme-help");
	// Make shared (owner, 2026-09-26; five reviewers, design X1): on a
	// theme picked for this key or dial that is not the shared one, the
	// slot Change holds shows Make shared. It makes that theme the shared
	// theme, then sets this key back to Default, so it keeps drawing the
	// same colors and now follows them. No right click, no mode, no
	// confirmation: the Shared defaults select sets the same value at once.
	const themeShareEl = document.getElementById("theme-share");
	const setSharedTheme = useGlobalSettings("theme", () => {}, null)[1];
	let themeShareAt = -Infinity; // no press yet: Change works from the first frame
	let themeSharePoint = null; // where a pointer press on Make shared landed
	let themeSharing = false;
	/** Whether an id is a theme this build knows (own keys only, so a
	 * stored "constructor" is unknown, as the plugin reads it). */
	const knownTheme = (id) => themesConfig !== null && Object.hasOwn(themesConfig.themes, id);
	let themeHelpHeld = 0;
	let gallerySignature = "";

	// The band folds like every section (owner, 2026-09-26; design R2).
	// Folded, the checked chip's face stands in for the name, in its own
	// palette with its name (Default with its link mark and dashed frame),
	// and the scope stays. On a key with no reading the row keeps the one
	// fact the band adds, from the help line's own test; its line is held
	// while the band stays folded, so the first reading picked moves
	// nothing, and let go when the band opens (UXR02, UXR03).
	const themeSecEl = document.getElementById("sec-theme");
	const themeMiniEl = document.getElementById("theme-mini");
	const themeNoteEl = document.getElementById("theme-note");
	let themeNoteHeld = false;
	function renderThemeFold() {
		if (themeSecEl === null || themeMiniEl === null) return;
		const chip = galleryEl.querySelector('.hw-theme[aria-checked="true"]');
		themeSecEl.classList.toggle("hw-mini-none", chip === null);
		const face = chip?.querySelector(".hw-theme-face") ?? null;
		const signature = face === null ? "" : `${chip.dataset.theme}|${face.outerHTML}`;
		if (themeMiniEl.dataset.signature !== signature) {
			themeMiniEl.dataset.signature = signature;
			if (face === null) themeMiniEl.replaceChildren();
			else {
				// The copy is the row's visible name for the theme, so it is
				// not hidden from assistive tech the way the chip's face is.
				const copy = face.cloneNode(true);
				copy.removeAttribute("aria-hidden");
				const wrap = document.createElement("span");
				wrap.className = `hw-mini-wrap${chip.classList.contains("hw-theme-deck") ? " hw-theme-deck" : ""}`;
				wrap.appendChild(copy);
				themeMiniEl.replaceChildren(wrap);
			}
		}
		if (themeNoteEl === null) return;
		const configured = typeof hw.state.settings.readingKey === "string" && hw.state.settings.readingKey !== "";
		const text = !configured && hw.kind === "key" ? "Shows on the key once a reading is picked." : "";
		if (themeNoteEl.textContent !== text) themeNoteEl.textContent = text;
		if (text !== "" && !themeSecEl.open) themeNoteHeld = true;
		if (text === "" && themeSecEl.open) themeNoteHeld = false;
		themeNoteEl.classList.toggle("shown", text !== "" || themeNoteHeld);
		themeNoteEl.style.minHeight = themeNoteHeld ? "1lh" : "";
	}
	themeSecEl?.addEventListener("toggle", renderThemeFold);

	function renderThemeLine() {
		if (themeCurrentEl === null || themesConfig === null) return;
		const id = themeOverride;
		const where = hw.kind === "dial" ? "dial" : "key";
		const known = id === "" || knownTheme(id);
		const shared = model.themeName(resolvedDeckId());
		const [name, scope, spoken] =
			id === ""
				? ["Default", ` (shared: ${shared})`, `Follows the shared theme, now ${shared}.`]
				: known
					? [model.themeName(id), ` (set on this ${where})`, `Set on this ${where}; kept when the shared theme changes.`]
					: [`"${id}"`, ` (unknown; draws ${model.themeName(themesConfig.defaultTheme)})`, ""];
		const shareable = id !== "" && known && id !== resolvedDeckId();
		if (themeChangeEl !== null) {
			themeChangeEl.hidden = shareable;
			themeChangeEl.classList.toggle("hw-look-change-off", id !== "");
		}
		if (themeShareEl !== null) {
			themeShareEl.hidden = !shareable;
			if (shareable) themeShareEl.setAttribute("aria-label", `Make shared: ${model.themeName(id)} becomes the shared theme and this ${where} follows it`);
		}
		document.getElementById("sec-theme")?.classList.toggle("hw-share-on", shareable);
		const signature = `${name}|${scope}`;
		if (themeCurrentEl.dataset.signature === signature) return;
		themeCurrentEl.dataset.signature = signature;
		const nameEl = document.createElement("span");
		nameEl.textContent = name;
		const scopeEl = document.createElement("span");
		scopeEl.className = "hw-look-scope";
		scopeEl.textContent = scope;
		themeCurrentEl.replaceChildren(nameEl, scopeEl);
		if (themeDescEl !== null) themeDescEl.textContent = spoken;
	}

	function renderThemeHelp() {
		if (themeHelpEl === null || themesConfig === null) return;
		const scope = hw.kind === "dial" ? "dial" : "key";
		const configured = typeof hw.state.settings.readingKey === "string" && hw.state.settings.readingKey !== "";
		const unknown = themeOverride !== "" && !knownTheme(themeOverride);
		// A key with no reading draws its prompt on fixed black; a dial's
		// prompt is drawn in its theme, so only a key says so.
		const text = !configured && hw.kind === "key"
			? "Shows on the key once a reading is picked."
			: unknown
				? `This version does not know that theme; the ${scope} keeps it stored until you pick one.`
				: "";
		if (themeHelpEl.dataset.signature === text) return;
		themeHelpEl.dataset.signature = text;
		themeHelpEl.textContent = text;
		if (text !== "") themeHelpHeld = Math.max(themeHelpHeld, themeHelpEl.offsetHeight);
		themeHelpEl.hidden = text === "" && themeHelpHeld === 0;
		themeHelpEl.style.minHeight = themeHelpHeld > 0 ? `${themeHelpHeld}px` : "";
	}

	function renderGallery() {
		if (themesConfig === null) return;
		const deckId = resolvedDeckId();
		const deckDisplay = model.themeName(deckId);
		// A stored theme this version does not know draws the spec default;
		// no chip is checked for it.
		const unknown = themeOverride !== "" && !knownTheme(themeOverride);
		const signature = JSON.stringify([deckId, themesConfig.themes, hw.kind]);
		if (signature !== gallerySignature || galleryEl.children.length === 0) {
			gallerySignature = signature;
			const frag = document.createDocumentFragment();
			const deckChip = themeChip("", themesConfig.themes[deckId], "Default", themeOverride === "");
			// The Default chip's accessible name says what it resolves to. No
			// tooltip: the line above the chips shows the same words, and a
			// title repeating the name is read twice (round 3, R46).
			deckChip.removeAttribute("title");
			deckChip.setAttribute("aria-label", `Default: follow the shared theme, currently ${deckDisplay}`);
			frag.appendChild(deckChip);
			for (const id of themeOrderOf(themesConfig)) {
				const palette = themesConfig.themes[id];
				const chip = themeChip(id, palette, model.themeName(id), themeOverride === id);
				chip.removeAttribute("title");
				chip.setAttribute("aria-label", `${model.themeName(id)} theme for this ${hw.kind === "dial" ? "dial" : "key"}`);
				frag.appendChild(chip);
			}
			// Rebuilding under focus would drop it; keep the focused chip focused.
			const focusedTheme = galleryEl.contains(document.activeElement) ? document.activeElement.dataset.theme : undefined;
			galleryEl.replaceChildren(frag);
			if (focusedTheme !== undefined) galleryEl.querySelector(`.hw-theme[data-theme="${CSS.escape(focusedTheme)}"]`)?.focus({ preventScroll: true });
		}
		// The selection changes in place: the focused swatch stays the same
		// element while arrow keys move through the group.
		for (const chip of galleryEl.querySelectorAll(".hw-theme")) {
			const selected = chip.dataset.theme === themeOverride;
			chip.setAttribute("aria-checked", selected ? "true" : "false");
			chip.classList.toggle("selected", selected);
			// An unknown stored theme checks no chip; the group still needs
			// its one Tab stop, so the Default chip takes it.
			chip.tabIndex = selected || (unknown && chip.dataset.theme === "") ? 0 : -1;
		}
		renderThemeLine();
		renderThemeHelp();
		renderThemeFold();
		labelSharedOptions();
		renderReadingColors(); // automatic wells show the theme's value color
	}

	// The help line and the folded row's note follow the reading being
	// picked (an unconfigured key says when the theme will show).
	hw.on("render", () => {
		renderThemeHelp();
		renderThemeFold();
	});

	/** The Default choices name what they currently resolve to. */
	const [getSharedText] = useGlobalSettings("textMode", undefined, null, false);
	// With no shared theme stored, the runtime draws the one it resolves
	// (legacy migration included), so the Shared defaults select shows that,
	// not a fixed Void (display only; nothing is written; round 3, R34).
	function syncSharedThemeDefault() {
		const el = document.getElementById("shared-theme");
		if (el === null || themesConfig === null) return;
		const id = resolvedDeckId();
		if (el.dataset.default === id) return;
		el.dataset.default = id;
		hw.resyncBound(["theme"]);
	}

	function labelSharedOptions() {
		const option = document.querySelector('#f-text option[value=""]');
		if (option === null) return;
		getSharedText().then((mode) => {
			const name = mode === "dim" ? "Dimmed" : mode === "custom" ? "Custom color" : "Theme text";
			const text = `Default (shared: ${name})`;
			if (option.textContent !== text) option.textContent = text;
		});
	}
	// A shared theme stored from anywhere redraws the line and the Default
	// chip at once, whichever of it and the plugin's themes payload lands
	// first.
	hw.on("globals", () => {
		if (themesConfig === null) {
			labelSharedOptions();
			return;
		}
		renderGallery();
		syncSharedThemeDefault();
	});

	function pickTheme(id) {
		if (id === themeOverride) return;
		themeChoice += 1;
		themeOverride = id;
		setThemeOverride(themeOverride);
		renderGallery();
	}

	// A press remembers the key's theme choice it started on: a theme that
	// arrives between press and release makes that press stale, and it
	// shares nothing until a fresh press (external review AX14).
	// The record ends only with its own release, after the click that
	// release may fire: focus leaving (Tab) or another key mid-press ends
	// nothing, since the press can still click and is still stale (AX21).
	// "Its own" is the exact key: releasing Enter never ends a held Space
	// press (AX36).
	let sharePress = null; // { choice, kind: "pointer" | " " | "Enter" }
	themeShareEl?.addEventListener("pointerdown", () => {
		sharePress = { choice: themeChoice, kind: "pointer" };
	});
	themeShareEl?.addEventListener("keydown", (ev) => {
		if (!ev.repeat && (ev.key === " " || ev.key === "Enter")) sharePress = { choice: themeChoice, kind: ev.key };
	});
	themeShareEl?.addEventListener("pointercancel", () => {
		if (sharePress?.kind === "pointer") sharePress = null;
	});
	const endSharePress = (kind) => {
		const press = sharePress;
		if (press?.kind !== kind) return;
		setTimeout(() => {
			if (sharePress === press) sharePress = null;
		}, 0);
	};
	document.addEventListener("pointerup", () => endSharePress("pointer"), true);
	document.addEventListener("keyup", (ev) => {
		if (ev.key === " " || ev.key === "Enter") endSharePress(ev.key);
	}, true);
	hw.announce("theme-share", ""); // primed: the first Make shared is said
	themeShareEl?.addEventListener("click", async (ev) => {
		const press = sharePress;
		sharePress = null;
		if (press !== null && press.choice !== themeChoice) return;
		const id = themeOverride;
		const choice = themeChoice;
		// A stale press (the state moved on), or one while a share is still
		// being written, does nothing.
		if (themeSharing || themesConfig === null || id === "" || !knownTheme(id) || id === resolvedDeckId()) return;
		const was = model.themeName(resolvedDeckId());
		const where = hw.kind === "dial" ? "dial" : "key";
		// A keyboard press (detail 0) has no point for a double click to land on.
		themeSharePoint = ev.detail > 0 ? { x: ev.clientX, y: ev.clientY } : null;
		themeShareAt = performance.now();
		// The shared theme first, and only then the key, so the device never
		// draws the old one on this key in between and a panel closed in the
		// meantime never leaves the key on Default with the old shared theme
		// (audit MS02). The line then shows the new shared theme at once
		// instead of waiting for the plugin's themes payload.
		themeSharing = true;
		try {
			await setSharedTheme(id);
		} finally {
			themeSharing = false;
		}
		themeShareAt = performance.now();
		themesConfig = { ...themesConfig, effectiveDeckTheme: id };
		// The shared settings can take a while to answer (the first write waits
		// for them). A theme picked for this key in the meantime is the newer
		// choice: it stays, focus stays where the person put it, and the panel
		// says what the key draws now.
		if (themeChoice !== choice) {
			renderGallery();
			syncSharedThemeDefault();
			hw.resyncBound(["theme"]);
			// An unknown stored theme is said the way the line shows it
			// (external review AX15).
			const now = themeOverride === "" ? "follows it" : knownTheme(themeOverride) ? `keeps ${model.themeName(themeOverride)}` : `keeps its stored theme "${themeOverride}" (unknown; draws ${model.themeName(themesConfig.defaultTheme)})`;
			hw.announce("theme-share", `${model.themeName(id)} is now the shared theme, was ${was}. This ${where} ${now}.`, { repeat: true });
			return;
		}
		pickTheme("");
		syncSharedThemeDefault();
		hw.resyncBound(["theme"]);
		// Focus lands on the Default chip, never on Change, which now holds
		// the slot: a held Enter must not run on into it.
		const defaultChip = galleryEl.querySelector('.hw-theme[data-theme=""]');
		defaultChip?.focus({ preventScroll: true });
		const at = defaultChip?.getBoundingClientRect();
		if (at !== undefined && (at.top < 0 || at.bottom > window.innerHeight)) defaultChip.scrollIntoView({ block: "nearest" });
		hw.announce("theme-share", `${model.themeName(id)} is now the shared theme, was ${was}. This ${where} follows it.`, { repeat: true });
	});
	// The second click of a double click on Make shared lands on Change,
	// which has just taken the slot, or on the fold row, which reaches 22 px
	// further right once Change is back: it opens and folds nothing. Only
	// that click: a pointer click within 500 ms, within 4 px of the first.
	// A keyboard press or a click somewhere else is a new command and runs.
	const swallowAfterShare = (ev) => {
		if (ev.detail === 0 || themeSharePoint === null || performance.now() - themeShareAt > 500) return;
		if (Math.hypot(ev.clientX - themeSharePoint.x, ev.clientY - themeSharePoint.y) > 4) return;
		ev.preventDefault();
		ev.stopImmediatePropagation();
	};
	themeChangeEl?.addEventListener("click", swallowAfterShare, true);
	document.querySelector("#sec-theme > summary")?.addEventListener("click", swallowAfterShare, true);
	galleryEl.addEventListener("click", (ev) => {
		const chip = ev.target.closest(".hw-theme");
		if (!chip) return;
		pickTheme(chip.dataset.theme);
	});
	galleryEl.addEventListener("keydown", (ev) => {
		const chips = [...galleryEl.querySelectorAll(".hw-theme")];
		const at = chips.indexOf(document.activeElement);
		if (at < 0 || ev.altKey || ev.ctrlKey || ev.metaKey) return;
		const next = { ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1, Home: 0, End: chips.length - 1 }[ev.key];
		if (next === undefined) return;
		ev.preventDefault();
		const target = chips[(next + chips.length) % chips.length];
		// Focus first: the rebuild keeps focus on whatever chip holds it.
		target.focus();
		pickTheme(target.dataset.theme);
	});
	// The plugin pushes a fresh themes payload (with effectiveDeckTheme)
	// whenever the deck theme changes; its answer covers an absent or unknown
	// stored theme (resolvedDeckId).
	streamDeckClient.send("sendToPlugin", { event: "getThemes" });

	// --- Text setting (issue #2) ----------------------------------------------
	// The Text selects are sdpi-managed; this block reveals the conditional
	// Custom rows (color well + dim checkbox) for the local and the deck-wide
	// scope, and binds the color wells. Wells write only on change, so absent
	// settings stay absent; an unset well shows the resolved theme's value
	// color: the truthful "custom starts from what you see" seed.
	function themeValueSeed() {
		if (themesConfig === null) return "#ffffff";
		// Empty follows the deck. An unknown explicit id follows the runtime
		// palette resolver's spec default, even on a different deck theme.
		const id = themeOverride === "" ? resolvedDeckId() : Object.hasOwn(themesConfig.themes, themeOverride) ? themeOverride : themesConfig.defaultTheme;
		const palette = themesConfig.themes[id];
		return palette ? palette.value.toLowerCase() : "#ffffff";
	}

	function bindTextControls(customEl, colorEl, useStore, event) {
		if (customEl === null || colorEl === null) return;
		const [getMode] = useStore("textMode", () => {}, null);
		const [getColor, setColor] = useStore("textColor", () => {}, null);
		const codeEl = document.getElementById(`${colorEl.id}-code`);
		const refresh = () => {
			getMode().then((mode) => {
				customEl.hidden = mode !== "custom";
			});
			getColor().then((color) => {
				const stored = typeof color === "string" && HEX_COLOR.test(color);
				if (codeEl !== null) codeEl.textContent = stored ? color.toUpperCase() : "not set: theme text until picked";
				colorEl.setAttribute("aria-label", stored ? `Custom text color, ${color.toUpperCase()}` : "Custom text color, not set (theme text until picked)");
				if (document.activeElement === colorEl) return; // picker open: don't fight it
				const shown = stored ? color.toLowerCase() : themeValueSeed();
				if (colorEl.value !== shown) colorEl.value = shown;
			});
		};
		// change (picker closed), not input: no write per drag frame. The
		// exact color is stored as picked; nothing here ever adjusts it.
		colorEl.addEventListener("change", () => setColor(colorEl.value));
		refresh();
		hw.on(event, refresh);
	}

	bindTextControls(document.getElementById("text-custom"), document.getElementById("text-color"), useSettings, "settings");
	bindTextControls(document.getElementById("deck-text-custom"), document.getElementById("deck-text-color"), useGlobalSettings, "globals");

	streamDeckClient.sendToPropertyInspector.subscribe((ev) => {
		const p = ev && ev.payload;
		if (!p || typeof p !== "object") return;
		if (p.event === "themes") {
			if (!drawableThemes(p)) return;
			themesConfig = p;
			renderGallery();
			syncSharedThemeDefault();
			hw.scheduleRender(); // the Shared defaults summary names the resolved theme
			return;
		}
		if (p.event === "detailSupport") {
			// The note starts hidden and empty; the one-shot reply only ever
			// needs to reveal it on an unsupported deck. The Press summary
			// says the same thing without opening the section.
			detailsSupported = p.supported === true;
			hw.scheduleRender();
			const note = document.getElementById("detail-unsupported");
			if (note !== null && p.supported !== true) {
				note.hidden = false;
				note.textContent = `Sensor details are not available on this deck (${p.model ?? "unsupported device"}): no bundled detail view fits its layout. Everything else on this key keeps working normally.`;
			}
			return;
		}
		if (p.event === "sensorTree") {
			setTree(Array.isArray(p.groups) ? p.groups : []);
			treeSource = p.source;
			treeFetchedOk = p.state === "ok";
			treeHasSnapshot = p.state === "ok" || p.state === "stale";
			projectDetailState();
			treeRequestPending = false;
			for (const picker of pickers) picker.onTree();
			renderRotationSet(); // chip labels resolve once the tree is here
			renderDetailList(); // detail chip labels too
			updateFilterCount(); // and the live filter match count
		} else if (p.event === "preview") {
			// The header, status line and summaries are the shell's. Ticks push
			// previews only: a source outage or switch invalidates the old tree
			// even when no new tree reply arrived in between.
			if (p.state !== "ok" || (p.source !== undefined && p.source !== treeSource)) treeFetchedOk = false;
			// Refresh after recovery so keys, aliases and available readings
			// describe the provider that now supplies the face.
			if (p.state === "ok" && !treeFetchedOk && !treeRequestPending) {
				requestTree();
			}
		}
	});

	primaryPicker.init();
	hw.on("retry", () => {
		tree = null;
		for (const picker of pickers) picker.renderList();
		treeRequestPending = true;
	});
	if (secondaryPicker !== null) secondaryPicker.init();
	if (quadPicker3 !== null) quadPicker3.init();
	if (quadPicker4 !== null) quadPicker4.init();
	if (detailBinding !== null) {
		detailListEl.addEventListener("keydown", (ev) => {
			if (ev.target instanceof Element && !currentDetailTarget(ev.target)) return;
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
				const after = ev.clientX > target.rect.left + target.rect.width / 2;
				sweepCarets(target.holder);
				target.holder.classList.toggle("drop-after", after);
				target.holder.classList.toggle("drop-before", !after);
				return;
			}
			paintDropEdge(target.holder, nearestChipEdge(target.holder, ev.clientX, ev.clientY));
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
				const after = ev.clientX > target.rect.left + target.rect.width / 2;
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
			if (!currentDetailTarget(ev.target)) return;
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
				if (chip === null || chipKey === undefined || isDetailPrimary(chipKey)) return;
				const tileIdx = Number(chip.dataset.tile);
				const cellIdx = Number(chip.dataset.cell);
				const spec = detailTiles[tileIdx];
				const input = document.createElement("input");
				input.type = "text";
				input.className = "hw-group-name hw-chip-rename hw-cell-rename";
				input.dataset.tile = String(tileIdx);
				input.dataset.cell = String(cellIdx);
				input.dataset.key = chipKey;
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
					t.automaticColors = Array.from({ length: grown }, (_, i) => t.automaticColors[i] === true);
				});
				// Same follow the move arrows use: the rebuild destroyed
				// the pressed control, and chained Enter must keep working.
				detailListEl.querySelector(`.hw-tile-size[data-tile="${size.dataset.tile}"]`)?.focus();
				return;
			}
			const abc = ev.target.closest(".hw-tile-abc");
			if (abc !== null) {
				editTile(Number(abc.dataset.tile), (t) => {
					t.cellLabels = !t.cellLabels;
				});
				detailListEl.querySelector(`.hw-tile-abc[data-tile="${abc.dataset.tile}"]`)?.focus();
				return;
			}
			const remove = ev.target.closest(".hw-set-remove");
			if (remove !== null) {
				const removes = [...detailListEl.querySelectorAll(".hw-set-remove")];
				const at = removes.indexOf(remove);
				removeDetailKey(remove.dataset.key);
				// Follow onto the neighbouring remove (same index, else the
				// new last), else back to the search box.
				const again = [...detailListEl.querySelectorAll(".hw-set-remove")];
				const follow = again[Math.min(at, again.length - 1)] ?? detailSearchEl();
				follow?.focus();
			}
		});
		// Arming must not steal focus from the search: with focus intact the
		// results stay open and the pick flow never restarts.
		detailListEl.addEventListener("mousedown", (ev) => {
			if (ev.target.closest(".hw-add") !== null) ev.preventDefault();
			// Hold the repaint for the length of this press (see detailPressing):
			// the blur it causes can commit or abandon a cell rename, and a
			// rebuild before mouseup would take the pressed control with it.
			detailPressing = true;
			clearTimeout(detailPressTimer);
			// A zero timer on mouseup lands after this press's own click has
			// been dispatched; the ceiling covers a release the window never
			// sees (a drag out of the webview), so nothing strands the repaint.
			detailPressTimer = setTimeout(releaseDetailPress, 500);
			window.addEventListener("mouseup", queueDetailRelease, { once: true });
		});
		// Cell-rename commit and teardown, byte-parallel to the rotation
		// chips: change writes once, blur without an edit restores the span,
		// Enter blurs. The quad color well keeps its own change listener;
		// the class guard keeps the two apart.
		const commitCellRename = (input) => {
			const label = input.value.trim();
			input.dataset.committed = label;
			editDetailCell(input.dataset.key, (t, cell) => {
				t.labels[cell] = label;
			});
		};
		detailListEl.addEventListener("change", (ev) => {
			const input = ev.target;
			if (!(input instanceof HTMLInputElement) || !input.classList.contains("hw-cell-rename")) return;
			dropLeaveCommit(input);
			if (input.dataset.committed === input.value.trim()) return; // the leave flush wrote it
			commitCellRename(input);
		});
		// A label typed but not yet committed is saved by the leave flush.
		detailListEl.addEventListener("input", (ev) => {
			const input = ev.target;
			if (!(input instanceof HTMLInputElement) || !input.classList.contains("hw-cell-rename")) return;
			registerLeaveCommit(input, () => commitCellRename(input));
		});
		detailListEl.addEventListener("focusout", (ev) => {
			if (ev.target instanceof HTMLInputElement && ev.target.classList.contains("hw-cell-rename")) {
				setTimeout(renderDetailList, 0);
			}
		});
		detailListEl.addEventListener("keydown", (ev) => {
			if (ev.key === "Enter" && ev.target instanceof HTMLInputElement && ev.target.classList.contains("hw-cell-rename")) {
				const key = ev.target.dataset.key;
				ev.target.blur();
				// Focus returns to that cell's name once the list has redrawn
				// (the redraw is queued by the focusout above, first).
				setTimeout(() => detailListEl.querySelector(`.hw-set-chip[data-key="${CSS.escape(key)}"] .hw-set-name[role="button"]`)?.focus({ preventScroll: true }), 0);
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
			// The toolbar acts on the selected member; a button that cannot
			// act (aria-disabled) does nothing and keeps focus.
			const tool = ev.target.closest(".hw-set-tools button[data-tool]");
			if (tool !== null) {
				for (const button of rotationTools.querySelectorAll("button")) button.tabIndex = button === tool ? 0 : -1;
				if (tool.getAttribute("aria-disabled") === "true") return;
				if (tool.dataset.tool === "earlier" || tool.dataset.tool === "later") {
					// A move into the next group takes the toolbar with it: the
					// page follows by the same distance, so the pressed button
					// stays under the pointer (as far as the page can scroll).
					const before = tool.getBoundingClientRect().top;
					moveSelectedRotation(tool.dataset.tool === "earlier" ? -1 : 1);
					const now = rotationTools.querySelector(`button[data-tool="${tool.dataset.tool}"]`);
					const shift = now === null || !now.isConnected ? 0 : now.getBoundingClientRect().top - before;
					if (Math.abs(shift) > 0.5) window.scrollBy({ top: shift, behavior: "instant" });
				}
				else if (tool.dataset.tool === "rename") startRotationRename();
				else if (tool.dataset.tool === "remove") removeSelectedRotation();
				return;
			}
			// A click on a member selects it (its list takes focus).
			const option = ev.target.closest('.hw-set-list [role="option"]');
			if (option !== null) {
				selectRotationMember(option.dataset.key, option.dataset.group === undefined ? null : Number(option.dataset.group), { focus: true });
				return;
			}
			const groupRemove = ev.target.closest(".hw-group-remove");
			if (groupRemove) {
				const index = Number(groupRemove.dataset.group);
				if (rotationGroups === null || rotationGroups[index] === undefined) return;
				// A group holding readings asks for a second press, in words;
				// an empty group goes at once (only its name is lost).
				const members = rotationGroups[index].keys.length;
				const what = `${members} reading${members === 1 ? "" : "s"}`;
				const groupName = rotationGroups[index].name;
				if (members > 0) {
					const called = groupName !== "" ? groupName : `group ${index + 1}`;
					const step = armPress(groupRemove, `Remove ${called} and its ${what}?`, "Press again to remove it.", `Press again to remove ${called} and its ${what}.`, ev.detail);
					if (step !== "confirm") return;
				}
				rotationArm = null;
				rotationGroups.splice(index, 1);
				if (rotationGroups.length === 0) {
					// Removing the last group keeps the button's promise
					// ("its readings leave the rotation"): back to flat
					// mode with an empty set, not a silent merge.
					rotationGroups = null;
					rotationKeys = [];
				}
				// Focus goes to a control that is still there and harmless,
				// never onto the next group's remove button under the pointer.
				rotationPendingFocus = () =>
					rotationSetEl.querySelector(`.hw-group-name[data-group="${Math.min(index, (rotationGroups?.length ?? 1) - 1)}"]:not(.hw-chip-rename)`) ??
					rotationSetEl.querySelector('button[data-set-action="add"]') ??
					rotationSetEl.querySelector(".hw-set-list") ??
					rotationSetEl.querySelector('button[data-set-action="split"]');
				writeRotation(true);
				hw.announce("rotation-order", `Removed ${groupName !== "" ? groupName : `group ${index + 1}`}${members > 0 ? ` and its ${what}` : ""}.`, { repeat: true });
				return;
			}
			const collector = ev.target.closest(".hw-collector");
			if (collector) {
				const index = Number(collector.dataset.group);
				if (Number.isInteger(index)) collectorIndex = index;
				collectorSettled = true;
				syncAddLabel();
				return;
			}
			const action = ev.target.closest("button[data-set-action]");
			if (action === null) return;
			if (action.dataset.setAction === "split") {
				// Group 1 inherits the current set; new ticks land in group 2.
				rotationGroups = [
					{ name: "", keys: [...rotationKeys], keysKept: [], raw: null, base: null },
					{ name: "", keys: [], keysKept: [], raw: null, base: null }
				];
				collectorIndex = 1;
				collectorSettled = true;
				// Focus lands on something that still exists and is in view.
				rotationPendingFocus = () => rotationSetEl.querySelector('.hw-group-name[data-group="1"]');
				writeRotation(true);
			} else if (action.dataset.setAction === "add") {
				rotationGroups = rotationGroups ?? [{ name: "", keys: [...rotationKeys], keysKept: [], raw: null, base: null }];
				rotationGroups.push({ name: "", keys: [], keysKept: [], raw: null, base: null });
				collectorIndex = rotationGroups.length - 1;
				collectorSettled = true;
				rotationPendingFocus = () => rotationSetEl.querySelector(`.hw-group-name[data-group="${collectorIndex}"]`);
				writeRotation(true);
			} else if (action.dataset.setAction === "merge") {
				// Merging drops the group names and which reading was in which
				// group; when either would be lost, it asks for a second press
				// (round 3, re-review PY09).
				const named = (rotationGroups ?? []).filter((group) => group.name !== "").length;
				const holding = (rotationGroups ?? []).filter((group) => group.keys.length > 0).length;
				if (named > 0 || holding >= 2) {
					const text = named > 0 ? "Merge and drop the group names?" : `Merge ${holding} groups into one list?`;
					const step = armPress(action, text, `Press again to merge every group into one set${named > 0 ? `; ${named} group name${named === 1 ? " is" : "s are"} dropped` : ""}.`, `Press again to merge${named > 0 ? "; the group names are dropped" : ""}.`, ev.detail);
					if (step !== "confirm") return;
				}
				rotationArm = null;
				rotationKeys = unionKeys(rotationGroups ?? []);
				rotationGroups = null;
				rotationPendingFocus = () => rotationSetEl.querySelector(".hw-set-list") ?? rotationSetEl.querySelector('button[data-set-action="split"]');
				writeRotation(true);
			}
		});
		// Group and chip names commit on change (blur or Enter); Enter blurs
		// so the deferred re-render (skipped while a field is focused) happens.
		rotationSetEl.addEventListener("change", (ev) => {
			if (!(ev.target instanceof HTMLInputElement)) return;
			if (ev.target.classList.contains("hw-chip-rename")) {
				dropLeaveCommit(ev.target);
				// Committed already by the leave flush: nothing new to write.
				if (ev.target.dataset.committed === ev.target.value.trim()) {
					renderRotationSet();
					return;
				}
				commitChipRename(ev.target);
				renderRotationSet();
				return;
			}
			if (!ev.target.classList.contains("hw-group-name")) return;
			const index = Number(ev.target.dataset.group);
			if (rotationGroups === null || rotationGroups[index] === undefined) return;
			dropLeaveCommit(ev.target);
			const groupName = ev.target.value.trim();
			if (ev.target.dataset.committed !== groupName || rotationGroups[index].name !== groupName) {
				rotationGroups[index].name = groupName;
				writeRotation(true, { render: false });
			}
			// Rebuild on the next task, once focus has settled: Tab lands on
			// the next control first, and the rebuild keeps focus there.
			setTimeout(renderRotationSet, 0);
		});
		/** Writes a chip rename (the rotation name for one reading). The
		 * leave flush writes quietly: the person may still be typing. */
		function commitChipRename(input, { speak = true } = {}) {
			const key = input.dataset.key;
			const name = input.value.trim();
			input.dataset.committed = name;
			// One name per measurement, like one color: the chip's own key
			// carries it and the aliases' entries go, so the dial title and
			// this chip read the same answer whichever provider is live. Only
			// those entries change; entries the parser skipped (junk, a newer
			// version's shape) stay stored as they were.
			for (const k of readingKeysOf(key)) {
				delete rotationNames[k];
				rotationNamesRaw = model.patchNames(rotationNamesRaw, k, "");
			}
			if (name !== "") {
				model.setOwn(rotationNames, key, name);
				rotationNamesRaw = model.patchNames(rotationNamesRaw, key, name);
			}
			namesBinding[1](rotationNamesRaw);
			if (speak) hw.announce("rotation-order", name !== "" ? `Named ${name} on the dial` : `${readingLabelOf(key) ?? key} uses HWiNFO's name again`, { repeat: true });
		}
		// Names typed but not yet committed are saved by the leave flush,
		// without rebuilding under the caret.
		rotationSetEl.addEventListener("input", (ev) => {
			const input = ev.target;
			if (!(input instanceof HTMLInputElement) || !input.classList.contains("hw-group-name")) return;
			registerLeaveCommit(input, () => {
				if (input.classList.contains("hw-chip-rename")) {
					commitChipRename(input, { speak: false });
					return;
				}
				const index = Number(input.dataset.group);
				if (rotationGroups === null || rotationGroups[index] === undefined) return;
				const groupName = input.value.trim();
				input.dataset.committed = groupName;
				if (rotationGroups[index].name === groupName) return;
				rotationGroups[index].name = groupName;
				writeRotation(true, { render: false });
			});
		});
		// A rename abandoned unchanged (blur without an edit) fires no change
		// event; restore the chip's span once focus has left the input.
		rotationSetEl.addEventListener("focusout", (ev) => {
			if (ev.target instanceof HTMLInputElement && ev.target.classList.contains("hw-chip-rename")) {
				setTimeout(renderRotationSet, 0);
			}
		});
		// A press selects the member under the pointer at once, before the
		// list takes focus, so the focus rule below never picks another one.
		rotationSetEl.addEventListener("pointerdown", (ev) => {
			const option = ev.target instanceof Element ? ev.target.closest('.hw-set-list [role="option"]') : null;
			if (option === null) return;
			selectRotationMember(option.dataset.key, option.dataset.group === undefined ? null : Number(option.dataset.group));
		});
		// A list that takes focus with nothing selected in it selects its
		// first member, so its keys and the toolbar act on what it shows.
		rotationSetEl.addEventListener("focusin", (ev) => {
			const list = ev.target instanceof Element && ev.target.matches(".hw-set-list") ? ev.target : null;
			if (list === null || list.querySelector('[aria-selected="true"]') !== null) return;
			const first = list.querySelector('[role="option"]');
			if (first !== null) selectRotationMember(first.dataset.key, first.dataset.group === undefined ? null : Number(first.dataset.group));
		});
		// A double click on a member renames it (the pointer's shortcut to
		// the toolbar's Rename).
		rotationSetEl.addEventListener("dblclick", (ev) => {
			const option = ev.target instanceof Element ? ev.target.closest('.hw-set-list [role="option"]') : null;
			if (option === null) return;
			selectRotationMember(option.dataset.key, option.dataset.group === undefined ? null : Number(option.dataset.group));
			startRotationRename();
		});
		rotationSetEl.addEventListener("keydown", (ev) => {
			if (ev.key === "Enter" && ev.target instanceof HTMLInputElement && ev.target.classList.contains("hw-group-name")) {
				const renaming = ev.target.classList.contains("hw-chip-rename");
				const groupIndex = ev.target.dataset.group;
				ev.target.blur();
				renderRotationSet();
				// A committed rename hands focus back to the member's list; a
				// committed group name keeps it on that name field.
				if (renaming) rotationSetEl.querySelector(`.hw-set-list[data-group="${rotationSel === null || rotationSel.group === null ? "" : rotationSel.group}"]`)?.focus({ preventScroll: true });
				else rotationSetEl.querySelector(`.hw-group-name[data-group="${groupIndex}"]:not(.hw-chip-rename)`)?.focus({ preventScroll: true });
				return;
			}
			if (ev.key === "Escape" && ev.target instanceof HTMLInputElement && ev.target.classList.contains("hw-chip-rename")) {
				// Abandon the rename: nothing is written, the name returns. (The
				// app never delivers Escape; blur without an edit does the same.)
				ev.preventDefault();
				ev.target.value = readingNameOf(ev.target.dataset.key) ?? "";
				ev.target.blur();
				renderRotationSet();
				rotationSetEl.querySelector(".hw-set-list")?.focus({ preventScroll: true });
				return;
			}
			// The toolbar: arrow keys move between its buttons (one Tab stop).
			if (ev.target instanceof Element && ev.target.matches(".hw-set-tools button")) {
				const buttons = [...rotationTools.querySelectorAll("button")];
				const at = buttons.indexOf(ev.target);
				const to = { ArrowLeft: at - 1, ArrowRight: at + 1, Home: 0, End: buttons.length - 1 }[ev.key];
				if (to === undefined) return;
				ev.preventDefault();
				const next = buttons[(to + buttons.length) % buttons.length];
				for (const button of buttons) button.tabIndex = button === next ? 0 : -1;
				next.focus();
				return;
			}
			// A list: arrows select (selection follows focus), Home and End
			// jump; Alt with an arrow moves the selected member and F2 renames
			// it, as shortcuts for the toolbar (never the only way).
			const list = ev.target instanceof Element && ev.target.matches(".hw-set-list") ? ev.target : null;
			if (list === null) return;
			const options = [...list.querySelectorAll('[role="option"]')];
			const at = options.findIndex((o) => o.getAttribute("aria-selected") === "true");
			if (ev.altKey && (ev.key === "ArrowUp" || ev.key === "ArrowLeft" || ev.key === "ArrowDown" || ev.key === "ArrowRight")) {
				ev.preventDefault();
				if (at >= 0) moveSelectedRotation(ev.key === "ArrowUp" || ev.key === "ArrowLeft" ? -1 : 1, { fromList: true });
				return;
			}
			if (ev.altKey && (ev.key === "Home" || ev.key === "End")) {
				ev.preventDefault();
				if (at >= 0) moveSelectedRotation(ev.key === "Home" ? -1 : 1, { fromList: true, edge: true });
				return;
			}
			// F2 and Delete act on THIS list's selection only (focusing a list
			// selects in it, so there always is one).
			if (ev.key === "F2") {
				ev.preventDefault();
				if (at >= 0) startRotationRename();
				return;
			}
			// Delete removes the selected member (APG rearrangeable listbox);
			// ticking it again in the search puts it back. One press removes
			// one: a held key's repeats do nothing.
			if (ev.key === "Delete") {
				ev.preventDefault();
				if (at >= 0 && !ev.repeat) removeSelectedRotation();
				return;
			}
			const to = { ArrowDown: at + 1, ArrowRight: at + 1, ArrowUp: at - 1, ArrowLeft: at - 1, Home: 0, End: options.length - 1 }[ev.key];
			if (to === undefined || options.length === 0) return;
			ev.preventDefault();
			const target = options[Math.max(0, Math.min(options.length - 1, to))];
			selectRotationMember(target.dataset.key, target.dataset.group === undefined ? null : Number(target.dataset.group));
		});
		// The position announcements speak from the first move on.
		hw.announce("rotation-order", "");
		rotationBinding[0]().then(adoptRotationKeys);
		groupsBinding[0]().then(adoptRotationGroups);
		namesBinding[0]().then(adoptRotationNames);
		rotationPicker?.init();
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
			const out = Object.fromEntries(Object.keys(doc ?? {}).sort().map((field) => [field, doc[field]]));
			return JSON.stringify(out, null, "\t");
		};
		const say = (text) => {
			configNote.hidden = false;
			configNote.textContent = text;
		};
		// A hand-edit marks its well dirty; a fill takes the mark back off.
		// Copy refreshes an untouched well first, so the backup is the
		// settings of the moment the button is pressed, not of fold-open.
		// A dirty well copies the draft exactly as typed.
		const dirty = new WeakSet();
		const fills = new WeakMap();
		for (const well of [configKeyEl, configDeckEl]) {
			well.addEventListener("input", () => dirty.add(well));
		}
		const fillWell = async (el) => {
			const request = {};
			fills.set(el, request);
			// The shell's copy is the newest document the panel has seen or
			// written, once the panel is connected (the key's) or the first
			// shared document has arrived. Asking the app again would hand
			// its answer to every control, and a late answer rolled them
			// back to an older document (external review AX77).
			// Every reading key goes out wearing its friendly name; apply
			// takes the names back off, so nothing stale is ever stored.
			const doc = el === configKeyEl ? (await streamDeckClient.getConnectionInfo(), hw.state.settings) : (await hw.globalsReady, hw.state.globals);
			// A late reply cannot replace a draft or a newer read of this well.
			if (dirty.has(el) || fills.get(el) !== request) return;
			el.value = canonical(el === configKeyEl ? mapReadingKeys(doc, namedKey) : doc);
			dirty.delete(el);
		};
		// A well the user has typed into keeps its draft: reopening the fold is
		// not a reason to throw hand-typed JSON away, and the draft is the one
		// place a reading link is authored. The two wells fill independently,
		// so a key read that never resolves cannot leave the deck well empty.
		const fill = async () => {
			await Promise.all([configKeyEl, configDeckEl].filter((el) => !dirty.has(el)).map(fillWell));
		};
		// Filling writes nothing; it happens when a fold around the wells
		// opens (Advanced, or its Configuration documents group), and an
		// untouched well follows every change to its document, so Replace
		// never writes back the document of the moment it was filled
		// (review of d17).
		for (const fold of [document.querySelector('details[data-fold="advanced"]'), document.getElementById("sec-config")]) {
			fold?.addEventListener("toggle", () => {
				if (fold.open) fill();
			});
		}
		// Not while the well has focus, though: a refill puts the caret at the
		// end, and an auto-cycling dial changes its document every few
		// seconds, so text typed after placing the cursor landed at the end.
		// The well catches up when focus moves elsewhere in the panel (leaving
		// the whole window keeps it on the well, so it waits for that), and
		// Copy and Replace refresh an untouched well first, so neither ever
		// uses an older document.
		const follow = (el) => {
			if (!dirty.has(el) && document.activeElement !== el) fillWell(el);
		};
		hw.on("settings", () => follow(configKeyEl));
		hw.on("globals", () => follow(configDeckEl));
		for (const well of [configKeyEl, configDeckEl]) well.addEventListener("blur", () => follow(well));
		const copy = (el) => async () => {
			if (!dirty.has(el)) {
				await fillWell(el);
			}
			let ok = true;
			try {
				await navigator.clipboard.writeText(el.value);
			} catch {
				el.select();
				ok = document.execCommand("copy");
			}
			say(ok ? "Copied." : "Copy failed; select the text and copy by hand.");
		};
		const apply = (el, write, what, confirmFirst) => {
			const button = el === configKeyEl ? document.getElementById("config-key-apply") : document.getElementById("config-deck-apply");
			const label = button?.textContent ?? "";
			// Armed until the person leaves the button or edits the document.
			// No timer: the spoken confirmation alone takes about as long as
			// the old five-second window, so a screen reader user missed it.
			let armedAt = 0;
			let armedValue = ""; // the document the arm was for
			// Leaving the button or editing the well disarms, and the note
			// then says nothing happened, so no stale "press again" stays
			// behind (round 3, R09).
			const disarm = (confirmed = false) => {
				if (armedAt === 0) return;
				armedAt = 0;
				if (button !== null) {
					button.dataset.armed = "false";
					button.textContent = label;
				}
				if (!confirmed) say("Not replaced. Nothing was changed.");
			};
			button?.addEventListener("blur", () => disarm());
			el.addEventListener("input", () => disarm());
			return async (ev) => {
				const detail = ev.detail;
				const pressedAt = performance.now();
				if (!dirty.has(el)) await fillWell(el);
				let doc;
				try {
					doc = JSON.parse(el.value);
				} catch (err) {
					say(`Refused: not JSON (${err.message}). Nothing was changed.`);
					return;
				}
				if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
					say("Refused: the document must be one JSON object. Nothing was changed.");
					return;
				}
				// The shared document reaches every key and dial: the first
				// press only arms, and says so; a second press replaces it. A
				// press within 450 ms of arming, or the second click of a double
				// click however slow (AX13), is ignored, so a double click only
				// arms.
				// A document that changed since the arm, even without typing (a
				// refill), is a new first press: the arm names one exact text.
				if (confirmFirst && (armedAt === 0 || el.value !== armedValue)) {
					armedAt = performance.now();
					armedValue = el.value;
					if (button !== null) {
						button.dataset.armed = "true";
						button.textContent = "Press again to replace for all keys and dials";
					}
					say("This replaces the shared settings every HWiNFO key and dial uses. Press again to confirm.");
					return;
				}
				if (confirmFirst && (detail > 1 || pressedAt - armedAt < 450)) return;
				disarm(true);
				// Names come off here, whether this build wrote them or a person
				// typed them: what lands in settings is keys alone. A document
				// that never carried a name passes through unchanged.
				write(mapReadingKeys(doc, bareKey));
				say(`Replaced the ${what} settings; reloading the panel.`);
				setTimeout(() => window.location.reload(), 350);
			};
		};
		document.getElementById("config-key-copy")?.addEventListener("click", copy(configKeyEl));
		document.getElementById("config-deck-copy")?.addEventListener("click", copy(configDeckEl));
		document.getElementById("config-key-apply")?.addEventListener("click", apply(configKeyEl, (doc) => streamDeckClient.setSettings(doc), hw.kind === "dial" ? "dial" : "key", false));
		document.getElementById("config-deck-apply")?.addEventListener("click", apply(configDeckEl, (doc) => streamDeckClient.setGlobalSettings(doc), "shared", true));
	}

	// --- section summaries --------------------------------------------------
	// Each summary names the EFFECTIVE result, from the plugin's resolved
	// `effective` block where the runtime decides (theme drawn, text
	// precedence, parsed thresholds and scope, controls), from exact stored
	// markers otherwise. Rendered by the shell on settings, echoes, previews
	// and tree changes; a tick that changes nothing rewrites nothing.
	const labelFor = (key) => readingLabelOf(key);
	if (hw.kind === "key" || hw.kind === "dial") {
		hw.summary("reading", (st) => model.readingSummary(hw.kind, st.settings, st.preview, labelFor));
		hw.summary("display", (st) => model.displaySummary(hw.kind, st.settings, st.globals, st.preview));
		hw.summary("alerts", (st) => model.alertsSummary(hw.kind, st.settings, st.preview));
		hw.summary("interaction", (st) => (hw.kind === "key" ? model.keyInteractionSummary(st.settings, detailsSupported) : model.dialInteractionSummary(st.settings, st.preview)));
		hw.summary("advanced", (st) => model.advancedSummary(st.globals));
		hw.summary("shared", (st) => model.sharedDefaultsSummary(st.globals, themesConfig === null ? undefined : resolvedDeckId()));
		hw.summary("connection", (st) => model.connectionSummary(st.globals));
	}

	requestTree();
})();
