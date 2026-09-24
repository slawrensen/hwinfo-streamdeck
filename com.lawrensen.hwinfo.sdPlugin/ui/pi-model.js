/* Pure panel logic, shared by every property inspector and loaded by the
   unit tests without a DOM: the one-line section summaries, and the
   lossless write helpers that keep fields, list entries and entry metadata
   this build does not understand exactly as they arrived.

   Summaries describe EFFECTIVE behavior, never the last control event. What
   the runtime resolves (the drawn theme, the Text precedence, parsed
   thresholds and their unit scope, the dial's control scheme, the key's
   drawn layout) comes from the plugin in the preview payload's `effective`
   block, built by the same functions the faces render with. Only exact
   stored markers are read here, mirroring the runtime parsers the way the
   panel's visibility rules already do; when the plugin has not answered, a
   summary says what is stored and does not guess what is drawn. */
/* exported hwModel */
self.hwModel = (() => {
	"use strict";

	const STAT = { current: "Current value", min: "Minimum", max: "Maximum", avg: "Average" };
	const isStat = (v) => v === "current" || v === "min" || v === "max" || v === "avg";
	const THEME_NAMES = { void: "Void", graphite: "Graphite", ultraviolet: "Ultraviolet", midnight: "Midnight", forest: "Forest", ember: "Ember", paper: "Paper" };
	const themeName = (id) => THEME_NAMES[id] ?? (typeof id === "string" && id !== "" ? id.charAt(0).toUpperCase() + id.slice(1) : "");
	const TEXT_NAMES = { theme: "Theme text", dim: "Dimmed text", custom: "Custom text color" };
	const LAYOUT_NAMES = { single: "One reading", dual: "Two readings, stacked", triple: "Three readings, rows", quad: "Four readings, quad grid" };
	const VIEW_NAMES = { single: "One reading", tworow: "Overview, two rows", overview: "Overview, three rows" };
	const GESTURE = {
		none: "does nothing",
		step: "cycles readings",
		stepGroup: "switches sensor or group",
		cycleStat: "cycles the stat",
		backToCurrent: "returns to the current value",
		pauseResume: "pauses the auto cycle",
		pin: "pins the reading",
		resetStats: "resets session stats"
	};
	const nonEmpty = (v) => typeof v === "string" && v !== "";

	/** A number the runtime would print: trims float noise, keeps sign. */
	function num(n) {
		if (typeof n !== "number" || !Number.isFinite(n)) return "";
		return String(Math.round(n * 1000) / 1000);
	}

	/** The comparison the runtime applies (alertLevel): at or beyond. */
	function thresholdText(value, below, unit) {
		return `${below ? "≤" : "≥"} ${num(value)}${unit ? ` ${unit}` : ""}`;
	}

	/** Key layout as stored; the drawn layout comes from the plugin. */
	function storedKeyLayout(settings) {
		const v = settings.keyLayout;
		return v === "dual" || v === "triple" || v === "quad" ? v : "single";
	}

	function dialView(settings) {
		return settings.dialView === "overview" ? "overview" : settings.dialView === "tworow" ? "tworow" : "single";
	}

	function pressBehavior(settings) {
		const v = settings.pressBehavior;
		return v === "open-details" || v === "tap-cycle-hold-details" ? v : "cycle-stat";
	}

	function detailMode(settings) {
		return settings.detailMode === "custom" ? "custom" : settings.detailMode === "filter" ? "filter" : "source";
	}

	function detailDensity(settings) {
		const v = settings.detailDensity;
		return v === 2 || v === "2" ? 2 : v === 3 || v === "3" ? 3 : v === 4 || v === "4" ? 4 : 1;
	}

	/** Every non-empty reading key the stored settings name, in slot order. */
	function slotKeys(settings) {
		return [settings.readingKey, settings.secondaryReadingKey, settings.quadReadingKey3, settings.quadReadingKey4];
	}

	// --- summaries ---------------------------------------------------------

	/** The Reading section's line. `labelOf(key)` resolves a tree label or null. */
	function readingSummary(kind, settings, preview, labelOf) {
		const primary = settings.readingKey;
		if (!nonEmpty(primary)) return "No reading selected";
		const name = preview?.reading?.label ?? labelOf(primary);
		const own = typeof settings.label === "string" && settings.label.trim() !== "" ? settings.label.trim() : null;
		if (preview?.missing === true || (name === null && preview?.state === "ok")) return "Saved reading not found in HWiNFO";
		const shown = own ?? name ?? "Saved reading";
		if (kind === "dial") {
			// The runtime's rules (rotation.ts): groups count only when two or
			// more hold a key no earlier group claimed; otherwise any stored
			// string key makes a set, even one.
			const claimed = new Set();
			const groups = (Array.isArray(settings.rotationGroups) ? settings.rotationGroups : []).filter((g) => {
				if (g === null || typeof g !== "object" || Array.isArray(g) || !Array.isArray(g.keys)) return false;
				let owns = false;
				for (const k of g.keys) {
					if (typeof k === "string" && k.trim() !== "" && !claimed.has(k)) {
						claimed.add(k);
						owns = true;
					}
				}
				return owns;
			}).length;
			const keys = Array.isArray(settings.rotationKeys) ? settings.rotationKeys.filter((k) => typeof k === "string").length : 0;
			const set = groups >= 2 ? `rotation: ${groups} groups` : keys >= 1 ? `rotation: ${keys} ${keys === 1 ? "reading" : "readings"}` : "rotation: this sensor's readings";
			return `${shown} · ${set}`;
		}
		const drawn = preview?.effective?.layout?.drawn ?? null;
		const chosen = storedKeyLayout(settings);
		if (chosen === "single") return shown;
		const picked = slotKeys(settings).filter(nonEmpty).length;
		if (drawn !== null && drawn !== chosen) return `${LAYOUT_NAMES[chosen]} chosen; shows one reading until another is picked`;
		return `${LAYOUT_NAMES[chosen]} · ${picked} picked`;
	}

	/** Display: stat, decimals, theme and text, with where each comes from. */
	function displaySummary(kind, settings, globals, preview) {
		const parts = [];
		if (kind === "key") parts.push(STAT[isStat(settings.statMode) ? settings.statMode : "current"]);
		else parts.push(VIEW_NAMES[dialView(settings)]);
		const d = settings.decimals;
		parts.push(d === "0" || d === "1" || d === "2" || d === "3" ? `${d} decimals` : "auto decimals");
		const eff = preview?.effective;
		if (eff?.theme !== undefined) {
			parts.push(`${themeName(eff.theme.drawn)}${eff.theme.own ? "" : " (shared)"}`);
		} else if (nonEmpty(settings.theme)) {
			parts.push(themeName(settings.theme));
		} else {
			parts.push("shared theme");
		}
		if (eff?.text !== undefined) {
			const t = eff.text;
			const label = t.applied === "custom" ? `custom text ${t.color}` : t.applied === "dim" ? "dimmed text" : "theme text";
			parts.push(`${label}${t.own ? "" : " (shared)"}`);
		} else {
			const m = settings.textMode;
			parts.push(m === "theme" || m === "dim" || m === "custom" ? TEXT_NAMES[m].toLowerCase() : "shared text");
		}
		return parts.join(" · ");
	}

	/** Alerts: the real operator, display units, and what they apply to. */
	function alertsSummary(kind, settings, preview) {
		const a = preview?.effective?.alert;
		const below = settings.alertBelow === true;
		if (a !== undefined) {
			if (a.warn === null && a.crit === null) {
				const typed = [settings.warnValue, settings.critValue].some((v) => typeof v === "string" && v.trim() !== "");
				return typed ? "Off: the values entered are not numbers" : "Off";
			}
			const typedBad = (v) => typeof v === "string" && v.trim() !== "";
			const parts = [];
			if (a.warn !== null) parts.push(`warn ${thresholdText(a.warn, a.below, a.unit)}`);
			if (a.crit !== null) parts.push(`critical ${thresholdText(a.crit, a.below, a.unit)}`);
			if (a.warn === null && typedBad(settings.warnValue)) parts.push("warn value is not a number");
			if (a.crit === null && typedBad(settings.critValue)) parts.push("critical value is not a number");
			let text = parts.join(" · ");
			text = text.charAt(0).toUpperCase() + text.slice(1);
			if (kind === "dial" && a.scopeUnit !== null && a.scopeUnit !== undefined) text += ` · ${a.scopeUnit === "" ? "unitless" : a.scopeUnit} readings only`;
			else if (kind === "dial" && a.applies === false && a.unit !== null) text += " · not for this reading's unit";
			if (kind === "key" && preview?.effective?.layout !== undefined && preview.effective.layout.drawn !== "single") text += " · first reading";
			if (a.level === "warn") text += " · warning now";
			if (a.level === "crit") text += " · critical now";
			return text;
		}
		const w = typeof settings.warnValue === "string" ? settings.warnValue.trim() : "";
		const c = typeof settings.critValue === "string" ? settings.critValue.trim() : "";
		if (w === "" && c === "") return "Off";
		return [w !== "" ? `warn ${below ? "≤" : "≥"} ${w}` : "", c !== "" ? `critical ${below ? "≤" : "≥"} ${c}` : ""].filter(Boolean).join(" · ").replace(/^w/, "W").replace(/^c/, "C");
	}

	/** Key press behavior, the Back role winning outright (detailRoleOf).
	 * `detailsSupported` is false when the plugin reported that this deck
	 * has no detail view (the press then only shows an alert). */
	function keyInteractionSummary(settings, detailsSupported) {
		if (settings.detailRole === "back") return "Press returns to the previous profile (Back tile)";
		const press = pressBehavior(settings);
		if (press === "cycle-stat") return "Press cycles current, min, max, avg";
		if (detailsSupported === false) return press === "open-details" ? "Press would open details, but this deck has none" : "Tap cycles; hold would open details, but this deck has none";
		if (detailMode(settings) === "filter" && !(typeof settings.detailFilter === "string" && settings.detailFilter.trim() !== "")) {
			return press === "open-details" ? "Press opens nothing until the filter is set" : "Tap cycles; hold opens nothing until the filter is set";
		}
		const mode = detailMode(settings);
		const what =
			mode === "custom"
				? `custom list of ${Array.isArray(settings.detailKeys) ? new Set(settings.detailKeys.filter(nonEmpty)).size : 0}`
				: mode === "filter"
					? `filter ${typeof settings.detailFilter === "string" && settings.detailFilter.trim() !== "" ? `"${settings.detailFilter.trim().slice(0, 24)}"` : "(empty)"}`
					: "this sensor's source";
		return press === "open-details" ? `Press opens details: ${what}` : `Tap cycles; hold opens details: ${what}`;
	}

	/** Dial gestures from the plugin's resolved scheme; stored preset otherwise. */
	function dialInteractionSummary(settings, preview) {
		const c = preview?.effective?.controls;
		// parseAutoCycleMs: any positive integer millisecond count runs.
		const ms = typeof settings.autoCycleMs === "string" && settings.autoCycleMs !== "" ? Number(settings.autoCycleMs) : NaN;
		const cycle = Number.isInteger(ms) && ms > 0 ? `auto cycle ${ms % 60000 === 0 ? `${ms / 60000} min` : `${ms / 1000} s`}` : "";
		const bump = settings.rotationDisabled === true ? "turns ignored" : "";
		if (c === undefined) {
			const p = settings.controlPreset === "elite" || settings.controlPreset === "custom" ? settings.controlPreset : "legacy";
			return [`${p.charAt(0).toUpperCase()}${p.slice(1)} controls`, bump, cycle].filter(Boolean).join(" · ");
		}
		const name = `${c.preset.charAt(0).toUpperCase()}${c.preset.slice(1)}`;
		const turn = settings.rotationDisabled === true ? "turns ignored" : `turn ${GESTURE[c.rotate]}`;
		const tap = c.touchZones === "two" ? "touch sides switch readings" : c.touchZones === "three" ? `touch sides switch readings, center tap ${GESTURE[c.tap]}` : `tap ${GESTURE[c.tap]}`;
		const push = `push ${GESTURE[c.shortPress]}${c.shortPress === "pauseResume" && cycle === "" ? " (auto cycle is off)" : ""}`;
		return [`${name}: ${turn}`, push, tap, cycle].filter(Boolean).join(" · ");
	}

	function controlSummary(settings) {
		const COMMANDS = {
			next: "Next reading",
			prev: "Previous reading",
			nextGroup: "Next sensor or group",
			prevGroup: "Previous sensor or group",
			cycleStat: "Cycle stat mode",
			showCurrent: "Show current value",
			showMin: "Show session min",
			showMax: "Show session max",
			showAvg: "Show session average",
			pauseCycle: "Pause auto cycle",
			resumeCycle: "Resume auto cycle",
			toggleCycle: "Pause/resume auto cycle",
			pin: "Pin reading",
			unpin: "Unpin reading",
			togglePin: "Pin/unpin reading",
			resetStats: "Reset session stats"
		};
		const id = settings.command === undefined ? "next" : settings.command;
		const name = COMMANDS[id];
		if (name === undefined) return { command: `Unknown command "${String(id)}": the key shows an alert`, target: "" };
		const scope = settings.resetScope === "set" || settings.resetScope === "all" ? settings.resetScope : "current";
		const target = typeof settings.target === "string" ? settings.target.trim() : "";
		if (id === "resetStats" && scope === "all") return { command: name, target: "every dial on every Stream Deck (Target ignored)" };
		const reach = id === "resetStats" ? (scope === "set" ? ", whole rotation set" : ", current reading") : "";
		return { command: `${name}${reach}`, target: target === "" ? "every dial" : `dials with Link ID "${target}"` };
	}

	/** Advanced: the shared, plugin-wide choices (global settings). */
	function advancedSummary(globals) {
		const src = globals.source === "shared-memory" ? "Shared Memory only" : globals.source === "gadget" ? "Gadget only" : "Auto source";
		const ms = Number(globals.pollIntervalMs);
		const poll = [250, 500, 1000, 2000, 5000].includes(ms) ? (ms >= 1000 ? `poll ${ms / 1000} s` : `poll ${ms} ms`) : "poll 1 s";
		const units = globals.dataUnits === "binary" ? "binary data units" : "decimal data units";
		return `${src} · ${poll} · ${units}`;
	}

	// --- lossless writes ---------------------------------------------------

	const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
	const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

	/** Splits a raw list into what this build edits and what it keeps
	 * untouched (non-strings, empty strings, entries past the cap), with
	 * each kept entry's original index, so a write can put it back where
	 * it was (`mergeKept`) and nothing is dropped or moved. */
	function splitKeyList(raw, cap = Infinity) {
		const known = [];
		const kept = [];
		const keptAt = [];
		if (!Array.isArray(raw)) return { known, kept, keptAt };
		raw.forEach((entry, index) => {
			if (typeof entry === "string" && entry !== "" && known.length < cap) {
				known.push(entry);
			} else {
				kept.push(entry);
				keptAt.push(index);
			}
		});
		return { known, kept, keptAt };
	}

	/** The edited list with the kept entries re-inserted at their original
	 * indices (ascending, clamped to the list's end): an untouched list
	 * comes back exactly as stored. */
	function mergeKept(known, kept, keptAt) {
		const out = [...known];
		kept.forEach((entry, i) => {
			const at = Math.min(keptAt?.[i] ?? out.length, out.length);
			out.splice(at, 0, entry);
		});
		return out;
	}

	/** One stored entry with only the fields that changed rewritten:
	 * unknown fields and untouched known fields stay byte-identical, and an
	 * entry this build cannot read (not an object) stays exactly as stored
	 * until an edit actually changes what it means. */
	function patchEntry(raw, base, current, fields) {
		if (raw !== undefined && !isPlainObject(raw) && fields.every((field) => same(base?.[field], current[field]))) return raw;
		const out = isPlainObject(raw) ? { ...raw } : {};
		for (const field of fields) {
			if (!isPlainObject(raw) || !same(base?.[field], current[field])) out[field] = current[field];
		}
		return out;
	}

	/** A name map with one entry set (or removed on empty); junk entries
	 * the parser skipped ride along untouched. */
	function patchNames(raw, key, name) {
		const out = isPlainObject(raw) ? { ...raw } : {};
		if (name === "") delete out[key];
		else out[key] = name;
		return out;
	}

	/** A color list with indices set; entries past them and junk the
	 * runtime salvages stay as stored, gaps take the slot defaults. */
	function patchColors(raw, updates, defaults) {
		const out = Array.isArray(raw) ? [...raw] : [];
		for (const [index, color] of Object.entries(updates)) {
			const i = Number(index);
			while (out.length < i) out.push(defaults[out.length] ?? null);
			out[i] = color;
		}
		return out;
	}

	return {
		themeName,
		storedKeyLayout,
		dialView,
		pressBehavior,
		detailMode,
		detailDensity,
		readingSummary,
		displaySummary,
		alertsSummary,
		keyInteractionSummary,
		dialInteractionSummary,
		controlSummary,
		advancedSummary,
		thresholdText,
		splitKeyList,
		mergeKept,
		patchEntry,
		patchNames,
		patchColors,
		same,
		LAYOUT_NAMES,
		VIEW_NAMES,
		GESTURE
	};
})();
