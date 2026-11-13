/* Pure logic for the Sensor Dial panel's Strip section, loaded by the
   panel and by the unit tests without a DOM: the edit operations one
   change sends, the per-style checks and what each reading row says, the
   dial row's marks and status line, the section summary, the roles
   that find readings in the live sensor list, and Build screens for
   this PC (screens from this PC's sensors, sent as one edit).

   Nothing here writes or sends anything. The plugin is the only writer of
   a dial's stripGroup; the panel sends it whitelisted operations against
   the revision it shows (src/strip/edits.ts) the moment a control changes.
   The limits below mirror src/strip/settings.ts (SERIES_LIMITS, MAX_SERIES,
   windows, overlays, bands) and are checked against it by
   test/pi-strip-model.test.ts.

   Screens: a Whole strip keeps up to MAX_SCREENS full strip views. The
   first is panes[0], the rest sit in config.screens in order, each a pane
   plus a name and a screenId the plugin mints. The panel names a screen
   by its id and turns it into an edit path (panes.0, screens.<n>) only
   when it sends, so a change typed for one screen lands on that screen
   wherever the list has moved it meanwhile. */
/* exported hwStripModel */
self.hwStripModel = (() => {
	"use strict";

	/** A panel string (ui/pi-strings.js, catalog key pi.*), or the English
	 * written here when that script is not loaded (the unit tests). */
	const T = (key, english, params) => (typeof hwT === "function" ? hwT(key, english, params) : english.replace(/\{(\w+)\}/g, (whole, name) => (params !== undefined && Object.hasOwn(params, name) ? String(params[name]) : whole)));
	const isDoc = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
	const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
	// The Filter grammar is pi-model.js's (loaded first, as the panel does).
	const hwModel = self.hwModel;

	const STYLES = ["trend", "area", "compare", "lanes", "heat", "group", "ambient", "meters", "events"];
	const STYLE_NAMES = { trend: "Trend", area: "Area", compare: "Compare", lanes: "Lanes", heat: "Heat", group: "Group", ambient: "Ambient", meters: "Meters", events: "Events" };
	const SERIES_LIMITS = { trend: { min: 1, max: 3 }, area: { min: 1, max: 3 }, compare: { min: 2, max: 4 }, lanes: { min: 2, max: 3 }, heat: { min: 1, max: 1 }, group: { min: 0, max: 1 }, ambient: { min: 0, max: 1 }, meters: { min: 1, max: 6 }, events: { min: 1, max: 4 } };
	// Styles that lay out their own pane and take no Readout
	// (src/strip/geometry.ts ownsLayout).
	const OWN_LAYOUT = ["meters", "events"];
	// Show on the graph boxes a style draws nothing for, hidden in its pane
	// (test/strip-overlay-effect.test.ts checks this against the renderer).
	const OVERLAYS_UNUSED = { heat: ["minmax"], lanes: ["legend"], group: ["minmax"], meters: ["current", "minmax", "axes"], events: ["current", "minmax", "time"] };
	// A Group's Tiles and Now draw no Scale and grid: Tiles has no scale, and
	// Now always draws its own.
	const overlayUsed = (style, overlay, view, readout) => (isValuesOnly({ style, readout }) ? !VALUES_ONLY_UNUSED.includes(overlay) : !(OVERLAYS_UNUSED[style] ?? []).includes(overlay) && !(style === "group" && overlay === AXES && (view === "tiles" || view === "now")));
	// Large values only draws its own marks whatever Graph is stored: no line
	// value, no window min and max, no Scale and grid.
	const VALUES_ONLY_UNUSED = ["current", "minmax", "axes"];
	// The window a pane gets when it switches to Events: throttling and
	// limits show their pattern over a quarter of an hour.
	const EVENTS_WINDOW = "15m";
	/** The window a pane's first pick of Events starts on: the pane's own, or
	 * the strip's when no other graph shares it (a Whole strip's window is
	 * every screen's). */
	function startEvents(w, pane, screens) {
		if (w.layout === "split" && !w.sharedWindow) pane.window = EVENTS_WINDOW;
		else if (w.layout === "whole" && screens < 2) w.window = EVENTS_WINDOW;
	}
	// The Group and Ambient styles draw a rule's readings
	// (src/strip/settings.ts StripGroupRule): the folder of the pane's first
	// reading, a detail filter, a custom list, or every reading of this PC
	// in one unit; at most GROUP_DRAW_MAX (Group, one unit) or AMBIENT_DRAW_MAX
	// (Ambient, every unit) drawn.
	const RULE_STYLES = ["group", "ambient"];
	const GROUP_SOURCES = ["folder", "filter", "list", "unit"];
	const AMBIENT_DRAW_MAX = 48;
	const UNIT_MAX = 16;
	const GROUP_VIEWS = ["auto", "rows", "now", "spread", "tiles"];
	const GROUP_DRAW_MAX = 32;
	const GROUP_KEYS_MAX = 128;
	// A pane keeps up to six readings whatever its style (Meters on a + XL);
	// a style draws the first SERIES_LIMITS[style].max of them and the rest
	// stay saved.
	const MAX_SERIES = 6;
	// Large values per pane (src/strip/settings.ts STRIP_READOUTS); "off" is
	// the stored absence of the field.
	const READOUTS = ["off", "left", "only"];
	// Meters' Look (src/strip/settings.ts STRIP_METER_LOOKS); "thin" is the
	// stored absence: today's Meters.
	const METER_LOOKS = ["thin", "full", "liquid"];
	// Brief gaps, for the whole strip (src/strip/settings.ts STRIP_GAP_MODES);
	// "connect" is the stored absence of the field.
	const GAP_MODES = ["connect", "mark", "gaps"];
	// The styles that draw a line whatever else the pane says.
	const GAP_MODE_STYLES = ["trend", "area", "compare", "lanes"];
	// The Scale and grid overlay (StripOverlays.axes): stored only when on.
	const AXES = "axes";
	const WINDOWS = ["1m", "5m", "15m"];
	const OVERLAYS = ["current", "minmax", "unit", "legend", "time"];
	const DEFAULT_OVERLAYS = { current: true, minmax: false, unit: true, legend: true, time: true };
	const MAX_BANDS = 4;
	const COUNT_WORDS = ["no", "one", "two", "three", "four", "five", "six"];
	const MAX_OPS = 40;
	// The dial's exact Background values (src/ui/dial-background.ts); the
	// strip carries its own copy, seeded once from the dial that made it.
	const BACKGROUNDS = ["theme", "glass", "tint", "outline", "clear", "stars", "dusk", "nebula"];
	/** The art looks' Stars and Sky color (deck-art.ts ART_STARS,
	 * ART_TONES). */
	const STARS = ["all", "few", "off"];
	const TONES = ["theme", "deep", "warm", "cool", "mono"];
	/** The strip's text modes ("" is Default), decimals and its custom
	 * color's form, as src/strip/edits.ts takes them. */
	const TEXT_MODES = ["theme", "dim", "custom"];
	const DECIMALS = ["auto", "0", "1", "2", "3"];
	const HEX6 = /^#[0-9A-Fa-f]{6}$/;

	// A style this version does not know reads as Trend, and a stored Fleet as
	// a Group at View Now (CUT_STYLES in src/strip/settings.ts).
	const styleOf = (raw) => (STYLES.includes(raw) ? raw : raw === "fleet" ? "group" : "trend");

	// Screens (Whole strip only): panes[0] and up to seven more.
	const MAX_SCREENS = 8;
	/** Seconds between automatic screen changes; anything else is By hand. */
	const SCREEN_CYCLES = [10, 30, 60, 300];
	/** A stored name (MAX_NAME_LENGTH, as a series name). */
	const SCREEN_NAME_MAX = 64;
	/** What a chip shows of a name: it fits the chip's name span. */
	const SCREEN_LABEL_MAX = 24;
	const screenCycleOf = (raw) => (SCREEN_CYCLES.includes(raw) ? raw : 0);
	/** The path screen `index` of the list keeps its fields under. */
	const screenPrefix = (index) => (Number.isInteger(index) && index > 0 ? `screens.${index - 1}` : "panes.0");
	const SCREEN_PATH = /^(?:panes\.0|screens\.(\d+))\.(.+)$/;
	/** The screen an edit path addresses (its place in the list) and the
	 * field under it; null for a path outside every screen (the layout, the
	 * window, the right half). */
	function screenPathOf(path) {
		const m = typeof path === "string" ? SCREEN_PATH.exec(path) : null;
		return m === null ? null : { index: m[1] === undefined ? 0 : Number(m[1]) + 1, field: m[2] };
	}

	/** A filter as the plugin keeps it (detailFilterOf): trimmed, cut at
	 * 128 characters, undefined when no alternative is left. */
	const groupFilterOf = (raw) => hwModel.detailFilterPattern(raw) || undefined;

	/** Group limits as the plugin keeps them, or undefined with no number. */
	function groupLimitsOf(raw) {
		if (!isDoc(raw)) return undefined;
		const out = {};
		if (typeof raw.warn === "number" && Number.isFinite(raw.warn)) out.warn = raw.warn;
		if (typeof raw.crit === "number" && Number.isFinite(raw.crit)) out.crit = raw.crit;
		if (out.warn === undefined && out.crit === undefined) return undefined;
		out.below = raw.below === true;
		if (typeof raw.unit === "string" && raw.unit.length <= 16) out.unit = raw.unit;
		withStampFields(out, raw);
		return out;
	}

	// ---- the unit stamp on a strip scale, band or Group limits -----------------------
	// The 1.8 key grammar (src/alerts/rules.ts stampCounts, src/strip/
	// settings.ts): displayUnit is the unit on view when the numbers were
	// typed, and it counts only while displayUnitFor records exactly the text
	// of the numbers stored beside it.
	const STAMP_UNIT_MAX = 16;
	const STAMP_TEXT_MAX = 32;
	const stampText = (raw) => (typeof raw === "string" ? raw : typeof raw === "number" && Number.isFinite(raw) ? String(raw) : undefined);

	/** Copies a stored entry's stamp fields as stored (within their bounds),
	 * so the working copy carries them and a stamp that stops counting is
	 * dropped by the plugin on its next rewrite. */
	function withStampFields(out, raw) {
		if (typeof raw.displayUnit === "string" && raw.displayUnit.length <= STAMP_UNIT_MAX) out.displayUnit = raw.displayUnit;
		if (isDoc(raw.displayUnitFor) && Object.values(raw.displayUnitFor).every((v) => typeof v === "string" && v.length <= STAMP_TEXT_MAX)) out.displayUnitFor = { ...raw.displayUnitFor };
		return out;
	}

	/** The stamp of an entry when it counts for the numbers named, else
	 * undefined (src/strip/settings.ts stampOf); "" for numbers typed for a
	 * reading with no unit. */
	function stampOf(entry, names) {
		if (!isDoc(entry)) return undefined;
		const unit = entry.displayUnit;
		const record = entry.displayUnitFor;
		if (typeof unit !== "string" || unit.length > STAMP_UNIT_MAX || !isDoc(record)) return undefined;
		if (Object.values(record).some((v) => typeof v !== "string" || v.length > STAMP_TEXT_MAX)) return undefined;
		for (const name of names) {
			const recorded = Object.hasOwn(record, name) ? record[name] : undefined;
			if (stampText(entry[name]) !== recorded) return undefined;
		}
		return unit;
	}

	/** The record a stamp writes: each number's text, by name. */
	function stampRecord(entry, names) {
		const out = {};
		for (const name of names) {
			const text = stampText(entry[name]);
			if (text !== undefined) out[name] = text;
		}
		return out;
	}

	/** A value moved between two units the plugin converts between
	 * (src/ui/format.ts valueBetweenUnits): identity, °C and °F, Δ°C and
	 * Δ°F; undefined for any other pair. */
	function valueBetweenUnits(value, unit, target) {
		if (unit === target) return value;
		if (unit === "°C" && target === "°F") return value * 1.8 + 32;
		if (unit === "°F" && target === "°C") return (value - 32) / 1.8;
		if (unit === "Δ°C" && target === "Δ°F") return value * 1.8;
		if (unit === "Δ°F" && target === "Δ°C") return value / 1.8;
		return undefined;
	}

	/** A number as a field shows it: up to three decimals, no trailing zeros. */
	const shownNumber = (n) => String(Number(n.toFixed(3)));

	/** The numbers of a stamped entry in the unit on view (`view`): with a
	 * counting stamp that pairs with it, converted (90 typed in °C shows 194
	 * under °F); otherwise as stored. */
	function stampedShown(entry, names, view) {
		const stamp = stampOf(entry, names);
		const out = {};
		for (const name of names) {
			const n = entry?.[name];
			if (typeof n !== "number" || !Number.isFinite(n)) continue;
			const converted = stamp === undefined ? undefined : valueBetweenUnits(n, stamp, view);
			out[name] = converted === undefined ? n : Number(converted.toFixed(6));
		}
		return out;
	}

	/** An entry with `names` set to what shows (`shown`, numbers in the unit
	 * on view) and stamped with that unit ("" for a reading with no unit):
	 * the record of exactly those numbers. No unit known (undefined): the
	 * numbers alone, unstamped. */
	function stamped(entry, names, shown, view) {
		const out = { ...entry };
		delete out.displayUnit;
		delete out.displayUnitFor;
		for (const name of names) {
			if (typeof shown[name] === "number") out[name] = shown[name];
			else delete out[name];
		}
		if (typeof view === "string" && view.length <= STAMP_UNIT_MAX && names.some((name) => typeof out[name] === "number")) {
			out.displayUnit = view;
			out.displayUnitFor = stampRecord(out, names);
		}
		return out;
	}

	// ---- Scale from and Scale to ------------------------------------------------------

	/** Where Scale from and Scale to show (both or neither): every style
	 * that draws a value scale; never on Group
	 * (it ignores a stored scale), Events, Ambient or Large values only
	 * (src/strip/scale.ts resolvedScale; test/strip-overlay-effect.test.ts
	 * checks this against the renderer). */
	const SCALE_SHOWN = { trend: "both", area: "both", compare: "both", lanes: "both", heat: "both", meters: "both", group: "none", events: "none", ambient: "none" };

	/** "both" or "none" for a pane drawing readings in `units`
	 * (native). With no drawn reading other than Yes/No (always 0 to 1) the
	 * fields hide too, and so they do on a Meters Full bar or Liquid of
	 * percentages, which keeps 0 to 100 (src/strip/fill.ts). */
	function scaleShown(style, readout, units, look = "thin") {
		const shown = SCALE_SHOWN[style] ?? "none";
		if (shown === "none") return "none";
		if (readout === "only" && !OWN_LAYOUT.includes(style)) return "none";
		if (Array.isArray(units) && units.length > 0 && units.every((u) => u === "Yes/No")) return "none";
		if (style === "meters" && look !== "thin" && METER_LOOKS.includes(look) && Array.isArray(units) && units.length > 0 && units.every((u) => u === "%" || u === "Yes/No")) return "none";
		return shown;
	}

	/** The reading a typed scale is stamped with: the first drawn reading
	 * that is not Yes/No (its native unit), or undefined. */
	const stampUnitOf = (units) => (Array.isArray(units) ? units.find((u) => typeof u === "string" && u !== "Yes/No") : undefined);

	/** The ends the fields show: converted into the unit on view when the
	 * stamp counts (`view`: the stamp reading's unit on view). */
	const scaleShownOf = (scale, view) => stampedShown(scale, ["min", "max"], view);

	/** The scale a typed end writes: both ends as they show, the one typed
	 * replaced (undefined clears it), stamped with the unit on view; both
	 * ends blank clears all four fields. */
	function scaleTypedOf(scale, end, n, view) {
		const shown = scaleShownOf(scale, view);
		if (n === undefined) delete shown[end];
		else shown[end] = n;
		if (shown.min === undefined && shown.max === undefined) return {};
		return stamped({}, ["min", "max"], shown, view);
	}

	/** The unit tag beside the fields ("(°C)"): the stamp's unit on view
	 * when it counts and pairs with the stamp reading, else the stamp's own,
	 * else the stamp reading's unit on view; "" with none. */
	function scaleTagOf(scale, view) {
		const stamp = stampOf(scale, ["min", "max"]);
		const unit = stamp !== undefined && (view === undefined || valueBetweenUnits(0, stamp, view) === undefined) ? stamp : view;
		return typeof unit === "string" && unit !== "" ? `(${unit})` : "";
	}

	/** The help line's key under the fields, or null for no line: only
	 * scaleNotUsed, while stored ends reach no reading the graph draws (a
	 * stamp in a unit no drawn reading shows, or a scale stored before the
	 * stamp on Lanes). Blank fields read Auto and the tag names the
	 * unit, so no line stands under them otherwise. `views`: each drawn
	 * reading's unit on view. */
	function scaleHelpKey(style, scale, views) {
		const typed = isDoc(scale) && (typeof scale.min === "number" || typeof scale.max === "number");
		if (!typed) return null;
		const stamp = stampOf(scale, ["min", "max"]);
		if (stamp === undefined && style === "lanes") return "pi.strip.scaleNotUsed";
		if (stamp !== undefined && !(views ?? []).some((v) => typeof v === "string" && valueBetweenUnits(0, stamp, v) !== undefined)) return "pi.strip.scaleNotUsed";
		return null;
	}

	/** A band's or Group limits' numbers as the fields show them. */
	const limitsShownOf = (entry, view) => stampedShown(entry, ["warn", "crit"], view);

	/** A band or Group limits with one number typed: both as they show, the
	 * one typed replaced (undefined clears it), stamped with the unit on view
	 * beside the native unit they keep. */
	function limitsTypedOf(entry, kind, n, view) {
		const shown = limitsShownOf(entry, view);
		if (n === undefined) delete shown[kind];
		else shown[kind] = n;
		return stamped(entry, ["warn", "crit"], shown, view);
	}

	/** A Group rule in the exact stored shape the plugin accepts, or null. */
	function groupRuleOf(raw) {
		if (!isDoc(raw)) return null;
		const unit = typeof raw.unit === "string" && raw.unit !== "" && raw.unit.length <= UNIT_MAX ? raw.unit : undefined;
		// A Folder rule carrying a unit is a Unit rule an older 1.8 build
		// rewrote (src/strip/settings.ts stripGroupRuleOf).
		const rule = { from: GROUP_SOURCES.includes(raw.from) && raw.from !== "folder" ? raw.from : unit !== undefined ? "unit" : "folder" };
		const filter = groupFilterOf(raw.filter);
		if (filter !== undefined) rule.filter = filter;
		if (unit !== undefined && rule.from === "unit") rule.unit = unit;
		const keys = [];
		for (const key of Array.isArray(raw.keys) ? raw.keys : []) {
			if (typeof key !== "string" || key === "" || keys.includes(key)) continue;
			keys.push(key);
			if (keys.length === GROUP_KEYS_MAX) break;
		}
		rule.keys = keys;
		rule.view = GROUP_VIEWS.includes(raw.view) ? raw.view : "auto";
		const limits = groupLimitsOf(raw.limits);
		if (limits !== undefined) rule.limits = limits;
		return rule;
	}

	/** The rule a pane switched to Group starts with: the folder of its
	 * first reading, drawn by count. */
	const NEW_GROUP = () => ({ from: "folder", keys: [], view: "auto" });
	/** The rule a pane switched to Ambient starts with: every reading in
	 * one unit, the pane's first reading's unit, else °C. */
	const NEW_AMBIENT = (unit) => ({ from: "unit", unit: typeof unit === "string" && unit !== "" && unit !== "Yes/No" && unit.length <= UNIT_MAX ? unit : "°C", keys: [], view: "auto" });
	const isRuleStyle = (style) => RULE_STYLES.includes(style);
	/** The rule a rule pane draws: its own, else the plugin's default
	 * (groupRuleOf in src/strip/group.ts). */
	const ruleOf = (p) => p.group ?? (p.style === "ambient" ? { from: "unit", unit: "°C", keys: [] } : { from: "folder", keys: [] });
	const windowOf = (raw) => (WINDOWS.includes(raw) ? raw : undefined);

	/** One pane as the panel edits it, salvaged like the plugin reads it. */
	function paneOf(raw) {
		const p = isDoc(raw) ? raw : {};
		const style = styleOf(p.style);
		const seen = new Set();
		const series = [];
		for (const entry of Array.isArray(p.series) ? p.series : []) {
			if (!isDoc(entry) || typeof entry.key !== "string" || entry.key === "" || seen.has(entry.key)) continue;
			seen.add(entry.key);
			const s = { key: entry.key };
			if (typeof entry.name === "string" && entry.name !== "") s.name = entry.name;
			if (typeof entry.color === "string" && /^#[0-9A-Fa-f]{6}$/.test(entry.color)) s.color = entry.color;
			series.push(s);
		}
		const o = isDoc(p.overlays) ? p.overlays : {};
		const overlays = {};
		for (const name of OVERLAYS) overlays[name] = o[name] === true ? true : o[name] === false ? false : DEFAULT_OVERLAYS[name];
		overlays[AXES] = o[AXES] === true;
		const sc = isDoc(p.scale) ? p.scale : {};
		const scale = {};
		if (typeof sc.min === "number" && Number.isFinite(sc.min)) scale.min = sc.min;
		if (typeof sc.max === "number" && Number.isFinite(sc.max)) scale.max = sc.max;
		withStampFields(scale, sc);
		const bands = [];
		for (const b of Array.isArray(p.bands) ? p.bands : []) {
			if (!isDoc(b) || typeof b.key !== "string" || b.key === "") continue;
			const band = { key: b.key, below: b.below === true };
			if (typeof b.warn === "number" && Number.isFinite(b.warn)) band.warn = b.warn;
			if (typeof b.crit === "number" && Number.isFinite(b.crit)) band.crit = b.crit;
			if (typeof b.unit === "string" && b.unit.length <= 16) band.unit = b.unit;
			withStampFields(band, b);
			if (band.warn === undefined && band.crit === undefined) continue;
			bands.push(band);
		}
		const out = { style, series, overlays, scale, bands, readout: READOUTS.includes(p.readout) ? p.readout : "off", look: METER_LOOKS.includes(p.meterLook) ? p.meterLook : "thin", group: p.style === "fleet" ? { ...(groupRuleOf(p.group) ?? NEW_GROUP()), view: "now" } : groupRuleOf(p.group) };
		const w = windowOf(p.window);
		if (w !== undefined) out.window = w;
		return out;
	}

	/** The field that names a pane's readings: Filter or Unit under those
	 * rules, which take no picker, else the picker. */
	function readingsFieldOf(p) {
		if (!isRuleStyle(p.style)) return "picker";
		const from = p.group?.from ?? (p.style === "ambient" ? "unit" : "folder");
		return from === "filter" || from === "unit" ? from : "picker";
	}

	/** Whether Brief gaps applies: by the pane as stored, never by live data,
	 * so the field holds still while readings come and go. A Group's Rows and
	 * Now have no line, and its Auto may draw one. */
	function gapModeShown(pane) {
		if (isValuesOnly(pane)) return true;
		if (pane.style === "group") return pane.group?.view !== "rows" && pane.group?.view !== "now";
		return GAP_MODE_STYLES.includes(pane.style);
	}

	/** Whether any graph the stored strip draws has a line: a Whole strip's
	 * screens, or an Equal split's halves. */
	function gapModeOnStrip(config) {
		const c = isDoc(config) ? config : {};
		const panes = Array.isArray(c.panes) ? c.panes : [];
		const drawn = c.layout === "split" ? panes : [...panes.slice(0, 1), ...(Array.isArray(c.screens) ? c.screens : [])];
		return drawn.some((p) => isDoc(p) && gapModeShown(paneOf(p)));
	}

	/** The stored pane of screen `index` (0 is panes[0]), or undefined. */
	function screenPaneOf(config, index) {
		const c = isDoc(config) ? config : {};
		if (index === 0) return Array.isArray(c.panes) ? c.panes[0] : undefined;
		return Number.isInteger(index) && index > 0 && Array.isArray(c.screens) ? c.screens[index - 1] : undefined;
	}

	/**
	 * The config fields the Strip section edits, from a stored config.
	 * `options.screen` is the place in the screen list of the screen the
	 * box edits: its pane stands in panes[0], and its edits go to its own
	 * path (diffOps). A screen the config does not hold is the first.
	 */
	function workingOf(config, options = {}) {
		const c = isDoc(config) ? config : {};
		const panes = Array.isArray(c.panes) ? c.panes : [];
		const screen = Number.isInteger(options.screen) && options.screen > 0 && isDoc(screenPaneOf(c, options.screen)) ? options.screen : 0;
		return {
			layout: c.layout === "split" ? "split" : "whole",
			window: windowOf(c.window) ?? "5m",
			sharedWindow: c.sharedWindow !== false,
			gapMode: GAP_MODES.includes(c.gapMode) ? c.gapMode : "connect",
			// Absent is Default (""), the shared Background; Words likewise
			// (null), so the strip follows Advanced, Shared defaults.
			background: BACKGROUNDS.includes(c.background) ? c.background : "",
			accentWords: c.accentWords === true || c.accentWords === false ? c.accentWords : null,
			// The strip's own Stars and Sky color; absent is Default (""), the
			// shared one.
			stars: STARS.includes(c.stars) ? c.stars : "",
			skyColor: TONES.includes(c.skyColor) ? c.skyColor : "",
			// The strip's own theme ("" is Default: the shared theme), text
			// color, decimals and °F: the Theme band and Display edit them
			// while this dial is in the strip.
			theme: typeof c.theme === "string" ? c.theme : "",
			textMode: TEXT_MODES.includes(c.textMode) ? c.textMode : "",
			textColor: typeof c.textColor === "string" && HEX6.test(c.textColor) ? c.textColor : "",
			textDimSecondary: c.textDimSecondary === true,
			decimals: DECIMALS.includes(c.decimals) ? c.decimals : "auto",
			fahrenheit: c.fahrenheit === true,
			linkId: typeof c.linkId === "string" ? c.linkId : "",
			screen,
			screenCycle: screenCycleOf(c.screenCycle),
			// The strip's own unit and decimals per reading (issue #59), as
			// stored; null when it keeps none. Display's rows edit it.
			readingFormats: isDoc(c.readingFormats) && Object.keys(c.readingFormats).length > 0 ? JSON.parse(JSON.stringify(c.readingFormats)) : null,
			panes: [paneOf(screen === 0 ? panes[0] : screenPaneOf(c, screen)), paneOf(panes[1])]
		};
	}

	/**
	 * The edit operations that turn `base` (a stored config) into `working`,
	 * in the whitelist the plugin accepts. `layout` is included only when
	 * asked (an edit of a live group; a new strip names its layout apart).
	 * Fields left as they are send nothing, so a remembered draft applies
	 * only what the person changed.
	 */
	function patchOf(base, working, options = {}) {
		return diffOps(workingOf(base), working, options);
	}

	/** The operations that turn working draft `b` into `w` (patchOf over
	 * two working drafts): what one control change sends. */
	function diffOps(b, w, { layout = false, panes = [0, 1] } = {}) {
		const ops = [];
		const set = (path, value) => ops.push({ op: "set", path, value });
		if (layout && w.layout !== b.layout) set("layout", w.layout);
		if (w.window !== b.window) set("window", w.window);
		if (w.sharedWindow !== b.sharedWindow) set("sharedWindow", w.sharedWindow);
		if (w.background !== b.background) set("background", w.background);
		if (w.accentWords !== b.accentWords) set("accentWords", w.accentWords);
		if ((w.stars ?? "") !== (b.stars ?? "")) set("stars", w.stars ?? "");
		if ((w.skyColor ?? "") !== (b.skyColor ?? "")) set("skyColor", w.skyColor ?? "");
		if ((w.theme ?? "") !== (b.theme ?? "")) set("theme", w.theme ?? "");
		if ((w.textMode ?? "") !== (b.textMode ?? "")) set("textMode", w.textMode ?? "");
		if ((w.textColor ?? "") !== (b.textColor ?? "")) set("textColor", w.textColor ?? "");
		if ((w.textDimSecondary ?? false) !== (b.textDimSecondary ?? false)) set("textDimSecondary", w.textDimSecondary === true);
		if ((w.decimals ?? "auto") !== (b.decimals ?? "auto")) set("decimals", w.decimals ?? "auto");
		if ((w.fahrenheit ?? false) !== (b.fahrenheit ?? false)) set("fahrenheit", w.fahrenheit === true);
		if ((w.gapMode ?? "connect") !== (b.gapMode ?? "connect")) set("gapMode", w.gapMode);
		if (w.linkId.trim() !== b.linkId.trim()) set("linkId", w.linkId.trim());
		// By hand is the stored absence of the cycle: null clears it.
		if ((w.screenCycle ?? 0) !== (b.screenCycle ?? 0)) set("screenCycle", screenCycleOf(w.screenCycle) === 0 ? null : w.screenCycle);
		// The whole map at once; null clears it (issue #59).
		if (!same(w.readingFormats ?? null, b.readingFormats ?? null)) set("readingFormats", w.readingFormats ?? null);
		for (const i of panes) {
			const bp = b.panes[i];
			const wp = w.panes[i];
			// The box edits the screen it shows: pane 0's fields go to that
			// screen's own path.
			const at = i === 0 ? screenPrefix(w.screen) : `panes.${i}`;
			if (wp.style !== bp.style) set(`${at}.style`, wp.style);
			if (!same(wp.series, bp.series)) set(`${at}.series`, wp.series);
			if ((wp.window ?? null) !== (bp.window ?? null)) set(`${at}.window`, wp.window ?? null);
			if (wp.readout !== bp.readout) set(`${at}.readout`, wp.readout);
			if ((wp.look ?? "thin") !== (bp.look ?? "thin")) set(`${at}.meterLook`, wp.look ?? "thin");
			for (const name of [...OVERLAYS, AXES]) if (wp.overlays[name] !== bp.overlays[name]) set(`${at}.overlays.${name}`, wp.overlays[name]);
			for (const end of ["min", "max", "displayUnit"]) if ((wp.scale[end] ?? null) !== (bp.scale[end] ?? null)) set(`${at}.scale.${end}`, wp.scale[end] ?? null);
			if (!same(wp.scale.displayUnitFor ?? null, bp.scale.displayUnitFor ?? null)) set(`${at}.scale.displayUnitFor`, wp.scale.displayUnitFor ?? null);
			if (!same(wp.bands, bp.bands)) set(`${at}.bands`, wp.bands);
			// Limits still waiting for a number stay in the panel (groupRuleOf
			// leaves them out), so they send nothing yet.
			const wg = wp.group === null || wp.group === undefined ? null : groupRuleOf(wp.group);
			const bg = bp.group === null || bp.group === undefined ? null : groupRuleOf(bp.group);
			if (!same(wg, bg)) set(`${at}.group`, wg);
		}
		return ops.slice(0, MAX_OPS);
	}

	/** A typed number as the plugin's threshold parser reads it ("70,5" is
	 * 70.5); undefined for blank, null for text that is not a number. */
	function numberOf(text) {
		const raw = String(text ?? "").trim();
		if (raw === "") return undefined;
		const n = Number(raw.replace(",", "."));
		return Number.isFinite(n) ? n : null;
	}

	/** The unit a reading is shown in (the strip's °F choice): °C as °F, and
	 * a temperature difference Δ°C as Δ°F (src/ui/format.ts convertUnit). */
	function displayUnit(unit, fahrenheit) {
		if (fahrenheit === true && unit === "°C") return "°F";
		if (fahrenheit === true && unit === "Δ°C") return "Δ°F";
		return unit ?? "";
	}

	/** Whether a pane draws Large values only (src/strip/settings.ts
	 * isValuesOnly): no graph, so its stored Graph means nothing. */
	function isValuesOnly(pane) {
		const s = styleOf(pane.style);
		return pane.readout === "only" && !OWN_LAYOUT.includes(s) && !isRuleStyle(s);
	}

	/** The readings a pane draws at most, whatever its dial slots
	 * (src/strip/settings.ts seriesLimitsOf). */
	const seriesMaxOf = (p) => (isValuesOnly(p) ? MAX_SERIES : SERIES_LIMITS[p.style].max);

	/** The most readings a style draws in a pane of `slots` dial slots:
	 * Meters one per slot, Large values only two per slot (`readout`), every
	 * other style its own limit. */
	function drawMax(style, slots, readout) {
		const s = styleOf(style);
		const known = typeof slots === "number" && slots > 0;
		if (isValuesOnly({ style: s, readout })) return known ? Math.min(MAX_SERIES, 2 * slots) : MAX_SERIES;
		const max = SERIES_LIMITS[s].max;
		return s === "meters" && known ? Math.min(max, slots) : max;
	}

	/**
	 * What each of a pane's readings does in its style, in the pane's order:
	 * { drawn, reason } with reason "limit" for a reading past the style's
	 * limit (kept, not drawn) and "nolimit" for a numeric reading Events has
	 * nothing to mark on (no alert band), exactly as the
	 * strip draws them. `readings` are { key, label, unit }; a reading not in
	 * HWiNFO's list right now has unit undefined and is not compared.
	 * `ctx.bands` are the pane's bands, `ctx.slots` its dial slots. A
	 * reading in another unit is never left out: Trend, Area and Compare
	 * draw each unit in its own band (src/strip/scene.ts). Compare
	 * is offered for one unit only (unitsOf); a Compare stored with several
	 * still draws them all, and its check line says so.
	 */
	function seriesRows(style, readings, ctx = {}) {
		const s = styleOf(style);
		const max = drawMax(s, ctx.slots, ctx.readout);
		const banded = new Set((Array.isArray(ctx.bands) ? ctx.bands : []).map((b) => b.key));
		return readings.map((r, i) => {
			if (i >= max) return { drawn: false, reason: "limit" };
			if (s === "events" && typeof r.unit === "string" && r.unit !== "Yes/No" && !banded.has(r.key)) return { drawn: false, reason: "nolimit" };
			return { drawn: true, reason: null };
		});
	}

	/** The units of `readings` HWiNFO lists now (a reading it does not
	 * list is not compared), each once. */
	const unitsOf = (readings) => new Set(readings.filter((r) => typeof r.unit === "string").map((r) => r.unit));
	/** Compare puts readings on one scale: it is for readings in one unit
	 * (owner, 2026-10-26). Several units go to Lanes, a scale each. */
	const mixedCompare = (style, readings) => styleOf(style) === "compare" && unitsOf(readings).size >= 2;

	/** Whether a style draws every one of `readings` (count and units) the
	 * way it is meant to: Compare in one unit. */
	function drawsAll(style, readings, ctx = {}) {
		return readings.length >= SERIES_LIMITS[styleOf(style)].min && !mixedCompare(style, readings) && seriesRows(style, readings, ctx).every((row) => row.drawn);
	}

	/**
	 * Whether the Graph select offers a style for a pane's readings, and why
	 * not when its count chip does not say: Events only for Yes/No readings
	 * and readings with an alert band ("limits"), Compare only for readings in
	 * one unit ("units"). Group draws a rule and is always offered.
	 */
	function styleOffer(style, readings, ctx = {}) {
		const s = styleOf(style);
		if (isRuleStyle(s)) return { offered: true, label: null };
		if (readings.length > drawMax(s, ctx.slots)) return { offered: false, label: null };
		if (mixedCompare(s, readings)) return { offered: false, label: "units" };
		const rows = seriesRows(s, readings, ctx);
		if (s === "events" && rows.some((row) => row.reason === "nolimit")) return { offered: false, label: "limits" };
		return { offered: true, label: null };
	}

	/** The style that draws every reading when this one does not: the
	 * first of Compare, Lanes and Trend that does, else null. */
	function fitStyle(style, readings) {
		if (readings.length === 0 || drawsAll(style, readings)) return null;
		return ["compare", "lanes", "trend"].find((s) => s !== styleOf(style) && drawsAll(s, readings)) ?? null;
	}

	/**
	 * What a pane's style draws with its readings, in one line (null when
	 * it draws them all): a Compare of several units, an empty or short
	 * pane, and the style that draws every reading when a row already says
	 * one is not drawn (the row says why; the line does not say it again).
	 * `fit` names a style that would draw them all, for the panel to offer;
	 * `warn` marks a line about readings as they are drawn. Nothing here
	 * stops a change: every change is saved as it is made, and the strip
	 * draws what its style can.
	 */
	function styleCheck(style, readings, ctx = {}) {
		const s = styleOf(style);
		const limit = SERIES_LIMITS[s];
		const max = drawMax(s, ctx.slots);
		const n = readings.length;
		// Large values only draws what is ticked, whatever Graph is stored; a
		// reading past its limit says so in its row.
		if (isValuesOnly({ style: s, readout: ctx.readout })) return { note: n === 0 ? "Pick a reading for this graph." : null, fit: null };
		if (mixedCompare(s, readings) && n <= max) {
			// Compare is for one unit; Lanes gives each reading its own scale.
			const lanes = drawsAll("lanes", readings, ctx) ? "lanes" : null;
			return { note: T("pi.strip.compareUnits", "Compare is for one unit; these draw in {count} bands, one per unit. Lanes gives each its own scale.", { count: COUNT_WORDS[unitsOf(readings).size] ?? String(unitsOf(readings).size) }), fit: lanes, warn: true };
		}
		const fit = fitStyle(s, readings);
		const offer = fit === null ? "" : `${STYLE_NAMES[fit]} draws them all.`;
		if (n > max) return { note: offer === "" ? null : offer, fit };
		const rows = seriesRows(s, readings, ctx);
		const named = (reason) => rows.map((row, i) => (row.reason === reason ? readings[i].label : null)).filter((x) => x !== null);
		const nolimit = named("nolimit");
		if (nolimit.length > 0) return { note: `Events marks Yes/No readings and readings with an alert band: ${nolimit.join(", ")} ${nolimit.length === 1 ? "has" : "have"} none.`, fit: null };
		if (n === 0) return { note: "Pick a reading for this graph.", fit: null };
		if (n < limit.min) return { note: `${STYLE_NAMES[s]} draws ${COUNT_WORDS[limit.min]} to ${COUNT_WORDS[limit.max]} readings; add ${limit.min - n === 1 ? "one" : COUNT_WORDS[limit.min - n]}.`, fit: null };
		return { note: null, fit: null };
	}

	const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

	/**
	 * A Group pane's count line (the status slot, not help): what its rule
	 * matches in HWiNFO's list now, in which unit, how many draw and what is
	 * left out. `count` is the plugin's (stripState group.counts); null
	 * before it arrives.
	 */
	function groupCheck(rule, count, fahrenheit, style = "group") {
		const from = rule?.from ?? "folder";
		if (count === null || count === undefined) return { note: null, tone: "" };
		switch (count.status) {
			case "no-anchor":
				return { note: style === "ambient" ? "Tick a reading: the strip draws every reading in its folder." : "Tick a reading: the graph shows every reading in its folder.", tone: "warn" };
			case "anchor-missing":
				return { note: "This folder's reading is not in HWiNFO's list right now.", tone: "warn" };
			case "no-filter":
				return { note: "Type a filter for this graph.", tone: "warn" };
			case "unavailable":
				return { note: "HWiNFO's list is not available right now.", tone: "warn" };
			case "empty":
				return { note: from === "list" ? "Tick readings for this graph." : "Matches nothing right now.", tone: "warn" };
			default:
				break;
		}
		if (style === "ambient") return ambientCheck(count, fahrenheit);
		const unit = displayUnit(count.unit, fahrenheit);
		const inUnit = unit === "" ? "with no unit" : `in ${unit}`;
		const total = count.sameUnit + count.otherUnits;
		const parts = [];
		if (count.otherUnits === 0) parts.push(count.sameUnit === 1 ? `1 reading, ${inUnit}.` : `${count.sameUnit} readings, all ${inUnit}.`);
		else parts.push(`${total} readings: ${count.sameUnit} ${inUnit} drawn, ${plural(count.otherUnits, "in another unit", "in other units")} left out.`);
		if (count.sameUnit > count.drawn) parts.push(`The strip graphs the first ${count.drawn}.`);
		return { note: parts.join(" "), tone: count.sameUnit > count.drawn || count.otherUnits > 0 ? "warn" : "" };
	}

	/**
	 * An Ambient pane's count line: how many readings the rule takes now, in
	 * which units, and how many it draws ("53 readings in °C: Ambient draws
	 * the first 48.", "24 readings, 4 units, each on its own range.").
	 */
	function ambientCheck(count, fahrenheit) {
		const units = typeof count.units === "number" ? count.units : 1;
		const unit = displayUnit(count.unit, fahrenheit);
		const head = units <= 1 ? `${plural(count.sameUnit, "reading", "readings")} ${unit === "" ? "with no unit" : `in ${unit}`}` : `${plural(count.sameUnit, "reading", "readings")}, ${units} units, each on its own range`;
		if (count.sameUnit > count.drawn) return { note: `${head}: Ambient draws the first ${count.drawn}.`, tone: "warn" };
		return { note: `${head}.`, tone: "" };
	}

	/** Manual scale: both ends optional, and a range when both are set. */
	function scaleCheck(min, max) {
		if (min === null || max === null) return "Scale ends must be numbers.";
		if (min !== undefined && max !== undefined && !(min < max)) return "Scale from must be below Scale to.";
		return null;
	}

	const paneName = (layout, index) => (layout === "whole" ? "The strip" : index === 0 ? "Left half" : "Right half");

	/** Encoder columns of one pane (0-based), as the runtime splits them. */
	function paneColumns(layout, encoders, index) {
		const all = Array.from({ length: encoders }, (_, c) => c);
		if (layout !== "split") return index === 0 ? all : [];
		return index === 0 ? all.slice(0, encoders / 2) : all.slice(encoders / 2);
	}

	/**
	 * The slot map's line for one encoder column: words that say what the
	 * plugin can see there and what a person can do about it. The plugin
	 * cannot place actions, so a missing slot always says to drag a Sensor
	 * Dial there in the Stream Deck app.
	 */
	function slotLine(slot, ctx) {
		const n = slot.column + 1;
		const inGroup = ctx.groupId !== null && slot.groupId === ctx.groupId;
		const conflict = ctx.conflictColumns.includes(slot.column);
		if (conflict) return { kind: "conflict", text: `Dial ${n}: holds a different copy of this strip`, action: null };
		switch (slot.state) {
			case "joined":
				return { kind: "joined", text: `Dial ${n}: in this strip${slot.self ? " (this dial)" : ""}`, action: null };
			case "outside":
				return { kind: "outside", text: `Dial ${n}: joined, outside this strip's dials`, action: null };
			case "dormant":
				return inGroup
					? { kind: "dormant", text: `Dial ${n}: left this strip${slot.self ? " (this dial)" : ""}`, action: ctx.live ? "rejoin" : null }
					: { kind: "dormant", text: `Dial ${n}: Sensor Dial, keeps a left copy of another strip`, action: ctx.live ? "add" : null };
			case "other":
				return { kind: "other", text: `Dial ${n}: in another strip`, action: ctx.live ? "move" : null };
			case "independent":
				return { kind: ctx.live ? "missing" : "independent", text: `Dial ${n}: Sensor Dial, not in a strip${slot.self ? " (this dial)" : ""}`, action: ctx.live ? "add" : null };
			default:
				return { kind: "missing", text: `Dial ${n}: no Sensor Dial. Drag one here in the Stream Deck app`, action: null };
		}
	}

	// --- the dial map: one mark per dial slot and one status line -------------
	/**
	 * How a slot's mark draws: "on" (a dial of this strip), "hollow" (a
	 * Sensor Dial not in a running strip, or one that left it), "dot" (in
	 * another strip, or joined outside this strip's dials) or "dashed" (no
	 * Sensor Dial there).
	 */
	function slotLook(slot, line, stayed = false) {
		// A dial still in the strip this dial left is in a strip other than
		// the one being made.
		if (stayed) return "dot";
		if (line.kind === "joined") return "on";
		if (slot.state === "none") return "dashed";
		if (line.kind !== "conflict" && (slot.state === "other" || slot.state === "outside")) return "dot";
		return "hollow";
	}

	/** The columns of the dials still in the strip this dial left (it keeps
	 * that strip's copy and is not joined), while a new strip is being made
	 * here: no new strip takes them (the plugin refuses it), and Rejoin goes
	 * back to them. */
	function stayedColumns(st, making) {
		if (!making || !isDoc(st) || st.self?.joined !== false || typeof st.self?.groupId !== "string") return [];
		return (Array.isArray(st.slots) ? st.slots : []).filter((s) => s.self !== true && (s.state === "joined" || s.state === "outside")).map((s) => s.column);
	}

	/** Whether a slot needs the person: on a running strip, every dial not
	 * drawing in it; while a strip is being made, a missing dial, one in
	 * another strip that is not yet included, and one still in the strip
	 * this dial left (`stayed`). */
	function slotNeeds(slot, line, { live = false, making = false, take = [], stayed = false } = {}) {
		if (live) return line.kind !== "joined";
		if (making) return slot.state === "none" || (slot.state === "other" && !take.includes(slot.column)) || stayed;
		return false;
	}

	/** A slot's problem in a few words, for the status line. `left`: a dial
	 * that keeps a left copy of this strip. */
	function slotProblem(slot, line, n, left, stayed = false) {
		if (line.kind === "conflict") return T("pi.strip.dialOtherCopy", "Dial {n} holds a different copy", { n });
		if (stayed) return T("pi.strip.dialStayed", "Dial {n} is still in the strip this dial left", { n });
		switch (slot.state) {
			case "none":
				return T("pi.strip.dialMissing", "Dial {n} is missing", { n });
			case "dormant":
				return left ? T("pi.strip.dialLeft", "Dial {n} left the strip", { n }) : T("pi.strip.dialNotIn", "Dial {n} is not in the strip", { n });
			case "other":
				return T("pi.strip.dialElsewhere", "Dial {n} is in another strip", { n });
			case "outside":
				return T("pi.strip.dialOutside", "Dial {n} is outside the strip", { n });
			default:
				return T("pi.strip.dialNotIn", "Dial {n} is not in the strip", { n });
		}
	}

	/** Dial numbers (from 0-based columns) in a few words: a run of three
	 * or more as "2 to 6", the rest listed ("2, 4 and 6"). */
	function dialNumbers(columns) {
		const n = [...new Set(columns)].sort((a, b) => a - b).map((c) => c + 1);
		const parts = [];
		for (let i = 0; i < n.length; ) {
			let j = i;
			while (j + 1 < n.length && n[j + 1] === n[j] + 1) j++;
			if (j - i >= 2) parts.push(T("pi.strip.dialRun", "{from} to {to}", { from: n[i], to: n[j] }));
			else for (let k = i; k <= j; k++) parts.push(String(n[k]));
			i = j + 1;
		}
		return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
	}

	/** What a screen reader says for one mark: its dial, its state, this
	 * dial, and the action it offers. */
	function slotLabel(slot, line, action, left, stayed = false) {
		const n = slot.column + 1;
		let state;
		if (line.kind === "conflict") state = T("pi.strip.markCopy", "holds a different copy of this strip");
		else if (stayed) state = T("pi.strip.markStayed", "still in the strip this dial left");
		else if (line.kind === "joined") state = T("pi.strip.markIn", "in this strip");
		else if (slot.state === "none") state = T("pi.strip.markMissing", "missing, add a Sensor Dial");
		else if (slot.state === "dormant" && left) state = T("pi.strip.markLeft", "left the strip");
		else if (slot.state === "other") state = T("pi.strip.markElsewhere", "in another strip");
		else if (slot.state === "outside") state = T("pi.strip.markOutside", "outside this strip's dials");
		else state = T("pi.strip.markNotIn", "not in a strip");
		const parts = [T("pi.strip.markDial", "Dial {n}, {state}", { n, state })];
		if (slot.self) parts.push(T("pi.strip.markSelf", "this dial"));
		if (action !== null && action !== undefined) parts.push(action);
		return parts.join(", ");
	}

	/**
	 * The dial map of a strip state: one mark per encoder slot ({ column,
	 * look, kind, self, needs, half, line, label }), whether the row shows
	 * at all (`shown`), and its one line ({ lead, text, tone, full, title })
	 * with the one action of the dial it names (`focus`, `action`). The row
	 * shows while a dial needs the person (on a running strip: missing,
	 * left, in another strip, a different copy; while a strip is made: a
	 * missing dial, one in another strip, or one still in the strip this
	 * dial left) or while a strip is being made;
	 * a running strip whose dials are all in it shows none. The line names
	 * the chosen mark's dial (`focus`), else the first dial that needs the
	 * person, else the layout and this dial's place. `ctx`: the shown
	 * layout, whether the strip runs here (`live`), whether one is being
	 * made, the columns ticked to move from another strip (`take`), the
	 * action word each slot action shows, and the chosen mark.
	 */
	function dialMap(st, { layout = "whole", live = false, making = false, take = [], actionWord = (a) => a, focus = null } = {}) {
		if (!isDoc(st) || st.device?.strip !== true) return { marks: [], status: null, shown: true, focus: null, action: null };
		const count = st.device.encoders;
		const n = (st.self?.column ?? 0) + 1;
		const ctx = { groupId: st.self?.groupId ?? null, live, conflictColumns: st.group?.conflict?.columns ?? [] };
		const leftOf = (slot) => ctx.groupId !== null && slot.groupId === ctx.groupId;
		const slotAt = (column) => (Array.isArray(st.slots) ? st.slots : []).find((s) => s.column === column);
		const actionOf = (slot, line) => (making && slot.state === "other" ? "include" : live ? line.action : null);
		const stayed = new Set(stayedColumns(st, making));
		const marks = (Array.isArray(st.slots) ? st.slots : []).map((slot) => {
			const line = slotLine(slot, ctx);
			const still = stayed.has(slot.column);
			const needs = slotNeeds(slot, line, { live, making, take, stayed: still });
			const act = actionOf(slot, line);
			return { column: slot.column, look: slotLook(slot, line, still), kind: line.kind, self: slot.self === true, needs, half: layout === "split" && (live || making) && slot.column >= count / 2 ? 1 : 0, line, label: slotLabel(slot, line, act === null ? null : actionWord(act), leftOf(slot), still) };
		});
		const problems = marks.filter((m) => m.needs);
		const shown = making || problems.length > 0 || marks.some((m) => m.kind === "conflict");
		const chosen = (focus === null ? undefined : marks.find((m) => m.column === focus)) ?? problems[0];
		// Several dials missing and nothing else: one short line for them all.
		const missing = problems.filter((m) => slotAt(m.column)?.state === "none");
		let status;
		let action = null;
		if (focus === null && missing.length > 1 && missing.length === problems.length) {
			status = { lead: "", text: T("pi.strip.dialsMissing", "Dials {dials} are missing", { dials: dialNumbers(missing.map((m) => m.column)) }), tone: "warn" };
			status.full = status.text;
			status.title = `${status.text}. ${T("pi.strip.dragDials", "Drag a Sensor Dial to each in the Stream Deck app.")}`;
			return { marks, status, shown, focus: null, action: null };
		}
		if (chosen !== undefined && (chosen.needs || chosen.kind === "conflict" || focus === chosen.column)) {
			const slot = slotAt(chosen.column);
			const still = stayed.has(chosen.column);
			const text = chosen.kind === "joined" && !still ? T("pi.strip.dialIn", "Dial {n} is in the strip", { n: chosen.column + 1 }) : slotProblem(slot, chosen.line, chosen.column + 1, leftOf(slot), still);
			// The slot's own line says "in this strip": the strip it is in is
			// not the one being made.
			status = { lead: "", text, tone: chosen.needs ? "warn" : "", title: still ? text : chosen.line.text };
			action = actionOf(slot, chosen.line);
		} else if (live || making) {
			const half = layout !== "split" ? T("pi.strip.wholeStrip", "Whole strip") : n <= count / 2 ? T("pi.strip.leftHalf", "Left half") : T("pi.strip.rightHalf", "Right half");
			status = { lead: `${half} · `, text: T("pi.strip.dialPlace", "dial {n} of {count}", { n, count }), tone: "" };
		} else {
			status = { lead: `${st.device.model} · `, text: T("pi.strip.dialPlace", "dial {n} of {count}", { n, count }), tone: "" };
		}
		status.full = `${status.lead}${status.text}`;
		status.title ??= status.full;
		return { marks, status, shown, focus: status.lead === "" && chosen !== undefined ? chosen.column : null, action };
	}

	/** One line for the Strip section's fold summary. */
	function summary(st) {
		if (!isDoc(st)) return "";
		if (st.device?.strip !== true) return "Needs a Stream Deck + or + XL";
		const self = st.self ?? {};
		const group = st.group;
		if (self.joined === true && isDoc(group)) {
			const config = isDoc(group.config) ? group.config : {};
			const layout = config.layout === "split" ? "split" : "whole";
			const of = st.device.encoders;
			const missing = (st.slots ?? []).filter((s) => s.state !== "joined").length;
			const where = layout === "whole" ? "Whole strip" : self.column < of / 2 ? "Equal split, left half" : "Equal split, right half";
			return `${where} · dial ${self.column + 1} of ${of}${missing > 0 ? ` · ${missing === 1 ? "1 dial missing" : `${missing} dials missing`}` : ""}`;
		}
		if (self.foreign !== null && self.foreign !== undefined) return "Different copy of a strip: choose one";
		if (isDoc(group)) return "Independent dial · left a strip";
		return "Independent dial";
	}

	/** The Scale and alerts fold's line: how many bands these panes have, a
	 * Group's one set of limits counting as one, "" with none. A row still
	 * waiting for its first number is not set yet. */
	function alertBandsLine(panes) {
		const set = (limits) => isDoc(limits) && (limits.warn !== undefined || limits.crit !== undefined);
		let count = 0;
		for (const p of panes) count += p.bands.filter(set).length + (set(p.group?.limits) ? 1 : 0);
		return count === 0 ? "" : count === 1 ? T("pi.strip.alertBandOne", "1 alert band") : T("pi.strip.alertBandMany", "{count} alert bands", { count });
	}

	// --- screens ---------------------------------------------------------------
	/**
	 * The screens the plugin reports with its strip state, beside the group
	 * it describes: each { id, index, name,
	 * autoName, style } in list order, the id of the one on the strip, the
	 * automatic cycle in seconds (0 is By hand) and whether an open panel
	 * holds it. null when the state carries no group.
	 */
	function screensOf(st) {
		const src = isDoc(st) && isDoc(st.group) && Array.isArray(st.group.screens) ? st.group : null;
		if (src === null) return null;
		const seen = new Set();
		const list = [];
		for (const raw of src.screens) {
			if (!isDoc(raw) || typeof raw.screenId !== "string" || raw.screenId === "" || seen.has(raw.screenId)) continue;
			seen.add(raw.screenId);
			list.push({ id: raw.screenId, index: Number.isInteger(raw.index) ? raw.index : list.length, name: typeof raw.name === "string" ? raw.name : "", autoName: typeof raw.autoName === "string" ? raw.autoName : "", style: styleOf(raw.style) });
			if (list.length === MAX_SCREENS) break;
		}
		list.sort((a, b) => a.index - b.index);
		list.forEach((s, i) => {
			s.index = i;
		});
		const current = list.find((s) => s.id === src.screen) ?? list[0] ?? null;
		return { list, currentId: current === null ? null : current.id, current: current === null ? 0 : current.index, cycle: screenCycleOf(src.screenCycle), held: src.cycleHeld === true };
	}

	/**
	 * The screen list of a stored config, in order: { id, index, name,
	 * autoName, style }. The config is the truth for what exists and where;
	 * `reported` (screensOf's list) lends the plugin's automatic names, and
	 * its id to a screen the config holds none for (a strip saved before it
	 * had screens: the plugin names it until the next edit mints one).
	 */
	function screenListOf(config, reported = []) {
		const c = isDoc(config) ? config : {};
		const told = Array.isArray(reported) ? reported : [];
		const raws = [Array.isArray(c.panes) ? c.panes[0] : undefined, ...(Array.isArray(c.screens) ? c.screens : [])].slice(0, MAX_SCREENS);
		return raws.map((raw, index) => {
			const p = isDoc(raw) ? raw : {};
			const own = typeof p.screenId === "string" && p.screenId !== "" ? p.screenId : null;
			const from = own === null ? told[index] : told.find((s) => s.id === own);
			return {
				id: own ?? from?.id ?? `@${index}`,
				index,
				name: typeof p.name === "string" ? p.name.trim().slice(0, SCREEN_NAME_MAX) : "",
				autoName: typeof from?.autoName === "string" ? from.autoName : "",
				style: styleOf(p.style)
			};
		});
	}

	/** Where a screen id sits in a list, or -1. */
	const screenIndexOf = (list, id) => (Array.isArray(list) ? list.findIndex((s) => s.id === id) : -1);

	/**
	 * A screen's automatic name, when it has none of its own: a filter rule
	 * its filter as typed, a folder its folder's name, a unit rule "Every"
	 * and its unit, ticked readings (a series style, a custom list) the
	 * first reading's name (its own, else its label) plus how many more the
	 * screen draws. "" when there is nothing to name it by yet (an empty
	 * filter, a reading HWiNFO does not list). The plugin's rules exactly
	 * (src/strip/screens.ts autoScreenName). `ctx.readingOf(key)` gives
	 * { label, source, found }.
	 */
	function autoName(raw, ctx = {}) {
		const p = paneOf(raw);
		const look = (key) => (typeof ctx.readingOf === "function" ? ctx.readingOf(key) : null);
		const ticked = (keys, own) => {
			const first = keys.length === 0 ? null : look(keys[0]);
			const label = typeof own === "string" && own !== "" ? own : first === null || first === undefined || first.found === false || typeof first.label !== "string" ? "" : first.label;
			if (label === "") return "";
			return keys.length > 1 ? `${label} +${keys.length - 1}` : label;
		};
		if (!isRuleStyle(p.style)) {
			// The readings the style draws (Heat one, Trend three), as the strip names them.
			const drawn = p.series.slice(0, seriesMaxOf(p));
			return ticked(drawn.map((s) => s.key), drawn[0]?.name);
		}
		const rule = ruleOf(p);
		if (rule.from === "filter") return rule.filter ?? "";
		if (rule.from === "unit") return typeof rule.unit === "string" && rule.unit !== "" ? T("pi.strip.screenEveryUnit", "Every {unit}", { unit: displayUnit(rule.unit, ctx.fahrenheit === true) }) : "";
		if (rule.from === "list") return ticked(rule.keys);
		const first = p.series.length === 0 ? null : look(p.series[0].key);
		return first !== null && first !== undefined && first.found !== false && typeof first.source === "string" ? first.source : "";
	}

	/** A name as a chip shows it: whole words up to SCREEN_LABEL_MAX
	 * characters, then an ellipsis (the whole name stays in the chip's title
	 * and its spoken name). A filter's `|` ends a word too. An automatic
	 * name's "+N" stays after the ellipsis: the count is what tells two
	 * screens that start with the same reading apart. */
	function screenLabel(text) {
		const s = String(text ?? "").replace(/\s+/g, " ").trim();
		if (s.length <= SCREEN_LABEL_MAX) return s;
		const more = / \+\d+$/.exec(s);
		const tail = more === null ? "" : more[0];
		const head = s.slice(0, s.length - tail.length);
		const cut = head.slice(0, SCREEN_LABEL_MAX - tail.length - 1);
		// A cut that ends where a word does keeps that word.
		const end = /[ |]/.test(head.charAt(cut.length)) ? cut.length : Math.max(cut.lastIndexOf(" "), cut.lastIndexOf("|"));
		return `${(end >= 8 ? cut.slice(0, end) : cut).trimEnd()}…${tail}`;
	}

	/** The name a screen shows: its own, else its automatic one: the
	 * panel's over `raw`, the copy the panel shows (a reading ticked a
	 * moment ago names its screen at once, whatever the plugin last
	 * reported), else the plugin's (it remembers a name HWiNFO no longer
	 * lists), else its place ("Screen 3"). */
	function screenNameOf(screen, raw, ctx = {}) {
		if (screen.name !== "") return screen.name;
		const auto = autoName(raw, ctx);
		if (auto !== "") return auto;
		return screen.autoName !== "" ? screen.autoName : T("pi.strip.screenNumber", "Screen {n}", { n: screen.index + 1 });
	}

	/** Add: a new screen right after the one on the strip, as Group over a
	 * filter still to type (the plugin builds it and mints its id); null
	 * when the strip holds MAX_SCREENS. */
	function addScreenOp(current, count) {
		if (count >= MAX_SCREENS) return null;
		const at = Number.isInteger(current) && current >= 0 && current < count ? current + 1 : Math.max(1, count);
		return { op: "addScreen", at, from: "group" };
	}
	/** Remove screen `index`; null for the last screen standing. */
	const removeScreenOp = (index, count) => (count > 1 && Number.isInteger(index) && index >= 0 && index < count ? { op: "removeScreen", at: index } : null);
	/** Move screen `from` to `to`, clamped to the list; null when it stays. */
	function moveScreenOp(from, to, count) {
		if (!Number.isInteger(from) || from < 0 || from >= count || !Number.isInteger(to)) return null;
		const at = Math.max(0, Math.min(count - 1, to));
		return at === from ? null : { op: "moveScreen", from, to: at };
	}
	/** Rename screen `index`: trimmed and cut at the stored cap; "" clears
	 * the name, and the automatic one shows again. */
	const renameScreenOp = (index, name) => ({ op: "set", path: `${screenPrefix(index)}.name`, value: String(name ?? "").trim().slice(0, SCREEN_NAME_MAX) });
	/** The screen shown after screen `index` goes: the next, else the one before. */
	const afterRemove = (list, index) => list[index + 1]?.id ?? list[index - 1]?.id ?? null;
	/** An operation made for one screen, sent to wherever that screen sits
	 * now (`index`); an operation outside every screen goes as it is. */
	function retargetOp(op, index) {
		const at = isDoc(op) ? screenPathOf(op.path) : null;
		return at === null ? op : { ...op, path: `${screenPrefix(index)}.${at.field}` };
	}

	// --- the Filter grammar ----------------------------------------------------
	// pi-model.js's copy of the plugin's matcher (src/detail/detail-settings.ts
	// compileDetailFilter): `|` separates alternatives, each trimmed; `*` is
	// any run and `?` one character; an alternative with neither is a
	// substring, one with a wildcard is anchored to the whole candidate
	// "<source> <label>"; letters match either case.
	/** A filter's alternatives in typed order: trimmed, empty ones dropped. */
	const filterAlternatives = (pattern) => (typeof pattern === "string" ? hwModel.detailFilterAlternatives(pattern) : []);
	/** One alternative as a matcher over a candidate's folded units. */
	function alternativeMatcher(alternative) {
		const p = hwModel.detailFilterGlob(alternative);
		return (units) => hwModel.globMatch(p, units);
	}

	/** The candidates a Filter rule matches against, from the panel's
	 * sensor list: "<source> <label>" of each reading, one per measurement. */
	function filterCandidates(groups) {
		return localReadings(groups).map(({ reading: r, group }) => {
			const source = typeof group.matchName === "string" ? group.matchName : typeof group.name === "string" ? group.name : "";
			return { key: r.key, units: hwModel.foldedUnits(`${source} ${typeof r.label === "string" ? r.label : ""}`), unit: typeof r.unit === "string" ? r.unit : undefined, value: r.value };
		});
	}

	/** The plugin's count of a rule's readings (byUnit in src/strip/group.ts):
	 * the unit with the most readings and the cap a style draws. */
	function unitCount(units, max, mixed) {
		const counts = new Map();
		for (const u of units) counts.set(u, (counts.get(u) ?? 0) + 1);
		let unit;
		for (const [u, n] of counts) if (unit === undefined || n > counts.get(unit)) unit = u;
		if (mixed) return { unit: unit ?? "", drawn: Math.min(units.length, max), sameUnit: units.length, otherUnits: 0, units: new Set(units.slice(0, max)).size };
		const same = units.filter((u) => u === unit).length;
		return { unit: unit ?? "", drawn: Math.min(same, max), sameUnit: same, otherUnits: units.length - same };
	}

	/** Whether a rule pane draws a reading: Ambient leaves out Yes/No and
	 * readings with no finite value (ambientDraws in src/strip/group.ts). */
	const ruleDraws = (style, reading) => style !== "ambient" || (reading.unit !== "Yes/No" && typeof reading.value === "number" && Number.isFinite(reading.value));
	/** The most readings a rule pane draws (ruleDrawMax in src/strip/group.ts). */
	const ruleDrawMax = (style) => (style === "ambient" ? AMBIENT_DRAW_MAX : GROUP_DRAW_MAX);

	/**
	 * What a Filter rule takes, from the panel's sensor list: a
	 * count in the shape of the plugin's (stripState group.counts, for
	 * groupCheck) and each alternative's own number of readings. The panel
	 * says this while a filter is typed and until the plugin has counted
	 * it; the plugin's count is the one the strip draws.
	 */
	function filterReport(filter, groups, { style = "group" } = {}) {
		const pattern = groupFilterOf(filter);
		const none = { unit: "", drawn: 0, sameUnit: 0, otherUnits: 0 };
		if (pattern === undefined) return { count: { status: "no-filter", title: "", ...none }, alternatives: [] };
		if (!Array.isArray(groups)) return { count: { status: "unavailable", title: pattern, ...none }, alternatives: [] };
		const ambient = style === "ambient";
		const candidates = filterCandidates(groups).filter((c) => ruleDraws(style, c));
		const matchers = filterAlternatives(pattern).map((text) => ({ text, match: alternativeMatcher(text) }));
		const alternatives = matchers.map(({ text, match }) => ({ text, count: candidates.filter((c) => match(c.units)).length }));
		const found = candidates.filter((c) => matchers.some(({ match }) => match(c.units)));
		if (found.length === 0) return { count: { status: "empty", title: pattern, ...none }, alternatives };
		return { count: { status: "ok", title: pattern, ...unitCount(found.map((c) => c.unit ?? ""), ruleDrawMax(style), ambient) }, alternatives };
	}

	const andList = (items) => (items.length === 1 ? items[0] : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

	/**
	 * A Filter rule's count line: groupCheck's words over `count`, a filter
	 * that takes nothing named as typed, and each alternative of a union
	 * that matches nothing named after the count ("*l3 cahce* matches
	 * nothing."): inside a `|` a dead half is otherwise invisible. Status,
	 * not help: it lives in the pane's count slot.
	 */
	function filterCheck(rule, count, alternatives, fahrenheit, style = "group") {
		const pattern = groupFilterOf(rule?.filter);
		if (pattern !== undefined && count?.status === "empty") return { note: T("pi.strip.filterNothing", "{filter} matches nothing right now.", { filter: pattern }), tone: "warn" };
		const line = groupCheck(rule, count, fahrenheit, style);
		const alts = Array.isArray(alternatives) ? alternatives : [];
		const dead = alts.filter((a) => a.count === 0).map((a) => a.text);
		if (line.note === null || count?.status !== "ok" || dead.length === 0 || dead.length === alts.length) return line;
		const words = dead.length === 1 ? T("pi.strip.filterDeadOne", "{glob} matches nothing.", { glob: dead[0] }) : T("pi.strip.filterDeadMany", "{globs} match nothing.", { globs: andList(dead) });
		return { note: `${line.note} ${words}`, tone: "warn" };
	}

	/** Filters an empty Filter field offers, tried in this order. Each
	 * starts with `*`: the sensor's name leads the candidate, so a filter
	 * that starts with a word ("GPU*temp*") misses "dGPU [#0]: ...". */
	const FILTER_EXAMPLES = ["*core ? clock*|*core ?? clock*", "*gpu*temp*", "*core*(ccd*", "*vrm*", "*ccd*tdie*", "*p-core*clock*", "*e-core*clock*", "*core*temp*", "*cpu*temp*", "*gpu*clock*", "*dimm*temp*", "*fan*"];
	/** The examples that work on this PC: each takes two or more readings,
	 * all in one unit (a Group draws one unit), at most `max` of them. A PC
	 * is never offered a filter its own sensors do not answer. */
	function filterExamples(groups, { max = 4 } = {}) {
		const candidates = filterCandidates(groups);
		const out = [];
		for (const example of FILTER_EXAMPLES) {
			if (out.length >= max) break;
			const alternatives = filterAlternatives(example).map(alternativeMatcher);
			const units = new Set();
			let n = 0;
			for (const c of candidates) {
				if (!alternatives.some((match) => match(c.units))) continue;
				n++;
				units.add(c.unit ?? "");
			}
			if (n >= 2 && units.size === 1) out.push(example);
		}
		return out;
	}

	// --- roles ------------------------------------------------------------------
	// Build asks for its CPU and GPU readings by role: a sensor type plus
	// words in the source and label, ranked. Nothing names a machine-specific
	// key, and the panel shows what it found before anything is written. A
	// role that must be `named` takes only a reading whose label says so,
	// and one it `excludes` never.
	const TYPE = { temp: 1, fan: 3, power: 5, usage: 7, other: 8 };
	const ROLES = {
		gpuTemp: { words: "GPU temperature", type: TYPE.temp, source: /\b(gpu|graphics|geforce|radeon|nvidia|arc)\b/i, label: /\bgpu\b/i, prefer: [/^gpu temperature$/i, /gpu (core )?temp/i], avoid: /hot ?spot|memory|junction|vrm|mem\b/i },
		// The GPU's own load: "GPU Core Load" (NVIDIA), "GPU Utilization"
		// (AMD), "GPU D3D Usage" (Intel); never its memory, an engine, the
		// bus or a fan's duty in %.
		gpuLoad: { words: "GPU load", type: TYPE.usage, source: /\b(gpu|graphics|geforce|radeon|nvidia|arc)\b/i, label: /\bgpu\b.*\b(load|usage|utili[sz]ation)\b/i, prefer: [/gpu core load/i, /gpu utili[sz]ation/i, /gpu (core )?usage/i, /gpu d3d usage/i], avoid: null, named: true, excludes: /memory|\bmem\b|controller|video|\bbus\b|encod|decod|\bfan|copy|comput/i },
		cpuTemp: { words: "CPU temperature", type: TYPE.temp, source: /\b(cpu|processor)\b/i, label: /\bcpu\b|tctl|tdie|package/i, prefer: [/tctl|tdie/i, /package/i, /^cpu$/i, /core max/i], avoid: /ccd|core \d|socket|vrm/i },
		cpuUsage: { words: "CPU usage", type: TYPE.usage, source: /\b(cpu|processor)\b/i, label: /cpu usage|total cpu|max cpu/i, prefer: [/total cpu usage/i, /cpu usage/i], avoid: /thread|core \d/i },
		cpuPower: { words: "CPU power", type: TYPE.power, source: /\b(cpu|processor)\b/i, label: /package power|cpu power|ppt/i, prefer: [/package power/i, /cpu power/i], avoid: /core \d|soc|misc/i },
		cooling: { words: "Fan or pump", type: TYPE.fan, source: /.*/, label: /fan|pump|aio/i, prefer: [/pump|aio/i, /cpu fan/i, /gpu fan/i], avoid: null },
		// The PC's memory in use: HWiNFO's "Physical Memory Load", an Other
		// reading (8), never the page file's "Virtual Memory Load" or a GPU's
		// memory.
		ramLoad: { words: "RAM usage", type: TYPE.other, source: /.*/, label: /\b(physical memory|memory|ram) (load|usage)\b/i, prefer: [/^physical memory load$/i], avoid: null, named: true, excludes: /virtual|\bgpu\b|vram|d3d|dedicated|dynamic|commit|page|swap|controller|\bbus\b/i }
	};

	/** How well a reading fits a role, or -1 when it does not fit at all. */
	function fit(role, group, reading) {
		if (reading.type !== role.type) return -1;
		if (role.excludes !== undefined && role.excludes.test(reading.label)) return -1;
		const inSource = role.source.test(group.name);
		const named = role.label.test(reading.label);
		if (role.named === true ? !named : !inSource && !named) return -1;
		let score = (inSource ? 4 : 0) + (named ? 2 : 0);
		const at = role.prefer.findIndex((re) => re.test(reading.label));
		if (at >= 0) score += 2 * (role.prefer.length - at);
		if (role.avoid !== null && role.avoid.test(reading.label)) score -= 5;
		return score;
	}

	/** The reading that fits a role best in `groups` (one not in `used`, and
	 * never a Yes/No reading), as a pick; key null when none fits. */
	function pickRole(roleId, groups, used) {
		const role = ROLES[roleId];
		let best = null;
		for (const group of groups) {
			for (const reading of Array.isArray(group.readings) ? group.readings : []) {
				if (used.has(reading.key) || reading.unit === "Yes/No") continue;
				const score = fit(role, group, reading);
				if (score < 0) continue;
				if (best === null || score > best.score) best = { score, group, reading };
			}
		}
		if (best === null) return { role: roleId, words: role.words, key: null, label: "", source: "", unit: "" };
		used.add(best.reading.key);
		return { role: roleId, words: role.words, key: best.reading.key, label: best.reading.label, source: best.group.name, unit: best.reading.unit ?? "" };
	}

	// --- Build screens for this PC ------------------------------------------------
	// Up to seven screens from this PC's own sensors, each only when its
	// readings are here: CPU (lanes of its temperature, usage and power),
	// CPU cores (Group tiles of every thread's usage, when four or more),
	// GPU (its temperature large beside its graph), CPU and GPU (a Compare of
	// those two temperatures), Cooling (a meter per fan or pump, or a Group
	// column per RPM reading when they outnumber the dials), Core clocks
	// (Group rows of a filter that takes four or more) and Every temperature
	// (Ambient of every °C reading), the Group and Ambient ones while their
	// history fits the plugin's share. The panel shows the list, every screen
	// ticked, and sends the ticked ones as one edit.
	const BUILD_MAX = 7;
	// Each core's clock as HWiNFO labels it ("Core 3 Clock (perf #2/16)",
	// "P-core 0 Clock", "E-core 16 Clock"): a thread's effective clock
	// ("Core 3 T0 Effective Clock") has more words before Clock and stays out.
	const CLOCKS_FILTER = "*core ? clock*|*core ?? clock*";
	const CLOCKS_MIN = 4;
	// Every thread's usage, as HWiNFO labels it ("Core 3 T1 Usage", "P-core
	// 0 T0 Usage", "E-core 8 T0 Usage"): anchored at the label's end, so
	// "Total CPU Usage" and "Max CPU/Thread Usage" stay out even when the
	// CPU's own name says Core, and an effective clock does too.
	const CORES_FILTER = "*core * t? usage";
	const CORES_MIN = 4;
	// Group and Ambient panes keep a history ring per reading they
	// draw, all from one allowance of the plugin: 768 KiB, 106 rings of a 5 or
	// 15 minute window (GROUP_HISTORY_BUDGET_BYTES, 168 buckets of 44 B). Past
	// it a screen coming back finds its older rings gone, so Build proposes
	// only what fits.
	const BUILD_RULE_RINGS = 106;

	/** This PC's readings once each (a linked alias counts once), with
	 * their folder. */
	function localReadings(groups) {
		const out = [];
		const seen = new Set();
		for (const group of Array.isArray(groups) ? groups : []) {
			if (!isDoc(group)) continue;
			for (const r of Array.isArray(group.readings) ? group.readings : []) {
				if (!isDoc(r) || typeof r.key !== "string" || seen.has(r.key)) continue;
				for (const k of Array.isArray(r.keys) ? r.keys : []) seen.add(k);
				seen.add(r.key);
				out.push({ reading: r, group });
			}
		}
		return out;
	}

	/** This PC's fans and pumps in RPM (none in `used`), the pump first, then
	 * the CPU's and the GPU's fans, then the rest as HWiNFO lists them. */
	function rankedFans(groups, used = new Set()) {
		return localReadings(groups)
			.filter(({ reading }) => reading.unit === "RPM" && !used.has(reading.key))
			.map((f, at) => ({ ...f, at, score: fit(ROLES.cooling, f.group, { ...f.reading, type: ROLES.cooling.type }) }))
			.sort((a, b) => b.score - a.score || a.at - b.at);
	}
	/** Fans as Meters, a meter each. */
	const fansPane = (fans) => ({ style: "meters", series: fans.map((f) => f.reading.key), group: null, labels: fans.map((f) => f.reading.label), count: fans.length });
	/** Fans past the dials: Group Now, a column per reading in RPM. */
	const fansGroup = (fans) => ({ style: "group", series: [], group: { from: "unit", unit: "RPM", keys: [], view: "now" }, labels: [], count: fans.length, unit: "RPM" });

	/**
	 * The screens Build screens proposes on this PC, in order, at most seven:
	 * each { id, name, style, readout?, series (keys), group (a rule, or
	 * null), labels (the readings it names), count, unit }. `slots` is the
	 * number of dials (Meters draws one reading a dial).
	 */
	function proposeScreens(groups, { slots = 6 } = {}) {
		const local = localReadings(groups);
		const localGroups = (Array.isArray(groups) ? groups : []).filter(isDoc);
		const used = new Set();
		const out = [];
		let rings = 0;
		const ringsFit = (drawn) => {
			if (rings + drawn > BUILD_RULE_RINGS) return false;
			rings += drawn;
			return true;
		};
		// CPU: Lanes of its temperature, usage and power (Trend with one).
		const cpu = ["cpuTemp", "cpuUsage", "cpuPower"].map((role) => pickRole(role, localGroups, used)).filter((p) => p.key !== null);
		if (cpu.length > 0) out.push({ id: "cpu", name: T("pi.strip.buildCpu", "CPU"), style: cpu.length >= 2 ? "lanes" : "trend", series: cpu.map((p) => p.key), group: null, labels: cpu.map((p) => p.label), count: cpu.length });
		// CPU cores: Group tiles of every thread's usage, when the filter
		// takes four or more readings in one unit.
		const cores = filterReport(CORES_FILTER, groups, { style: "group" }).count;
		if (cores.status === "ok" && cores.sameUnit >= CORES_MIN && ringsFit(Math.min(cores.sameUnit, GROUP_DRAW_MAX))) out.push({ id: "cores", name: T("pi.strip.buildCores", "CPU cores"), style: "group", series: [], group: { from: "filter", filter: CORES_FILTER, keys: [], view: "tiles" }, labels: [], count: cores.sameUnit, unit: cores.unit });
		// GPU: its temperature, large beside its graph.
		const gpu = pickRole("gpuTemp", localGroups, used);
		if (gpu.key !== null) out.push({ id: "gpu", name: T("pi.strip.buildGpu", "GPU"), style: "area", readout: "left", series: [gpu.key], group: null, labels: [gpu.label], count: 1 });
		// CPU and GPU: their two temperatures in Compare, when both are here
		// in one unit (Compare refuses two).
		const cpuTemp = cpu.find((p) => p.role === "cpuTemp");
		if (cpuTemp !== undefined && gpu.key !== null && cpuTemp.unit === gpu.unit) out.push({ id: "cpu-gpu", name: T("pi.strip.buildCpuGpu", "CPU and GPU"), style: "compare", series: [cpuTemp.key, gpu.key], group: null, labels: [cpuTemp.label, gpu.label], count: 2 });
		// Cooling: every fan and pump in RPM, a meter each while they fit the
		// dials, else a Group column for each of them.
		const fans = rankedFans(groups, used);
		if (fans.length > 0) {
			const name = T("pi.strip.buildCooling", "Cooling");
			if (fans.length <= Math.min(slots, MAX_SERIES)) out.push({ id: "cooling", name, ...fansPane(fans) });
			else if (ringsFit(Math.min(fans.length, GROUP_DRAW_MAX))) out.push({ id: "cooling", name, ...fansGroup(fans) });
		}
		// Core clocks: Group rows of the filter, when it takes four or more
		// readings in one unit.
		const clocks = filterReport(CLOCKS_FILTER, groups, { style: "group" }).count;
		if (clocks.status === "ok" && clocks.sameUnit >= CLOCKS_MIN && ringsFit(Math.min(clocks.sameUnit, GROUP_DRAW_MAX))) out.push({ id: "clocks", name: T("pi.strip.buildClocks", "Core clocks"), style: "group", series: [], group: { from: "filter", filter: CLOCKS_FILTER, keys: [], view: "rows" }, labels: [], count: clocks.sameUnit, unit: clocks.unit });
		// Every temperature: Ambient over every °C reading.
		const temps = local.filter(({ reading }) => reading.unit === "°C" && (reading.value === undefined || Number.isFinite(reading.value))).length;
		if (temps >= 2 && ringsFit(Math.min(temps, AMBIENT_DRAW_MAX))) out.push({ id: "temps", name: T("pi.strip.buildTemps", "Every temperature"), style: "ambient", series: [], group: { from: "unit", unit: "°C", keys: [], view: "auto" }, labels: [], count: temps, unit: "°C" });
		return out.slice(0, BUILD_MAX);
	}

	/**
	 * The operations that put proposed screens on a strip in one edit:
	 * `start` is the place of the first (0 fills the first screen, as a new
	 * strip does; the count of screens now appends after them). A screen at
	 * 0 is set over `first` (the stored first pane) in its own fields; each
	 * other is an addScreen there followed by its fields. Each carries its
	 * origin (the proposal's id), so Build never proposes it again, and its
	 * name: Build's label, or the one buildProposal told apart
	 * (`storeName`); the panel moves that name on when what the screen
	 * draws changes (nameAfter). Never more than MAX_OPS; the screens that
	 * would pass MAX_SCREENS are not sent. An added screen is a Group
	 * already, so a Group screen sends no style: all seven proposals fit one
	 * edit wherever they go (39 operations at most, on a new strip).
	 */
	function buildScreensOps(screens, { start = 0, first = null } = {}) {
		const ops = [];
		const set = (path, value) => ops.push({ op: "set", path, value });
		const room = MAX_SCREENS - start;
		screens.slice(0, Math.max(0, room)).forEach((screen, i) => {
			const at = start + i;
			const prefix = screenPrefix(at);
			const old = at === 0 ? paneOf(first) : null;
			if (at > 0) ops.push({ op: "addScreen", at, from: "group" });
			if (at === 0 || screen.style !== "group") set(`${prefix}.style`, screen.style);
			// A new screen starts as a Group over an empty filter: a series
			// screen drops that rule, a rule screen sets its own.
			if (isRuleStyle(screen.style)) {
				set(`${prefix}.group`, screen.group);
				if (old !== null && old.series.length > 0) set(`${prefix}.series`, []);
			} else {
				set(`${prefix}.series`, screen.series.map((key) => ({ key })));
				if (at > 0 || old?.group !== null) set(`${prefix}.group`, null);
			}
			if (screen.readout === "left") set(`${prefix}.readout`, "left");
			else if (old !== null && old.readout !== "off") set(`${prefix}.readout`, "off");
			// A band names a reading of its own screen; the first screen's old
			// bands go with its old readings.
			if (old !== null && old.bands.length > 0) set(`${prefix}.bands`, []);
			set(`${prefix}.origin`, screen.id);
			set(`${prefix}.name`, typeof screen.storeName === "string" && screen.storeName !== "" ? screen.storeName : screen.name);
		});
		return ops.length <= MAX_OPS ? ops : null;
	}

	/** The proposals a set of Build's operations came from, by the origin
	 * each stores: a list ticked on one dial's panel, as another panel finds
	 * it in the plugin's remembered draft. */
	function originsOfOps(ops) {
		return (Array.isArray(ops) ? ops : []).filter((op) => isDoc(op) && op.op === "set" && typeof op.path === "string" && op.path.endsWith(".origin") && typeof op.value === "string").map((op) => op.value);
	}

	/** How a proposed screen draws, in the confirm list's words. */
	const buildHow = (screen) => (screen.id === "gpu" ? T("pi.strip.buildAreaReadout", "Area with large values") : screen.id === "clocks" ? T("pi.strip.buildGroupRows", "Group Rows") : screen.id === "cores" ? T("pi.strip.buildGroupTiles", "Group Tiles") : screen.id === "cooling" && screen.style === "group" ? T("pi.strip.buildGroupNow", "Group Now") : STYLE_NAMES[screen.style]);

	/** One proposed screen in the confirm list: its name, how it draws and
	 * what it takes ("CPU · Lanes · CPU (Tctl/Tdie), Total CPU Usage and
	 * CPU Package Power", "CPU cores · Group Tiles · 32 readings matching
	 * *core * t? usage", "Core clocks · Group Rows · 16 readings matching
	 * *core ? clock*|*core ?? clock*"). */
	function buildScreenLine(screen) {
		const what = screen.labels.length > 0 ? andList(screen.labels) : screen.group?.from === "filter" ? T("pi.strip.buildMatching", "{count} readings matching {filter}", { count: screen.count, filter: screen.group.filter }) : T("pi.strip.buildInUnit", "{count} readings in {unit}", { count: screen.count, unit: screen.unit ?? "" });
		return `${screen.name} · ${buildHow(screen)} · ${what}`;
	}

	// --- an Equal split's starts ---------------------------------------------------
	/**
	 * The pairs an Equal split can start from on this PC, in order, each only
	 * when this PC's own sensors fill both halves: { id, name, panes: [left,
	 * right] }, a half in the shape Build's screens use ({ style, readout?,
	 * series (keys), group, labels, count, unit? }), a meter's also with its
	 * Look, its readings' names and decimals ({ look?, names?, decimals? }).
	 * CPU and RAM usage: a Meters Liquid of Total CPU Usage and of Physical
	 * Memory Load, named CPU usage and RAM usage, in whole percents. CPU and
	 * GPU: each temperature in Area with large values. Temperature and load: a Compare
	 * of the two temperatures, and one of the CPU's usage and that GPU's load.
	 * CPU and cooling: Lanes of the CPU's temperature, usage and power (Trend
	 * with one), and a meter per fan or pump, or Group Now when they
	 * outnumber the half's dials. `slots` is the deck's dials. The first is
	 * the one a new split starts from; none leaves each half to choose.
	 */
	function proposeSplits(groups, { slots = 6 } = {}) {
		const localGroups = (Array.isArray(groups) ? groups : []).filter(isDoc);
		const used = new Set();
		const pick = (role) => pickRole(role, localGroups, used);
		const cpuTemp = pick("cpuTemp");
		const cpuUsage = pick("cpuUsage");
		const cpuPower = pick("cpuPower");
		const gpuTemp = pick("gpuTemp");
		// The load of the GPU whose temperature it is, where that GPU lists
		// one: with two GPUs the pair never sets one's temperature beside
		// the other's load. A temperature listed outside any GPU (a laptop's
		// embedded controller) takes the load that fits best.
		const gpuGroup = gpuTemp.key === null ? undefined : localGroups.find((g) => Array.isArray(g.readings) && g.readings.some((r) => isDoc(r) && r.key === gpuTemp.key));
		const sameGpu = gpuGroup === undefined ? null : pickRole("gpuLoad", [gpuGroup], used);
		const gpuLoad = sameGpu !== null && sameGpu.key !== null ? sameGpu : pick("gpuLoad");
		const half = (style, picks, readout) => ({ style, ...(readout === undefined ? {} : { readout }), series: picks.map((p) => p.key), group: null, labels: picks.map((p) => p.label), count: picks.length });
		const found = (...picks) => picks.every((p) => p.key !== null);
		const out = [];
		// CPU and RAM usage: a Meters Liquid of each, in whole percents, named
		// CPU usage and RAM usage; first, so a new split starts from it.
		const ramLoad = pick("ramLoad");
		const usage = (p, name) => ({ ...half("meters", [p]), look: "liquid", names: [name], decimals: "0" });
		if (found(cpuUsage, ramLoad) && cpuUsage.unit === "%" && ramLoad.unit === "%") out.push({ id: "cpu-ram", name: T("pi.strip.startCpuRam", "CPU and RAM usage"), panes: [usage(cpuUsage, T("pi.strip.pairCpuUsage", "CPU usage")), usage(ramLoad, T("pi.strip.pairRamUsage", "RAM usage"))] });
		if (found(cpuTemp, gpuTemp)) out.push({ id: "cpu-gpu", name: T("pi.strip.buildCpuGpu", "CPU and GPU"), panes: [half("area", [cpuTemp], "left"), half("area", [gpuTemp], "left")] });
		// Compare draws one unit: each pair of readings shares one.
		if (found(cpuTemp, gpuTemp, cpuUsage, gpuLoad) && cpuTemp.unit === gpuTemp.unit && cpuUsage.unit === gpuLoad.unit) out.push({ id: "temp-load", name: T("pi.strip.startTempLoad", "Temperature and load"), panes: [half("compare", [cpuTemp, gpuTemp]), half("compare", [cpuUsage, gpuLoad])] });
		const cpu = [cpuTemp, cpuUsage, cpuPower].filter((p) => p.key !== null);
		const fans = rankedFans(localGroups);
		if (cpu.length > 0 && fans.length > 0) {
			const room = Math.min(Math.floor(slots / 2), MAX_SERIES);
			out.push({ id: "cpu-cooling", name: T("pi.strip.startCpuCooling", "CPU and cooling"), panes: [half(cpu.length >= 2 ? "lanes" : "trend", cpu), fans.length <= room ? fansPane(fans) : fansGroup(fans)] });
		}
		return out;
	}

	/**
	 * The operations that start both halves of an Equal split from a pair, in
	 * one edit, over the stored config (a new strip's base, or a running
	 * split's copy): each half's style, its readings or its rule, and Large
	 * values on the left where the pair has them; a half's old bands go (a
	 * band names a reading of its own half), and its look, scale and window
	 * stay. The left half is also the Whole strip's first screen: its name and
	 * the origin Build stored on it describe the graph that goes, so they go
	 * with it (a kept origin would keep Build from ever proposing that screen
	 * again); its id, the other screens and every field Fill does not write
	 * stay. Whether a person made what it replaces is fillRisk's to say.
	 */
	function splitStartOps(start, config) {
		if (!isDoc(start) || !Array.isArray(start.panes)) return null;
		const stored = isDoc(config) && Array.isArray(config.panes) ? config.panes : [];
		const ops = [];
		const set = (path, value) => ops.push({ op: "set", path, value });
		start.panes.slice(0, 2).forEach((half, i) => {
			const at = `panes.${i}`;
			const old = paneOf(stored[i]);
			set(`${at}.style`, half.style);
			if (isRuleStyle(half.style)) {
				set(`${at}.group`, half.group);
				if (old.series.length > 0) set(`${at}.series`, []);
			} else {
				set(`${at}.series`, half.series.map((key, n) => ({ key, ...(typeof half.names?.[n] === "string" ? { name: half.names[n] } : {}) })));
				if (old.group !== null) set(`${at}.group`, null);
			}
			if (half.readout === "left") set(`${at}.readout`, "left");
			else if (old.readout !== "off") set(`${at}.readout`, "off");
			// A meter takes the pair's Look, else Thin bar.
			if (half.style === "meters") set(`${at}.meterLook`, half.look ?? "thin");
			if (old.bands.length > 0) set(`${at}.bands`, []);
			// panes.1 takes no name or origin (src/strip/edits.ts): one an import
			// left there stays, unread.
			if (i === 0 && isDoc(stored[0])) {
				if (typeof stored[0].name === "string" && stored[0].name !== "") set(`${at}.name`, "");
				if (typeof stored[0].origin === "string" && stored[0].origin !== "") set(`${at}.origin`, "");
			}
		});
		const formats = pairFormats(isDoc(config) ? config.readingFormats : undefined, start.panes.slice(0, 2));
		if (formats !== null) set("readingFormats", formats);
		return ops;
	}

	/** The strip's own decimals per reading with a pair's added (a meter's
	 * whole percents): only where the reading has no decimals of its own on
	 * the strip, each entry as the panel's Decimals row writes it (pi-model.js
	 * patchReadingFormat, its cap included); null when nothing changes.
	 * `stored` is the plugin's copy, which keeps each entry's unit and
	 * decimals only. */
	function pairFormats(stored, halves) {
		let map = isDoc(stored) ? stored : undefined;
		let changed = false;
		for (const half of halves) {
			if (!isDoc(half) || !DECIMALS.includes(half.decimals) || !Array.isArray(half.series)) continue;
			for (const key of half.series) {
				if (typeof key !== "string" || hwModel.readingFormatOf(map, [key])?.entry.decimals !== undefined) continue;
				const patched = hwModel.patchReadingFormat(map, [key], key, { decimals: half.decimals });
				if (patched.refused !== undefined) continue;
				map = patched.next;
				changed = true;
			}
		}
		return changed ? map : null;
	}

	/** A value with its object keys in order, so two copies compare by
	 * content (the Stream Deck app sorts the keys of plugin messages). */
	const sortedOf = (v) => (Array.isArray(v) ? v.map(sortedOf) : isDoc(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortedOf(v[k])])) : v);
	/** The keys of a stored list of readings when each entry is a reading and
	 * nothing more ({ key }), [] when there is none, else null: a name, a
	 * color or a newer version's field is work Fill would drop. */
	function bareKeysOf(series, names = []) {
		if (series === undefined) return [];
		if (!Array.isArray(series)) return null;
		const keys = [];
		for (const [n, entry] of series.entries()) {
			if (!isDoc(entry) || typeof entry.key !== "string" || entry.key === "") return null;
			// A name the pair itself gives the reading is Fill's own.
			const own = typeof names[n] === "string" && Object.keys(entry).length === 2 && entry.name === names[n];
			if (Object.keys(entry).length !== 1 && !own) return null;
			keys.push(entry.key);
		}
		return keys;
	}
	/** Whether a stored half draws `half` (a pair's, in proposeSplits'
	 * shape) in what Fill writes: its style, its readings in order or its
	 * rule, Large values and a meter's Look. A band or a reading's own name
	 * or color is the half's own (halfRisk). */
	function drawsHalf(raw, half) {
		if (!isDoc(raw) || !isDoc(half) || raw.style !== half.style) return false;
		if ((raw.readout ?? "off") !== (half.readout === "left" ? "left" : "off")) return false;
		if (half.style === "meters" && (raw.meterLook ?? "thin") !== (half.look ?? "thin")) return false;
		const series = raw.series ?? [];
		if (!Array.isArray(series) || !series.every(isDoc)) return false;
		const keys = series.map((s) => s.key);
		if (isRuleStyle(half.style)) return keys.length === 0 && isDoc(raw.group) && same(sortedOf(raw.group), sortedOf(half.group));
		return raw.group === undefined && same(keys, half.series);
	}
	/** What Fill would replace in one stored half (place `i`): "harmless"
	 * when it is empty (no reading, no rule), the strip's untouched start
	 * (the left half still drawing the reading the strip was made with, its
	 * stored `seed`, alone in Trend: the plugin drops the seed when a
	 * person changes the half's readings), or, while both halves draw one
	 * of this PC's pairs (`pairHalf`, that pair's half at this place: Fill
	 * writes a pair's halves together), that pair's half and nothing more,
	 * the names it gives its readings included; "protected" otherwise: a
	 * half a person built, named, had Build make or edited after Fill, and
	 * anything this version cannot read for sure, a meter Look it does not
	 * know included. Fill writes a meter half's Look with the pair, so a
	 * Look it knows does not count. Fields Fill never writes (what the half
	 * shows on the graph, its scale, window, id, a newer version's own pane
	 * fields) stay whatever they hold and do not count, nor does a name or
	 * origin on the right half (only an import writes one, and nothing
	 * shows or reads it). */
	function halfRisk(raw, i, pairHalf) {
		const paired = pairHalf !== null;
		if (!isDoc(raw) || (i === 0 && (Object.hasOwn(raw, "name") || Object.hasOwn(raw, "origin")))) return "protected";
		if (!STYLES.includes(raw.style)) return "protected";
		if (raw.bands !== undefined && !(Array.isArray(raw.bands) && raw.bands.length === 0)) return "protected";
		if (raw.readout !== undefined && !READOUTS.includes(raw.readout)) return "protected";
		if (raw.meterLook !== undefined && !METER_LOOKS.includes(raw.meterLook)) return "protected";
		if (raw.group !== undefined && !isDoc(raw.group)) return "protected";
		const keys = bareKeysOf(raw.series, pairHalf?.names);
		if (keys === null) return "protected";
		if (keys.length === 0 && raw.group === undefined && !isRuleStyle(raw.style)) return "harmless";
		const seeded = i === 0 && raw.style === "trend" && raw.group === undefined && (raw.readout ?? "off") === "off" && keys.length === 1 && keys[0] === raw.seed;
		return seeded || paired ? "harmless" : "protected";
	}
	/** What Fill both halves would replace in a stored split, per half
	 * ([left, right]): "harmless" or "protected" (halfRisk). It reads only
	 * the stored strip, the same on every member dial's panel. */
	function fillRisk(config, starts) {
		const stored = isDoc(config) && Array.isArray(config.panes) ? config.panes : [];
		const pair = (Array.isArray(starts) ? starts : []).find((s) => isDoc(s) && Array.isArray(s.panes) && [0, 1].every((i) => drawsHalf(stored[i], s.panes[i])));
		return [0, 1].map((i) => halfRisk(stored[i], i, pair === undefined ? null : pair.panes[i]));
	}
	/**
	 * The question Use asks before Fill puts `start` over a protected half,
	 * or null when there is none: { text, whole }. Each protected half by its
	 * place and its name (the left half's own, else the one its readings give
	 * it, autoName); `whole` whenever Replace changes the left half, which is
	 * also the Whole strip's first screen (it stays only where it is
	 * harmless and already draws the pair's left half).
	 */
	function fillAsk(config, risk, start, ctx = {}) {
		const stored = isDoc(config) && Array.isArray(config.panes) ? config.panes : [];
		const left = Array.isArray(risk) && risk[0] === "protected";
		const right = Array.isArray(risk) && risk[1] === "protected";
		if (!left && !right) return null;
		const nameOf = (i) => {
			const raw = stored[i];
			const own = i === 0 && isDoc(raw) && typeof raw.name === "string" ? raw.name.trim() : "";
			return own !== "" ? own : autoName(raw, ctx);
		};
		const [a, b] = [nameOf(0), nameOf(1)];
		let text;
		if (left && right) text = a !== "" && b !== "" ? T("pi.strip.fillAskBoth", "Replace both halves, '{left}' and '{right}'?", { left: a, right: b }) : T("pi.strip.fillAskBothPlain", "Replace both halves?");
		else if (left) text = a !== "" ? T("pi.strip.fillAskLeft", "Replace the left half, '{name}'?", { name: a }) : T("pi.strip.fillAskLeftPlain", "Replace the left half?");
		else text = b !== "" ? T("pi.strip.fillAskRight", "Replace the right half, '{name}'?", { name: b }) : T("pi.strip.fillAskRightPlain", "Replace the right half?");
		const leftStays = !left && drawsHalf(stored[0], isDoc(start) && Array.isArray(start.panes) ? start.panes[0] : null);
		return { text, whole: !leftStays };
	}

	/** What a half draws, compared whole: its style, Large values on the
	 * left, its readings in order or its rule, and a meter's Look. */
	const halfKey = (style, readout, keys, group, look) => JSON.stringify([style ?? null, readout === "left", isRuleStyle(style) ? groupRuleOf(group) : keys, style === "meters" ? (look ?? "thin") : null]);
	const startKeyOf = (start) => start.panes.map((h) => halfKey(h.style, h.readout, h.series, h.group, h.look)).join("|");

	/**
	 * The start a new split's remembered operations came from: "own" for
	 * none (each half chosen), else the id of the pair in `starts` whose
	 * halves they draw, or null. A draft remembered on another dial's panel
	 * brings its pick back this way, as Build's origins bring its ticks.
	 */
	function splitStartOf(ops, starts) {
		const list = Array.isArray(ops) ? ops.filter((op) => isDoc(op) && op.op === "set" && typeof op.path === "string") : [];
		if (list.length === 0) return "own";
		const value = (path) => list.findLast((op) => op.path === path)?.value;
		const keysOf = (series) => (Array.isArray(series) ? series.map((s) => (isDoc(s) ? s.key : null)) : []);
		const key = [0, 1].map((i) => halfKey(value(`panes.${i}.style`), value(`panes.${i}.readout`), keysOf(value(`panes.${i}.series`)), value(`panes.${i}.group`), value(`panes.${i}.meterLook`))).join("|");
		return (Array.isArray(starts) ? starts : []).find((s) => startKeyOf(s) === key)?.id ?? null;
	}

	/** The pair a stored split's halves draw now, or null. */
	function splitStartIn(config, starts) {
		const stored = isDoc(config) && Array.isArray(config.panes) ? config.panes : [];
		const key = [0, 1]
			.map((i) => {
				const p = paneOf(stored[i]);
				return halfKey(p.style, p.readout, p.series.map((s) => s.key), p.group, p.look);
			})
			.join("|");
		return (Array.isArray(starts) ? starts : []).find((s) => startKeyOf(s) === key)?.id ?? null;
	}

	// --- screen names from what a screen draws ------------------------------------
	/** A name compared as a person reads it: case and spaces aside. */
	const nameKey = (name) => String(name ?? "").replace(/\s+/g, " ").trim().toLowerCase();

	/**
	 * What a screen draws from, as one string two screens can be compared
	 * by: its ticked readings (or a custom list) as a set, a folder by its
	 * reading, a filter as typed, a unit rule by its unit. null when it has
	 * nothing yet. `canon(key)` folds a linked alias into its reading.
	 */
	function readingsOf(raw, canon = (key) => key) {
		const p = paneOf(raw);
		const keys = (list) => (list.length === 0 ? null : `keys:${[...new Set(list.map((key) => canon(key)))].sort().join(",")}`);
		if (!isRuleStyle(p.style)) return keys(p.series.map((s) => s.key));
		const rule = ruleOf(p);
		if (rule.from === "filter") return rule.filter === undefined ? null : `filter:${nameKey(rule.filter)}`;
		if (rule.from === "unit") return `unit:${rule.unit ?? "°C"}`;
		if (rule.from === "list") return keys(rule.keys);
		return p.series.length === 0 ? null : `folder:${canon(p.series[0].key)}`;
	}

	/** A proposed screen as a stored pane: what it draws. */
	const proposedPane = (screen) => ({ style: screen.style, series: screen.series.map((key) => ({ key })), group: screen.group, ...(screen.readout === undefined ? {} : { readout: screen.readout }) });
	/** A proposed screen's readings in readingsOf's terms. */
	const proposedReadings = (screen, canon) => readingsOf(proposedPane(screen), canon);

	/** The names a built screen takes while it draws what Build gave it,
	 * in the order tried: Build's own label ("CPU"), told apart by how it
	 * draws ("CPU (Lanes)") or by its first reading ("CPU (CPU
	 * (Tctl/Tdie))") when another screen shows that name. */
	const buildNames = (screen) => [screen.name, `${screen.name} (${buildHow(screen)})`, ...(screen.labels.length > 0 ? [`${screen.name} (${screen.labels[0]})`] : [])];

	/**
	 * Build screens for this PC on a strip that already has screens: the
	 * proposals (proposeScreens) less each one already on the strip, by the
	 * origin Build stored on it (whatever its name or readings became
	 * since), or by drawing the same readings as a screen there. Each is
	 * named by Build's own label (buildNames), never a filter or a unit
	 * phrase, and never a name another screen shows (no "CPU 2"): one that
	 * no choice leaves apart is not proposed. `existing`: the strip's
	 * screens as { name (as shown), raw (what it draws), origin }. Returns
	 * { screens (each with storeName, the name it is stored with),
	 * skipped (their labels) }.
	 */
	function buildProposal(groups, { slots = 6, existing = [], canon } = {}) {
		// The history share counts the strip's rule screens too.
		let rings = existing.reduce((sum, e) => sum + ruleRingsOf(e.raw, groups), 0);
		const have = new Set(existing.map((e) => readingsOf(e.raw, canon)).filter((x) => x !== null));
		const origins = new Set(existing.map((e) => e.origin).filter((x) => typeof x === "string" && x !== ""));
		const taken = new Set(existing.map((e) => nameKey(e.name)).filter((x) => x !== ""));
		const screens = [];
		const skipped = [];
		for (const screen of proposeScreens(groups, { slots })) {
			const drawn = proposedReadings(screen, canon);
			const name = origins.has(screen.id) || (drawn !== null && have.has(drawn)) ? undefined : buildNames(screen).find((c) => !taken.has(nameKey(c)));
			if (name === undefined) {
				skipped.push(screen.name);
				continue;
			}
			const more = ruleRingsOf(screen, groups);
			if (more > 0 && rings + more > BUILD_RULE_RINGS) continue;
			rings += more;
			if (drawn !== null) have.add(drawn);
			origins.add(screen.id);
			taken.add(nameKey(name));
			screens.push({ ...screen, shownName: name, storeName: name });
		}
		return { screens, skipped };
	}

	/** A sensor's name in a few words, for a screen's name: what comes
	 * before its first colon ("CPU [#0]: Example 16-Core Processor:
	 * Enhanced" is "CPU"), its first instance's "[#0]" dropped, and a chip
	 * named in brackets at its end dropped ("Example X670 (Nuvoton
	 * NCT6799D)" is "Example X670"). */
	function sensorShortName(name) {
		let s = String(name ?? "").replace(/\s+/g, " ").trim();
		const colon = s.indexOf(":");
		if (colon > 0) s = s.slice(0, colon).trim();
		s = s.replace(/\s*\[#0\]$/, "");
		const bare = s.replace(/\s*\([^()]*\)$/, "").trim();
		return (bare === "" ? s : bare).slice(0, SCREEN_NAME_MAX);
	}

	/** The sensor group a saved key's row sits in, in the panel's sensor
	 * list, found as the panel's treeEntryOf finds the row: the row keyed
	 * by it, else the first row whose aliases carry it. null when no row
	 * names it. */
	function treeGroupOf(groups, key) {
		const list = (Array.isArray(groups) ? groups : []).filter((g) => isDoc(g) && Array.isArray(g.readings));
		const own = list.find((g) => g.readings.some((r) => isDoc(r) && r.key === key));
		return own ?? list.find((g) => g.readings.some((r) => isDoc(r) && Array.isArray(r.keys) && r.keys.includes(key))) ?? null;
	}

	/** The history rings a screen holds on this list: one per reading a rule
	 * pane draws (resolveGroup in src/strip/group.ts), none for other styles. */
	function ruleRingsOf(raw, groups) {
		const p = paneOf(raw);
		if (!isRuleStyle(p.style)) return 0;
		const rule = ruleOf(p);
		const folder = treeGroupOf(groups, p.series[0]?.key);
		if (rule.from === "filter") return filterReport(rule.filter, groups, { style: p.style }).count.drawn;
		const max = ruleDrawMax(p.style);
		if (rule.from === "list") return Math.min(rule.keys.length, max);
		if (rule.from === "unit") return Math.min(filterCandidates(groups).filter((c) => c.unit === (rule.unit ?? "°C") && ruleDraws(p.style, c)).length, max);
		if (folder === null) return 0;
		return unitCount(folder.readings.filter((r) => ruleDraws(p.style, r)).map((r) => r.unit ?? ""), max, p.style === "ambient").drawn;
	}

	/** The first reading a screen draws, as a key: its first ticked reading
	 * (or listed one, or the reading that names its folder), or the first of
	 * this PC's readings its filter or its unit takes. null for a screen
	 * with nothing yet. */
	function firstReadingOf(raw, groups) {
		const p = paneOf(raw);
		if (!isRuleStyle(p.style)) return p.series[0]?.key ?? null;
		const rule = ruleOf(p);
		if (rule.from === "list") return rule.keys[0] ?? null;
		if (rule.from === "folder") return p.series[0]?.key ?? null;
		const candidates = filterCandidates(groups);
		if (rule.from === "unit") return candidates.find((c) => c.unit === (rule.unit ?? "°C") && c.unit !== "Yes/No")?.key ?? null;
		if (rule.filter === undefined) return null;
		const alternatives = filterAlternatives(rule.filter).map(alternativeMatcher);
		return candidates.find((c) => alternatives.some((match) => match(c.units)))?.key ?? null;
	}

	/** How many readings a screen draws besides its first (the "+N" of its
	 * name): a series style's drawn readings, a custom list's; a rule that
	 * takes readings by folder, filter or unit counts as one. */
	function moreOf(raw) {
		const p = paneOf(raw);
		if (!isRuleStyle(p.style)) return Math.max(0, Math.min(p.series.length, seriesMaxOf(p)) - 1);
		return p.group?.from === "list" ? Math.max(0, p.group.keys.length - 1) : 0;
	}

	/**
	 * The names what a screen draws gives it, in the order tried. A built
	 * screen (`origin`) whose readings are still what Build for this PC
	 * gives it: Build's own label (buildNames). Otherwise its first
	 * reading's sensor with "+N" for the others it draws ("CPU +2"), the
	 * reading's own name, then both ("CPU: CPU (Tctl/Tdie)"): never a
	 * filter as typed or a unit phrase. None for a screen with nothing yet
	 * or whose first reading HWiNFO does not list. `ctx`: the panel's
	 * sensor list (`groups`), `readingOf(key)` ({ label, source, found }),
	 * the deck's dials (`slots`) and `canon`.
	 */
	function contentNames(raw, origin, { groups, readingOf, slots = 6, canon } = {}) {
		if (typeof origin === "string" && origin !== "") {
			const built = proposeScreens(groups, { slots }).find((x) => x.id === origin);
			const drawn = readingsOf(raw, canon);
			if (built !== undefined && drawn !== null && proposedReadings(built, canon) === drawn) return buildNames(built);
		}
		const first = firstReadingOf(raw, groups);
		const reading = first === null || typeof readingOf !== "function" ? null : readingOf(first);
		if (reading === null || reading === undefined || reading.found === false || typeof reading.source !== "string") return [];
		const more = moreOf(raw);
		const plus = (text) => (more > 0 ? `${text} +${more}` : text).slice(0, SCREEN_NAME_MAX);
		const short = sensorShortName(reading.source);
		const label = String(reading.label ?? "").replace(/\s+/g, " ").trim();
		return [...new Set([plus(short), plus(label), `${short}: ${label}`.slice(0, SCREEN_NAME_MAX)].filter((x) => x !== "" && x !== ":" && !x.startsWith(" +")))];
	}

	/**
	 * The name a screen takes when what it draws changes (null: leave its
	 * name alone). A screen with no name of its own takes one the moment it
	 * draws something; a name taken that way, or Build's label, follows
	 * what the screen draws (back to Build's label when it draws what Build
	 * gave it again), and goes ("") when it draws nothing. A name the person
	 * gave stays. Never a name another screen shows (`others`, as shown).
	 * `before` and `after` are contentNames of the screen before and after
	 * the change.
	 */
	function nameAfter({ own, before, after, others }) {
		const auto = own === "" ? before.length === 0 : before.includes(own);
		if (!auto) return null;
		if (after.length === 0) return own === "" ? null : "";
		const taken = new Set(others.map(nameKey));
		const next = after.find((c) => !taken.has(nameKey(c)));
		return next === undefined || next === own ? null : next;
	}

	return {
		STYLES,
		STYLE_NAMES,
		OWN_LAYOUT,
		isValuesOnly,
		OVERLAYS_UNUSED,
		overlayUsed,
		EVENTS_WINDOW,
		startEvents,
		readingsFieldOf,
		drawMax,
		styleOffer,
		unitsOf,
		GROUP_SOURCES,
		GROUP_VIEWS,
		GROUP_DRAW_MAX,
		GROUP_KEYS_MAX,
		RULE_STYLES,
		AMBIENT_DRAW_MAX,
		NEW_GROUP,
		NEW_AMBIENT,
		isRuleStyle,
		groupRuleOf,
		groupFilterOf,
		groupCheck,
		SERIES_LIMITS,
		MAX_SERIES,
		WINDOWS,
		OVERLAYS,
		DEFAULT_OVERLAYS,
		MAX_BANDS,
		MAX_OPS,
		BACKGROUNDS,
		STARS,
		TONES,
		READOUTS,
		METER_LOOKS,
		DECIMALS,
		GAP_MODES,
		gapModeShown,
		gapModeOnStrip,
		alertBandsLine,
		AXES,
		paneOf,
		workingOf,
		patchOf,
		diffOps,
		numberOf,
		displayUnit,
		valueBetweenUnits,
		stampOf,
		SCALE_SHOWN,
		scaleShown,
		stampUnitOf,
		scaleShownOf,
		scaleTypedOf,
		scaleTagOf,
		scaleHelpKey,
		limitsShownOf,
		limitsTypedOf,
		shownNumber,
		styleCheck,
		seriesRows,
		fitStyle,
		scaleCheck,
		paneName,
		paneColumns,
		slotLine,
		slotLook,
		stayedColumns,
		dialMap,
		dialNumbers,
		summary,
		BUILD_MAX,
		BUILD_RULE_RINGS,
		proposeScreens,
		buildProposal,
		ruleRingsOf,
		buildScreensOps,
		originsOfOps,
		buildScreenLine,
		proposeSplits,
		splitStartOps,
		fillRisk,
		fillAsk,
		splitStartOf,
		splitStartIn,
		readingsOf,
		sensorShortName,
		firstReadingOf,
		moreOf,
		contentNames,
		nameAfter,
		same,
		MAX_SCREENS,
		SCREEN_CYCLES,
		SCREEN_NAME_MAX,
		SCREEN_LABEL_MAX,
		FILTER_EXAMPLES,
		screenCycleOf,
		screenPrefix,
		screenPathOf,
		screenPaneOf,
		screensOf,
		screenListOf,
		screenIndexOf,
		autoName,
		screenLabel,
		screenNameOf,
		addScreenOp,
		removeScreenOp,
		moveScreenOp,
		renameScreenOp,
		afterRemove,
		retargetOp,
		filterReport,
		filterCheck,
		filterExamples
	};
})();
