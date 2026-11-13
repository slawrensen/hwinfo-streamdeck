/* The Sensor Dial panel's Strip section: layout, the dials taking part
   (one row of marks, one per dial, and one status line; a dial's own row
   and action show when its mark is chosen), Build screens (this PC's
   screens, ticked, with one button), readings and graph per pane, and the
   plugin's own preview slices.

   On a running strip every control acts at once: a change is sent to the
   plugin as a stripEdit with the revision this panel shows, and the panel
   then shows the copy the plugin wrote back, so what it shows is what the
   strip draws. The plugin is the only writer of a dial's stripGroup. A
   change made while one is on its way waits and follows it. A stale
   revision (another dial's panel changed the strip first) or a refused
   change is said in the status line, and the panel shows the plugin's
   copy again; nothing is dropped without a word.

   Making a strip keeps its own button (Make the strip): an independent
   dial where the strip can be made offers Build screens' list first,
   ticked, and that button builds it, as it does for a Whole strip being
   made. The words that name the start are a quiet dropdown where there is
   a choice: Screens for this PC or One reading only (today's strip of
   this dial's reading), and for an Equal split this PC's pairs, the first
   that fits picked, or Choose each half. A running Equal split offers the
   pairs as Fill both halves: a preview until Use writes it in one edit;
   over a half a person made, Use first asks in words (Cancel, Replace).
   Leaving one is a layout choice like the others: Independent dials sends the leave at once, and the
   dial that left says so on one line ending in Rejoin and, while other
   dials of the strip are still in it here, Every dial leaves (else
   Restore the strip). While the strip still runs here, choosing Whole
   strip or Equal split on the dial that left rejoins it, as Rejoin does,
   and the strip then takes the layout chosen. A new strip's screens are
   mirrored into the plugin's memory
   as a draft (stripGet with a draft) for the preview only; it follows a
   person from one dial's panel to another's until it is made, dropped or
   ten minutes old. Opening, browsing and previewing send only stripGet.
   Loaded after pi-common.js, which lends its reading checklist. */
/* global SDPIComponents, hwShell, hwStripModel, hwT */
(() => {
	"use strict";

	/** A panel string (ui/pi-strings.js, catalog key pi.*), or the English
	 * written here when that script is not loaded (a unit test that runs
	 * this file alone). */
	const T = (key, english, params) => (typeof hwT === "function" ? hwT(key, english, params) : english.replace(/\{(\w+)\}/g, (whole, name) => (params !== undefined && Object.hasOwn(params, name) ? String(params[name]) : whole)));

	const hw = hwShell;
	const section = document.getElementById("sec-strip");
	if (hw.kind !== "dial" || section === null) return;
	const model = hwStripModel;
	const { streamDeckClient: client } = SDPIComponents;
	const $ = (id) => document.getElementById(id);
	const isDoc = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
	const clone = (v) => JSON.parse(JSON.stringify(v));
	const newId = () => `s${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;

	const ui = {
		radios: Array.from(document.querySelectorAll('input[name="strip-layout"]')),
		map: $("strip-map"),
		device: $("strip-device"),
		slots: $("strip-slots"),
		detail: $("strip-slot-detail"),
		restore: $("strip-restore"),
		restoreText: $("strip-restore-text"),
		rejoin: $("strip-rejoin"),
		leaveAll: $("strip-leave-all"),
		restoreAll: $("strip-restore-all"),
		resolve: $("strip-resolve"),
		resolveText: $("strip-resolve-text"),
		keepGroup: $("strip-keep-group"),
		useDial: $("strip-use-dial"),
		retarget: $("strip-retarget"),
		retargetText: $("strip-retarget-text"),
		retargetGo: $("strip-retarget-go"),
		edit: $("strip-edit"),
		// Build screens: the links, the list and its one button.
		build: $("strip-build"),
		buildBox: $("strip-build-box"),
		buildHead: $("strip-build-head"),
		buildTitle: $("strip-build-title"),
		buildList: $("strip-build-list"),
		buildUse: $("strip-build-use"),
		buildNo: $("strip-build-no"),
		links: $("strip-links"),
		window: $("strip-window"),
		windowItem: $("strip-window").closest(".hw-field"),
		sharedItem: $("strip-shared-item"),
		shared: $("strip-shared"),
		// Screens (a Whole strip, when the plugin reports them).
		cycleItem: $("strip-cycle-item"),
		cycle: $("strip-cycle"),
		screensBox: $("strip-screens"),
		screenLabel: $("strip-screen-label"),
		pick: $("strip-screen-pick"),
		screenPrev: $("strip-screen-prev"),
		screenSelect: $("strip-screen-select"),
		screenName: $("strip-screen-name"),
		screenNext: $("strip-screen-next"),
		screenPlace: $("strip-screen-place"),
		screenEdit: $("strip-screen-edit"),
		screenTools: $("strip-screen-tools"),
		addScreen: $("strip-add-screen"),
		link: $("strip-link"),
		linkSum: $("strip-link-sum"),
		moreSum: $("strip-more-sum"),
		gapMode: $("strip-gap-mode"),
		gapModeItem: $("strip-gap-mode-item"),
		preview: $("strip-preview"),
		shots: $("strip-shots"),
		caption: $("strip-caption"),
		// The caption's line, and what names a strip's start on it: a strip
		// being made (the start dropdown, also the first words of Build's
		// title) and a running Equal split (Fill both halves).
		capline: $("strip-capline"),
		capctl: $("strip-capctl"),
		startPick: $("strip-start-pick"),
		start: $("strip-start"),
		startText: $("strip-start-text"),
		fillPick: $("strip-fill-pick"),
		fill: $("strip-fill"),
		fillText: $("strip-fill-text"),
		fillOne: $("strip-fill-one"),
		fillUse: $("strip-fill-use"),
		fillCancel: $("strip-fill-cancel"),
		// What Use asks before Fill replaces a half a person made.
		fillAsk: $("strip-fill-ask"),
		fillAskText: $("strip-fill-ask-text"),
		fillAlso: $("strip-fill-also"),
		fillNo: $("strip-fill-no"),
		fillYes: $("strip-fill-yes"),
		note: $("strip-note"),
		bar: $("strip-bar"),
		go: $("strip-go"),
		controls: $("strip-controls")
	};
	const panes = [0, 1].map((i) => ({
		index: i,
		box: $(`sp${i}`),
		name: $(`sp${i}-name`),
		extra: $(`sp${i}-extra`),
		extraName: $(`sp${i}-extra-name`),
		style: $(`sp${i}-style`),
		styleItem: $(`sp${i}-style`).closest(".hw-field"),
		readout: $(`sp${i}-readout`),
		series: $(`sp${i}-series`),
		check: $(`sp${i}-check`),
		windowItem: $(`sp${i}-window-item`),
		window: $(`sp${i}-window`),
		overlays: Array.from(document.querySelectorAll(`#sp${i}-overlays input[data-overlay]`)),
		min: $(`sp${i}-min`),
		max: $(`sp${i}-max`),
		bands: $(`sp${i}-bands`),
		bandAdd: $(`sp${i}-band-add`),
		// The Group style's controls (a rule, not a list of readings).
		viewItem: $(`sp${i}-view-item`),
		view: $(`sp${i}-view`),
		// The Unit a rule takes every reading in.
		unitItem: $(`sp${i}-unit-item`),
		unit: $(`sp${i}-unit`),
		overlaysBox: $(`sp${i}-overlays`),
		bandsItem: $(`sp${i}-bands`).closest(".hw-field"),
		readoutItem: $(`sp${i}-readout-item`),
		// Meters' Look: Thin bar, Full bar or Liquid.
		lookItem: $(`sp${i}-look-item`),
		look: $(`sp${i}-look`),
		fromItem: $(`sp${i}-from-item`),
		from: $(`sp${i}-from`),
		filterItem: $(`sp${i}-filter-item`),
		filter: $(`sp${i}-filter`),
		label: $(`sp${i}-label`),
		pickerBox: $(`sp${i}-picker`),
		help: $(`sp${i}-help`),
		scaleRow: $(`sp${i}-scale-row`),
		scaleHelp: $(`sp${i}-scale-help`),
		scaleTags: [...$(`sp${i}-scale-row`).querySelectorAll("[data-scale-unit]")],
		picker: null
	}));
	/** A pane that draws a rule's readings: Group or Ambient. */
	const isGroup = (p) => model.isRuleStyle(p.style);
	/** Meters and Events lay out their own pane: no Readout. */
	const ownLayout = (p) => model.OWN_LAYOUT.includes(p.style);
	/** What a pane's readings are checked against: its bands and its dial
	 * slots (Meters draws one reading a slot). */
	const ctxOf = (pane, p) => ({ bands: p.bands, slots: model.paneColumns(working?.layout ?? "whole", encoders() || 6, pane.index).length, readout: p.readout });
	/** Why a style is not offered, in its option's own words. */
	const OFFER_WORDS = {
		limits: () => T("pi.strip.styleEventsLimits", "Events · Yes/No or readings with limits"),
		units: () => T("pi.strip.styleCompareUnits", "Compare · readings in one unit")
	};
	/** A rule pane's rule as shown (a new one when the pane has none: an
	 * Ambient pane takes every reading in its first reading's unit). */
	const ruleOf = (p) => {
		if (p.group === null || p.group === undefined) p.group = p.style === "ambient" ? model.NEW_AMBIENT(readingOf(p.series[0]?.key ?? "").unit) : model.NEW_GROUP();
		return p.group;
	};
	/** The units of this PC's readings with their counts, from the panel's
	 * sensor list, in first-seen order (a Unit rule's choices). */
	const unitChoices = () => {
		const counts = new Map();
		for (const group of hw.state.tree?.groups ?? []) {
			for (const r of Array.isArray(group.readings) ? group.readings : []) {
				const unit = typeof r.unit === "string" ? r.unit : "";
				if (unit === "" || unit === "Yes/No") continue;
				counts.set(unit, (counts.get(unit) ?? 0) + 1);
			}
		}
		return [...counts];
	};

	// --- state ------------------------------------------------------------------
	let st = null; // the plugin's latest stripState for this dial
	let choice = "independent"; // the layout radio: "independent" | "whole" | "split" (syncChoice)
	let leaving = false; // Independent dials chosen on a running strip: the leave is on its way (or follows the change on its way)
	let leaveOwed = false; // that leave waits for the change on its way to be answered
	let owed = null; // { op, payload }: a choice pressed while a change was on its way (requestNext), sent once it is answered
	let newLayout = null; // "whole" | "split" chosen on a dial with no running strip: a strip to make
	let rejoinLayout = null; // "whole" | "split" chosen on the dial that left a strip still running here: the rejoin is on its way, then the strip takes that layout
	let working = null; // a running strip as shown: the plugin's copy (model.workingOf), plus band rows with no number yet
	let shownRev = 0; // the revision `working` was read from
	let make = null; // a new strip's screens: { patch } (Build screens' operations for its ticks), or null
	let draftSent = false; // the plugin holds a new-strip draft for this dial
	let memoAdopted = false; // a remembered new-strip draft was taken over once
	const take = new Set(); // columns ticked to move from another strip
	let pending = null; // { opId, op, columns, timer }
	let queued = []; // edit operations made while one is on its way
	let resultNote = null; // { tone, lines } from the last answer
	let proposal = null; // Build screens' list on show: { running, screens, skipped, start, fits, unticked }, or null
	let declined = false; // One reading only: this panel makes a Whole strip of one reading, until Screens for this PC is picked
	let remembered = null; // the proposals ticked in a draft remembered from another dial's panel, until this panel's list takes them
	let newStripList = null; // Build's list for a new strip on this PC: { from, slots, screens }, made once per sensor list
	let splitPick = null; // the start of an Equal split being made: a pair's id, or "own" (each half chosen); null is this PC's first pair
	let rememberedSplit = null; // an Equal split's operations remembered from another dial's panel, until this panel's pairs name its pick
	let splitList = null; // this PC's pairs for an Equal split: { from, slots, starts }, made once per sensor list
	let fillPick = null; // the pair previewed on a running Equal split, until Use writes it or Cancel drops it
	let fillRev = 0; // the revision that preview was made over
	let fillAsking = null; // { start, ops, rev, asks }: Use asked before Fill replaces a half a person made, until Cancel, Replace, focus leaving or a newer copy
	let justMade = false; // a strip was made here, and the state that shows it is on its way
	let revealed = null; // the dial (column) whose line shows under the dial row
	let rovingColumn = null; // the dial mark that takes the row's Tab stop
	let themesInfo = null; // the plugin's last themes payload, for the strip's accent
	const invalidText = new Map(); // id of a typed field -> why it was not sent
	let foldUntouched = false; // the plugin remembers no fold for this section
	// Screens. The plugin reports them with its strip state (null: no group,
	// and the section shows none). The screen the list
	// chooses is the screen on the strip and the screen the box edits: one
	// truth.
	let screens = null; // model.screensOf(st)
	let shownConfig = null; // the stored copy `working` was read from
	let pendingShow = null; // { id, at }: a screen this panel asked the strip to show, until the plugin's state names it
	const SHOW_WAIT_MS = 1500;
	const structural = []; // list changes made while an edit was on its way; each builds its operation when it goes
	let structuralAfter = null; // what the answer to the list change on its way does next
	let renaming = null; // the id of the screen whose name field takes the list's place
	let armedRemove = null; // { id, at }: Remove pressed once for this screen
	let focusFilterSoon = false; // a screen was added: its Filter takes focus once it shows

	const send = (payload) => client.send("sendToPlugin", payload);
	const ask = (extra = {}) => send({ event: "stripGet", requestId: newId(), ...extra });
	const live = () => st !== null && st.self?.joined === true && st.group?.live === true && isDoc(st.group.config);
	const encoders = () => (st?.device?.strip === true ? st.device.encoders : 0);
	const liveLayout = () => (live() && st.group.config.layout === "split" ? "split" : "whole");
	/** A running strip, shown and edited in place. */
	const editing = () => live() && !leaving && working !== null;
	/** A strip being made: a layout chosen on a dial with no running strip. */
	const making = () => st !== null && st.device?.strip === true && !live() && newLayout !== null;
	/** This dial left a strip that still runs on this deck, and holds that
	 * strip's own copy (not a different one): a layout chosen here rejoins. */
	const leftLive = () => st !== null && st.self?.joined === false && typeof st.self?.groupId === "string" && st.self.foreign === null && st.group?.live === true;
	/** The layout radio: the running strip's layout (as shown), Independent
	 * dials while this dial's leave is on its way, the layout chosen while
	 * this dial rejoins, or the layout of a strip being made. */
	function syncChoice() {
		if (live()) choice = leaving ? "independent" : (working?.layout ?? liveLayout());
		else {
			leaving = false;
			leaveOwed = false;
			choice = rejoinLayout ?? newLayout ?? "independent";
		}
	}

	function readingOf(key) {
		const entry = hw.pickers?.treeEntryOf(key) ?? null;
		return entry === null ? { key, label: key, unit: undefined, source: "", found: false } : { key, label: entry.reading.label, unit: entry.reading.unit ?? "", source: entry.group.name, found: true };
	}

	/** The units a pane's Scale from and Scale to speak for: each drawn
	 * reading's native unit and its unit on view, and the unit on view of
	 * the reading a typed end is stamped with (the first that is not Yes/No;
	 * a data unit stays HWiNFO's). */
	function scaleUnitsOf(p) {
		// The strip's °F as the rest of the section shows it.
		const fahrenheit = isDoc(st?.group?.config) && st.group.config.fahrenheit === true;
		const raw = p.series.slice(0, model.SERIES_LIMITS[p.style]?.max ?? 1).map((s) => readingOf(s.key).unit);
		const units = raw.filter((u) => typeof u === "string");
		const stamp = model.stampUnitOf(units);
		return { units, views: units.map((u) => model.displayUnit(u, fahrenheit)), view: stamp === undefined ? undefined : model.displayUnit(stamp, fahrenheit) };
	}

	/** A number as its field shows it: as stored, or converted (at most
	 * three decimals). */
	const fieldText = (shown, stored) => (shown === undefined ? "" : shown === stored ? String(stored) : model.shownNumber(shown));

	/** A working copy as the plugin receives it: a band with no number yet
	 * stays in this panel (the plugin refuses an empty band). */
	function forPatch(w) {
		const out = clone(w);
		for (const pane of out.panes) pane.bands = pane.bands.filter((b) => typeof b.warn === "number" || typeof b.crit === "number");
		return out;
	}

	// --- screens: which one the box edits -------------------------------------------
	/** The screen list of a copy: the config's, with the plugin's names. */
	const screenListIn = (config) => model.screenListOf(config, screens?.list ?? []);
	const screenList = () => screenListIn(shownConfig ?? st?.group?.config);
	/** The screen on the strip: the one this panel asked for until the
	 * plugin's state names it, else the plugin's. */
	const viewId = () => pendingShow?.id ?? screens?.currentId ?? null;
	/** The place of the screen on the strip in `list` (the first while
	 * split: a split strip draws panes[0] and keeps its screens). */
	function viewIndexIn(list, config) {
		if (screens === null || (isDoc(config) && config.layout === "split")) return 0;
		const i = model.screenIndexOf(list, viewId());
		return i < 0 ? 0 : i;
	}
	/** Screens apply to a running Whole strip whose plugin reports them. */
	const screensOn = () => editing() && working.layout === "whole" && screens !== null;
	/** The screen the box edits, for `config` and the plugin's screens
	 * `told`: the one on the strip, or the first while split. */
	function boxIdIn(config, told) {
		if (told === null) return null;
		if (isDoc(config) && config.layout === "split") return model.screenListOf(config, told.list)[0]?.id ?? null;
		return pendingShow?.id ?? told.currentId;
	}

	/** Shows a copy of the plugin's: `config` at `rev`, the box on the
	 * screen on the strip. Band rows still waiting for a number stay where
	 * they were, on their own screen. */
	function show(config, rev) {
		const list = screens === null ? [] : screenListIn(config);
		const index = viewIndexIn(list, config);
		const fresh = model.workingOf(config, { screen: index });
		fresh.screenId = screens === null ? null : (list[index]?.id ?? null);
		// Pane 0's rows wait on their screen: another screen shown drops them.
		const kept = working === null ? [] : working.screenId === fresh.screenId ? [0, 1] : [1];
		for (const i of kept) {
			const keys = new Set(fresh.panes[i].series.map((s) => s.key));
			for (const band of working.panes[i].bands) {
				if (typeof band.warn === "number" || typeof band.crit === "number" || !keys.has(band.key) || fresh.panes[i].bands.length >= model.MAX_BANDS) continue;
				fresh.panes[i].bands.push(band);
			}
			const waiting = working.panes[i].group?.limits;
			const pane = fresh.panes[i];
			if (pane.group !== null && pane.group.limits === undefined && waiting !== undefined && typeof waiting.warn !== "number" && typeof waiting.crit !== "number") pane.group.limits = waiting;
		}
		working = fresh;
		shownRev = rev;
		shownConfig = config;
	}

	/** The box's draft of another screen, from the copy in hand (typed
	 * text sent after the strip moved on), or null when it is gone. */
	function draftFor(screenId) {
		const config = shownConfig ?? st?.group?.config;
		const index = model.screenIndexOf(screenListIn(config), screenId);
		if (index < 0) return null;
		const draft = model.workingOf(config, { screen: index });
		draft.screenId = screenId;
		return draft;
	}

	/** Operations with the screen they were made for (null: none, a field
	 * of the whole strip or the right half). */
	const tagOps = (ops, screenId) => ops.map((op) => ({ op, screenId: screenId !== null && screenId !== undefined && model.screenPathOf(op.path) !== null ? screenId : null }));

	/** Each operation made for a screen goes where that screen sits in the
	 * copy in hand now; one whose screen is gone is dropped. */
	function resolveOps(entries) {
		if (screens === null) return entries.map((e) => e.op);
		const list = screenList();
		const out = [];
		for (const { op, screenId } of entries) {
			if (screenId === null) {
				out.push(op);
				continue;
			}
			const index = model.screenIndexOf(list, screenId);
			if (index >= 0) out.push(model.retargetOp(op, index));
		}
		return out;
	}

	/** The plugin's copy, unless a change of this panel is on its way (its
	 * answer brings the copy) or the strip is not running here. */
	function adoptLive() {
		if (!live()) {
			working = null;
			shownRev = 0;
			shownConfig = null;
			return;
		}
		if (pending !== null || queued.length > 0) {
			// A change on its way brings the copy; the box still follows the
			// screen on the strip at once, from the copy it holds.
			const config = shownConfig ?? st.group.config;
			if (screens !== null && working !== null && working.screenId !== boxIdIn(config, screens)) show(config, shownRev);
			return;
		}
		show(st.group.config, st.group.rev);
	}

	// --- the plugin's answers -----------------------------------------------------
	hw.on("stripState", (p) => {
		const next = model.screensOf(p);
		if (pendingShow !== null && (next === null || next.currentId === pendingShow.id || performance.now() - pendingShow.at > SHOW_WAIT_MS)) pendingShow = null;
		// The strip moved to another screen: what was typed for the screen
		// the box showed is sent to that screen first.
		const nextBox = boxIdIn(isDoc(p?.group?.config) ? p.group.config : null, next);
		if (working !== null && next !== null && working.screenId !== nextBox && typedInputs.size > 0) textFlush();
		if (armedRemove !== null && armedRemove.id !== nextBox) disarmRemove();
		// The deck moved the strip (a turn, a Control key, the cycle), not
		// this panel: said while focus is in the list.
		if (next !== null && screens !== null && pendingShow === null && next.currentId !== screens.currentId) deckMoved = true;
		st = p;
		justMade = false;
		// The leave was answered: from now on the radio shows what this
		// state says.
		if (leaving && pending === null && !leaveOwed) leaving = false;
		screens = next;
		adoptLive();
		if (live()) newLayout = null;
		// The rejoin was answered: the dial is back, and a layout other than
		// the strip's, chosen to rejoin, goes as one edit. Its note stays.
		if (rejoinLayout !== null && pending === null) {
			const layout = rejoinLayout;
			rejoinLayout = null;
			if (editing() && working.layout !== layout) {
				const said = resultNote;
				change((w) => {
					w.layout = layout;
				});
				resultNote = said;
			}
		}
		// A new-strip draft remembered from another dial's panel (or this one
		// before a reload) is taken over once.
		if (!memoAdopted && !live() && isDoc(p.draft) && p.device?.strip === true) {
			newLayout = p.draft.layout === "split" ? "split" : "whole";
			const patch = Array.isArray(p.draft.patch) ? p.draft.patch : [];
			make = patch.length > 0 ? { patch } : null;
			// Its ticks come back with it; a Whole strip with no screens is one
			// the person chose One reading only for; an Equal split's pick is
			// named once this panel knows its pairs (syncSplit).
			remembered = model.originsOfOps(patch);
			declined = newLayout === "whole" && patch.length === 0;
			rememberedSplit = newLayout === "split" ? patch : null;
			memoAdopted = true;
			// This dial previews it too (the plugin keeps a draft per panel).
			mirrorDraft();
		}
		memoAdopted = true;
		if (foldUntouched && p.self?.joined === true && !section.open) {
			// A member's panel shows its strip first; a reveal, not a fold the
			// person chose, so it is not remembered.
			foldUntouched = false;
			section.open = true;
		}
		render();
	});

	hw.on("stripEditResult", (p) => {
		if (pending === null || p.opId !== pending.opId) return;
		const { op, columns } = pending;
		clearTimeout(pending.timer);
		pending = null;
		if (p.ok === true && op === "edit") {
			if (typeof p.rev === "number") shownRev = p.rev;
			// Operations still to go find their screens in the newest copy.
			if (isDoc(p.config)) shownConfig = p.config;
			// What changed meanwhile goes now, against the new revision, with
			// what was typed since.
			flushTyped();
			if (sendQueued()) return;
			if (isDoc(p.config)) show(p.config, shownRev);
			if (Array.isArray(p.unwritten) && p.unwritten.length > 0) resultNote = { tone: "warn", lines: [unwrittenLine(p.unwritten)] };
			// A screen added, removed or moved: what follows from it (the new
			// screen shown, its Filter focused), then the next list change.
			const after = structuralAfter;
			structuralAfter = null;
			if (after !== null && isDoc(p.config)) after(p.config);
			if (pending === null) nextStructural();
			// Independent dials was chosen meanwhile: the leave goes now.
			if (pending === null && leaveOwed) leaveNow();
			sendOwed();
			render();
			return;
		}
		if (p.ok === true) {
			const lines = [];
			if (op === "leave") {
				// The dial's own line says it left (renderRestore); the note
				// only says what could not be changed. Dials off screen keep
				// their copy and come back in the strip.
				if (pendingLeaveAll && typeof p.offscreen === "number" && p.offscreen > 0) lines.push(p.offscreen === 1 ? "1 dial of this strip was not on screen and was not changed." : `${p.offscreen} dials of this strip were not on screen and were not changed.`);
			} else if (op === "create") lines.push(T("pi.strip.madeTheStrip", "The strip is made. Every change here now applies at once."));
			else if (op === "restore" || op === "join") lines.push(backLine(op, columns));
			else if (op === "resolve") lines.push("Settled. The strip runs from the setup you chose.");
			else lines.push("Applied.");
			if (Array.isArray(p.unwritten) && p.unwritten.length > 0) lines.push(unwrittenLine(p.unwritten));
			resultNote = lines.length === 0 ? null : { tone: op === "leave" ? "warn" : "ok", lines };
			hw.announce("strip", op === "leave" ? [T("pi.strip.dialLeft", "Dial {n} left the strip", { n: (st?.self?.column ?? 0) + 1 }), ...lines].join(". ") : lines[0], { repeat: true });
			if (op === "create") {
				// The plugin forgot the new-strip draft when it made the strip.
				make = null;
				newLayout = null;
				draftSent = false;
				take.clear();
				proposal = null;
				declined = false;
				splitPick = null;
				rememberedSplit = null;
				justMade = !live();
				if (isDoc(p.config)) {
					working = null;
					show(p.config, typeof p.rev === "number" ? p.rev : 1);
				}
			}
			// This dial's leave holds the radio on Independent dials until
			// the state that answers this ask (the stripState handler).
			ask();
			if (leaveOwed) leaveNow();
			else if (editing()) {
				// A change made while this was on its way goes now, over the
				// copy this answer names.
				if (p.groupId === st.self.groupId && typeof p.rev === "number" && isDoc(p.config)) {
					shownRev = p.rev;
					shownConfig = p.config;
				}
				if (!sendQueued()) nextStructural();
			}
			sendOwed();
			render();
			return;
		}
		// Refused: show the strip as the plugin has it, and say so. A
		// refused leave puts the radio back on the layout that runs, a
		// refused rejoin back on Independent dials.
		if (op === "leave") leaving = false;
		rejoinLayout = null;
		queued = [];
		structural.length = 0;
		structuralAfter = null;
		if (op === "edit" && isDoc(p.config)) show(p.config, typeof p.rev === "number" ? p.rev : shownRev);
		else adoptLive();
		resultNote = p.reason === "stale" ? { tone: "warn", lines: [T("pi.strip.changedElsewhere", "Another dial's panel changed this strip first. Try again.")] } : { tone: "danger", lines: [refusal(p)] };
		hw.announce("strip", resultNote.lines[0], { repeat: true });
		ask();
		if (leaveOwed) leaveNow();
		sendOwed();
		render();
	});

	function unwrittenLine(columns) {
		return `${dialList(columns)} left the screen before ${columns.length === 1 ? "it" : "they"} could be updated and ${columns.length === 1 ? "keeps its" : "keep their"} older setup.`;
	}

	/** What an applied restore or join says: the dial it brought in, or
	 * every dial that left. It stands on its own: a running strip whose
	 * dials are all in it shows no dial row to point at. */
	function backLine(op, columns) {
		if (Array.isArray(columns) && columns.length === 1) {
			const n = columns[0] + 1;
			return op === "join" ? T("pi.strip.joined", "Applied. Dial {n} is in the strip.", { n }) : T("pi.strip.rejoined", "Applied. Dial {n} is back in the strip.", { n });
		}
		return op === "restore" && columns === "all" ? T("pi.strip.restoredAll", "Applied. Every dial that left is back in the strip.") : "Applied.";
	}

	function refusal(p) {
		const detail = typeof p.detail === "string" ? p.detail : "";
		switch (p.reason) {
			case "incomplete":
				return `${detail || "A dial is missing"}. Drag a Sensor Dial there in the Stream Deck app, then try again.`;
			case "conflict": {
				// The plugin's detail names the dials: one, or several.
				const several = (detail.match(/\d+/g) ?? []).length > 1;
				return `${detail || "A dial is in another strip"}. Tick Include beside the dials to move ${several ? "them" : "it"} here.`;
			}
			case "mismatch":
				return "This strip was set up for a deck with another number of dials. Use this deck's dials first.";
			case "device":
				return "Strips need a Stream Deck + or + XL.";
			case "no-group":
				return detail === "" ? "That strip is gone. Choose a layout to make a new one." : `${detail}.`;
			default:
				return T("pi.strip.refused", "The plugin refused this change ({detail}).", { detail: detail === "" ? "no reason given" : detail });
		}
	}

	/** "Dial 3", "Dials 2 and 4", "Dials 2 to 6". */
	const dialList = (columns) => (columns.length === 1 ? `Dial ${columns[0] + 1}` : `Dials ${model.dialNumbers(columns)}`);

	// --- sending ----------------------------------------------------------------------
	let pendingLeaveAll = false;
	let flushing = false;
	/** Saves still waiting out their debounce go now: this dial's own
	 * fields to its settings, and text typed in the strip's fields, whose
	 * edit joins `queued` (sendEdit) instead of going as a request of its
	 * own from inside the one that flushed it: of two edits sent against
	 * one revision, the plugin refuses the second as stale. */
	function flushTyped() {
		if (flushing) return;
		flushing = true;
		try {
			hw.flushPending();
		} finally {
			flushing = false;
		}
	}
	/** The next operations waiting (`queued`) go as one edit against the
	 * shown revision; false when none is left to send. */
	function sendQueued() {
		while (queued.length > 0) {
			const next = resolveOps(queued.splice(0, model.MAX_OPS));
			if (next.length === 0) continue;
			request("edit", { event: "stripEdit", groupId: st.self.groupId, baseRev: shownRev, patch: next });
			return true;
		}
		return false;
	}
	/** The shell's pending saves out, one frame, then the request: the
	 * plugin's write then includes the last thing typed anywhere in this
	 * panel (a strip field's text goes after this request's answer). */
	function request(op, payload) {
		if (pending !== null) return;
		flushTyped();
		const opId = newId();
		pending = { opId, op, columns: payload.columns, timer: 0 };
		pending.timer = setTimeout(() => {
			if (pending === null || pending.opId !== opId) return;
			pending = null;
			queued = [];
			structural.length = 0;
			structuralAfter = null;
			// A leave or a rejoin with no answer (or one waiting on it) is
			// dropped: the radio shows the strip as last heard.
			leaving = false;
			leaveOwed = false;
			owed = null;
			rejoinLayout = null;
			resultNote = { tone: "danger", lines: [T("pi.strip.noAnswer", "No answer from the plugin. The panel shows the strip as it last heard it.")] };
			hw.announce("strip", resultNote.lines[0], { repeat: true });
			adoptLive();
			ask();
			render();
		}, 3000);
		requestAnimationFrame(() => send({ ...payload, opId }));
	}

	/** A choice that is a request of its own (Keep the strip's setup, Use
	 * this dial's copy, Use this deck's dials): sent now, or once the change
	 * on its way is answered, the latest one pressed. `payload()` builds it
	 * when it goes, from the state then; null when there is nothing left to
	 * choose. */
	function requestNext(op, payload) {
		owed = { op, payload };
		sendOwed();
	}
	function sendOwed() {
		if (owed === null || pending !== null) return;
		const { op, payload } = owed;
		owed = null;
		const built = st === null ? null : payload();
		if (built === null) return;
		resultNote = null;
		request(op, built);
	}

	/** This dial leaves its running strip (Independent dials): sent now,
	 * or once the change on its way is answered. */
	function leaveNow() {
		if (pending !== null) {
			leaveOwed = true;
			return;
		}
		leaveOwed = false;
		if (!live()) {
			leaving = false;
			return;
		}
		pendingLeaveAll = false;
		request("leave", { event: "stripLeave", groupId: st.self.groupId });
	}

	/** Operations for the running strip ({ op, screenId } entries): sent
	 * now, or after the change on its way (a later one for the same field of
	 * the same screen replaces an earlier one). A screen's operation goes to
	 * wherever that screen sits when it is sent. */
	function sendEdit(entries) {
		if (entries.length === 0) return;
		// Text typed in another strip field goes in the same edit, before.
		if (pending === null) flushTyped();
		const key = (e) => `${e.screenId ?? ""}|${e.op.path}`;
		const merged = new Map(queued.map((e) => [key(e), e]));
		for (const e of entries) {
			merged.delete(key(e));
			merged.set(key(e), e);
		}
		queued = [...merged.values()];
		if (pending === null && !flushing) sendQueued();
	}

	/** One change of a running strip: `mutate` edits the shown copy, and
	 * what differs from before is sent at once. With `screenId` (text typed
	 * for a screen the strip has moved away from) it edits that screen. */
	function change(mutate, screenId) {
		if (!editing()) return;
		const target = screenId === undefined || screenId === null || screenId === working.screenId ? working : draftFor(screenId);
		if (target === null) return;
		const before = forPatch(target);
		mutate(target);
		resultNote = null;
		const after = forPatch(target);
		const entries = tagOps(model.diffOps(before, after, { layout: true }), target.screenId);
		const named = handName(before, after, target.screenId);
		if (named !== null) entries.push(named);
		sendEdit(entries);
		render();
	}

	/** A screen takes its name from what it draws: a screen added by hand
	 * its first reading's sensor once it has one, a built screen Build's
	 * label while it draws what Build gave it; such a name follows what the
	 * screen draws (model.nameAfter), and a name the person gave stays. One
	 * more operation in the same edit, or null. */
	function handName(before, after, screenId) {
		if (!screensOn() || screenId === null || screenId === undefined || after.layout !== "whole") return null;
		const groups = hw.state.tree?.groups ?? null;
		const list = screenList();
		const index = model.screenIndexOf(list, screenId);
		if (groups === null || list.length < 2 || index < 0) return null;
		const stored = model.screenPaneOf(shownConfig ?? st?.group?.config, index);
		const origin = isDoc(stored) && typeof stored.origin === "string" ? stored.origin : undefined;
		const ctx = { groups, readingOf, slots: encoders() || 6, canon: (key) => hw.pickers?.treeEntryOf(key)?.reading.key ?? key };
		const was = model.contentNames(before.panes[0], origin, ctx);
		const now = model.contentNames(after.panes[0], origin, ctx);
		if (model.same(was, now)) return null;
		const others = screenNames(list).filter((_, i) => i !== index);
		const name = model.nameAfter({ own: list[index].name, before: was, after: now, others });
		if (name === null) return null;
		// The list shows it at once; the plugin's copy confirms.
		nameAtOnce(index, name);
		return { op: model.renameScreenOp(index, name), screenId };
	}

	/** A change of the screen list (add, remove, move, Build screens): one
	 * edit, built when it goes, after any change on its way, so it names the
	 * screens as the plugin has them then. `build` returns { op, after } or
	 * { ops, after } (one edit of several operations; after(config) runs on
	 * its answer) or null for nothing to do. `anyStrip`: an edit that needs
	 * no screens (Fill both halves) goes the same way on any running strip. */
	function structuralEdit(build, { anyStrip = false } = {}) {
		if (!editing() || (screens === null && !anyStrip)) return;
		if (pending !== null || queued.length > 0) {
			structural.push(build);
			return;
		}
		runStructural(build);
	}
	function runStructural(build) {
		// What was typed meanwhile goes first: the build reads the copy
		// that answers it.
		flushTyped();
		if (sendQueued()) {
			structural.unshift(build);
			return;
		}
		const made = build();
		if (made === null) return nextStructural();
		resultNote = null;
		structuralAfter = made.after ?? null;
		request("edit", { event: "stripEdit", groupId: st.self.groupId, baseRev: shownRev, patch: made.ops ?? [made.op] });
	}
	function nextStructural() {
		const build = structural.shift();
		if (build !== undefined && editing()) runStructural(build);
	}

	// --- typed numbers and the link name ------------------------------------------------
	const typedInputs = new Set();
	/** Reads the fields a person typed in into the shown copy and sends what
	 * changed. A field that is not a number (or a scale that is not a
	 * range) is marked and not sent; the status line says why. */
	function commitText() {
		if (!editing()) {
			for (const input of typedInputs) delete input.dataset.screen;
			typedInputs.clear();
			return;
		}
		const inputs = [...typedInputs].filter((input) => input.isConnected);
		typedInputs.clear();
		if (inputs.length === 0) return;
		// Typed text belongs to the screen it was typed for, wherever the
		// strip is now.
		const bound = new Map();
		for (const input of inputs) {
			const id = input.dataset.screen ?? "";
			delete input.dataset.screen;
			if (!bound.has(id)) bound.set(id, []);
			bound.get(id).push(input);
		}
		for (const [id, group] of bound) commitInputs(group, id === "" ? undefined : id);
	}

	function commitInputs(inputs, screenId) {
		change((w) => {
			for (const input of inputs) {
				const id = input.id || input.dataset.textId;
				if (input === ui.link) {
					w.linkId = input.value;
					continue;
				}
				const filterPane = panes.find((x) => x.filter === input);
				if (filterPane !== undefined) {
					const rule = ruleOf(w.panes[filterPane.index]);
					const filter = model.groupFilterOf(input.value);
					if (filter === undefined) delete rule.filter;
					else rule.filter = filter;
					continue;
				}
				const pane = panes.find((x) => x.min === input || x.max === input || x.bands.contains(input));
				if (pane === undefined) continue;
				const p = w.panes[pane.index];
				const n = model.numberOf(input.value);
				const bad = n === null;
				input.setAttribute("aria-invalid", bad ? "true" : "false");
				if (bad) {
					invalidText.set(id, T("pi.strip.notANumber", "A scale end or band limit is not a number. Fix it or clear it."));
					continue;
				}
				invalidText.delete(id);
				if (input === pane.min || input === pane.max) {
					// Both ends as they show, stamped with the unit on view, so a
					// later °F switch converts them (the alert keys' rule).
					const end = input === pane.min ? "min" : "max";
					const scale = model.scaleTypedOf(p.scale, end, n, scaleUnitsOf(p).view);
					const why = model.scaleCheck(scale.min, scale.max);
					if (why !== null) {
						input.setAttribute("aria-invalid", "true");
						invalidText.set(id, `${model.paneName(w.layout, pane.index)}: ${why}`);
						continue;
					}
					p.scale = scale;
					for (const other of [pane.min, pane.max]) if (other !== input && invalidText.has(other.id) && model.numberOf(other.value) !== null) {
						invalidText.delete(other.id);
						other.setAttribute("aria-invalid", "false");
					}
					continue;
				}
				// A band row is the shown screen's (rows waiting for a number
				// live in this panel only).
				if (w !== working) continue;
				const at = input.closest("li[data-band]")?.dataset.band;
				const band = at === "limits" ? p.group?.limits : p.bands[Number(at)];
				if (band === undefined || band === null) continue;
				const kind = input.dataset.bandWarn !== undefined ? "warn" : "crit";
				// Both limits as they show, stamped with the unit on view beside
				// the native unit the band keeps ("" for a reading with no unit;
				// none while the unit is not known, so nothing narrows them).
				const native = at === "limits" ? band.unit : (readingOf(band.key).unit ?? band.unit);
				const next = model.limitsTypedOf(band, kind, n, native === undefined ? undefined : model.displayUnit(native, isDoc(st?.group?.config) && st.group.config.fahrenheit === true));
				for (const k of Object.keys(band)) delete band[k];
				Object.assign(band, next);
			}
		}, screenId);
	}

	let textTimer = 0;
	const textFlush = () => {
		clearTimeout(textTimer);
		textTimer = 0;
		hw.dropLeaveFlush(textFlush);
		commitText();
	};
	function textTyped(ev) {
		if (ev?.target instanceof HTMLInputElement) {
			typedInputs.add(ev.target);
			// The screen this text is typed for, from its first keystroke.
			if (ev.target.dataset.screen === undefined) ev.target.dataset.screen = working?.screenId ?? "";
		}
		clearTimeout(textTimer);
		textTimer = setTimeout(textFlush, 600);
		// Leaving the panel sends it at once (the shell's leave flush).
		hw.addLeaveFlush(textFlush);
	}

	// --- what keeps a new strip from going ----------------------------------------------
	function blockReason() {
		if (st === null) return null;
		if (pending !== null) return "Waiting for the plugin's answer.";
		return making() ? slotsBlock() : null;
	}
	/** The dials that keep a new strip from being made here, in words. */
	function slotsBlock() {
		const missing = st.slots.filter((s) => s.state === "none").map((s) => s.column);
		if (missing.length > 0) return `${dialList(missing)} ${missing.length === 1 ? "needs" : "need"} a Sensor Dial before this layout can be made. Drag one there in the Stream Deck app.`;
		// Dials still in the strip this dial left: no new strip takes them
		// (the plugin refuses it); Rejoin brings this dial back to them. A
		// pasted copy on this dial waits for its choice first: until then
		// there is no Rejoin, and the choice is what shows.
		const stayed = model.stayedColumns(st, true);
		if (stayed.length > 0) {
			const what = `${dialList(stayed)} ${stayed.length === 1 ? "is" : "are"} still in the strip this dial left.`;
			return isDoc(st.self.foreign) ? `${what} Choose Keep the strip's setup or Use this dial's copy first.` : `${what} Choose Independent dials, then Rejoin.`;
		}
		const taken = st.slots.filter((s) => s.state === "other" && !take.has(s.column)).map((s) => s.column);
		if (taken.length > 0) return `${dialList(taken)} ${taken.length === 1 ? "is" : "are"} in another strip. Tick Include beside the dials to move ${taken.length === 1 ? "it" : "them"} here.`;
		return null;
	}

	// --- rendering -----------------------------------------------------------------------
	const setText = (el, text) => {
		if (el !== null && el.textContent !== text) el.textContent = text;
	};
	const showEl = (el, on) => {
		if (el !== null && el.hidden === on) el.hidden = !on;
	};
	const setAria = (el, on) => {
		const v = on ? "true" : "false";
		if (el.getAttribute("aria-disabled") !== v) el.setAttribute("aria-disabled", v);
	};

	// Nothing in this section moves under a held pointer. A field that
	// commits on blur does so at the mousedown of the press that moved the
	// focus, and an answer or a push can land before the release; drawing
	// then can replace rows or change a line's height under the pointer, so
	// the release lands elsewhere and the click is lost. While a pointer is
	// down the edit is still sent at once; the drawing waits for the release
	// and runs after its click.
	let pressing = false;
	let renderOwed = false;
	let radioFocusOwed = false; // a layout radio had focus when a leave disabled it
	let focusOwed = null; // "make" | "screens" | "layout": a control that had focus went hidden, and where focus goes (handFocus)
	document.addEventListener("pointerdown", () => {
		pressing = true;
		// A press puts focus where the person wants it.
		focusOwed = null;
	}, true);
	const pressDone = () => {
		if (!pressing) return;
		pressing = false;
		if (!renderOwed) return;
		setTimeout(() => {
			if (pressing) return;
			renderOwed = false;
			render();
		}, 0);
	};
	window.addEventListener("pointerup", pressDone, true);
	window.addEventListener("pointercancel", pressDone, true);
	window.addEventListener("blur", pressDone);

	function render() {
		if (pressing) {
			renderOwed = true;
			return;
		}
		// Read before anything can hide: a control that had focus and goes
		// hands it on (handFocus).
		const had = section.contains(document.activeElement) ? document.activeElement : null;
		syncChoice();
		const strip = st?.device?.strip === true;
		// While a leave or a rejoin is on its way the layout waits for its answer.
		const radioHadFocus = ui.radios.includes(document.activeElement);
		const waiting = leaving || pending?.op === "leave" || rejoinLayout !== null;
		for (const r of ui.radios) {
			r.disabled = !strip || st === null || waiting;
			const on = r.value === choice;
			if (r.checked !== on) r.checked = on;
		}
		// Focus that a disabled radio dropped comes back once it answers.
		if (waiting && radioHadFocus) radioFocusOwed = true;
		else if (!waiting && radioFocusOwed) {
			radioFocusOwed = false;
			if (document.activeElement === null || document.activeElement === document.body) ui.radios.find((r) => r.checked && !r.disabled)?.focus({ preventScroll: true });
		}
		renderMap(strip);
		const self = st?.self ?? {};
		renderRestore(strip, self);
		renderResolve(strip, self);
		renderRetarget(strip, self);
		const edit = strip && editing();
		showEl(ui.edit, edit);
		if (edit) renderEdit();
		renderStripTheme();
		renderRedirects();
		renderBuild(strip, self);
		renderStart(strip);
		renderFill(strip);
		renderPreview();
		renderNote();
		renderBar(strip);
		renderControls();
		renderDialOnly();
		// The start dropdown moved between Build's title and the caption's
		// line (renderStart) keeps the focus it had.
		if (had === ui.start && document.activeElement !== ui.start && drawn(ui.start)) ui.start.focus({ preventScroll: true });
		handFocus(had);
		hw.scheduleRender(); // the fold summary
	}

	/** Hidden by an ancestor in this render (a row, a bar or a block that
	 * goes), not removed: a removed row's own code hands its focus on. */
	const hiddenNow = (el) => el.isConnected && el.closest("[hidden]") !== null;
	const drawn = (el) => el !== null && !el.disabled && el.closest("[hidden]") === null && el.getClientRects().length > 0;
	/**
	 * Focus that a control hidden by this render dropped goes on to a
	 * visible one, so the next Tab goes on from there: Make the strip, once
	 * the strip is made, to its layout (or Time window); the screen list or
	 * its tools, once one screen is left, to the list, else Add a screen,
	 * else the Filter; anything else (a resolve or retarget block that is
	 * done) to the layout. It runs after the code that called render, so an
	 * action that hands its own focus on (the left line, the dial row's
	 * action, Build screens, Rename, a new screen's Filter) keeps its choice.
	 */
	function handFocus(had) {
		if (had !== null && hiddenNow(had)) focusOwed = ui.bar.contains(had) || (ui.buildBox.contains(had) && !live()) ? "make" : ui.pick.contains(had) || ui.screenTools.contains(had) || ui.links.contains(had) || ui.buildBox.contains(had) ? "screens" : "layout";
		if (focusOwed !== null) queueMicrotask(placeFocus);
	}
	function placeFocus() {
		if (focusOwed === null) return;
		const now = document.activeElement;
		if (now !== null && now !== document.body && !hiddenNow(now)) {
			focusOwed = null;
			return;
		}
		const radio = ui.radios.find((r) => r.checked) ?? null;
		// A strip just made shows as running with the plugin's next state.
		if (focusOwed === "make" && !live()) return;
		const next = focusOwed === "make" ? [radio, ui.window] : focusOwed === "screens" ? [ui.screenSelect, ui.addScreen, panes[0].filter, radio] : [radio];
		const target = next.find(drawn);
		if (target === undefined) return;
		focusOwed = null;
		target.focus({ preventScroll: true });
	}

	/** The words a slot's one action shows. */
	const actionWord = (action) => (action === "rejoin" ? T("pi.strip.actionRejoin", "Rejoin") : action === "move" ? T("pi.strip.actionMove", "Move here") : action === "include" ? T("pi.strip.actionInclude", "Include") : T("pi.strip.add", "Add"));

	/** The relative luminance of a #RRGGBB color (WCAG). */
	function luminance(hex) {
		const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
		return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
	}
	/** The accent of the theme the strip draws in (its own, else the deck's,
	 * else the default), when it stands out 3:1 on the panel; "" falls back
	 * to the panel's own green (pi.css). */
	function stripAccent() {
		const themes = isDoc(themesInfo?.themes) ? themesInfo.themes : isDoc(hw.state.themes) ? hw.state.themes : null;
		if (themes === null) return "";
		const own = isDoc(st?.group?.config) ? st.group.config.theme : undefined;
		const id = [own, themesInfo?.effectiveDeckTheme, themesInfo?.defaultTheme].find((t) => typeof t === "string" && Object.hasOwn(themes, t));
		const accent = id === undefined ? undefined : themes[id]?.accent;
		if (typeof accent !== "string" || !/^#[0-9a-fA-F]{6}$/.test(accent)) return "";
		const bg = luminance("#2d2d2d");
		const fg = luminance(accent);
		return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05) >= 3 ? accent : "";
	}

	/** The dial map of the state shown: the layout the radio shows, and the
	 * mark chosen to name its dial in the line. */
	function dialMapNow() {
		const layout = live() ? (working?.layout ?? liveLayout()) : (newLayout ?? "whole");
		return model.dialMap(st, { layout, live: live(), making: making(), take: [...take], actionWord, focus: revealed });
	}

	/**
	 * The dials in one row and one line beside them, shown only while a dial
	 * needs the person or a strip is being made (a running strip whose dials
	 * are all in it shows none, and an independent dial none either). The
	 * line names one dial and ends in its one action. A mark changes its fill
	 * and border only, and the line keeps its one line, so a live push never
	 * moves a box. The marks are one Tab stop (arrows move between them); a
	 * mark picks the dial the line names.
	 */
	let marksSignature = "";
	let statusSignature = "";
	let mapShown = null;
	function renderMap(strip) {
		// Read before the row can hide: an action that had focus hands it on.
		const actionHadFocus = ui.detail.contains(document.activeElement);
		const map = strip ? dialMapNow() : { marks: [], status: null, shown: true, focus: null, action: null };
		let status = map.status;
		if (st === null) status = { lead: "", text: T("pi.strip.waitingForThe", "Waiting for the plugin."), tone: "" };
		else if (!strip) status = { lead: "", text: T("pi.strip.stripsNeedA", "Strips need a Stream Deck + or + XL. This deck has no touch strip."), tone: "" };
		// Waiting and a deck without a strip say so in the line; on a strip
		// deck the row shows only while it asks something of the person.
		const shown = st === null || !strip || (map.shown && (live() || making()));
		if (mapShown !== shown) {
			// A dial that needs the person appears: said once, as the row shows.
			if (shown && mapShown === false && status.tone === "warn") hw.announce("strip", status.text, { repeat: true });
			mapShown = shown;
		}
		showEl(ui.map, shown);
		const full = `${status.lead}${status.text}`;
		const statusSig = JSON.stringify(status);
		if (statusSig !== statusSignature) {
			statusSignature = statusSig;
			const lead = document.createElement("span");
			lead.className = "hw-strip-lead";
			lead.textContent = status.lead;
			ui.device.replaceChildren(...(status.lead === "" ? [] : [lead]), document.createTextNode(status.text));
			ui.device.title = status.title ?? full;
			ui.device.dataset.tone = status.tone;
		}
		ui.map.dataset.dials = String(map.marks.length);
		const accent = stripAccent();
		if (ui.map.style.getPropertyValue("--hw-strip-accent") !== accent) {
			if (accent === "") ui.map.style.removeProperty("--hw-strip-accent");
			else ui.map.style.setProperty("--hw-strip-accent", accent);
		}
		if (revealed !== null && !map.marks.some((m) => m.column === revealed)) revealed = null;
		if (rovingColumn === null || !map.marks.some((m) => m.column === rovingColumn)) rovingColumn = map.marks.find((m) => m.self)?.column ?? map.marks[0]?.column ?? null;
		// The row's buttons are made once per layout of marks; a state change
		// only sets their attributes.
		const sig = JSON.stringify(map.marks.map((m) => [m.column, m.half]));
		if (sig !== marksSignature) {
			marksSignature = sig;
			const focused = ui.slots.contains(document.activeElement) ? document.activeElement.dataset.column : undefined;
			const frag = document.createDocumentFragment();
			map.marks.forEach((m, i) => {
				const button = document.createElement("button");
				button.type = "button";
				button.className = "hw-strip-dial";
				button.dataset.column = String(m.column);
				if (m.half === 1 && map.marks[i - 1]?.half === 0) button.dataset.seam = "";
				button.setAttribute("aria-controls", "strip-device");
				frag.appendChild(button);
			});
			ui.slots.replaceChildren(frag);
			if (focused !== undefined) ui.slots.querySelector(`[data-column="${focused}"]`)?.focus({ preventScroll: true });
		}
		for (const button of ui.slots.querySelectorAll("button[data-column]")) {
			const m = map.marks.find((x) => x.column === Number(button.dataset.column));
			if (m === undefined) continue;
			if (button.dataset.look !== m.look) button.dataset.look = m.look;
			if (button.dataset.kind !== m.kind) button.dataset.kind = m.kind;
			button.toggleAttribute("data-self", m.self);
			button.toggleAttribute("data-needs", m.needs);
			if (button.getAttribute("aria-label") !== m.label) button.setAttribute("aria-label", m.label);
			if (button.title !== m.label) button.title = m.label;
			// The mark whose dial the line names.
			const named = map.focus === m.column ? "true" : "false";
			if (button.getAttribute("aria-expanded") !== named) button.setAttribute("aria-expanded", named);
			const tab = m.column === rovingColumn ? 0 : -1;
			if (button.tabIndex !== tab) button.tabIndex = tab;
		}
		renderDetail(map, actionHadFocus);
	}

	/** The one action at the end of the line, for the dial it names:
	 * Rejoin, Add, Move here, or Include while a strip is made. */
	let detailSignature = "";
	let detailColumn = null;
	function renderDetail(map, hadFocus) {
		const column = map.focus;
		const action = column === null ? null : map.action;
		showEl(ui.detail, action !== null);
		if (action === null) {
			if (ui.detail.childElementCount > 0) ui.detail.replaceChildren();
			detailSignature = "";
			// The action that had focus is done: focus goes to its mark, or to
			// the layout when the row has gone (every dial is in the strip).
			if (hadFocus) {
				const mark = mapShown ? ui.slots.querySelector(`[data-column="${detailColumn}"]`) : null;
				(mark ?? ui.radios.find((r) => r.checked) ?? ui.radios[0])?.focus({ preventScroll: true });
			}
			detailColumn = null;
			return;
		}
		detailColumn = column;
		const including = action === "include";
		const sig = JSON.stringify([column, action, including && take.has(column)]);
		if (sig === detailSignature) return;
		detailSignature = sig;
		if (including) {
			const label = document.createElement("label");
			label.className = "hw-check hw-strip-take";
			const box = document.createElement("input");
			box.type = "checkbox";
			box.checked = take.has(column);
			box.dataset.take = String(column);
			const word = document.createElement("span");
			word.textContent = actionWord("include");
			box.setAttribute("aria-label", `Include dial ${column + 1}; it leaves its other strip`);
			label.append(box, word);
			ui.detail.replaceChildren(label);
		} else {
			const button = document.createElement("button");
			button.type = "button";
			button.className = "hw-btn hw-strip-slot-action";
			button.dataset.slotAction = action;
			button.dataset.column = String(column);
			button.textContent = actionWord(action);
			button.setAttribute("aria-label", `${button.textContent}: dial ${column + 1}`);
			ui.detail.replaceChildren(button);
		}
		// The action that was focused is done: focus goes to the next one, or
		// back to its mark.
		if (hadFocus) (ui.detail.querySelector("button, input") ?? ui.slots.querySelector(`[data-column="${column}"]`))?.focus({ preventScroll: true });
	}

	/** The strip's theme, for the Theme section at the top (pi-common.js):
	 * while this dial draws part of a running strip, that section shows the
	 * strip's theme and a pick there is one edit of it (Default clears it,
	 * so the strip follows the shared theme). The dial's own theme is left
	 * as stored. Said only when it changes. */
	let themeSignature = null;
	function renderStripTheme() {
		const on = st?.device?.strip === true && editing();
		const theme = on ? (working.theme ?? "") : null;
		const sig = on ? `on|${theme}` : "off";
		if (sig === themeSignature) return;
		themeSignature = sig;
		hw.emit("stripTheme", on ? { theme, set: setStripTheme } : null);
	}
	function setStripTheme(id) {
		change((w) => {
			w.theme = typeof id === "string" ? id : "";
		});
	}

	/** Display's text color, Background, Words, decimals, °F and Unit and
	 * decimals per reading: while this dial draws part of a running strip
	 * they show and edit the strip's own (one edit each, the plugin writes
	 * it), through the shell's field redirects; the dial's own stay stored.
	 * Off the strip, they are the dial's again. Set again only when a value
	 * changes. The strip's readings, which its own Unit and decimals rows
	 * name (issue #59), go out with them ("stripReadings"). */
	let redirectSignature = null;
	let readingsSignature = null;
	function renderRedirects() {
		const on = st?.device?.strip === true && editing();
		const readings = on && Array.isArray(st?.group?.readings) ? st.group.readings.filter((k) => typeof k === "string" && k !== "") : null;
		const readingsSig = JSON.stringify(readings);
		if (readingsSig !== readingsSignature) {
			readingsSignature = readingsSig;
			hw.emit("stripReadings", readings);
		}
		const sig = on ? JSON.stringify([working.textMode, working.textColor, working.textDimSecondary, working.background, working.accentWords, working.stars, working.skyColor, working.decimals, working.fahrenheit, working.readingFormats ?? null]) : "off";
		if (sig === redirectSignature) return;
		const was = redirectSignature;
		redirectSignature = sig;
		if (!on) {
			if (was !== null) hw.redirect(null);
			return;
		}
		const field = (read, write) => ({ value: () => (working === null ? undefined : read(working)), set: (value) => change((w) => write(w, value)) });
		hw.redirect({
			textMode: field(
				(w) => w.textMode,
				(w, v) => {
					w.textMode = ["theme", "dim", "custom"].includes(v) ? v : "";
				}
			),
			textColor: field(
				(w) => w.textColor,
				(w, v) => {
					w.textColor = typeof v === "string" && /^#[0-9A-Fa-f]{6}$/.test(v) ? v : "";
				}
			),
			textDimSecondary: field(
				(w) => w.textDimSecondary,
				(w, v) => {
					w.textDimSecondary = v === true;
				}
			),
			dialBackground: field(
				(w) => w.background,
				(w, v) => {
					w.background = model.BACKGROUNDS.includes(v) ? v : "";
					// Default ("") follows the shared Background, Words and Sky together.
					if (w.background === "") {
						w.accentWords = null;
						w.stars = "";
						w.skyColor = "";
					}
				}
			),
			dialStars: field(
				(w) => w.stars,
				(w, v) => {
					w.stars = model.STARS.includes(v) ? v : "";
				}
			),
			dialSkyColor: field(
				(w) => w.skyColor,
				(w, v) => {
					w.skyColor = model.TONES.includes(v) ? v : "";
				}
			),
			dialAccentWords: field(
				(w) => w.accentWords,
				(w, v) => {
					w.accentWords = v === true ? true : v === false ? false : null;
				}
			),
			decimals: field(
				(w) => w.decimals,
				(w, v) => {
					w.decimals = ["auto", "0", "1", "2", "3"].includes(v) ? v : "auto";
				}
			),
			fahrenheit: field(
				(w) => w.fahrenheit,
				(w, v) => {
					w.fahrenheit = v === true;
				}
			),
			// The whole map, as Display's rows patch it; none clears it.
			readingFormats: field(
				(w) => w.readingFormats ?? undefined,
				(w, v) => {
					w.readingFormats = v !== null && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 0 ? v : null;
				}
			)
		});
	}

	/** A dial that left a strip: one line saying so, ending in Rejoin (this
	 * dial) and Every dial leaves while other dials of that strip are still
	 * in it on this deck, else Restore the strip (every dial that left). An
	 * action that had focus and goes hands it to the next one, or to the
	 * layout. */
	function renderRestore(strip, self) {
		const active = document.activeElement;
		const hadFocus = active !== null && ui.restore.contains(active);
		const on = strip && choice === "independent" && self.joined !== true && isDoc(st?.group) && self.foreign === null;
		showEl(ui.restore, on);
		const buttons = [ui.rejoin, ui.leaveAll, ui.restoreAll];
		if (on) {
			setText(ui.restoreText, T("pi.strip.dialLeft", "Dial {n} left the strip", { n: self.column + 1 }));
			const othersIn = st.group.live === true && (st.slots ?? []).some((s) => !s.self && (s.state === "joined" || s.state === "outside"));
			showEl(ui.leaveAll, othersIn);
			showEl(ui.restoreAll, !othersIn);
		}
		if (hadFocus && (!on || active.closest("[hidden]") !== null)) {
			const shown = on ? buttons.filter((b) => !b.hidden) : [];
			const next = shown.find((b) => buttons.indexOf(b) > buttons.indexOf(active)) ?? shown[0];
			(next ?? ui.radios.find((r) => r.checked) ?? ui.radios[0])?.focus({ preventScroll: true });
		}
	}

	function renderResolve(strip, self) {
		const on = strip && isDoc(self.foreign);
		showEl(ui.resolve, on);
		if (!on) return;
		setText(ui.resolveText, "This dial holds a different copy of a strip setup (pasted, or from a copied profile). The strip keeps its own setup until you choose.");
	}

	function renderRetarget(strip, self) {
		const config = isDoc(st?.group?.config) ? st.group.config : {};
		const on = strip && self.joined === true && st.group?.health === "mismatch";
		showEl(ui.retarget, on);
		if (!on) return;
		setText(ui.retargetText, `This strip was set up for ${config.encoders === 6 ? "a Stream Deck + XL (6 dials)" : config.encoders === 4 ? "a Stream Deck + (4 dials)" : "another deck"}. This deck has ${st.device.encoders} dials.`);
	}

	function renderEdit() {
		const split = working.layout === "split";
		if (ui.window.value !== working.window) ui.window.value = working.window;
		showEl(ui.sharedItem, split);
		showEl(ui.windowItem, !split || working.sharedWindow);
		ui.shared.checked = working.sharedWindow;
		if (document.activeElement !== ui.link && ui.link.value !== working.linkId) ui.link.value = working.linkId;
		// The fold's line names the link while it is folded.
		setText(ui.linkSum, working.linkId.trim());
		const shownPanes = working.layout === "split" ? working.panes : working.panes.slice(0, 1);
		setText(ui.moreSum, model.alertBandsLine(shownPanes));
		// By what is stored, never by live data, so it holds still while
		// readings come and go.
		showEl(ui.gapModeItem, shownPanes.some((p) => model.gapModeShown(p)) || model.gapModeOnStrip(shownConfig ?? st?.group?.config));
		if (ui.gapMode.value !== working.gapMode) ui.gapMode.value = working.gapMode;
		for (const pane of panes) renderPane(pane, split);
		renderScreens();
		renderedScreen = working.screenId;
		if (focusFilterSoon) {
			// A screen just added shows: its Filter takes focus.
			focusFilterSoon = false;
			if (panes[0].filter.getClientRects().length > 0) panes[0].filter.focus({ preventScroll: false });
		}
	}

	// --- screens ---------------------------------------------------------------------
	let renderedScreen = null; // the screen the box last drew
	let screensSignature = "";
	let deckMoved = false; // the plugin's state moved the strip to another screen
	/** What a list of screens is called, one name each (the reading names
	 * come from the panel's sensor list). The screen in the box is named
	 * from the box's own copy, so the list says what the box shows. */
	function screenNames(list) {
		const fahrenheit = isDoc(st?.group?.config) && st.group.config.fahrenheit === true;
		const config = shownConfig ?? st?.group?.config;
		return list.map((screen) => model.screenNameOf(screen, working !== null && working.screenId === screen.id ? working.panes[0] : model.screenPaneOf(config, screen.index), { readingOf, fahrenheit }));
	}

	/**
	 * This screen, the head of the box on a running Whole strip. One screen:
	 * its name on the head's line and Add a screen. Two or more: one row,
	 * the screen before, a list of their names (the screen on the strip
	 * chosen), the screen after, its place and Edit; Next screen shows in
	 * Time window's row. Edit opens one row of tools (Rename, Earlier,
	 * Later, Remove, Add) under it. A move of the strip changes the list's
	 * choice and the place's digits, never a size.
	 */
	let editingScreens = false; // Edit is open: the tools row shows
	function renderScreens() {
		const on = screensOn();
		const list = on ? screenList() : [];
		const many = list.length >= 2;
		showEl(ui.screensBox, on);
		showEl(ui.links, on && !many);
		showEl(ui.pick, many);
		showEl(ui.cycleItem, many);
		const legend = panes[0].name;
		// The head names the box; the pane's legend is read, not shown.
		if (legend.classList.contains("hw-sr-only") !== on) legend.classList.toggle("hw-sr-only", on);
		if (!many) {
			screensSignature = "";
			deckMoved = false;
			editingScreens = false;
			if (renaming !== null) renaming = null;
			showEl(ui.screenTools, false);
		}
		if (!on) return;
		const index = viewIndexIn(list, shownConfig);
		const names = screenNames(list);
		const name = names[index] ?? "";
		// A screen with nothing to name it by yet is "This screen" alone.
		const unnamed = name === T("pi.strip.screenNumber", "Screen {n}", { n: index + 1 });
		const head = many || unnamed ? T("pi.strip.thisScreen", "This screen") : T("pi.strip.thisScreenNamed", "This screen: {name}", { name });
		setText(ui.screenLabel, head);
		if (ui.screenLabel.title !== (many ? "" : head)) ui.screenLabel.title = many ? "" : head;
		setText(legend, many ? T("pi.strip.screenLegend", "Screen {n} of {count}: {name}", { n: index + 1, count: list.length, name }) : head);
		setText(panes[0].extraName, name);
		if (!many) return;
		const cycle = String(working.screenCycle ?? 0);
		if (ui.cycle.value !== cycle) ui.cycle.value = cycle;
		if (renaming !== null && model.screenIndexOf(list, renaming) < 0) renaming = null;
		// The list's names, made again only when a name or the order changes.
		const sig = JSON.stringify([list.map((x) => x.id), names]);
		if (sig !== screensSignature) {
			screensSignature = sig;
			ui.screenSelect.replaceChildren(
				...list.map((screen, i) => {
					const option = document.createElement("option");
					option.value = screen.id;
					option.textContent = names[i];
					return option;
				})
			);
		}
		const id = list[index]?.id ?? "";
		if (ui.screenSelect.value !== id) ui.screenSelect.value = id;
		setText(ui.screenPlace, T("pi.strip.screenPlace", "{n} of {count}", { n: index + 1, count: list.length }));
		setAria(ui.screenPrev, index <= 0);
		setAria(ui.screenNext, index >= list.length - 1);
		// Rename puts the name field in the list's place, at its size.
		showEl(ui.screenSelect, renaming === null);
		showEl(ui.screenName, renaming !== null);
		const open = editingScreens ? "true" : "false";
		if (ui.screenEdit.getAttribute("aria-expanded") !== open) ui.screenEdit.setAttribute("aria-expanded", open);
		setText(ui.screenEdit, editingScreens ? T("pi.strip.doneScreens", "Done") : T("pi.strip.editScreens", "Edit"));
		showEl(ui.screenTools, editingScreens);
		syncScreenTools(list, index, name);
		// A move the deck made is said while focus is on the list (one this
		// panel made is read as the list's own choice).
		if (deckMoved && document.activeElement === ui.screenSelect) hw.announce("strip", T("pi.strip.screenOnStrip", "{name} on the strip, {n} of {count}", { name, n: index + 1, count: list.length }), { repeat: true });
		deckMoved = false;
	}

	const TOOL_KEYS = { earlier: "Alt+Left", later: "Alt+Right", rename: "F2", remove: "Delete" };
	const toolOf = (tool) => ui.screenTools.querySelector(`button[data-tool="${tool}"]`);
	/** Names and enables the tools for the screen on the strip. A button
	 * that cannot act says why (aria-disabled, its name and title) and keeps
	 * its focus. Earlier and Later name as their step the screen they move,
	 * by its stored id: the strip keeps a moved screen on view, so a quick
	 * press again moves it again, and stops when the strip shows another
	 * screen (a deck turn, the cycle). A screen with no stored id is known
	 * by its place, which names another screen after a move, so it names
	 * no step. */
	function syncScreenTools(list, index, name) {
		const id = viewId();
		const at = model.screenIndexOf(list, id);
		const moving = at >= 0 && model.screenPaneOf(shownConfig ?? st?.group?.config, at)?.screenId === id ? id : null;
		for (const tool of ["earlier", "later"]) {
			const button = toolOf(tool);
			const step = moving === null ? null : `screen-${tool}:${moving}`;
			if (step === null) button.removeAttribute("data-step");
			else if (button.dataset.step !== step) button.dataset.step = step;
		}
		const full = list.length >= model.MAX_SCREENS;
		const spec = {
			earlier: [index > 0, T("pi.strip.moveScreenEarlier", "Move {name} earlier", { name })],
			later: [index < list.length - 1, T("pi.strip.moveScreenLater", "Move {name} later", { name })],
			rename: [true, T("pi.strip.renameScreen", "Rename {name}", { name })],
			remove: [list.length > 1, T("pi.strip.removeScreen", "Remove {name}", { name })],
			add: [!full, full ? T("pi.strip.screensFull", "A strip keeps at most {max} screens", { max: model.MAX_SCREENS }) : T("pi.strip.addScreenAfter", "Add a screen after {name}", { name })],
			build: [true, T("pi.strip.buildScreens", "Build screens for this PC")]
		};
		for (const button of ui.screenTools.querySelectorAll("button[data-tool]")) {
			const [enabled, label] = spec[button.dataset.tool];
			setAria(button, !enabled);
			if (button.dataset.armed === "true") continue;
			if (button.getAttribute("aria-label") !== label) button.setAttribute("aria-label", label);
			const title = TOOL_KEYS[button.dataset.tool] === undefined ? label : T("pi.strip.toolKey", "{label} ({key} in the list)", { label, key: TOOL_KEYS[button.dataset.tool] });
			if (button.title !== title) button.title = title;
		}
	}

	function renderPane(pane, split) {
		const on = pane.index === 0 || split;
		showEl(pane.box, on);
		showEl(pane.extra, on);
		if (!on) return;
		const p = working.panes[pane.index];
		// On a Whole strip with screens, This screen's head names the box
		// (renderScreens).
		if (split || !screensOn()) {
			const name = model.paneName(working.layout, pane.index);
			setText(pane.name, name);
			setText(pane.extraName, name);
		}
		// More's legend names whose overlays and bands these are where there
		// are two: a half. On a Whole strip More sits in This screen's block,
		// and its legend is read, not shown.
		if (pane.extraName.classList.contains("hw-sr-only") === split) pane.extraName.classList.toggle("hw-sr-only", !split);
		// Another screen in the box: its own text replaces what a focused
		// field shows (what was typed there went to its screen first).
		const freshScreen = pane.index === 0 && working.screenId !== renderedScreen;
		if (pane.style.value !== p.style) pane.style.value = p.style;
		const group = isGroup(p);
		const rule = group ? ruleOf(p) : null;
		// A Group pane lists the folder's reading, or its custom list.
		const listed = group && rule.from === "list" ? rule.keys.map((key) => ({ key })) : group ? p.series.slice(0, 1) : p.series;
		const readings = listed.map((s) => readingOf(s.key));
		// Styles that cannot draw every ticked reading are not offered; the
		// style in use stays, and its rows say what it leaves out. Group
		// draws a rule, never the ticked list, so it is always offered. A
		// style held back for its readings' kind (Events) says so in
		// its option's words; the option keeps its place and size.
		const ctx = ctxOf(pane, p);
		for (const option of pane.style.options) {
			const offer = option.value === p.style ? { offered: true, label: null } : model.styleOffer(option.value, readings, ctx);
			if (option.dataset.chip === undefined) option.dataset.chip = option.textContent;
			const chip = T(`pi.strip.style${option.value.charAt(0).toUpperCase()}${option.value.slice(1)}`, option.dataset.chip);
			const words = offer.label === null ? chip : OFFER_WORDS[offer.label]();
			if (option.textContent !== words) option.textContent = words;
			if (option.disabled !== !offer.offered) option.disabled = !offer.offered;
		}
		const ambient = p.style === "ambient";
		showEl(pane.viewItem, p.style === "group");
		showEl(pane.fromItem, group);
		showEl(pane.filterItem, group && rule.from === "filter");
		showEl(pane.unitItem, group && rule.from === "unit");
		showEl(pane.readoutItem, !group && !ownLayout(p));
		showEl(pane.lookItem, p.style === "meters");
		// Large values only draws no graph, so Graph is not asked. Only an edit
		// of Readout or Graph moves this, never a reading.
		showEl(pane.styleItem, !model.isValuesOnly(p));
		// Scale from and Scale to where the style draws a value scale, with
		// the unit beside them; Group ignores a
		// stored scale, Ambient and Events draw none. Blank fields read Auto,
		// so no help line stands under them: one shows only while the stored
		// ends do not apply to this graph.
		const scaleUnits = scaleUnitsOf(p);
		const scaleShown = model.scaleShown(p.style, p.readout, scaleUnits.units, p.look);
		showEl(pane.scaleRow, scaleShown !== "none");
		showEl(pane.scaleHelp, scaleShown !== "none" && model.scaleHelpKey(p.style, p.scale, scaleUnits.views) !== null);
		const tag = model.scaleTagOf(p.scale, scaleUnits.view);
		for (const el of pane.scaleTags) setText(el, tag);
		showEl(pane.overlaysBox, !ambient);
		showEl(pane.bandsItem, !ambient);
		// Filter and Unit rules need no picker; a folder takes one ticked
		// reading, so the tick-order line is for lists only.
		const picking = model.readingsFieldOf(p) === "picker";
		showEl(pane.label, picking);
		showEl(pane.pickerBox, picking);
		showEl(pane.series, picking);
		showEl(pane.help, !group || rule.from === "list");
		if (group) {
			if (pane.view.value !== rule.view) pane.view.value = rule.view;
			if (pane.from.value !== rule.from) pane.from.value = rule.from;
			if ((freshScreen || document.activeElement !== pane.filter) && pane.filter.value !== (rule.filter ?? "")) pane.filter.value = rule.filter ?? "";
			if (rule.from === "unit") renderUnits(pane, rule.unit ?? "°C");
		}
		if (pane.readout.value !== p.readout) pane.readout.value = p.readout;
		if (pane.look.value !== p.look) pane.look.value = p.look;
		showEl(pane.windowItem, split && !working.sharedWindow);
		const w = p.window ?? working.window;
		if (pane.window.value !== w) pane.window.value = w;
		for (const box of pane.overlays) {
			box.checked = p.overlays[box.dataset.overlay] === true;
			showEl(box.closest("label"), model.overlayUsed(p.style, box.dataset.overlay, p.group?.view, p.readout));
		}
		for (const [input, end] of [
			[pane.min, "min"],
			[pane.max, "max"]
		]) {
			if (freshScreen) {
				input.setAttribute("aria-invalid", "false");
				invalidText.delete(input.id);
			} else if (document.activeElement === input || input.getAttribute("aria-invalid") === "true") continue;
			// A stamped end shows in the unit on view (90 typed in °C reads 194
			// under °F); an unstamped one as stored.
			const text = fieldText(model.scaleShownOf(p.scale, scaleUnits.view)[end], p.scale[end]);
			if (input.value !== text) input.value = text;
		}
		renderSeries(pane, p, readings);
		if (group) renderGroupLimits(pane, p);
		else renderBands(pane, p);
		renderCheck(pane, p, readings);
		pane.picker?.renderList();
	}

	/** The Unit select: this PC's units with their counts, the rule's own
	 * kept (and named) when HWiNFO lists none of it now. */
	let unitSignatures = ["", ""];
	function renderUnits(pane, chosen) {
		const choices = unitChoices();
		if (!choices.some(([unit]) => unit === chosen)) choices.unshift([chosen, 0]);
		const fahrenheit = isDoc(st?.group?.config) && st.group.config.fahrenheit === true;
		const sig = JSON.stringify([choices, chosen, fahrenheit]);
		if (unitSignatures[pane.index] === sig) return;
		unitSignatures[pane.index] = sig;
		pane.unit.replaceChildren(
			...choices.map(([unit, n]) => {
				const option = document.createElement("option");
				option.value = unit;
				option.textContent = `${model.displayUnit(unit, fahrenheit)}, ${n === 1 ? "1 reading" : `${n} readings`}`;
				return option;
			})
		);
		pane.unit.value = chosen;
	}

	let checkSignatures = ["", ""];
	/** A Filter rule's count line: the plugin's count of the filter as
	 * stored, or, while one is typed and until the plugin has counted it,
	 * the panel's own over its sensor list; each alternative that matches
	 * nothing is named; an empty field offers filters that work on this PC.
	 * Status words in the count slot, never help. */
	function filterLine(pane, p, fahrenheit) {
		const typed = typedInputs.has(pane.filter) || document.activeElement === pane.filter ? pane.filter.value : p.group?.filter;
		const filter = model.groupFilterOf(typed);
		const groups = hw.state.tree?.groups ?? null;
		const report = model.filterReport(filter, groups, { style: p.style });
		const plugin = st?.group?.counts?.[pane.index] ?? null;
		// The plugin's count names the filter it counted.
		const counted = plugin !== null && (plugin.title ?? "") === (filter ?? "");
		const count = counted || report.count.status === "unavailable" ? plugin : report.count;
		const line = model.filterCheck({ ...p.group, filter }, count, report.alternatives, fahrenheit, p.style);
		const examples = filter === undefined && groups !== null ? model.filterExamples(groups) : [];
		return { ...line, examples, tone: examples.length > 0 ? "" : line.tone };
	}

	function renderCheck(pane, p, readings) {
		if (isGroup(p)) {
			const fahrenheit = isDoc(st?.group?.config) && st.group.config.fahrenheit === true;
			const line = p.group?.from === "filter" ? filterLine(pane, p, fahrenheit) : { ...model.groupCheck(p.group, st?.group?.counts?.[pane.index] ?? null, fahrenheit, p.style), examples: [] };
			const sig = JSON.stringify(["group", line]);
			if (checkSignatures[pane.index] === sig) return;
			checkSignatures[pane.index] = sig;
			if (line.examples.length > 0) {
				// "Try" and filters that work here, each filling the field.
				const parts = [document.createTextNode(T("pi.strip.filterTry", "Try"))];
				for (const example of line.examples) {
					const button = document.createElement("button");
					button.type = "button";
					button.className = "hw-link hw-strip-example";
					button.dataset.example = example;
					button.textContent = example;
					// Read as words apart, not one run.
					parts.push(document.createTextNode(" "), button);
				}
				pane.check.replaceChildren(...parts);
			} else pane.check.replaceChildren(...(line.note === null ? [] : [document.createTextNode(line.note)]));
			pane.check.dataset.tone = line.tone;
			return;
		}
		const check = model.styleCheck(p.style, readings, ctxOf(pane, p));
		const sig = JSON.stringify(check);
		if (checkSignatures[pane.index] === sig) return;
		checkSignatures[pane.index] = sig;
		const parts = [];
		if (check.note !== null) parts.push(document.createTextNode(check.note));
		if (check.fit !== null) {
			const use = document.createElement("button");
			use.type = "button";
			use.className = "hw-link hw-strip-fit";
			use.dataset.fit = check.fit;
			use.textContent = T("pi.strip.useStyle", "Use {style}", { style: model.STYLE_NAMES[check.fit] });
			parts.push(document.createTextNode(" "), use);
		}
		pane.check.replaceChildren(...parts);
		const ctx = ctxOf(pane, p);
		const held = model.seriesRows(p.style, readings, ctx).some((row) => row.reason === "nolimit");
		pane.check.dataset.tone = check.warn === true || check.fit !== null || held || readings.length > model.drawMax(p.style, ctx.slots, ctx.readout) ? "warn" : "";
	}

	function renderSeries(pane, p, items) {
		const rows = isGroup(p) ? items.map(() => ({ drawn: true, reason: null })) : model.seriesRows(p.style, items, ctxOf(pane, p));
		const styleName = model.isValuesOnly(p) ? T("pi.strip.readoutOnly", "Large values only") : model.STYLE_NAMES[p.style];
		const sig = JSON.stringify([items, rows, styleName]);
		if (pane.series.dataset.signature === sig) return;
		pane.series.dataset.signature = sig;
		const focused = pane.series.contains(document.activeElement) ? document.activeElement.dataset.key : undefined;
		const frag = document.createDocumentFragment();
		items.forEach((r, at) => {
			const li = document.createElement("li");
			li.className = "hw-strip-reading";
			li.dataset.drawn = rows[at].drawn ? "true" : "false";
			const text = document.createElement("span");
			text.className = "hw-strip-reading-text";
			text.textContent = r.found ? `${r.label} · ${r.unit === "" ? "no unit" : model.displayUnit(r.unit, false)}` : "Saved reading (not in HWiNFO's list now)";
			text.title = r.found ? `${r.label} · ${r.source}` : r.key;
			li.appendChild(text);
			if (!rows[at].drawn) {
				const why = document.createElement("span");
				why.className = "hw-strip-reading-note";
				const reason = rows[at].reason;
				why.textContent = reason === "limit" ? T("pi.strip.notDrawnIn", "not drawn in {style}", { style: styleName }) : reason === "nolimit" ? T("pi.strip.notMarkedNoBand", "nothing to mark: no alert band") : T("pi.strip.notDrawnUnit", "not drawn: other unit");
				li.appendChild(why);
			}
			const remove = document.createElement("button");
			remove.type = "button";
			remove.className = "hw-set-remove";
			remove.dataset.key = r.key;
			remove.dataset.pane = String(pane.index);
			remove.textContent = "×";
			remove.setAttribute("aria-label", `Remove ${r.found ? r.label : "this reading"} (number ${at + 1})`);
			li.appendChild(remove);
			frag.appendChild(li);
		});
		pane.series.replaceChildren(frag);
		if (focused !== undefined) {
			const again = pane.series.querySelector(`button[data-key="${CSS.escape(focused)}"]`) ?? pane.series.querySelector("button") ?? $(`sp${pane.index}-search`);
			again?.focus({ preventScroll: true });
		}
	}

	/** A limits row's values, in place: the row is built again only when
	 * what it offers changes, because a commit runs while focus is on its way
	 * to the next field, and a Tab from Warn at must land on Critical at. A
	 * field being typed in keeps its text. */
	function showLimits(li, shown, limits) {
		for (const [selector, value] of [
			["[data-band-warn]", fieldText(shown.warn, limits.warn)],
			["[data-band-crit]", fieldText(shown.crit, limits.crit)]
		]) {
			const input = li.querySelector(selector);
			if (input === document.activeElement || typedInputs.has(input) || input.getAttribute("aria-invalid") === "true") continue;
			if (input.value !== value) input.value = value;
		}
		const box = li.querySelector("input[data-band-below]");
		if (box.checked !== (limits.below === true)) box.checked = limits.below === true;
	}

	/** One row of the Alert bands block, a band's or a Group's limits:
	 * `select` (the caller's), Warn at, Critical at, Lower is worse and the
	 * remove button. `tag` marks the row's controls for the handlers,
	 * `idPart` names them for the focus hand-back. */
	function limitsRow(pane, tag, idPart, select, aria, removeLabel, shown, limits) {
		const li = document.createElement("li");
		li.className = "hw-strip-band";
		li.dataset.band = tag;
		const field = (kind, label, value) => {
			const input = document.createElement("input");
			input.type = "text";
			input.inputMode = "decimal";
			input.autocomplete = "off";
			input.placeholder = label;
			input.value = value === undefined ? "" : String(value);
			input.dataset[kind === "warn" ? "bandWarn" : "bandCrit"] = "";
			input.dataset.textId = `sp${pane.index}-${idPart}-${kind}`;
			input.setAttribute("aria-label", aria(label));
			return input;
		};
		const below = document.createElement("label");
		below.className = "hw-check";
		const box = document.createElement("input");
		box.type = "checkbox";
		box.checked = limits.below === true;
		box.dataset.bandBelow = tag;
		box.dataset.textId = `sp${pane.index}-${idPart}-below`;
		const word = document.createElement("span");
		word.textContent = "Lower is worse";
		below.append(box, word);
		const remove = document.createElement("button");
		remove.type = "button";
		remove.className = "hw-set-remove";
		remove.dataset.bandRemove = tag;
		remove.dataset.textId = `sp${pane.index}-${idPart}-remove`;
		remove.textContent = "×";
		remove.setAttribute("aria-label", removeLabel);
		li.append(select, field("warn", "Warn at", fieldText(shown.warn, limits.warn)), field("crit", "Critical at", fieldText(shown.crit, limits.crit)), below, remove);
		return li;
	}

	function renderBands(pane, p) {
		const fahrenheit = isDoc(st?.group?.config) && st.group.config.fahrenheit === true;
		const unitOf = (band) => model.displayUnit(readingOf(band.key).unit ?? band.unit ?? "", fahrenheit);
		const sig = JSON.stringify([working.screenId, p.bands.map((band) => band.key), p.series.map((s) => s.key), fahrenheit]);
		const full = p.bands.length >= model.MAX_BANDS || p.series.length === 0;
		setAria(pane.bandAdd, full);
		pane.bandAdd.title = p.series.length === 0 ? "Pick a reading first" : full ? `At most ${model.MAX_BANDS} bands per graph` : "";
		if (pane.bands.dataset.signature === sig) {
			// A stamped band shows its limits in the unit on view.
			p.bands.forEach((band, at) => showLimits(pane.bands.children[at], model.limitsShownOf(band, unitOf(band)), band));
			return;
		}
		pane.bands.dataset.signature = sig;
		const focusedId = pane.bands.contains(document.activeElement) ? document.activeElement.dataset.textId : undefined;
		const frag = document.createDocumentFragment();
		p.bands.forEach((band, at) => {
			const unit = unitOf(band);
			const select = document.createElement("select");
			select.dataset.bandKey = String(at);
			select.dataset.textId = `sp${pane.index}-b${at}-key`;
			select.setAttribute("aria-label", `Band ${at + 1}: reading`);
			for (const s of p.series) {
				const r = readingOf(s.key);
				const option = document.createElement("option");
				option.value = s.key;
				option.textContent = r.found ? r.label : "Saved reading";
				select.appendChild(option);
			}
			select.value = band.key;
			frag.appendChild(limitsRow(pane, String(at), `b${at}`, select, (label) => `Band ${at + 1}: ${label}${unit === "" ? "" : ` (${unit})`}`, `Remove band ${at + 1}`, model.limitsShownOf(band, unit), band));
		});
		pane.bands.replaceChildren(frag);
		if (focusedId !== undefined) (pane.bands.querySelector(`[data-text-id="${focusedId}"]`) ?? pane.bandAdd).focus({ preventScroll: true });
	}

	/** A Group pane's limits: one row for every reading of the group, in the
	 * Alert bands block (the band row's own fields). */
	function renderGroupLimits(pane, p) {
		const limits = p.group?.limits;
		const fahrenheit = isDoc(st?.group?.config) && st.group.config.fahrenheit === true;
		const sig = JSON.stringify(["group", working.screenId, limits !== undefined, fahrenheit]);
		setAria(pane.bandAdd, limits !== undefined);
		pane.bandAdd.title = limits !== undefined ? "One set of limits for the whole group" : "";
		if (pane.bands.dataset.signature === sig) {
			if (limits !== undefined) showLimits(pane.bands.children[0], model.limitsShownOf(limits, model.displayUnit(limits.unit ?? "", fahrenheit)), limits);
			return;
		}
		pane.bands.dataset.signature = sig;
		const focusedId = pane.bands.contains(document.activeElement) ? document.activeElement.dataset.textId : undefined;
		const frag = document.createDocumentFragment();
		if (limits !== undefined) {
			const select = document.createElement("select");
			select.disabled = true;
			select.setAttribute("aria-label", "Limits: every reading of the group");
			const option = document.createElement("option");
			option.textContent = "Every reading";
			select.appendChild(option);
			frag.appendChild(limitsRow(pane, "limits", "g", select, (label) => `Every reading: ${label}`, "Remove the limits", model.limitsShownOf(limits, model.displayUnit(limits.unit ?? "", fahrenheit)), limits));
		}
		pane.bands.replaceChildren(frag);
		if (focusedId !== undefined) (pane.bands.querySelector(`[data-text-id="${focusedId}"]`) ?? pane.bandAdd).focus({ preventScroll: true });
	}

	/** Where Build screens can act: a deck with a touch strip, not while a
	 * leave is on its way or a copy or the deck size needs settling; a
	 * running strip only as a Whole strip the panel edits (screens are a
	 * Whole strip's). */
	function buildOn(strip, self) {
		if (!strip || st === null || leaving || isDoc(self.foreign)) return false;
		if (self.joined === true && st.group?.health === "mismatch") return false;
		return live() ? screensOn() : true;
	}

	/** The screens a list ticks. */
	const tickedOf = (list) => list.screens.slice(0, list.fits).filter((screen) => !list.unticked.has(screen.id));
	/** Build's operations for a new strip from a list's ticks. */
	const newStripOps = (list) => model.buildScreensOps(tickedOf(list), { start: 0, first: st.base?.panes?.[0] ?? null }) ?? [];

	/** Build's list for a new strip on this PC, made once per sensor list, so
	 * a push moves nothing. Null until the sensor list is here. */
	function newStripScreens() {
		const groups = hw.state.tree?.groups;
		if (!Array.isArray(groups)) return null;
		const slots = encoders() || 6;
		if (newStripList === null || newStripList.from !== groups || newStripList.slots !== slots) newStripList = { from: groups, slots, screens: model.buildProposal(groups, { slots }).screens };
		return newStripList.screens;
	}

	/** Whether a strip being made here takes Build's list: a Whole strip,
	 * or an independent dial with no strip behind it where one can be made
	 * now; not after One reading only, and not over dials still in the strip
	 * this dial left (the line there offers Rejoin). A dial missing or in
	 * another strip keeps the list until a layout is chosen, where the line
	 * and the note say what it takes. */
	function listFits() {
		if (declined || justMade || leftLive() || model.stayedColumns(st, true).length > 0) return false;
		if (newLayout === "whole") return true;
		return newLayout === null && !isDoc(st.group) && slotsBlock() === null;
	}

	/**
	 * Keeps the list on show true to the state: a running strip's until it
	 * is used or closed (made at the press), a new strip's from this PC's
	 * sensors while it fits. The ticks of a Whole strip being made are what
	 * the plugin previews.
	 */
	function syncBuild(on) {
		if (proposal?.running === true && !(on && live())) proposal = null;
		if (proposal?.running === true) return;
		const screens = on && !live() && listFits() ? newStripScreens() : [];
		// The sensor list is on its way: what is drafted stays as it is.
		if (screens === null) return;
		if (screens.length === 0) proposal = null;
		else {
			const taken = remembered;
			if (proposal === null) remembered = null;
			const unticked = proposal?.unticked ?? new Set(taken === null || taken.length === 0 ? [] : screens.map((screen) => screen.id).filter((id) => !taken.includes(id)));
			proposal = { running: false, screens, skipped: [], start: 0, fits: Math.min(screens.length, model.MAX_SCREENS), unticked };
			// What a first visit opens on: a reveal, not a fold the person chose,
			// so it is not remembered.
			if (foldUntouched && !section.open) {
				foldUntouched = false;
				section.open = true;
			}
		}
		if (making() && newLayout === "whole") {
			const ops = proposal === null ? [] : newStripOps(proposal);
			make = ops.length === 0 ? null : { patch: ops };
		}
		syncSplit();
		mirrorDraft();
	}

	/** Build screens on a running strip: one link while it has one screen,
	 * a tool among the others with several; each opens the list and closes
	 * it again. */
	function renderBuild(strip, self) {
		const on = buildOn(strip, self);
		syncBuild(on);
		const open = proposal?.running === true ? "true" : "false";
		for (const link of [ui.build, toolOf("build")]) if (link.getAttribute("aria-expanded") !== open) link.setAttribute("aria-expanded", open);
		renderBuildList();
	}

	/** The screens on the running strip as Build screens compares them:
	 * each name as shown, what it draws (the box's own copy for the screen
	 * it edits) and what made it. */
	function existingScreens() {
		const list = screenList();
		const names = screenNames(list);
		const config = shownConfig ?? st?.group?.config;
		return list.map((screen, i) => {
			const stored = model.screenPaneOf(config, i);
			return { name: names[i], raw: working !== null && working.screenId === screen.id ? working.panes[0] : stored, origin: isDoc(stored) && typeof stored.origin === "string" ? stored.origin : undefined };
		});
	}

	/** The title of a running strip's list: what its one button will do
	 * with the ticks. */
	function buildListTitle(list, ticked) {
		if (list.screens.length === 0 && list.skipped.length > 0) return T("pi.strip.buildTitleSame", "Build screens for this PC: the strip already has every screen it finds.");
		if (list.screens.length === 0) return T("pi.strip.buildTitleNone", "Build screens for this PC: nothing on this PC fits a screen.");
		if (list.fits === 0) return T("pi.strip.buildTitleFull", "Build screens for this PC: this strip already keeps {max} screens.", { max: model.MAX_SCREENS });
		if (ticked === 0) return T("pi.strip.buildTitleNoTick", "Build screens for this PC: no screen ticked.");
		return T("pi.strip.buildTitleAfter", "Build screens for this PC: adds {count} after screen {last}.", { count: ticked, last: list.start });
	}

	/** The words after a new strip's start in its list's title (the start
	 * dropdown leads it): what Make the strip makes with the ticks. */
	function startWords(ticked) {
		if (ticked === 0) return T("pi.strip.startNoTick", "no screen ticked");
		return ticked === 1 ? T("pi.strip.startWholeOne", "a Whole strip of one screen") : T("pi.strip.startWholeMany", "a Whole strip of {count} screens", { count: ticked });
	}

	/** Build screens' list: what it found, each screen ticked, before
	 * anything is written. It opens where the person looks: under the screen
	 * row on a running strip, above Make the strip on one being made. */
	function renderBuildList() {
		showEl(ui.buildBox, proposal !== null);
		if (proposal === null) return;
		const home = proposal.running ? ui.screensBox : null;
		if (home !== null && ui.buildBox.parentElement !== home) home.append(ui.buildBox);
		else if (home === null && ui.buildBox.nextElementSibling !== ui.edit) ui.edit.before(ui.buildBox);
		const ticked = tickedOf(proposal).length;
		setText(ui.buildUse, proposal.running ? T("pi.strip.useTheseScreens", "Use these screens") : T("pi.strip.makeTheStrip", "Make the strip"));
		// A new strip's way out is One reading only, in the start dropdown
		// that leads the title; a running strip's list has Cancel.
		showEl(ui.buildNo, proposal.running);
		setAria(ui.buildUse, ticked === 0 || (!proposal.running && (blockReason() !== null || pending !== null)));
		setText(ui.buildTitle, proposal.running ? buildListTitle(proposal, ticked) : ` · ${startWords(ticked)}`);
		const sig = JSON.stringify([proposal.screens.map((screen) => [screen.id, model.buildScreenLine(screen)]), proposal.skipped, proposal.fits]);
		if (ui.buildList.dataset.signature !== sig) {
			ui.buildList.dataset.signature = sig;
			const frag = document.createDocumentFragment();
			for (const screen of proposal.screens.slice(0, proposal.fits)) {
				const li = document.createElement("li");
				li.dataset.found = "true";
				// One line a row, cut with an ellipsis; the whole row in its
				// title.
				const row = document.createElement("label");
				row.className = "hw-check hw-check-line";
				row.title = model.buildScreenLine(screen);
				const box = document.createElement("input");
				box.type = "checkbox";
				box.dataset.screen = screen.id;
				const words = document.createElement("span");
				const name = document.createElement("span");
				name.className = "hw-strip-screen-name";
				name.textContent = screen.name;
				words.append(name, document.createTextNode(model.buildScreenLine(screen).slice(screen.name.length)));
				row.append(box, words);
				li.append(row);
				frag.appendChild(li);
			}
			const left = proposal.screens.slice(proposal.fits);
			if (left.length > 0) {
				const li = document.createElement("li");
				li.dataset.found = "false";
				li.textContent = T("pi.strip.buildNoRoom", "{names}: no room, a strip keeps at most {max} screens.", { names: left.map((s) => s.name).join(", "), max: model.MAX_SCREENS });
				frag.appendChild(li);
			}
			if (proposal.skipped.length > 0) {
				// What the strip already draws is not proposed again.
				const li = document.createElement("li");
				li.dataset.found = "same";
				li.textContent = T("pi.strip.buildAlready", "Already on the strip: {names}.", { names: proposal.skipped.join(", ") });
				frag.appendChild(li);
			}
			ui.buildList.replaceChildren(frag);
		}
		for (const box of ui.buildList.querySelectorAll("input[data-screen]")) {
			const on = !proposal.unticked.has(box.dataset.screen);
			if (box.checked !== on) box.checked = on;
		}
	}

	// --- starts: the words that name a strip's start (the owner's pick C) ---------------
	/** This PC's pairs for an Equal split (model.proposeSplits), made once
	 * per sensor list, so a push moves nothing. Null until the sensor list
	 * is here. */
	function splitStarts() {
		const groups = hw.state.tree?.groups;
		if (!Array.isArray(groups)) return null;
		const slots = encoders() || 6;
		if (splitList === null || splitList.from !== groups || splitList.slots !== slots) splitList = { from: groups, slots, starts: model.proposeSplits(groups, { slots }) };
		return splitList.starts;
	}

	/** The start an Equal split being made takes: the one picked, else this
	 * PC's first pair, else each half chosen. */
	const splitNow = (starts) => (splitPick === "own" || starts.some((s) => s.id === splitPick) ? splitPick : (starts[0]?.id ?? "own"));

	/** An Equal split being made previews its start: the pair's operations
	 * over this dial's base, or none for each half chosen. A pick remembered
	 * from another dial's panel is named once the pairs are known. */
	function syncSplit() {
		if (!(making() && newLayout === "split")) return;
		const starts = splitStarts();
		// The sensor list is on its way: the draft stays as it is.
		if (starts === null) return;
		if (rememberedSplit !== null) {
			splitPick = model.splitStartOf(rememberedSplit, starts);
			rememberedSplit = null;
		}
		const start = starts.find((s) => s.id === splitNow(starts));
		const ops = start === undefined ? null : model.splitStartOps(start, st.base);
		make = ops === null || ops.length === 0 ? null : { patch: ops };
	}

	/** The starts a strip being made offers, each { id, name }: a Whole
	 * strip Build's screens for this PC (where its list can show) and One
	 * reading only; an Equal split this PC's pairs, then Choose each half. */
	function startOptions() {
		if (newLayout === "split") return [...(splitStarts() ?? []).map((s) => ({ id: s.id, name: s.name })), { id: "own", name: T("pi.strip.startOwn", "Choose each half") }];
		const listed = !justMade && !leftLive() && model.stayedColumns(st, true).length === 0 && (newStripScreens()?.length ?? 0) > 0;
		return [...(listed ? [{ id: "screens", name: T("pi.strip.startScreens", "Screens for this PC") }] : []), { id: "one", name: T("pi.strip.oneReadingOnly", "One reading only") }];
	}
	const startNow = () => (newLayout === "split" ? splitNow(splitStarts() ?? []) : proposal !== null && !proposal.running ? "screens" : "one");

	/** A select's options, made again only when they change, so a push
	 * never rebuilds a list the person has open. */
	function setOptions(select, options) {
		const sig = JSON.stringify(options);
		if (select.dataset.options === sig) return;
		select.dataset.options = sig;
		select.replaceChildren(
			...options.map((o) => {
				const option = document.createElement("option");
				option.value = o.id;
				option.textContent = o.name;
				return option;
			})
		);
	}

	/**
	 * The words that name a new strip's start: a quiet dropdown in the link
	 * color with a chevron, only where there is a choice. With Build's list
	 * on show they are the first words of its title (one start: plain
	 * words); otherwise they stand on the caption's line in the caption's
	 * place, and with one start the caption stays. A running strip has none:
	 * a running Equal split has Fill both halves (renderFill).
	 */
	function renderStart(strip) {
		const inBox = proposal !== null && !proposal.running;
		const on = strip && !live() && (making() || inBox);
		const options = on ? startOptions() : [];
		const shown = on && (inBox || options.length > 1);
		if (shown) {
			const home = inBox ? ui.buildHead : ui.capline;
			const next = inBox ? ui.buildTitle : ui.capctl;
			if (ui.startPick.parentElement !== home || ui.startPick.nextElementSibling !== next) home.insertBefore(ui.startPick, next);
			setOptions(ui.start, options);
			const value = startNow();
			if (ui.start.value !== value) ui.start.value = value;
			setText(ui.startText, options.find((o) => o.id === value)?.name ?? "");
			const single = options.length > 1 ? "false" : "true";
			if (ui.startPick.dataset.single !== single) ui.startPick.dataset.single = single;
		}
		showEl(ui.startPick, shown);
		showEl(ui.caption, !(shown && !inBox));
	}

	/** The pairs Fill both halves offers on a running Equal split: this
	 * PC's, less the one its halves draw now, whatever the halves hold
	 * (Use asks first over a half a person made: fillPlan). */
	function fillStarts() {
		if (!editing() || working.layout !== "split") return [];
		const config = shownConfig ?? st?.group?.config;
		const starts = splitStarts() ?? [];
		const drawn = model.splitStartIn(config, starts);
		return starts.filter((s) => s.id !== drawn);
	}

	/** Previews a pair on the running split: a draft the plugin draws in
	 * this panel's preview, nothing written. Null drops the preview. */
	function fillAt(id) {
		const start = id === null ? undefined : fillStarts().find((s) => s.id === id);
		const ops = start === undefined ? null : model.splitStartOps(start, shownConfig ?? st?.group?.config);
		if (ops === null || ops.length === 0) {
			const had = fillPick !== null;
			fillPick = null;
			if (had) ask({ draft: null });
			return;
		}
		fillPick = start.id;
		fillRev = shownRev;
		ask({ draft: { patch: ops, baseRev: shownRev } });
	}

	/** What Use does with a pair over the copy in hand: its operations, the
	 * revision they go against, and the question to ask first, null over
	 * halves that hold nothing a person made (model.fillRisk, from the
	 * stored strip alone: its untouched start is the reading it was made
	 * with, which it keeps). */
	function fillPlan(start) {
		const config = shownConfig ?? st?.group?.config;
		const ops = model.splitStartOps(start, config);
		if (ops === null || ops.length === 0) return null;
		const risk = model.fillRisk(config, splitStarts() ?? []);
		const fahrenheit = isDoc(config) && config.fahrenheit === true;
		return { start, ops, rev: shownRev, asks: model.fillAsk(config, risk, start, { readingOf, fahrenheit }) };
	}

	/** Use over a half a person made: the question under the preview, Cancel
	 * focused (the safe choice), nothing sent. */
	function askFill(plan) {
		fillAsking = plan;
		setText(ui.fillAskText, plan.asks.text);
		showEl(ui.fillAlso, plan.asks.whole);
		// Described by the second line only while it shows.
		if (plan.asks.whole) ui.fillAsk.setAttribute("aria-describedby", "strip-fill-also");
		else ui.fillAsk.removeAttribute("aria-describedby");
		render();
		ui.fillAsk.scrollIntoView({ block: "nearest" });
		ui.fillNo.focus({ preventScroll: true });
	}

	/** The question goes with nothing written: Cancel, Escape (where the app
	 * delivers it), focus leaving it. With `refocus`, Use takes focus. */
	function dropAsk(refocus) {
		if (fillAsking === null) return;
		fillAsking = null;
		render();
		if (refocus && drawn(ui.fillUse)) ui.fillUse.focus({ preventScroll: true });
	}

	/**
	 * Fill both halves, at the end of a running Equal split's caption line:
	 * a quiet dropdown of the pairs, or with one pair a plain link. A pick
	 * is a preview only (the caption says so) with Use, which writes it in
	 * one edit, and Cancel. A pair the split no longer offers (the layout
	 * changed, its halves drawn) takes its preview with it, and a newer copy
	 * (another dial's panel changed the strip) is previewed again. The
	 * question Use asked goes with a newer copy, which the status line says,
	 * or another pair: nothing is written, and a new Use asks again. While
	 * it asks, the line's Use and Cancel keep their place unseen (pi.css).
	 */
	function renderFill(strip) {
		const starts = strip ? fillStarts() : [];
		if (fillPick !== null && !starts.some((s) => s.id === fillPick)) fillAt(null);
		else if (fillPick !== null && fillRev !== shownRev) fillAt(fillPick);
		const pick = starts.find((s) => s.id === fillPick);
		let dropped = false;
		if (fillAsking !== null && (pick === undefined || pick.id !== fillAsking.start.id || fillAsking.rev !== shownRev)) {
			dropped = ui.fillAsk.contains(document.activeElement);
			if (fillAsking.rev !== shownRev) {
				resultNote = { tone: "warn", lines: [T("pi.strip.changedElsewhere", "Another dial's panel changed this strip first. Try again.")] };
				hw.announce("strip", resultNote.lines[0], { repeat: true });
			}
			fillAsking = null;
		}
		const many = starts.length > 1;
		showEl(ui.capctl, starts.length > 0);
		const named = many || pick !== undefined;
		showEl(ui.fillPick, named);
		if (named) {
			const head = T("pi.strip.fillBothHalves", "Fill both halves");
			setOptions(ui.fill, [{ id: "", name: head }, ...starts.map((s) => ({ id: s.id, name: s.name }))]);
			const value = pick?.id ?? "";
			if (ui.fill.value !== value) ui.fill.value = value;
			setText(ui.fillText, pick?.name ?? head);
			const single = many ? "false" : "true";
			if (ui.fillPick.dataset.single !== single) ui.fillPick.dataset.single = single;
		}
		showEl(ui.fillOne, starts.length === 1 && pick === undefined);
		if (starts.length === 1) setText(ui.fillOne, T("pi.strip.fillOne", "Fill: {name}", { name: starts[0].name }));
		showEl(ui.fillUse, pick !== undefined);
		showEl(ui.fillCancel, pick !== undefined);
		if (pick !== undefined) {
			const label = T("pi.strip.fillUseLabel", "Use {name} on both halves", { name: pick.name });
			if (ui.fillUse.getAttribute("aria-label") !== label) ui.fillUse.setAttribute("aria-label", label);
		}
		const armed = pick !== undefined ? "true" : "false";
		if (ui.capline.dataset.armed !== armed) ui.capline.dataset.armed = armed;
		const asking = fillAsking !== null ? "true" : "false";
		if (ui.capline.dataset.asking !== asking) ui.capline.dataset.asking = asking;
		// What moves as the question comes or goes (Replace, the Window row)
		// takes no press meant for what was there, a slow second press past
		// the double-click time included (pi-shell's panel move guard).
		if (ui.fillAsk.hidden === (fillAsking !== null)) hw.markPanelScroll();
		showEl(ui.fillAsk, fillAsking !== null);
		if (dropped && drawn(ui.fillUse)) ui.fillUse.focus({ preventScroll: true });
		else if (dropped) focusFill();
	}

	/** After Use or Cancel: focus on the dropdown, else the link, else the
	 * layout. */
	function focusFill() {
		const next = [ui.fill, ui.fillOne, ui.radios.find((r) => r.checked)].find((el) => el !== undefined && drawn(el));
		next?.focus({ preventScroll: true });
	}

	/** The preview and its caption show once there is something to show: a
	 * strip being made (a layout chosen) or a running strip on this dial.
	 * They come and go with a choice or with this dial joining or leaving,
	 * never with a pushed frame; once shown, the box keeps its size before
	 * the first frame. */
	const previewOn = () => st !== null && st.device?.strip === true && (live() || making());

	let shotCount = -1;
	let shotRows = 1;
	function renderPreview() {
		showEl(ui.preview, previewOn());
		const n = encoders();
		const shown = n > 0 ? n : 4;
		if (shotCount !== shown) {
			shotCount = shown;
			// A row holds at most four slices (a +, about 44 px tall at the
			// app's 378 px). One row of a + XL's six left them about 30 px
			// tall, too small to read; its two halves, dials 1 to 3 above
			// dials 4 to 6, are twice that and are the Equal split's halves.
			shotRows = shown > 4 ? 2 : 1;
			const perRow = Math.ceil(shown / shotRows);
			const frag = document.createDocumentFragment();
			for (let r = 0; r < shotRows; r++) {
				const row = document.createElement("div");
				row.className = "hw-strip-shot-row";
				const count = Math.min(perRow, shown - r * perRow);
				row.style.setProperty("--n", String(count));
				for (let c = 0; c < count; c++) {
					const img = document.createElement("img");
					img.alt = "";
					img.width = 200;
					img.height = 100;
					img.dataset.column = String(r * perRow + c);
					row.appendChild(img);
				}
				frag.appendChild(row);
			}
			ui.shots.replaceChildren(frag);
		}
		const preview = st?.preview ?? { kind: "none", slices: [] };
		const slices = Array.isArray(preview.slices) ? preview.slices : [];
		ui.shots.querySelectorAll("img").forEach((img, i) => {
			const svg = typeof slices[i] === "string" ? slices[i] : "";
			if (img.dataset.svg === svg) return;
			img.dataset.svg = svg;
			if (svg === "") img.removeAttribute("src");
			else img.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
		});
		const paused = (st?.group?.panes ?? []).some((p) => p.mode === "paused");
		let caption = T("pi.strip.noPreviewYet", "No preview yet");
		// A draft over a running strip is a pair Fill both halves previews.
		if (preview.kind === "draft") caption = editing() ? T("pi.strip.previewOnly", "Preview only") : T("pi.strip.previewOfTheNew", "Preview of the new strip");
		// Next screen waits while a member's panel is open, so the box never
		// changes under the pointer; the caption says so (status, not help).
		else if (preview.kind === "live") caption = paused ? T("pi.strip.captionPaused", "On the deck now · paused on the deck") : screens?.held === true && screensOn() && (working.screenCycle ?? 0) > 0 && screenList().length >= 2 ? T("pi.strip.captionHeld", "On the deck now · held while this panel is open") : T("pi.strip.captionLive", "On the deck now");
		else if (typeof preview.error === "string" && preview.error !== "") caption = preview.error;
		setText(ui.caption, caption);
		const laid = shotRows === 2 ? ", the left half above the right half" : " side by side";
		const words = slices.length > 0 && preview.kind !== "none" ? `${caption}: ${slices.length} slices${laid}` : caption;
		if (ui.shots.getAttribute("aria-label") !== words) ui.shots.setAttribute("aria-label", words);
	}

	let noteSignature = "";
	function renderNote() {
		const typed = [...invalidText.values()];
		const reason = blockReason();
		const content =
			typed.length > 0 && editing()
				? { tone: "warn", lines: [typed[0]] }
				: (resultNote ?? (reason !== null && making() && pending === null ? { tone: "warn", lines: [reason] } : pending !== null && pending.op !== "edit" ? { tone: "info", lines: ["Waiting for the plugin's answer."] } : { tone: "", lines: [] }));
		const sig = JSON.stringify(content);
		if (sig === noteSignature) return;
		noteSignature = sig;
		ui.note.dataset.tone = content.tone;
		ui.note.replaceChildren(
			...content.lines.map((line) => {
				const para = document.createElement("p");
				para.textContent = line;
				return para;
			})
		);
	}

	/** Make the strip under the preview, while a strip is being made with
	 * no Build list on show: the list holds that button itself. */
	function renderBar(strip) {
		const creating = strip && making() && proposal === null;
		showEl(ui.bar, creating);
		if (!creating) return;
		setAria(ui.go, blockReason() !== null || pending !== null);
	}

	const GESTURE_WORDS = { rotate: "Turn", push: "Push", touch: "Touch", longTouch: "Long touch" };
	let controlsSignature = "";
	function renderControls() {
		const controls = Array.isArray(st?.group?.controls) ? st.group.controls : [];
		const sig = JSON.stringify(controls);
		if (sig === controlsSignature) return;
		controlsSignature = sig;
		const frag = document.createDocumentFragment();
		if (controls.length === 0) {
			const dt = document.createElement("dt");
			dt.textContent = T("pi.strip.inAStrip", "In a strip");
			const dd = document.createElement("dd");
			dd.textContent = "Turn changes the time window, push or touch inspects (freezes the view), long touch goes back to live.";
			frag.append(dt, dd);
		}
		for (const [gesture, words] of controls) {
			const dt = document.createElement("dt");
			dt.textContent = GESTURE_WORDS[gesture] ?? gesture;
			const dd = document.createElement("dd");
			dd.textContent = words;
			frag.append(dt, dd);
		}
		ui.controls.replaceChildren(frag);
	}

	// A dial in a strip draws no reading, alert or gesture of its own, so
	// Reading, Alerts and Controls step aside and return as they were when
	// it leaves: this follows membership, never live data. Display stays: its
	// text color, Background, Words, decimals and °F edit the strip
	// (renderRedirects), and its dial-only controls step aside. The sensor
	// reload serves the strip's lists too, so it stands in the strip's
	// Readings row meanwhile, beside the field that names the first graph's
	// readings, so a screen with no search has it too.
	const DIAL_ONLY = ["sec-reading", "sec-alerts", "sec-interaction"].map((id) => $(id));
	const reload = $("picker-refresh");
	const reloadHome = reload.nextElementSibling;
	const READINGS_FIELDS = { picker: "sp0-search", filter: "sp0-filter", unit: "sp0-unit" };
	let reloadBeside = null;
	function placeListTools(onStrip) {
		const beside = !onStrip ? null : READINGS_FIELDS[working === null ? "picker" : model.readingsFieldOf(working.panes[0])];
		if (beside === reloadBeside) return;
		const hadFocus = document.activeElement === reload;
		if (beside === null) {
			reloadHome.before(reload);
		} else {
			$(beside).after(reload);
		}
		reloadBeside = beside;
		if (hadFocus) reload.focus({ preventScroll: true });
	}
	const displaySection = document.getElementById("sec-display");
	const displayScope = document.getElementById("display-scope");
	function renderDialOnly() {
		const joined = hw.state.preview?.strip?.status === "joined" || st?.self?.joined === true;
		for (const section of DIAL_ONLY) showEl(section, !joined);
		placeListTools(joined);
		const editsStrip = st?.device?.strip === true && editing();
		if (displaySection !== null && displaySection.classList.contains("hw-strip-joined") !== editsStrip) displaySection.classList.toggle("hw-strip-joined", editsStrip);
		showEl(displayScope, editsStrip);
	}
	hw.on("preview", renderDialOnly);

	// --- the new-strip draft (preview only) -----------------------------------------------
	/** The plugin previews a new strip from a draft it keeps in memory: the
	 * layout and the screens ticked. Dropped when the layout goes back to
	 * Independent dials. */
	let draftSaid = "";
	function mirrorDraft() {
		if (st === null || st.device?.strip !== true) return;
		if (making()) {
			const draft = { layout: newLayout, patch: make?.patch ?? [], baseRev: 0 };
			const said = JSON.stringify(draft);
			if (draftSent && said === draftSaid) return;
			draftSent = true;
			draftSaid = said;
			ask({ draft });
		} else if (draftSent) {
			draftSent = false;
			ask({ draft: null });
		}
	}

	// --- the readings checklists -------------------------------------------------------
	for (const pane of panes) {
		if (hw.pickers === undefined) break;
		pane.picker = hw.pickers.create({
			search: $(`sp${pane.index}-search`),
			list: $(`sp${pane.index}-list`),
			tick: (key) => {
				if (working === null) return { on: false, title: "" };
				const p = working.panes[pane.index];
				if (isGroup(p) && ruleOf(p).from === "list") {
					const keys = ruleOf(p).keys;
					const on = keys.some((k) => k === key || hw.pickers.treeEntryOf(k)?.reading.key === key);
					const full = keys.length >= model.GROUP_KEYS_MAX;
					return { on, disabled: !on && full, title: !on && full ? `A list keeps at most ${model.GROUP_KEYS_MAX} readings; untick one first` : "Ticked readings draw in this graph" };
				}
				if (isGroup(p)) {
					const on = p.series.slice(0, 1).some((s) => s.key === key || hw.pickers.treeEntryOf(s.key)?.reading.key === key);
					return { on, title: "Every reading in this reading's folder draws" };
				}
				const on = p.series.some((s) => s.key === key || hw.pickers.treeEntryOf(s.key)?.reading.key === key);
				const full = p.series.length >= model.MAX_SERIES;
				return { on, disabled: !on && full, title: !on && full ? `A graph keeps at most ${model.MAX_SERIES} readings; untick one first` : "Ticked readings draw in this graph" };
			},
			onTick: (key, next) => {
				change((w) => {
					const p = w.panes[pane.index];
					if (isGroup(p) && ruleOf(p).from === "list") {
						const rule = ruleOf(p);
						if (next) {
							if (rule.keys.length < model.GROUP_KEYS_MAX && !rule.keys.includes(key)) rule.keys.push(key);
						} else rule.keys = rule.keys.filter((k) => k !== key && hw.pickers.treeEntryOf(k)?.reading.key !== key);
						return;
					}
					if (isGroup(p)) {
						// One reading names the folder: a new tick replaces it.
						p.series = next ? [{ key }] : [];
						const keys = new Set(p.series.map((s) => s.key));
						p.bands = p.bands.filter((b) => keys.has(b.key));
						return;
					}
					if (next) {
						if (p.series.length < model.MAX_SERIES && !p.series.some((s) => s.key === key)) p.series.push({ key });
					} else {
						p.series = p.series.filter((s) => s.key !== key && hw.pickers.treeEntryOf(s.key)?.reading.key !== key);
						const keys = new Set(p.series.map((s) => s.key));
						p.bands = p.bands.filter((b) => keys.has(b.key));
					}
				});
				// change() renders when it edits; otherwise the ticks redraw here.
				if (!editing()) render();
			},
			alsoWithin: pane.series
		});
	}
	hw.on("tree", () => render());

	// --- events ---------------------------------------------------------------------------
	for (const r of ui.radios) {
		r.addEventListener("change", () => {
			if (!r.checked || st === null) return;
			resultNote = null;
			const value = r.value;
			if (live()) {
				// On a running strip every layout applies at once: Independent
				// dials is this dial leaving (Rejoin brings it back), Whole
				// strip and Equal split switch the running strip.
				if (value === "independent") {
					leaving = true;
					leaveNow();
					return render();
				}
				if (working === null || working.layout === value) return render();
				change((w) => {
					w.layout = value;
				});
				return;
			}
			if (value !== "independent" && leftLive()) {
				// This dial left a strip that still runs here: Whole strip
				// and Equal split bring it back (Rejoin), and a layout other
				// than the strip's follows as one edit once it is back (the
				// stripState handler). The radios wait meanwhile.
				if (pending === null) {
					// A new strip drafted here (a remembered draft) goes, as with
					// Independent dials: the plugin drops its preview and forgets
					// the draft.
					newLayout = null;
					make = null;
					proposal = null;
					take.clear();
					mirrorDraft();
					rejoinLayout = value;
					request("restore", { event: "stripRestore", groupId: st.self.groupId, columns: [st.self.column] });
				}
				return render();
			}
			newLayout = value === "independent" ? null : value;
			if (newLayout !== "whole") make = null;
			if (newLayout === null) {
				proposal = null;
				take.clear();
				splitPick = null;
				rememberedSplit = null;
			}
			render();
		});
	}

	ui.window.addEventListener("change", () =>
		change((w) => {
			w.window = ui.window.value;
		})
	);
	ui.shared.addEventListener("change", () =>
		change((w) => {
			w.sharedWindow = ui.shared.checked;
			if (!w.sharedWindow) for (const p of w.panes) p.window ??= w.window;
		})
	);
	ui.link.addEventListener("input", textTyped);
	ui.link.addEventListener("change", textFlush);

	// --- screens: showing, adding, moving, renaming, removing ---------------------------
	/** Shows a screen on the strip: a runtime command, no settings write.
	 * The list and the box follow at once; the plugin's state confirms. */
	function showScreen(id) {
		if (screens === null || id === null || !editing()) return;
		// What was typed for the screen in the box goes to it first.
		if (typedInputs.size > 0) textFlush();
		if (armedRemove !== null && armedRemove.id !== id) disarmRemove();
		pendingShow = { id, at: performance.now() };
		send({ event: "stripShowScreen", screenId: id });
		if (working !== null && working.screenId !== id) show(shownConfig ?? st.group.config, shownRev);
		render();
	}

	const spokenName = (list, index) => screenNames(list)[index] ?? "";

	/** Earlier and Later (Alt with an arrow): the screen on the strip moves
	 * by one; with `edge`, to the start or the end. It stays on the strip:
	 * the plugin keeps the screen it shows wherever that screen goes. */
	function moveView(step, edge = false) {
		const id = viewId();
		structuralEdit(() => {
			const list = screenList();
			const from = model.screenIndexOf(list, id);
			const op = model.moveScreenOp(from, edge ? (step < 0 ? 0 : list.length - 1) : from + step, list.length);
			if (op === null) return null;
			return {
				op,
				after: (config) => {
					// Found by its new place: a screen known only by its place
					// takes an id with the move.
					const now = screenListIn(config);
					if (now[op.to] !== undefined) hw.announce("strip", T("pi.strip.screenMoved", "{name} is now {n} of {count}", { name: spokenName(now, op.to), n: op.to + 1, count: now.length }), { repeat: true });
				}
			};
		});
	}

	/** Add (and "Add a screen"): a new screen right after the one on the
	 * strip, shown at once with its Filter focused. */
	function addScreen() {
		structuralEdit(() => {
			const list = screenList();
			const op = model.addScreenOp(viewIndexIn(list, shownConfig), list.length);
			if (op === null) return null;
			return {
				op,
				after: (config) => {
					const now = screenListIn(config);
					const added = now[op.at];
					if (added === undefined) return;
					focusFilterSoon = true;
					showScreen(added.id);
					hw.announce("strip", T("pi.strip.screenAdded", "Screen {n} of {count} added. Type its filter.", { n: op.at + 1, count: now.length }), { repeat: true });
				}
			};
		});
	}

	/** Remove asks for a second press, in words, as the panel's other
	 * consequential removes do: a screen holds a graph, a rule, bands and
	 * overlays. The arm belongs to one screen and goes with focus. Delete on
	 * the list arms it too, and opens the tools so the armed Remove shows. */
	function armRemove(id, name, viaKey) {
		armedRemove = { id, at: performance.now() };
		if (!editingScreens) {
			editingScreens = true;
			render();
		}
		const button = toolOf("remove");
		button.dataset.armed = "true";
		setText(button.querySelector("[data-l10n]"), T("pi.strip.removeArmed", "Press again to remove"));
		const label = T("pi.strip.removeArmedLabel", "Press again to remove {name}", { name });
		button.setAttribute("aria-label", label);
		button.title = label;
		hw.announce("strip", viaKey ? T("pi.strip.removeArmedKey", "Press Delete again to remove {name}", { name }) : label, { repeat: true });
	}
	function disarmRemove() {
		armedRemove = null;
		const button = toolOf("remove");
		if (button === null || button.dataset.armed !== "true") return;
		button.dataset.armed = "false";
		setText(button.querySelector("[data-l10n]"), T("pi.strip.remove", "Remove"));
		button.removeAttribute("aria-label");
		button.title = "";
		render();
	}
	function pressRemove(detail, viaKey) {
		const list = screenList();
		const index = viewIndexIn(list, shownConfig);
		const screen = list[index];
		if (screen === undefined || list.length <= 1) return;
		const name = spokenName(list, index);
		if (armedRemove === null || armedRemove.id !== screen.id) return armRemove(screen.id, name, viaKey);
		// The second click of a double click only arms.
		if (!viaKey && (detail > 1 || performance.now() - armedRemove.at < 450)) return;
		disarmRemove();
		const next = model.afterRemove(list, index);
		structuralEdit(() => {
			const now = screenList();
			const op = model.removeScreenOp(model.screenIndexOf(now, screen.id), now.length);
			if (op === null) return null;
			return {
				op,
				after: (config) => {
					const left = screenListIn(config);
					const at = model.screenIndexOf(left, next);
					if (at >= 0) showScreen(next);
					const shown = at >= 0 ? at : 0;
					hw.announce("strip", T("pi.strip.screenRemoved", "Removed {name}. {next} is on the strip.", { name, next: spokenName(left, shown) }), { repeat: true });
				}
			};
		});
	}

	/** Rename (Edit's Rename, or F2 on the list): the name field takes the
	 * list's place at its size; Enter or leaving it applies; empty shows the
	 * automatic name. */
	function startRename() {
		const list = screenList();
		const index = viewIndexIn(list, shownConfig);
		const screen = list[index];
		if (screen === undefined || list.length < 2) return;
		disarmRemove();
		// Named as the list names it (screenNames): a unit rule in the unit the strip shows.
		const fahrenheit = isDoc(st?.group?.config) && st.group.config.fahrenheit === true;
		const auto = model.screenNameOf({ ...screen, name: "" }, model.screenPaneOf(shownConfig ?? st.group.config, index), { readingOf, fahrenheit });
		const input = ui.screenName;
		input.value = screen.name;
		input.dataset.original = screen.name;
		input.dataset.screen = screen.id;
		delete input.dataset.done;
		if (input.flush !== undefined) hw.dropLeaveFlush(input.flush);
		input.flush = undefined;
		input.placeholder = auto;
		input.maxLength = model.SCREEN_NAME_MAX;
		input.setAttribute("aria-label", T("pi.strip.screenNameLabel", "Name of screen {n}; empty shows {auto}", { n: index + 1, auto }));
		renaming = screen.id;
		render();
		input.focus();
		input.select();
	}
	/** Applies a rename to the screen it was typed for, wherever it is now. */
	function commitRename(input, { refocus = false } = {}) {
		if (input.dataset.done === "1" || renaming === null) return;
		input.dataset.done = "1";
		hw.dropLeaveFlush(input.flush ?? (() => {}));
		input.flush = undefined;
		const id = input.dataset.screen;
		const value = input.value.trim();
		renaming = null;
		screensSignature = "";
		const list = screenList();
		const index = model.screenIndexOf(list, id);
		if (index >= 0 && value.slice(0, model.SCREEN_NAME_MAX) !== list[index].name) {
			const op = model.renameScreenOp(index, value);
			// The list shows the new name at once; the plugin's copy confirms.
			nameAtOnce(index, op.value);
			sendEdit([{ op, screenId: id }]);
			hw.announce("strip", op.value === "" ? T("pi.strip.screenNameCleared", "Screen {n} shows its automatic name again", { n: index + 1 }) : T("pi.strip.screenRenamed", "Renamed to {name}", { name: op.value }), { repeat: true });
		}
		render();
		if (refocus) ui.screenSelect.focus({ preventScroll: true });
	}
	/** A name sent for screen `index`, shown before the plugin's copy comes. */
	function nameAtOnce(index, name) {
		const config = clone(shownConfig ?? st.group.config);
		const pane = index === 0 ? config.panes?.[0] : config.screens?.[index - 1];
		if (!isDoc(pane)) return;
		if (name === "") delete pane.name;
		else pane.name = name;
		shownConfig = config;
	}

	/** The screen before or after the one on the strip (`to`: a step, or
	 * "first" / "last"), shown on the strip; it stops at the ends. */
	function stepScreen(to) {
		const list = screenList();
		const index = viewIndexIn(list, shownConfig);
		const at = to === "first" ? 0 : to === "last" ? list.length - 1 : index + to;
		const target = list[Math.max(0, Math.min(list.length - 1, at))];
		if (target !== undefined && target.id !== viewId()) showScreen(target.id);
	}

	ui.gapMode.addEventListener("change", () =>
		change((w) => {
			w.gapMode = ui.gapMode.value;
		})
	);
	ui.cycle.addEventListener("change", () =>
		change((w) => {
			w.screenCycle = model.screenCycleOf(Number(ui.cycle.value));
		})
	);
	ui.addScreen.addEventListener("click", () => addScreen());
	// The list: choosing a name shows that screen on the strip.
	ui.screenSelect.addEventListener("change", () => {
		if (armedRemove !== null) disarmRemove();
		if (ui.screenSelect.value !== viewId()) showScreen(ui.screenSelect.value);
	});
	ui.screenSelect.addEventListener("keydown", (ev) => {
		if (ev.key !== "Delete" && armedRemove !== null) disarmRemove();
		const step = { ArrowLeft: -1, ArrowRight: 1 }[ev.key];
		if (ev.altKey && (step !== undefined || ev.key === "Home" || ev.key === "End")) {
			// Alt with Left or Right moves the screen on the strip; Alt+Home and
			// Alt+End to either end. (Alt+Down still opens the list.)
			ev.preventDefault();
			if (step !== undefined) moveView(step);
			else moveView(ev.key === "Home" ? -1 : 1, true);
			return;
		}
		if (ev.key === "F2") {
			ev.preventDefault();
			startRename();
			return;
		}
		if (ev.key === "Delete") {
			// One press arms, the next removes; a held key's repeats do nothing.
			ev.preventDefault();
			if (!ev.repeat) pressRemove(0, true);
			return;
		}
		if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
		// Left and Right show the screen before or after, Home and End the
		// first or the last (Up and Down move the list's choice as ever).
		const to = step ?? (ev.key === "Home" ? "first" : ev.key === "End" ? "last" : undefined);
		if (to === undefined) return;
		ev.preventDefault();
		stepScreen(to);
	});
	// Under 300 px the place and Edit end This screen's line, above the
	// arrows and the list (pi.css), so there they come first in the row and
	// Tab goes through it as it reads. Focus stays where it was.
	const narrowRow = typeof window.matchMedia === "function" ? window.matchMedia("(max-width: 299px)") : null;
	function orderRow() {
		const first = narrowRow?.matches === true;
		if (first ? ui.pick.firstElementChild === ui.screenPlace : ui.pick.lastElementChild === ui.screenEdit) return;
		const had = document.activeElement;
		const before = first ? ui.pick.firstElementChild : null;
		ui.pick.insertBefore(ui.screenPlace, before);
		ui.pick.insertBefore(ui.screenEdit, before);
		if (had instanceof HTMLElement && had !== document.activeElement && ui.pick.contains(had)) had.focus({ preventScroll: true });
	}
	orderRow();
	if (typeof narrowRow?.addEventListener === "function") narrowRow.addEventListener("change", orderRow);
	else narrowRow?.addListener?.(orderRow);
	ui.screenPrev.addEventListener("click", () => {
		if (ui.screenPrev.getAttribute("aria-disabled") !== "true") stepScreen(-1);
	});
	ui.screenNext.addEventListener("click", () => {
		if (ui.screenNext.getAttribute("aria-disabled") !== "true") stepScreen(1);
	});
	ui.screenEdit.addEventListener("click", () => {
		editingScreens = !editingScreens;
		if (!editingScreens) disarmRemove();
		render();
	});
	ui.screenName.addEventListener("keydown", (ev) => {
		if (ev.key === "Enter") {
			ev.preventDefault();
			commitRename(ui.screenName, { refocus: true });
		} else if (ev.key === "Escape") {
			// Abandon: nothing is written. (The app never delivers Escape;
			// leaving the field unchanged does the same.)
			ev.preventDefault();
			ui.screenName.value = ui.screenName.dataset.original ?? "";
			commitRename(ui.screenName, { refocus: true });
		}
	});
	ui.screenName.addEventListener("input", () => {
		const input = ui.screenName;
		if (input.flush !== undefined) return;
		// Leaving the panel mid-name applies it, like every typed field.
		input.flush = () => commitRename(input);
		hw.addLeaveFlush(input.flush);
	});
	ui.screenName.addEventListener("focusout", () => commitRename(ui.screenName));
	// Remove's arm goes when focus leaves both the list and Remove.
	ui.screensBox.addEventListener("focusout", (ev) => {
		if (armedRemove === null) return;
		const to = ev.relatedTarget;
		if (to !== ui.screenSelect && to !== toolOf("remove")) disarmRemove();
	});
	ui.screenTools.addEventListener("click", (ev) => {
		const tool = ev.target instanceof Element ? ev.target.closest("button[data-tool]") : null;
		if (tool === null) return;
		for (const button of ui.screenTools.querySelectorAll("button")) button.tabIndex = button === tool ? 0 : -1;
		const act = tool.dataset.tool;
		if (tool.getAttribute("aria-disabled") === "true") {
			// Add at eight says why it does nothing.
			if (act === "add") hw.announce("strip", tool.getAttribute("aria-label") ?? "", { repeat: true });
			return;
		}
		if (act !== "remove" && armedRemove !== null) disarmRemove();
		if (act === "earlier" || act === "later") moveView(act === "earlier" ? -1 : 1);
		else if (act === "rename") startRename();
		else if (act === "remove") pressRemove(ev.detail, false);
		else if (act === "add") addScreen();
		else if (act === "build") toggleBuild();
	});
	// The tools row is one Tab stop: arrows move between its buttons.
	ui.screenTools.addEventListener("keydown", (ev) => {
		const buttons = [...ui.screenTools.querySelectorAll("button")];
		const at = buttons.indexOf(ev.target instanceof Element ? ev.target.closest("button") : null);
		const to = { ArrowLeft: at - 1, ArrowRight: at + 1, Home: 0, End: buttons.length - 1 }[ev.key];
		if (at < 0 || to === undefined) return;
		ev.preventDefault();
		const next = buttons[(to + buttons.length) % buttons.length];
		for (const button of buttons) button.tabIndex = button === next ? 0 : -1;
		next.focus();
	});

	for (const pane of panes) {
		const at = (w) => w.panes[pane.index];
		pane.style.addEventListener("change", () =>
			change((w) => {
				const from = at(w).style;
				at(w).style = pane.style.value;
				if (model.isRuleStyle(pane.style.value)) ruleOf(at(w));
				// Events starts on 15 minutes, where throttling shows its pattern.
				if (pane.style.value === "events" && from !== "events") model.startEvents(w, at(w), screenList().length);
			})
		);
		pane.unit.addEventListener("change", () =>
			change((w) => {
				ruleOf(at(w)).unit = pane.unit.value;
			})
		);
		pane.view.addEventListener("change", () =>
			change((w) => {
				ruleOf(at(w)).view = pane.view.value;
			})
		);
		pane.from.addEventListener("change", () =>
			change((w) => {
				const rule = ruleOf(at(w));
				rule.from = pane.from.value;
				// A Unit rule names its unit: the first reading's, else °C.
				if (rule.from === "unit") rule.unit ??= model.NEW_AMBIENT(readingOf(at(w).series[0]?.key ?? "").unit).unit;
				else delete rule.unit;
			})
		);
		pane.filter.addEventListener("input", (ev) => {
			textTyped(ev);
			// The count slot follows each keystroke (the panel's own count).
			if (working !== null && isGroup(working.panes[pane.index])) renderCheck(pane, working.panes[pane.index], []);
		});
		pane.filter.addEventListener("change", textFlush);
		pane.check.addEventListener("click", (ev) => {
			// An example fills the Filter and applies at once.
			const example = ev.target instanceof Element ? ev.target.closest("button[data-example]") : null;
			if (example !== null) {
				pane.filter.value = example.dataset.example;
				textTyped({ target: pane.filter });
				textFlush();
				pane.filter.focus({ preventScroll: true });
				return;
			}
			const button = ev.target instanceof Element ? ev.target.closest("button[data-fit]") : null;
			if (button === null) return;
			const fit = button.dataset.fit;
			change((w) => {
				at(w).style = fit;
			});
			pane.style.focus({ preventScroll: true });
			hw.announce("strip", `${model.STYLE_NAMES[fit]}: every reading draws.`, { repeat: true });
		});
		pane.readout.addEventListener("change", () =>
			change((w) => {
				at(w).readout = pane.readout.value;
			})
		);
		pane.look.addEventListener("change", () =>
			change((w) => {
				at(w).look = pane.look.value;
			})
		);
		pane.window.addEventListener("change", () =>
			change((w) => {
				at(w).window = pane.window.value;
			})
		);
		for (const box of pane.overlays) {
			box.addEventListener("change", () =>
				change((w) => {
					at(w).overlays[box.dataset.overlay] = box.checked;
				})
			);
		}
		for (const input of [pane.min, pane.max]) {
			input.addEventListener("input", textTyped);
			input.addEventListener("change", textFlush);
		}
		pane.series.addEventListener("click", (ev) => {
			const button = ev.target instanceof Element ? ev.target.closest("button[data-key]") : null;
			if (button === null) return;
			change((w) => {
				const p = at(w);
				if (isGroup(p) && ruleOf(p).from === "list") {
					ruleOf(p).keys = ruleOf(p).keys.filter((k) => k !== button.dataset.key);
					return;
				}
				p.series = p.series.filter((s) => s.key !== button.dataset.key);
				const keys = new Set(p.series.map((s) => s.key));
				p.bands = p.bands.filter((b) => keys.has(b.key));
			});
		});
		pane.bandAdd.addEventListener("click", () => {
			if (working === null) return;
			const p = at(working);
			if (isGroup(p)) {
				const rule = ruleOf(p);
				if (rule.limits !== undefined) return;
				textFlush();
				// The limits wait in this panel until a number is typed; they are
				// typed for the unit the group draws.
				const unit = st?.group?.counts?.[pane.index]?.unit;
				rule.limits = { below: false, ...(typeof unit === "string" && unit !== "" ? { unit } : {}) };
				render();
				pane.bands.querySelector('li[data-band="limits"] [data-band-warn]')?.focus();
				return;
			}
			if (p.bands.length >= model.MAX_BANDS || p.series.length === 0) return;
			textFlush();
			// A new band has no number yet: it waits in this panel until one is typed.
			const key = p.series[0].key;
			const unit = readingOf(key).unit;
			p.bands.push({ key, below: false, ...(typeof unit === "string" ? { unit } : {}) });
			render();
			pane.bands.querySelector(`li[data-band="${p.bands.length - 1}"] [data-band-warn]`)?.focus();
		});
		pane.bands.addEventListener("input", (ev) => {
			if (ev.target instanceof HTMLInputElement && ev.target.type === "text") textTyped(ev);
		});
		pane.bands.addEventListener("change", (ev) => {
			const el = ev.target;
			if (el instanceof HTMLSelectElement && el.dataset.bandKey !== undefined) {
				textFlush();
				change((w) => {
					const band = at(w).bands[Number(el.dataset.bandKey)];
					if (band === undefined) return;
					band.key = el.value;
					const unit = readingOf(el.value).unit;
					if (typeof unit === "string") band.unit = unit;
					else delete band.unit;
				});
			} else if (el instanceof HTMLInputElement && el.dataset.bandBelow !== undefined) {
				textFlush();
				change((w) => {
					const band = el.dataset.bandBelow === "limits" ? at(w).group?.limits : at(w).bands[Number(el.dataset.bandBelow)];
					if (band !== undefined && band !== null) band.below = el.checked;
				});
			} else if (el instanceof HTMLInputElement && el.type === "text") {
				textFlush();
			}
		});
		pane.bands.addEventListener("click", (ev) => {
			const button = ev.target instanceof Element ? ev.target.closest("button[data-band-remove]") : null;
			if (button === null) return;
			textFlush();
			change((w) => {
				if (button.dataset.bandRemove === "limits") {
					if (at(w).group !== null) delete at(w).group.limits;
					return;
				}
				at(w).bands.splice(Number(button.dataset.bandRemove), 1);
			});
		});
	}

	// Build screens: the list shows what it found first; nothing changes
	// until its one button.
	/** The link or the tool that opened a running strip's list. */
	const buildOpener = () => (screenList().length >= 2 ? toolOf("build") : ui.build);
	/** Opens a running strip's list, or closes it again. */
	function toggleBuild() {
		if (proposal !== null) return closeBuild({ fromOpener: true });
		if (!screensOn()) return;
		const start = screenList().length;
		// The screens it has: a proposal that draws the same readings is left
		// out, and no two screens share a name.
		const found = model.buildProposal(hw.state.tree?.groups ?? [], { slots: encoders() || 6, existing: existingScreens(), canon: (key) => hw.pickers?.treeEntryOf(key)?.reading.key ?? key });
		proposal = { running: true, screens: found.screens, skipped: found.skipped, start, fits: Math.max(0, Math.min(found.screens.length, model.MAX_SCREENS - start)), unticked: new Set() };
		render();
		const top = window.scrollY;
		ui.buildBox.scrollIntoView({ block: "nearest" });
		// Brought into view, the list moves the page under the resting
		// pointer: a slow second press there, past the double-click time,
		// ticks nothing (pi-shell's panel move guard, as Fill's question). In
		// place, it opens under the link, which a second press closes.
		if (window.scrollY !== top) hw.markPanelScroll();
		ui.buildUse.focus({ preventScroll: true });
	}
	/** A running strip's list is done: focus goes back to what opened it,
	 * or to Edit when the tools have closed meanwhile. Closed by its own
	 * Use or Cancel, what moves up under the pointer takes no slow second
	 * press; the link that opened it stays where it was. */
	function closeBuild({ fromOpener = false } = {}) {
		proposal = null;
		const opener = buildOpener();
		render();
		if (!fromOpener) hw.markPanelScroll();
		(drawn(opener) ? opener : ui.screenEdit).focus({ preventScroll: true });
	}
	ui.build.addEventListener("click", toggleBuild);
	ui.buildList.addEventListener("change", (ev) => {
		const box = ev.target;
		if (!(box instanceof HTMLInputElement) || box.dataset.screen === undefined || proposal === null) return;
		if (box.checked) proposal.unticked.delete(box.dataset.screen);
		else proposal.unticked.add(box.dataset.screen);
		render();
	});
	ui.buildUse.addEventListener("click", () => {
		if (proposal === null || st === null) return;
		if (ui.buildUse.getAttribute("aria-disabled") === "true") {
			if (!proposal.running) sayWhyNot();
			return;
		}
		// A strip being made is made with every screen ticked, at once.
		if (!proposal.running) return makeStrip();
		// One edit adds every screen ticked after the ones there now; the
		// first new one shows on the strip.
		const chosen = tickedOf(proposal);
		structuralEdit(() => {
			const start = screenList().length;
			const ops = model.buildScreensOps(chosen, { start });
			if (ops === null || ops.length === 0) return null;
			const names = chosen.slice(0, model.MAX_SCREENS - start).map((s) => s.shownName ?? s.name);
			return {
				ops,
				after: (config) => {
					const added = screenListIn(config)[start];
					if (added !== undefined) showScreen(added.id);
					hw.announce("strip", T("pi.strip.screensBuilt", "Added {names}.", { names: names.join(", ") }), { repeat: true });
				}
			};
		});
		closeBuild();
	});
	ui.buildNo.addEventListener("click", () => {
		if (proposal?.running === true) closeBuild();
	});
	// The start of a strip being made. One reading only: the strip this
	// dial's reading makes, previewed, with its own Make the strip; Screens
	// for this PC brings Build's list back, ticked; an Equal split's pair or
	// Choose each half is previewed. Focus stays on the dropdown wherever it
	// moves (renderStart).
	ui.start.addEventListener("change", () => {
		const id = ui.start.value;
		if (id === "screens") declined = false;
		else if (id === "one") {
			declined = true;
			proposal = null;
			make = null;
			newLayout = "whole";
		} else splitPick = id;
		render();
	});
	// Fill both halves on a running Equal split: a pick previews, nothing
	// written; Use writes it in one edit, built from the copy in hand when it
	// goes (the revision it names has the plugin refuse it if another panel
	// changed the strip first); over a half a person made it asks first, and
	// only Replace writes; Cancel drops the preview.
	ui.fill.addEventListener("change", () => {
		fillAt(ui.fill.value === "" ? null : ui.fill.value);
		render();
	});
	ui.fillOne.addEventListener("click", () => {
		const only = fillStarts();
		if (only.length !== 1) return;
		fillAt(only[0].id);
		render();
		if (drawn(ui.fillUse)) ui.fillUse.focus({ preventScroll: true });
	});
	ui.fillUse.addEventListener("click", () => {
		const start = fillStarts().find((s) => s.id === fillPick);
		if (start === undefined || fillAsking !== null) return;
		// With this panel's own change on its way (a number typed, sent as
		// focus left it), what Use does is settled over the copy that
		// answers it, in the build below.
		if (pending === null && queued.length === 0 && structural.length === 0) {
			const plan = fillPlan(start);
			if (plan === null) return;
			if (plan.asks !== null) return askFill(plan);
		}
		fillAt(null);
		structuralEdit(
			() => {
				// The copy in hand when it goes: one that holds a half a person
				// made asks first.
				const now = fillPlan(start);
				if (now === null) return null;
				if (now.asks === null) return { ops: now.ops };
				fillAt(start.id);
				askFill(now);
				return null;
			},
			{ anyStrip: true }
		);
		render();
		focusFill();
	});
	ui.fillNo.addEventListener("click", () => dropAsk(true));
	// Replace writes what it asked about, once, against the revision it was
	// asked over: a newer copy is the plugin's to refuse, never overwritten.
	ui.fillYes.addEventListener("click", () => {
		const plan = fillAsking;
		if (plan === null || !editing()) return;
		fillAsking = null;
		fillAt(null);
		resultNote = null;
		structuralAfter = null;
		request("edit", { event: "stripEdit", groupId: st.self.groupId, baseRev: plan.rev, patch: plan.ops });
		render();
		focusFill();
	});
	ui.fillAsk.addEventListener("keydown", (ev) => {
		if (ev.key !== "Escape") return;
		ev.preventDefault();
		dropAsk(true);
	});
	// Focus leaving the question for another control or the page is
	// dismissal, read once focus has landed: a press inside it keeps it (the
	// box takes focus), and so does the app's window losing focus (the
	// panel keeps its focused control).
	ui.fillAsk.addEventListener("focusout", () => {
		setTimeout(() => {
			if (fillAsking !== null && !ui.fillAsk.contains(document.activeElement)) dropAsk(false);
		}, 0);
	});
	ui.fillCancel.addEventListener("click", () => {
		fillAt(null);
		render();
		focusFill();
	});
	/** A press on a Make the strip that cannot go: the reason is in the note,
	 * said again for the press. */
	function sayWhyNot() {
		const reason = blockReason();
		if (reason !== null) hw.announce("strip", reason, { repeat: true });
	}
	/** Make the strip, with the screens ticked if Build's list is on show. */
	function makeStrip() {
		resultNote = null;
		const layout = newLayout ?? "whole";
		const patch = proposal !== null ? newStripOps(proposal) : (make?.patch ?? []);
		if (making() || proposal !== null) request("create", { event: "stripCreate", layout, columns: "all", ...(take.size > 0 ? { take: [...take].sort((a, b) => a - b) } : {}), ...(patch.length > 0 ? { patch } : {}) });
		render();
	}

	// The dial marks: one Tab stop, arrows between them; a mark shows its
	// dial's line under the row, and shows it no more when chosen again.
	ui.slots.addEventListener("click", (ev) => {
		const button = ev.target instanceof Element ? ev.target.closest("button[data-column]") : null;
		if (button === null) return;
		const column = Number(button.dataset.column);
		rovingColumn = column;
		revealed = revealed === column ? null : column;
		render();
	});
	ui.slots.addEventListener("keydown", (ev) => {
		const buttons = [...ui.slots.querySelectorAll("button[data-column]")];
		const at = buttons.indexOf(ev.target instanceof Element ? ev.target.closest("button") : null);
		const to = { ArrowLeft: at - 1, ArrowUp: at - 1, ArrowRight: at + 1, ArrowDown: at + 1, Home: 0, End: buttons.length - 1 }[ev.key];
		if (at < 0 || to === undefined) return;
		ev.preventDefault();
		const next = buttons[Math.max(0, Math.min(buttons.length - 1, to))];
		rovingColumn = Number(next.dataset.column);
		for (const button of buttons) button.tabIndex = button === next ? 0 : -1;
		next.focus();
	});

	ui.detail.addEventListener("change", (ev) => {
		const box = ev.target;
		if (!(box instanceof HTMLInputElement) || box.dataset.take === undefined) return;
		const column = Number(box.dataset.take);
		if (box.checked) take.add(column);
		else take.delete(column);
		render();
	});
	// Moving a dial out of another strip asks for a second, fresh press.
	let armedMove = null;
	ui.detail.addEventListener("click", (ev) => {
		const button = ev.target instanceof Element ? ev.target.closest("button[data-slot-action]") : null;
		if (button === null || st === null || pending !== null) return;
		const column = Number(button.dataset.column);
		const groupId = st.self.groupId;
		const action = button.dataset.slotAction;
		if (action === "move" && armedMove !== column) {
			armedMove = column;
			button.dataset.armed = "true";
			button.textContent = "Press again to move";
			button.addEventListener(
				"blur",
				() => {
					armedMove = null;
					button.dataset.armed = "false";
					button.textContent = "Move here";
				},
				{ once: true }
			);
			hw.announce("strip", `Press again to move dial ${column + 1} out of its other strip into this one.`, { repeat: true });
			return;
		}
		armedMove = null;
		resultNote = null;
		if (action === "rejoin") request("restore", { event: "stripRestore", groupId, columns: [column] });
		else if (action === "add") request("join", { event: "stripJoin", groupId, columns: [column] });
		else if (action === "move") request("join", { event: "stripJoin", groupId, columns: [column], take: [column] });
	});

	// The left dial's line: Rejoin (this dial), Every dial leaves (the
	// dials of that strip still in it; the plugin finds them from this
	// dial's left copy) and Restore the strip (every dial that left).
	const lineAction = (op, columns) => {
		if (st === null || !isDoc(st.group) || pending !== null) return;
		resultNote = null;
		pendingLeaveAll = op === "leave";
		request(op, { event: op === "leave" ? "stripLeave" : "stripRestore", groupId: st.self.groupId, columns });
		render();
	};
	ui.rejoin.addEventListener("click", () => lineAction("restore", [st?.self.column]));
	ui.leaveAll.addEventListener("click", () => lineAction("leave", "all"));
	ui.restoreAll.addEventListener("click", () => lineAction("restore", "all"));
	// The pasted copy's choice and the deck's dials: each goes once the
	// change on its way is answered, over the strip as it is then.
	const resolveAs = (use) => () => (isDoc(st.self.foreign) ? { event: "stripResolve", use, ...(st.self.groupId ? { groupId: st.self.groupId } : {}) } : null);
	ui.keepGroup.addEventListener("click", () => requestNext("resolve", resolveAs("group")));
	ui.useDial.addEventListener("click", () => requestNext("resolve", resolveAs("thisDial")));
	ui.retargetGo.addEventListener("click", () => requestNext("edit", () => (st.group?.health === "mismatch" ? { event: "stripEdit", groupId: st.self.groupId, baseRev: st.group.rev, patch: [{ op: "set", path: "encoders", value: st.device.encoders }] } : null)));

	ui.go.addEventListener("click", () => {
		if (st === null) return;
		if (ui.go.getAttribute("aria-disabled") === "true") return sayWhyNot();
		makeStrip();
	});

	// --- start ------------------------------------------------------------------------------
	client.sendToPropertyInspector.subscribe((ev) => {
		const p = ev?.payload;
		if (isDoc(p) && p.event === "panelFolds" && p.kind === "dial" && isDoc(p.folds) && typeof p.folds["sec-strip"] !== "boolean") {
			foldUntouched = true;
			render();
		}
		// The dial marks fill in the accent of the theme the strip draws in.
		if (isDoc(p) && p.event === "themes" && isDoc(p.themes)) {
			themesInfo = p;
			render();
		}
	});
	hw.announce("strip", ""); // primed: the first answer is spoken
	hw.summary("strip", () => model.summary(st));
	client.getConnectionInfo().then(() => ask());
	render();
})();
