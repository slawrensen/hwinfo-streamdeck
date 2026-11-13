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
	const themeName = (id) => (typeof id === "string" && Object.hasOwn(THEME_NAMES, id) ? THEME_NAMES[id] : typeof id === "string" && id !== "" ? id.charAt(0).toUpperCase() + id.slice(1) : "");
	const TEXT_NAMES = { theme: "Theme text", dim: "Dimmed text", custom: "Custom text color" };
	const LAYOUT_NAMES = { single: "One reading", dual: "Two readings, stacked", triple: "Three readings, rows", quad: "Four readings, quad grid" };
	const VIEW_NAMES = { single: "One reading", tworow: "Overview, two rows", overview: "Overview, three rows" };
	const GESTURE = {
		none: "does nothing",
		step: "cycles readings",
		stepGroup: "switches sensor or group",
		cycleStat: "cycles the stat",
		backToCurrent: "returns to the current value",
		pauseResume: "pauses or resumes the auto cycle",
		pin: "pins or unpins the reading",
		resetStats: "resets session stats",
		snooze: "snoozes alerts"
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

	/** A Trend window's name, read like the plugin's parseHistoryWindow:
	 * exact values only, anything else is the recent-samples line (""). */
	const WINDOW_NAMES = { "1m": "1 min", "5m": "5 min", "15m": "15 min" };
	function trendWindow(raw) {
		return raw === "1m" || raw === "5m" || raw === "15m" ? WINDOW_NAMES[raw] : "";
	}

	/** The looks the plugin draws itself (src/ui/deck-art.ts ART_LOOKS). */
	const ART_LOOKS = ["stars", "dusk", "nebula"];
	function isArtLook(v) {
		return ART_LOOKS.includes(v);
	}

	/** One stored background look, exactly as the plugin reads it
	 * (ownBackgroundOf): one of the eight names, else null. */
	function lookOf(v) {
		return v === "theme" || v === "glass" || v === "tint" || v === "outline" || v === "clear" || isArtLook(v) ? v : null;
	}

	/** The art looks' Stars and Sky color (deck-art.ts ART_STARS,
	 * ART_TONES), the first of each the default, and one stored value
	 * exactly as the plugin reads it (artStarsOf, artToneOf): an exact name,
	 * else null. */
	const STARS = ["all", "few", "off"];
	const TONES = ["theme", "deep", "warm", "cool", "mono"];
	function starsOf(v) {
		return STARS.includes(v) ? v : null;
	}
	function toneOf(v) {
		return TONES.includes(v) ? v : null;
	}
	/** The stars a look draws for an amount (deck-art.ts drawnStars): the
	 * Stars look keeps at least Few, so its panel offers no Off and a stored
	 * or shared Off shows as Few there. */
	function drawnStars(look, stars) {
		return look === "stars" && stars === "off" ? "few" : stars;
	}
	/** What a Sky select shows for one axis: the stored value as it is (one
	 * this build does not know shows as kept), else `fallback` (Default ""
	 * on an action, the default on the shared one). The plugin draws the
	 * fallback for a value it does not know. */
	function skyShown(stored, fallback) {
		return typeof stored === "string" && stored !== "" ? stored : fallback;
	}
	/** The shared Sky a kind draws: per axis its exact global, else the
	 * default (src/ui/shared-looks.ts). */
	function sharedSkyOf(globals, kind) {
		const g = globals ?? {};
		return { stars: starsOf(kind === "key" ? g.keyStars : g.dialStars) ?? "all", tone: toneOf(kind === "key" ? g.keySkyColor : g.dialSkyColor) ?? "theme" };
	}
	/** Whether a theme's background is light (Paper): the art looks draw no
	 * sky on it, by deck-art.ts artFits (background luminance 0.18 or more).
	 * Anything but #RRGGBB reads as dark; themes.json holds only #RRGGBB. */
	function lightTheme(bg) {
		if (typeof bg !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(bg)) return false;
		const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
		const [r, g, b] = [1, 3, 5].map((i) => linear(parseInt(bg.slice(i, i + 2), 16) / 255));
		return 0.2126 * r + 0.7152 * g + 0.0722 * b >= 0.18;
	}
	/** Each Stars and Sky color name's catalog key and English text
	 * (ui/pi-strings.js): warm and cool show as Warmer and Cooler, true
	 * against every theme's own hue. */
	const STARS_TEXT = { all: ["starsAll", "All"], few: ["starsFew", "Few"], off: ["starsOff", "Off"] };
	const TONE_TEXT = { theme: ["skyTheme", "Theme"], deep: ["skyDeep", "Deep"], warm: ["skyWarm", "Warmer"], cool: ["skyCool", "Cooler"], mono: ["skyMono", "Mono"] };

	/** One stored Words in the accent color: the exact boolean, else null
	 * (ownAccentWordsOf). */
	function wordsOf(v) {
		return v === true || v === false ? v : null;
	}

	/** The dial's background look (issue #41), resolved the way the plugin
	 * resolves it (dialBackgroundFor): the dial's own exact value, else the
	 * shared default (globals.dialBackground), else Theme. */
	function dialBackground(settings, globals = {}) {
		return lookOf(settings.dialBackground) ?? lookOf(globals?.dialBackground) ?? "theme";
	}

	/** Whether the dial's look takes Words in the accent color: Glass, Tint
	 * and Outline (the plugin's accentWords trait). Theme and Clear draw
	 * their words as before whatever is stored. */
	function accentWordsLook(settings, globals = {}) {
		const look = dialBackground(settings, globals);
		return look === "glass" || look === "tint" || look === "outline";
	}

	/** Words in the accent color, resolved the way the plugin resolves it
	 * (dialAccentWordsFor): the dial's own exact boolean, else the shared
	 * default's exact true, on a look that takes it. */
	function dialAccentWords(settings, globals = {}) {
		return (wordsOf(settings.dialAccentWords) ?? globals?.dialAccentWords === true) && accentWordsLook(settings, globals);
	}

	/** The key's background look (keyBackgroundFor): its own exact value,
	 * else the shared default (globals.keyBackground), else Theme. */
	function keyBackground(settings, globals = {}) {
		return lookOf(settings.keyBackground) ?? lookOf(globals?.keyBackground) ?? "theme";
	}

	/** The key's Words in the accent color (keyAccentWordsFor): its own
	 * exact boolean, else the shared default's exact true, on a look that
	 * takes it. */
	function keyAccentWords(settings, globals = {}) {
		const look = keyBackground(settings, globals);
		return (wordsOf(settings.keyAccentWords) ?? globals?.keyAccentWords === true) && (look === "glass" || look === "tint" || look === "outline");
	}

	/** A looks generation as the plugin reads it (src/ui/shared-looks.ts
	 * looksGenOf): a whole number above 0, else 0. */
	function looksGenOf(v) {
		return typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : 0;
	}

	/** A key's or dial's document pasted into Replace this key's or dial's
	 * settings, stamped with this machine's looks generation (looksGen): its
	 * own Background or Words carry the generation exactly; a stamp above it
	 * (another machine's) comes down to it; with no reset made here it
	 * carries none. Otherwise unchanged. */
	function stampOwnLooks(doc, kind, rawGen) {
		if (!isPlainObject(doc)) return doc;
		const gen = looksGenOf(rawGen);
		if (gen <= 0) {
			if (!Object.hasOwn(doc, "looksGen")) return doc;
			const next = { ...doc };
			delete next.looksGen;
			return next;
		}
		const own = kind === "key" ? lookOf(doc.keyBackground) !== null || wordsOf(doc.keyAccentWords) !== null || starsOf(doc.keyStars) !== null || toneOf(doc.keySkyColor) !== null : lookOf(doc.dialBackground) !== null || wordsOf(doc.dialAccentWords) !== null || starsOf(doc.dialStars) !== null || toneOf(doc.dialSkyColor) !== null;
		return (own ? doc.looksGen !== gen : looksGenOf(doc.looksGen) > gen) ? { ...doc, looksGen: gen } : doc;
	}

	/** The panel catalog (ui/pi-strings.js) with English and its parameters
	 * where it is absent (the unit suites load this file without it). */
	const T = (key, english, params) => (typeof hwT === "function" ? hwT(key, english, params) : english.replace(/\{(\w+)\}/g, (whole, name) => (params !== undefined && Object.hasOwn(params, name) ? String(params[name]) : whole)));

	/**
	 * The count line under the shared Background (Advanced, Shared
	 * defaults), from the plugin's count of the visible keys, independent
	 * dials and strips that keep their own Background or Words
	 * ({ keys, dials, strips, background, words }): "4 dials and 1 strip use
	 * their own background." Empty when none does or the count is junk.
	 */
	function ownLooksLine(count) {
		const n = (v) => (typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : 0);
		const keys = n(count?.keys);
		const dials = n(count?.dials);
		const strips = n(count?.strips);
		const total = keys + dials + strips;
		if (total === 0) return "";
		const parts = [];
		if (keys > 0) parts.push(keys === 1 ? T("pi.sharedLooks.keyOne", "1 key") : T("pi.sharedLooks.keyMany", "{count} keys", { count: keys }));
		if (dials > 0) parts.push(dials === 1 ? T("pi.sharedLooks.dialOne", "1 dial") : T("pi.sharedLooks.dialMany", "{count} dials", { count: dials }));
		if (strips > 0) parts.push(strips === 1 ? T("pi.sharedLooks.stripOne", "1 strip") : T("pi.sharedLooks.stripMany", "{count} strips", { count: strips }));
		const who = parts.length === 1 ? parts[0] : parts.length === 2 ? T("pi.sharedLooks.listTwo", "{a} and {b}", { a: parts[0], b: parts[1] }) : T("pi.sharedLooks.listThree", "{a}, {b} and {c}", { a: parts[0], b: parts[1], c: parts[2] });
		// Every one keeps its own background (some their words too), none
		// does (words only), or some do: the line names what they keep.
		const background = n(count?.background);
		const one = total === 1;
		if (background >= total) return one ? T("pi.sharedLooks.ownBackgroundOne", "{who} uses its own background.", { who }) : T("pi.sharedLooks.ownBackgroundMany", "{who} use their own background.", { who });
		if (background === 0) return one ? T("pi.sharedLooks.ownWordsOne", "{who} uses its own word color.", { who }) : T("pi.sharedLooks.ownWordsMany", "{who} use their own word color.", { who });
		return T("pi.sharedLooks.ownMixed", "{who} use their own background or word color.", { who });
	}

	/** What a press does, as the plugin's pressBehaviorOf reads it: any
	 * other value (absent, junk, a choice this build does not have) cycles
	 * the stat. */
	function pressBehavior(settings) {
		const v = settings.pressBehavior;
		return v === "open-details" || v === "tap-cycle-hold-details" ? v : "cycle-stat";
	}

	/** Whether a press behavior opens the detail view (on a press or a hold). */
	function detailsBehavior(behavior) {
		return behavior === "open-details" || behavior === "tap-cycle-hold-details";
	}

	function detailMode(settings) {
		return settings.detailMode === "custom" ? "custom" : settings.detailMode === "filter" ? "filter" : "source";
	}

	/** The alternatives of a filter pattern (issue #35), mirroring
	 * detailFilterAlternatives in src/detail/detail-settings.ts: "|" always
	 * separates, each piece is trimmed (interior spaces stay literal), and
	 * empty pieces are dropped, in typed order. detailFilterMatcher below
	 * splits with this too; keep it in sync. */
	function detailFilterAlternatives(pattern) {
		const alternatives = [];
		for (const piece of pattern.split("|")) {
			const trimmed = piece.trim();
			if (trimmed !== "") alternatives.push(trimmed);
		}
		return alternatives;
	}

	/** The stored filter the way the plugin reads it (detailFilterOf):
	 * trimmed, then capped at 128 characters as one string, or "" when
	 * nothing is left to match, a pattern of only "|" and spaces included.
	 * The view refuses to open on "". */
	function detailFilterPattern(raw) {
		if (typeof raw !== "string") return "";
		const pattern = raw.trim().slice(0, 128);
		return detailFilterAlternatives(pattern).length === 0 ? "" : pattern;
	}

	// The panels' one copy of compileDetailFilter's grammar (the key's live
	// count, the strip's Filter rule); keep it in sync. Case folds per UTF-16
	// unit to upper, never a non-ASCII unit onto an ASCII one (µ, ß).
	function foldCodeUnit(code) {
		if (code < 128) return code >= 97 && code <= 122 ? code - 32 : code;
		const upper = String.fromCharCode(code).toUpperCase();
		if (upper.length !== 1) return code;
		const upperCode = upper.charCodeAt(0);
		return upperCode < 128 ? code : upperCode;
	}

	function foldedUnits(text) {
		const units = new Array(text.length);
		for (let i = 0; i < text.length; i++) units[i] = foldCodeUnit(text.charCodeAt(i));
		return units;
	}

	/** An alternative's glob: a substring unless it has a wildcard. */
	const detailFilterGlob = (alternative) => foldedUnits(/[*?]/.test(alternative) ? alternative : `*${alternative}*`);

	const GLOB_STAR = 42; // "*"
	const GLOB_QUERY = 63; // "?"
	/** `?` is one unit, `*` any run: a linear two-pointer walk, where a
	 * RegExp backtracks exponentially on hostile patterns. */
	function globMatch(p, s) {
		let pi = 0;
		let si = 0;
		let star = -1;
		let mark = 0;
		while (si < s.length) {
			// A pattern "*" is always the wildcard, even over a candidate's own "*".
			if (pi < p.length && (p[pi] === GLOB_QUERY || (p[pi] !== GLOB_STAR && p[pi] === s[si]))) {
				pi++;
				si++;
			} else if (pi < p.length && p[pi] === GLOB_STAR) {
				star = pi;
				pi++;
				mark = si;
			} else if (star !== -1) {
				pi = star + 1;
				mark++;
				si = mark;
			} else {
				return false;
			}
		}
		while (pi < p.length && p[pi] === GLOB_STAR) pi++;
		return pi === p.length;
	}

	/** A matcher of "<source> <label>": a pattern without "|" as typed, one
	 * with "|" when any alternative matches. */
	function detailFilterMatcher(pattern) {
		if (!pattern.includes("|")) {
			const p = detailFilterGlob(pattern);
			return (candidate) => globMatch(p, foldedUnits(candidate));
		}
		const alternatives = detailFilterAlternatives(pattern).map(detailFilterGlob);
		return (candidate) => {
			const s = foldedUnits(candidate);
			return alternatives.some((p) => globMatch(p, s));
		};
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

	/** The Reading section's line. `labelOf(key)` resolves a tree label or
	 * null. A dial's line names its rotation and never the reading on the
	 * dial: the header names that, and a step changes it, so the line has
	 * one text through every step and never rewraps under one. */
	function readingSummary(kind, settings, preview, labelOf) {
		const primary = settings.readingKey;
		if (!nonEmpty(primary)) return "No reading selected";
		const name = preview?.reading?.label ?? labelOf(primary);
		const own = typeof settings.label === "string" && settings.label.trim() !== "" ? settings.label.trim() : null;
		if (preview?.missing === true || (name === null && preview?.state === "ok")) return "Saved reading not found in HWiNFO";
		if (kind === "dial") {
			// The runtime's rules (rotation.ts): groups count only when two or
			// more hold a key no earlier group claimed; otherwise any stored
			// string key makes a set, even one.
			const groups = claimedGroups(settings).length;
			const keys = Array.isArray(settings.rotationKeys) ? settings.rotationKeys.filter((k) => typeof k === "string").length : 0;
			return `Rotation: ${groups >= 2 ? `${groups} groups` : keys >= 1 ? `${keys} ${keys === 1 ? "reading" : "readings"}` : "this sensor's readings"}`;
		}
		const shown = own ?? name ?? "Saved reading";
		const drawn = preview?.effective?.layout?.drawn ?? null;
		const chosen = storedKeyLayout(settings);
		if (chosen === "single") return shown;
		const picked = slotKeys(settings).filter(nonEmpty).length;
		if (drawn !== null && drawn !== chosen) return `${LAYOUT_NAMES[chosen]} chosen; shows one reading until another is picked`;
		return `${LAYOUT_NAMES[chosen]} · ${picked} picked`;
	}

	/** Display: text color, stat or view, decimals, °F and the key's graph,
	 * with where each comes from. The theme is not here: it sits in the
	 * band above the sections, whose folded row shows the checked chip. */
	function displaySummary(kind, settings, globals, preview) {
		const parts = [];
		if (kind === "key") parts.push(STAT[isStat(settings.statMode) ? settings.statMode : "current"]);
		else parts.push(dialView(settings) === "tworow" && trendWindow(settings.dialHistoryWindow) !== "" ? `${VIEW_NAMES.tworow}, ${trendWindow(settings.dialHistoryWindow)} trend` : VIEW_NAMES[dialView(settings)]);
		const d = settings.decimals;
		parts.push(d === "0" || d === "1" || d === "2" || d === "3" ? `${d} decimals` : "auto decimals");
		const eff = preview?.effective;
		if (eff?.text !== undefined) {
			const t = eff.text;
			const label = t.applied === "custom" ? `custom text ${t.color}` : t.applied === "dim" ? "dimmed text" : "theme text";
			parts.push(`${label}${t.own ? "" : " (shared)"}`);
		} else {
			const m = settings.textMode;
			parts.push(m === "theme" || m === "dim" || m === "custom" ? TEXT_NAMES[m].toLowerCase() : "shared text");
		}
		if (settings.fahrenheit === true) parts.push("°F");
		// A dial drawn over the touch strip picture, or a key over the page
		// background, names its look; Theme, the default, says nothing.
		if (kind === "dial" && dialBackground(settings, globals) !== "theme") parts.push(dialBackground(settings, globals));
		if (kind === "key" && keyBackground(settings, globals) !== "theme") parts.push(keyBackground(settings, globals));
		// Under a Custom text color the words change nothing (Custom stays exact).
		if (kind === "dial" && dialAccentWords(settings, globals) && appliedTextMode(settings, globals, preview) !== "custom") parts.push("accent words");
		if (kind === "key" && keyAccentWords(settings, globals) && appliedTextMode(settings, globals, preview) !== "custom") parts.push("accent words");
		// The key's graph strip draws on the one-reading layout only; the
		// stored mode wins, else the legacy sparkline flag (the panel's rule).
		if (kind === "key" && (preview?.effective?.layout?.drawn ?? storedKeyLayout(settings)) === "single") {
			const mode = ["none", "sparkline", "bar", "ring"].includes(settings.displayMode) ? settings.displayMode : settings.sparkline === true ? "sparkline" : "none";
			if (mode !== "none") parts.push(mode === "bar" ? "bar" : mode === "ring" ? "ring" : trendWindow(settings.historyWindow) !== "" ? `${trendWindow(settings.historyWindow)} sparkline` : "sparkline");
		}
		return parts.join(" · ");
	}

	/** The text mode a face draws in: the plugin's own answer when the panel
	 * has one, else the action's valid mode, else the shared one. Custom
	 * counts only with a #RRGGBB color, as the plugin reads it. */
	function appliedTextMode(settings, globals, preview) {
		const applied = preview?.effective?.text?.applied;
		if (applied !== undefined) return applied;
		const own = ["theme", "dim", "custom"].includes(settings.textMode) ? settings : globals ?? {};
		if (own.textMode === "custom") return /^#[0-9A-Fa-f]{6}$/.test(own.textColor ?? "") ? "custom" : "theme";
		return own.textMode === "dim" ? "dim" : "theme";
	}

	/** "1 reading" / "3 readings". */
	const readingsText = (n) => `${n} reading${n === 1 ? "" : "s"}`;

	/** What a key's live alert path adds to the Alerts line: how many
	 * readings have their own limits (one set per reading, however many
	 * rows show it), whether reading 1 is one of them (Warn at and Critical
	 * at are then not in use), the wait before an alert shows, and a
	 * snooze (`now.snoozed` in place of the face's, see alertsSummary). */
	function keyAlertExtras(k, now) {
		if (!isPlainObject(k) || !Array.isArray(k.slots)) return { own: 0, firstOwn: false, extra: "" };
		const owners = k.slots.filter((slot) => isPlainObject(slot) && slot.source === "reading");
		const own = new Set(owners.map((slot) => (typeof slot.ruleKey === "string" ? `k:${slot.ruleKey}` : `s:${slot.slot}`))).size;
		const firstOwn = owners.some((slot) => slot.slot === 0);
		let extra = "";
		if (typeof k.dwellMs === "number" && k.dwellMs > 0) extra += ` · after ${num(k.dwellMs / 1000)} s`;
		const snoozed = now !== undefined ? now.snoozed : isPlainObject(k.face) ? k.face.snoozed : undefined;
		if (snoozed === "warn" || snoozed === "crit") extra += " · snoozed";
		return { own, firstOwn, extra };
	}

	/** The plugin's alert view of one key slot, only while it is about the
	 * reading the panel's settings put there: a preview built for the
	 * previous reading of that slot (one round trip after a pick) is no
	 * answer, so nothing is filed or captured from it. Null otherwise. */
	function keyAlertSlot(keyAlerts, slot, key) {
		const slots = isPlainObject(keyAlerts) && Array.isArray(keyAlerts.slots) ? keyAlerts.slots : [];
		return slots.find((s) => isPlainObject(s) && s.slot === slot && typeof key === "string" && key !== "" && s.key === key) ?? null;
	}

	const SLOT_FIELDS = ["readingKey", "secondaryReadingKey", "quadReadingKey3", "quadReadingKey4"];

	/**
	 * The alert rows a key panel shows under Warn at and Critical at, in slot
	 * order. Each reading has one set of limits, so:
	 * - reading 1 gets a row only while it has limits of its own (an
	 *   `alertRules` entry, which Warn at and Critical at then give way to),
	 *   or while `keepFirst` holds (its row has focus or a save pending, so
	 *   clearing its numbers never pulls the row from under the caret);
	 * - a later reading that is the same reading as an earlier slot gets a
	 *   row with no fields, naming the slot whose limits cover it;
	 * - every other configured reading gets a row of its own.
	 * Readings compare by the plugin's identity when its preview is about the
	 * reading in the slot, else by saved key.
	 */
	function alertRowPlan(settings, keyAlerts, keepFirst) {
		const layout = storedKeyLayout(settings);
		const count = layout === "quad" ? 4 : layout === "triple" ? 3 : layout === "dual" ? 2 : 1;
		const slots = [];
		for (let slot = 0; slot < count; slot++) {
			const key = settings[SLOT_FIELDS[slot]];
			if (nonEmpty(key)) slots.push({ slot, key, info: keyAlertSlot(keyAlerts, slot, key) });
		}
		const identity = (s) => (nonEmpty(s.info?.identity) ? s.info.identity : s.key);
		const plan = [];
		for (const s of slots) {
			if (s.slot === 0) {
				if (s.info?.source === "reading" || keepFirst === true) plan.push({ slot: 0, key: s.key, kind: "edit" });
				continue;
			}
			const earlier = slots.find((t) => t.slot < s.slot && identity(t) === identity(s));
			if (earlier === undefined) plan.push({ slot: s.slot, key: s.key, kind: "edit" });
			else plan.push({ slot: s.slot, key: s.key, kind: "same", of: earlier.slot, ofRow: earlier.slot !== 0 || plan.some((p) => p.slot === 0) });
		}
		return plan;
	}

	/** The "Alert after" choice the runtime reads (parseAlertDwellMs): an
	 * exact choice, else immediate. */
	function alertDwellMsOf(settings) {
		const raw = settings.alertDwellMs;
		return typeof raw === "string" && ["0", "2000", "5000", "10000", "30000"].includes(raw) ? Number(raw) : 0;
	}

	/** The snooze length the runtime reads (parseAlertSnoozeMs, then the
	 * 15 minute default a command uses). */
	function alertSnoozeMsOf(settings) {
		const raw = settings.alertSnoozeMs;
		return typeof raw === "string" && ["300000", "900000", "3600000"].includes(raw) ? Number(raw) : 900000;
	}

	/** Timing, folded: when a level shows and how long a snooze lasts. */
	function alertTimingSummary(settings) {
		const dwell = alertDwellMsOf(settings);
		const snooze = alertSnoozeMsOf(settings);
		return `${dwell === 0 ? "Alerts show at once" : `Alerts show after ${dwell / 1000} s`} · snooze ${snooze === 3600000 ? "1 hour" : `${snooze / 60000} min`}`;
	}

	/** The `alertRules` entry a reading's keys find first (its own key, then
	 * its linked keys, as the runtime walks them), or null. Only an object
	 * counts, as the runtime's parser keeps only objects. */
	function alertRuleOf(rules, keys) {
		if (!isPlainObject(rules)) return null;
		for (const key of keys) {
			if (typeof key === "string" && Object.hasOwn(rules, key) && isPlainObject(rules[key])) return { key, entry: rules[key] };
		}
		return null;
	}

	/** A rules map with one entry's named fields set (undefined removes a
	 * field); the entry's other fields and every other entry, junk
	 * included, stay exactly as stored. */
	function patchAlertRule(rules, key, fields) {
		const out = isPlainObject(rules) ? { ...rules } : {};
		const entry = Object.hasOwn(out, key) && isPlainObject(out[key]) ? { ...out[key] } : {};
		for (const [field, value] of Object.entries(fields)) {
			if (value === undefined) delete entry[field];
			else entry[field] = value;
		}
		return setOwn(out, key, entry);
	}

	/** A rules map without the entries the runtime would use for a reading
	 * (every object entry under its keys); anything else stays as stored. */
	function withoutAlertRule(rules, keys) {
		const out = isPlainObject(rules) ? { ...rules } : {};
		for (const key of keys) {
			if (typeof key === "string" && Object.hasOwn(out, key) && isPlainObject(out[key])) delete out[key];
		}
		return out;
	}

	// The pairs the °F choice converts between: temperatures, and the
	// temperature differences calculated readings publish (src/ui/format.ts
	// valueBetweenUnits).
	const TEMPERATURE_PAIRS = [
		["°C", "°F"],
		["Δ°C", "Δ°F"]
	];
	/** Two different units the runtime converts between. */
	const temperaturePair = (a, b) => a !== b && TEMPERATURE_PAIRS.some((pair) => pair.includes(a) && pair.includes(b));

	/** Whether limits saved in `stored` still compare for a reading the
	 * face shows in `displayUnit`: the same unit, or °C and °F (and Δ°C and
	 * Δ°F), converted, as the runtime's ruleUnitFor reads a captured unit. */
	function alertUnitUsable(stored, displayUnit) {
		if (typeof stored !== "string" || typeof displayUnit !== "string") return false;
		return stored === displayUnit || temperaturePair(stored, displayUnit);
	}

	function storedUnitOf(entry) {
		return isPlainObject(entry) && Object.hasOwn(entry, "unit") ? entry.unit : undefined;
	}

	/** The fields one edit of a reading's own limits writes: the edit, plus
	 * the unit the face shows the reading in when the entry's saved unit no
	 * longer compares (or was never saved), so the edit turns limits that
	 * were off back on, in the unit on the face. A saved unit that still
	 * compares stays (°C limits on a °F face): the entry's other limits are
	 * in it. With no unit known (the reading is not reporting) the edit
	 * goes alone. */
	function alertEditFields(entry, displayUnit, fields) {
		if (typeof displayUnit !== "string" || alertUnitUsable(storedUnitOf(entry), displayUnit)) return { ...fields };
		return { ...fields, unit: displayUnit };
	}

	/** The unit a reading's own limits are typed in, for the brackets after
	 * their labels: the entry's saved unit while it compares, else the unit
	 * the next edit saves; "" when neither is known (or no unit). */
	function alertFieldUnit(entry, displayUnit) {
		const stored = storedUnitOf(entry);
		if (alertUnitUsable(stored, displayUnit)) return stored;
		if (typeof displayUnit === "string") return displayUnit;
		return typeof stored === "string" ? stored : "";
	}

	/** A legacy limit as the runtime reads it (parseThreshold takes a finite
	 * number or a string), as text for an entry, or undefined when blank. */
	function limitText(raw) {
		if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
		return typeof raw === "string" && raw.trim() !== "" ? raw : undefined;
	}

	// The legacy fields a display-unit stamp covers, and their names in
	// alertDisplayUnitFor (src/alerts/rules.ts ALERT_STAMP_FIELDS).
	const ALERT_STAMP_FIELDS = [
		["warnValue", "warn"],
		["critValue", "crit"],
		["alertHysteresis", "hyst"]
	];
	const stampText = (raw) => (typeof raw === "string" ? raw : typeof raw === "number" && Number.isFinite(raw) ? String(raw) : undefined);

	/** alertDisplayUnit while alertDisplayUnitFor records exactly the text
	 * the three fields hold, else undefined (rules.ts stampedDisplayUnit). */
	function provenDisplayUnit(settings) {
		if (!isPlainObject(settings)) return undefined;
		return provenStamp(
			settings.alertDisplayUnit,
			settings.alertDisplayUnitFor,
			ALERT_STAMP_FIELDS.map(([field, name]) => [name, Object.hasOwn(settings, field) ? settings[field] : undefined])
		);
	}

	/** The one stamp grammar (rules.ts stampCounts): `unit` while `record`
	 * holds, under each name, exactly the text of the number stored for it
	 * (absent where none is); else undefined. Keys, dials, and strip scales,
	 * bands and Group limits (pi-strip-model.js stampOf) read it alike. */
	function provenStamp(unit, record, numbers) {
		if (typeof unit !== "string" || !isPlainObject(record)) return undefined;
		for (const [name, stored] of numbers) {
			const recorded = Object.hasOwn(record, name) ? record[name] : undefined;
			if (recorded !== undefined && typeof recorded !== "string") return undefined;
			if (stampText(stored) !== recorded) return undefined;
		}
		return unit;
	}

	/** The alertDisplayUnitFor a save writes beside a stamp: the text of the
	 * three fields once `field` holds `value` (the edit being saved). */
	function alertStampProof(settings, field, value) {
		const next = { ...(isPlainObject(settings) ? settings : {}), [field]: value };
		const out = {};
		for (const [name, key] of ALERT_STAMP_FIELDS) {
			const text = stampText(Object.hasOwn(next, name) ? next[name] : undefined);
			if (text !== undefined) out[key] = text;
		}
		return out;
	}

	/**
	 * The entry a tick of "Separate limits for" creates, from the plugin's
	 * view of the reading on the dial: its unit and, when the dial's own
	 * limits cover the reading, a copy of them in the unit they compare in
	 * (a stamped °C/°F display unit, else the face's), so the tick alone
	 * changes no alert.
	 */
	function alertRuleSeed(settings, readingAlert) {
		const unit = readingAlert.displayUnit;
		if (readingAlert.legacyApplies !== true) return { unit };
		const stamped = provenDisplayUnit(settings);
		const seed = {
			warn: limitText(settings.warnValue),
			crit: limitText(settings.critValue),
			below: settings.alertBelow === true ? true : undefined,
			hyst: limitText(settings.alertHysteresis),
			unit: typeof stamped === "string" && temperaturePair(stamped, unit) ? stamped : unit
		};
		return Object.fromEntries(Object.entries(seed).filter(([, value]) => value !== undefined));
	}

	/** Blank, or a number the runtime reads (parseThreshold: trimmed, the
	 * first comma a decimal point). */
	function limitIsNumber(text) {
		const raw = String(text).trim();
		return raw === "" || Number.isFinite(Number(raw.replace(",", ".")));
	}

	const OWN_FIELD_NAMES = { warn: "Its warn at", crit: "Its critical at", hyst: "Its clear by" };

	/** A note for each of a reading's own limits, as typed, that is not a
	 * number (the panel shows these in the one note line, never as an error
	 * line that would move the panel as the dial rotates). */
	function alertOwnFieldNotes(values) {
		return ["warn", "crit", "hyst"]
			.filter((field) => typeof values?.[field] === "string" && !limitIsNumber(values[field]))
			.map((field) => `${OWN_FIELD_NAMES[field]} is not a number, so ${field === "hyst" ? "it counts as 0" : "it is ignored"}`);
	}

	/** The one note line under the dial's limits: the reading's own fields
	 * that are not numbers (when it has limits of its own; `ownValues` is
	 * null otherwise), then the plugin's notes on the limits that apply. */
	function alertNotes(ownValues, flags, source) {
		const notes = [...(ownValues === null ? [] : alertOwnFieldNotes(ownValues)), ...(Array.isArray(flags) ? flags : []).map((flag) => alertNoteText(flag, source)).filter((note) => note !== null)];
		return notes.length === 0 ? "" : `${notes.join(". ")}.`;
	}

	/** A stored limit as typed, for a summary (a stored number reads as one). */
	function typedLimit(raw) {
		if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
		return typeof raw === "string" ? raw.trim() : "";
	}

	/** The dial reading's own limits in words, from the entry the plugin
	 * says applies, or null when the reading has none. */
	function ownLimitsText(settings, readingAlert) {
		const found = readingAlert?.ruleKey === null || readingAlert?.ruleKey === undefined ? null : alertRuleOf(settings.alertRules, [readingAlert.ruleKey]);
		if (found === null) return null;
		const entry = found.entry;
		const below = entry.below === true;
		const unit = typeof entry.unit === "string" && entry.unit !== "" ? ` ${entry.unit}` : "";
		const parts = [];
		const warn = typedLimit(entry.warn);
		const crit = typedLimit(entry.crit);
		if (warn !== "") parts.push(`warn ${below ? "≤" : "≥"} ${warn}${unit}`);
		if (crit !== "") parts.push(`critical ${below ? "≤" : "≥"} ${crit}${unit}`);
		return `This reading: ${parts.length === 0 ? "off" : parts.join(" · ")}`;
	}

	/** A plugin note on the limits (alertFlags), in the panel's words, or
	 * null when the panel says it elsewhere: a field of the dial's own
	 * limits that is not a number has its own error line, and the panel
	 * checks a reading's own fields as typed (alertOwnFieldNotes). The
	 * recovery band is named by the field that applies (`source`, from the
	 * plugin's readingAlert). */
	function alertNoteText(flag, source) {
		if (flag === null || typeof flag !== "object" || typeof flag.code !== "string" || typeof flag.message !== "string") return null;
		if (/-not-number$/.test(flag.code)) return null;
		const band = source === "reading" ? "Its clear by" : "Clear by";
		if (flag.code === "hyst-negative") return `${band} is below 0, so it counts as 0`;
		if (flag.code === "band-wider-than-gap") return `${band} is as wide as the gap between warn and critical, or wider`;
		return flag.message;
	}

	/** What the dial's reading shows now, from the plugin's alert step. */
	function readingAlertNow(readingAlert) {
		if (readingAlert?.level === "crit") return " · critical now";
		if (readingAlert?.level === "warn") return " · warning now";
		if (readingAlert?.snoozed === "crit" || readingAlert?.snoozed === "warn") return " · snoozed";
		return "";
	}

	/** Alerts: the real operator, display units, and what they apply to.
	 * `now` ({ level, snoozed }) stands in for the live alert state, for
	 * the room the line keeps (alertsRoom). */
	function alertsSummary(kind, settings, preview, now) {
		const a = preview?.effective?.alert;
		const below = settings.alertBelow === true;
		const k = kind === "key" ? keyAlertExtras(preview?.effective?.keyAlerts, now) : { own: 0, firstOwn: false, extra: "" };
		// A dial's reading with limits of its own: those are what apply to it.
		const readingAlert = kind === "dial" ? preview?.effective?.readingAlert : undefined;
		const own = ownLimitsText(settings, readingAlert);
		if (own !== null) return `${own}${readingAlertNow(now ?? readingAlert)}`;
		if (a !== undefined) {
			const level = now?.level ?? a.level;
			// Reading 1 with limits of its own: Warn at and Critical at are not
			// in use, so the line names only the readings' own limits.
			if ((a.warn === null && a.crit === null) || k.firstOwn) {
				if (k.own > 0) {
					let own = `Own limits on ${readingsText(k.own)}`;
					if (level === "warn") own += " · warning now";
					if (level === "crit") own += " · critical now";
					return own + k.extra;
				}
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
			if (k.own > 0) text += ` · own limits on ${readingsText(k.own)}`;
			// A dial says what its face shows (after Alert after and any
			// snooze); a key, as before, what its value is past.
			if (readingAlert !== undefined) return text + readingAlertNow(now ?? readingAlert);
			if (level === "warn") text += " · warning now";
			if (level === "crit") text += " · critical now";
			return text + k.extra;
		}
		const w = typeof settings.warnValue === "string" ? settings.warnValue.trim() : "";
		const c = typeof settings.critValue === "string" ? settings.critValue.trim() : "";
		if (w === "" && c === "") return "Off";
		return [w !== "" ? `warn ${below ? "≤" : "≥"} ${w}` : "", c !== "" ? `critical ${below ? "≤" : "≥"} ${c}` : ""].filter(Boolean).join(" · ").replace(/^w/, "W").replace(/^c/, "C");
	}

	const LIVE_ALERTS = ["normal", "warn", "crit"].flatMap((level) => [{ level, snoozed: null }, { level, snoozed: "warn" }]);

	/** Every text the Alerts line can show while only the live alert state
	 * changes (a level crossed, a snooze) or a dial step goes onto or off a
	 * reading with limits of its own: the panel keeps the room of the
	 * longest (pi-shell.js holdRoom), so a live change never moves it. Empty
	 * when the line has one text. */
	function alertsRoom(kind, settings, preview) {
		const shown = preview?.effective?.readingAlert;
		const views = kind === "dial" && isPlainObject(settings.alertRules) && shown !== undefined ? [null, ...Object.keys(settings.alertRules)].map((ruleKey) => ({ ...preview, effective: { ...preview.effective, readingAlert: { ...shown, ruleKey } } })) : [preview];
		const texts = new Set(views.flatMap((view) => LIVE_ALERTS.map((now) => alertsSummary(kind, settings, view, now))));
		return texts.size > 1 ? [...texts] : [];
	}

	const DWELL_CHOICES = ["2000", "5000", "10000", "30000"];
	const SNOOZE_NAMES = { 300000: "5 min", 900000: "15 min", 3600000: "1 hour" };

	/** The Alerts section's Timing line, read the way the plugin parses
	 * each field (rules.ts): exact choices only, a band above 0. */
	function keyAlertTimingSummary(settings) {
		const parts = [DWELL_CHOICES.includes(settings.alertDwellMs) ? `after ${Number(settings.alertDwellMs) / 1000} s` : "immediately"];
		const band = settings.alertHysteresis;
		const raw = typeof band === "number" ? band : typeof band === "string" ? Number(band.trim().replace(",", ".")) : Number.NaN;
		if (Number.isFinite(raw) && raw > 0) parts.push(`clears ${num(raw)} back`);
		const snooze = typeof settings.alertSnoozeMs === "string" && Object.hasOwn(SNOOZE_NAMES, settings.alertSnoozeMs) ? SNOOZE_NAMES[settings.alertSnoozeMs] : undefined;
		if (snooze !== undefined) parts.push(`a press snoozes ${snooze}`);
		const text = parts.join(" · ");
		return text.charAt(0).toUpperCase() + text.slice(1);
	}

	/** What the detail view lists, in a few words; null for a filter with
	 * nothing to match (the view refuses to open). */
	function detailsWhat(settings) {
		const mode = detailMode(settings);
		const filter = detailFilterPattern(settings.detailFilter);
		if (mode === "filter" && filter === "") return null;
		return mode === "custom"
			? `custom list of ${Array.isArray(settings.detailKeys) ? new Set(settings.detailKeys.filter(nonEmpty)).size : 0}`
			: mode === "filter"
				? `filter "${filter.slice(0, 24)}"`
				: "this reading's sensor";
	}

	/** Key press behavior, the Back role winning outright (detailRoleOf).
	 * `detailsSupported` is false when the plugin reported that this deck
	 * has no detail view (the press then only shows an alert). */
	function keyInteractionSummary(settings, detailsSupported) {
		if (settings.detailRole === "back") return "Press returns to the previous profile (Back tile)";
		const press = pressBehavior(settings);
		if (press === "cycle-stat") return "Press cycles current, min, max, avg";
		if (detailsSupported === false) return press === "open-details" ? "Press would open details, but this deck has none" : "Tap cycles; hold would open details, but this deck has none";
		const what = detailsWhat(settings);
		if (what === null) {
			return press === "open-details" ? "Press opens nothing until the filter is set" : "Tap cycles; hold opens nothing until the filter is set";
		}
		return press === "open-details" ? `Press opens details: ${what}` : `Tap cycles; hold opens details: ${what}`;
	}

	const RULE_FIELDS = ["warn", "crit", "below", "hyst", "unit"];

	/**
	 * `alertRules` after one reading's row was edited: the entry filed under
	 * `fileKey` takes the patch (a blank text or a false box removes that
	 * field) and `unit`, the unit its numbers are in (the plugin's
	 * limitUnit: the one they were saved in while it still applies, so the
	 * numbers the person did not touch keep their meaning), in the same
	 * write. An entry left with no Warn at and no Critical at is removed
	 * unless it holds a field this build does not know: a lone direction or
	 * recovery band would otherwise decide the reading (an entry outranks
	 * the legacy pair) while alerting on nothing. Every other entry, and
	 * every unknown field, stays exactly as stored; keys are set as own
	 * properties whatever their spelling.
	 */
	function patchKeyAlertRule(raw, fileKey, patch, unit) {
		const out = isPlainObject(raw) ? { ...raw } : {};
		const prev = isPlainObject(raw) && Object.hasOwn(raw, fileKey) && isPlainObject(raw[fileKey]) ? raw[fileKey] : {};
		const next = { ...prev };
		for (const [field, value] of Object.entries(patch)) {
			if (value === undefined || value === false || (typeof value === "string" && value.trim() === "")) delete next[field];
			else setOwn(next, field, value);
		}
		if (typeof unit === "string") setOwn(next, "unit", unit);
		const limits = ["warn", "crit"].some((field) => Object.hasOwn(next, field));
		const unknown = Object.keys(next).some((field) => !RULE_FIELDS.includes(field));
		if (!limits && !unknown) delete out[fileKey];
		else setOwn(out, fileKey, next);
		return out;
	}

	/** Whether rotation groups are in effect: two or more groups that hold
	 * a reading key, the rule the runtime's rotationGroupsOf applies (a key
	 * claimed by an earlier group does not count again). */
	function groupsActive(settings) {
		return claimedGroups(settings).length >= 2;
	}

	/** The keys each stored rotation group holds, by the rule of the
	 * runtime's rotationGroupsOf (src/rotation.ts): an entry that is not an
	 * object or has no keys list is skipped, a key that is not a non-blank
	 * string or that an earlier group holds does not count, and a group
	 * left with no key drops out. The runtime uses groups only when two or
	 * more are left; this returns them all. */
	function claimedGroups(settings) {
		const groups = [];
		const claimed = new Set();
		for (const g of Array.isArray(settings.rotationGroups) ? settings.rotationGroups : []) {
			if (!isPlainObject(g) || !Array.isArray(g.keys)) continue;
			const keys = g.keys.filter((k) => typeof k === "string" && k.trim() !== "" && !claimed.has(k) && claimed.add(k));
			if (keys.length > 0) groups.push(keys);
		}
		return groups;
	}

	/** A gesture's command in words, with "Switch sensor or group" resolved
	 * to what it does on this dial now. */
	function gestureWords(command, settings) {
		if (command === "stepGroup") return groupsActive(settings) ? "switches group" : "switches sensor";
		return typeof command === "string" && Object.hasOwn(GESTURE, command) ? GESTURE[command] : "does nothing";
	}

	/** The auto-cycle interval the dial runs, or null for off: the plugin's
	 * parseAutoCycleMs exactly (a string or number that is a positive
	 * integer millisecond count; a boolean or array is off, AX31). */
	function autoCycleMsOf(settings) {
		const raw = settings.autoCycleMs;
		const ms = (typeof raw === "string" && raw !== "") || typeof raw === "number" ? Number(raw) : NaN;
		return Number.isInteger(ms) && ms > 0 ? ms : null;
	}

	/** Dial gestures from the plugin's resolved scheme; stored preset otherwise. */
	function dialInteractionSummary(settings, preview) {
		const c = preview?.effective?.controls;
		const ms = autoCycleMsOf(settings);
		const cycle = ms !== null ? `auto cycle ${ms % 60000 === 0 ? `${ms / 60000} min` : `${ms / 1000} s`}` : "";
		const bump = settings.rotationDisabled === true ? "turns ignored" : "";
		if (c === undefined) {
			const p = settings.controlPreset === "elite" || settings.controlPreset === "custom" ? settings.controlPreset : "legacy";
			return [`${p.charAt(0).toUpperCase()}${p.slice(1)} controls`, bump, cycle].filter(Boolean).join(" · ");
		}
		const name = `${c.preset.charAt(0).toUpperCase()}${c.preset.slice(1)}`;
		const say = (command) => gestureWords(command, settings);
		const turn = settings.rotationDisabled === true ? "turns ignored" : `turn ${say(c.rotate)}`;
		// The pressed turn is Elite's group switch: named when it does
		// something different from a plain turn (round 3, R30).
		const pressed = settings.rotationDisabled !== true && c.pressedRotate !== c.rotate && c.pressedRotate !== "none" ? `pressed turn ${say(c.pressedRotate)}` : "";
		const tap = c.touchZones === "two" ? "touch sides switch readings" : c.touchZones === "three" ? `touch sides switch readings, center tap ${say(c.tap)}` : `tap ${say(c.tap)}`;
		// A reset that reaches past this reading is named with its reach on
		// whichever push does it, even Elite's long push, which the line
		// otherwise leaves out: a destructive reach never hides in a fold
		// (round 3, re-review PY03). The pause clause's note gives way to it.
		const reach = settings.resetScope === "all" ? " (every dial, everywhere)" : settings.resetScope === "set" ? " (whole rotation set)" : "";
		const pushSays = (command) => `${say(command)}${command === "resetStats" ? reach : ""}`;
		const push = `push ${pushSays(c.shortPress)}${c.shortPress === "pauseResume" && cycle === "" && reach === "" ? " (auto cycle is off)" : ""}`;
		const longPush = reach !== "" && c.preset !== "legacy" && c.longPress === "resetStats" && c.shortPress !== "resetStats" ? `long push ${pushSays(c.longPress)}` : "";
		return [`${name}: ${turn}`, pressed, push, longPush, tap, cycle].filter(Boolean).join(" · ");
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
			backToCurrent: "Back to current value",
			pauseCycle: "Pause auto cycle",
			resumeCycle: "Resume auto cycle",
			toggleCycle: "Pause/resume auto cycle",
			pin: "Pin reading",
			unpin: "Unpin reading",
			togglePin: "Pin/unpin reading",
			resetStats: "Reset session stats",
			snoozeAlerts: "Snooze alerts",
			unsnoozeAlerts: "End alert snooze",
			stripLive: "Strip: back to live",
			stripInspect: "Strip: inspect (pause the view)",
			stripToggleInspect: "Strip: inspect or back to live",
			stripWindowNext: "Strip: longer time window",
			stripWindowPrev: "Strip: shorter time window",
			stripSeriesNext: "Strip: highlight next reading",
			stripSeriesPrev: "Strip: highlight previous reading",
			stripScreenNext: "Strip: next screen",
			stripScreenPrev: "Strip: previous screen",
			stripScreenFirst: "Strip: first screen"
		};
		const id = settings.command === undefined ? "next" : settings.command;
		// Own names only: a stored "constructor" is an unknown command, not
		// Object (external review AX22).
		const name = typeof id === "string" && Object.hasOwn(COMMANDS, id) ? COMMANDS[id] : undefined;
		// A stored object is shown as JSON: String() throws on some (AX59).
		if (name === undefined) return { command: `Unknown command "${typeof id === "string" ? id : JSON.stringify(id)}": the key shows an alert`, target: "" };
		const scope = settings.resetScope === "set" || settings.resetScope === "all" ? settings.resetScope : "current";
		const target = typeof settings.target === "string" ? settings.target.trim() : "";
		if (id === "resetStats" && scope === "all") return { command: name, target: "every dial on every Stream Deck (Link ID ignored)" };
		const reach = id === "resetStats" ? (scope === "set" ? ", whole rotation set" : ", current reading") : "";
		// Strip commands reach strips (by the strip's own Link ID), never a
		// single dial; every other command skips dials joined to a strip.
		if (id.startsWith("strip")) return { command: name, target: target === "" ? "every strip" : `strips with Link ID "${target}"` };
		return { command: `${name}${reach}`, target: target === "" ? "every dial" : `dials with Link ID "${target}"` };
	}

	/** The read interval the runtime uses, mirroring parsePollInterval
	 * (src/poller.ts): a finite number is rounded and clamped to 250 ms..60 s,
	 * anything else is the 1 s default. */
	function pollIntervalOf(raw) {
		const n = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : Number.NaN;
		return Number.isFinite(n) ? Math.min(60_000, Math.max(250, Math.round(n))) : 1000;
	}

	/** The option a shared select (Shared defaults, Connection)
	 * shows for a stored blank ("" or only spaces): what the runtime draws
	 * for it. A blank is no newer version's choice, so it is not shown as a
	 * kept value. The runtime reads it as the field's default, `fallback`
	 * (for the theme, the deck theme it already resolved, which the select
	 * holds as its default), except Read every: parsePollInterval reads a
	 * blank as 0 and clamps it to 250 ms. Display only; nothing is written.
	 * Any other text comes back as it is. */
	function sharedChoiceShown(setting, text, fallback) {
		if (typeof text !== "string" || text.trim() !== "") return text;
		return setting === "pollIntervalMs" ? String(pollIntervalOf(text)) : fallback;
	}

	/** Shared defaults, folded: what a key or dial set to Default draws.
	 * `resolvedTheme` is the panel's resolved deck theme (a known stored
	 * shared theme, else the plugin's effectiveDeckTheme, which includes the
	 * legacy migration); without it, a stored id this version does not know
	 * draws the spec default. */
	function sharedDefaultsSummary(globals, resolvedTheme) {
		const id = typeof resolvedTheme === "string" && Object.hasOwn(THEME_NAMES, resolvedTheme) ? resolvedTheme : typeof globals.theme === "string" && Object.hasOwn(THEME_NAMES, globals.theme) ? globals.theme : "void";
		const theme = themeName(id);
		const text = globals.textMode === "dim" ? "dimmed text" : globals.textMode === "custom" ? "custom text" : "theme text";
		const accents = globals.typeAccents === "off" ? "theme accent" : "accents by type";
		const font = globals.textFont === "segoe-ui" ? "Segoe UI" : "Tahoma";
		const units = globals.dataUnits === "binary" ? "binary units" : "decimal units";
		return `${theme} · ${text} · ${font} · ${accents} · ${units}`;
	}

	/** Connection, folded: the source mode and the read interval. */
	function connectionSummary(globals) {
		const src = globals.source === "shared-memory" ? "Shared Memory only" : globals.source === "gadget" ? "Gadget only" : "Auto source";
		const ms = pollIntervalOf(globals.pollIntervalMs);
		return `${src} · read every ${ms >= 1000 ? `${ms / 1000} s` : `${ms} ms`}`;
	}

	/** Advanced: the shared, plugin-wide choices (global settings). */
	function advancedSummary(globals) {
		const src = globals.source === "shared-memory" ? "Shared Memory only" : globals.source === "gadget" ? "Gadget only" : "Auto source";
		const ms = pollIntervalOf(globals.pollIntervalMs);
		const poll = ms >= 1000 ? `read every ${ms / 1000} s` : `read every ${ms} ms`;
		const units = globals.dataUnits === "binary" ? "binary units" : "decimal units";
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

	/** JSON with every object's keys sorted: equal for equal documents in
	 * whatever order a delivery wrote their keys. */
	function sortedJson(value) {
		return JSON.stringify(value, (_, v) => (v !== null && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v));
	}

	// --- per-reading formats (issue #59) ------------------------------------
	// The panel's half of src/ui/reading-format.ts: readingFormats maps a
	// reading key to { unit?, decimals? }. Lookups walk the reading's keys
	// with own-property checks, the plugin's walk; the panel is the only
	// writer and writes only from a select change.

	/** The most own entries the panel lets the map grow to; an existing
	 * entry can always be edited. */
	const READING_FORMATS_CAP = 128;
	/** The decimals choices the runtime reads (src/ui/reading-format.ts),
	 * in the order the panel lists them. */
	const FORMAT_DECIMALS = Object.freeze(["auto", "0", "1", "2", "3"]);

	/** The entry that applies to a reading (its keys in walk order, the
	 * first own plain-object entry), with the key it is saved under; null
	 * when none or when the map is not a plain object. */
	function readingFormatOf(raw, keys) {
		if (!isPlainObject(raw)) return null;
		for (const key of keys) {
			if (typeof key !== "string" || key === "" || !Object.hasOwn(raw, key)) continue;
			const entry = raw[key];
			if (isPlainObject(entry)) return { key, entry };
		}
		return null;
	}

	/**
	 * readingFormats with one reading's choice changed: every entry under
	 * the reading's keys (`keys`, the row key first) goes, then one entry is
	 * written under `fileKey` holding the entry's other fields (unknown ones
	 * included) with `patch` applied: a field set to "" is removed. An entry
	 * left with nothing is not written, and a map left empty is undefined
	 * (the field goes). Other readings' entries, dormant or junk, stay as
	 * stored. Refuses ({ refused }) a map that is not a plain object (a shape
	 * a newer version wrote; kept untouched) and a new entry past the cap.
	 */
	function patchReadingFormat(raw, keys, fileKey, patch) {
		if (raw !== undefined && raw !== null && !isPlainObject(raw)) return { refused: "shape" };
		const map = isPlainObject(raw) ? raw : {};
		const found = readingFormatOf(map, keys);
		const entry = found === null ? {} : { ...found.entry };
		for (const field of ["unit", "decimals"]) {
			if (!Object.hasOwn(patch, field)) continue;
			if (patch[field] === "") delete entry[field];
			else entry[field] = patch[field];
		}
		const existed = keys.some((key) => Object.hasOwn(map, key));
		const keep = Object.keys(entry).length > 0;
		if (keep && !existed && Object.keys(map).length >= READING_FORMATS_CAP) return { refused: "cap" };
		const next = { ...map };
		for (const key of keys) delete next[key];
		if (keep) setOwn(next, fileKey, entry);
		return { next: Object.keys(next).length === 0 ? undefined : next };
	}

	/**
	 * The rows of a key's per-reading format list: one per configured slot of
	 * the stored layout, in slot order; a slot showing a reading an earlier
	 * slot already shows (`same`, the panel's alias-aware comparison) gets a
	 * row with no controls naming that slot.
	 */
	function formatRowPlan(settings, same) {
		const layout = storedKeyLayout(settings);
		const count = layout === "quad" ? 4 : layout === "triple" ? 3 : layout === "dual" ? 2 : 1;
		const plan = [];
		for (let slot = 0; slot < count; slot++) {
			const key = settings[SLOT_FIELDS[slot]];
			if (!nonEmpty(key)) continue;
			const earlier = plan.find((p) => p.kind === "edit" && same(p.key, key));
			plan.push(earlier === undefined ? { slot, key, kind: "edit" } : { slot, key, kind: "same", of: earlier.slot });
		}
		return plan;
	}

	/** The format sub-section's folded line: what the rows' own formats are. */
	function formatsSummary(rows) {
		const set = rows.filter((row) => row.unit !== "" || row.decimals !== "");
		if (set.length === 0) return "None set";
		if (set.length > 1) return `${set.length} readings set`;
		const row = set[0];
		const decimals = row.decimals === "" ? "" : row.decimals === "auto" ? "auto decimals" : `${row.decimals} decimal${row.decimals === "1" ? "" : "s"}`;
		return `${row.name}: ${[row.unit, decimals].filter((part) => part !== "").join(", ")}`;
	}

	/** Sets one entry as an own property whatever the key's spelling: a
	 * stored key like "__proto__" would otherwise reach the prototype
	 * setter and store nothing (external review AX35). */
	function setOwn(obj, key, value) {
		Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true });
		return obj;
	}

	/** A name map with one entry set (or removed on empty); junk entries
	 * the parser skipped ride along untouched. */
	function patchNames(raw, key, name) {
		const out = isPlainObject(raw) ? { ...raw } : {};
		if (name === "") delete out[key];
		else setOwn(out, key, name);
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

	/** Shared settings fields that belong to this machine alone. `launchKey`
	 * is a secret this machine may hold from a 1.8 test build, which signed
	 * the programs and addresses a person allowed a key to open with it: no
	 * copy shows it, and Replace keeps the stored one and never takes a
	 * pasted one. */
	// looksResetGen counts this machine's own "Use it everywhere" presses
	// (src/ui/shared-looks.ts): another machine's number would drop choices
	// made here, so it never travels with a pasted document.
	const MACHINE_ONLY_GLOBALS = ["launchKey", "looksResetGen"];

	/** The shared document as the Shared settings well shows and copies it:
	 * every field except the machine-only ones, kept exactly as stored. */
	function sharedDocForWell(globals) {
		const out = {};
		if (!isPlainObject(globals)) return out;
		for (const [field, value] of Object.entries(globals)) {
			if (!MACHINE_ONLY_GLOBALS.includes(field)) setOwn(out, field, value);
		}
		return out;
	}

	/** What Replace writes: the pasted document without any machine-only
	 * field, and this machine's own values for them carried over from the
	 * current document. A pasted key is ignored, never stored. */
	function sharedDocToWrite(pasted, current) {
		const out = sharedDocForWell(pasted);
		if (!isPlainObject(current)) return out;
		for (const field of MACHINE_ONLY_GLOBALS) {
			if (Object.hasOwn(current, field)) setOwn(out, field, current[field]);
		}
		return out;
	}

	// --- plugin-written global fields (Reading links, Calculated readings) ---

	/** A stored field as comparable text: object keys sorted (the app
	 * re-sorts every plugin message), an absent field its own spelling. */
	const fieldJson = (value) => (value === undefined ? "\u0000absent" : sortedJson(value));

	/** How long the shell holds the panel's own whole-document global
	 * writes back while the plugin commits a field (then they go as held). */
	const GLOBALS_HOLD_MS = 3000;

	/**
	 * The shell's guard for the global fields only the plugin writes
	 * (readingLinks, calculatedReadings). The panel's settings store saves
	 * the WHOLE global document on any shared edit, from its own copy, so
	 * a copy taken before the plugin's commit would put the old field back.
	 * While an apply is in flight the panel's whole-document writes are
	 * held (the last one wins, as each carries every earlier edit); once
	 * the plugin answers, a held or later document that still carries the
	 * field as it was before the commit gets the committed value instead.
	 * Chained commits to one field all count: every earlier value the
	 * store may still hold maps to the newest commit. A document delivered
	 * to the panel ends the splice for a field once it carries none of the
	 * old values (the store has adopted a newer one). An answer that comes
	 * after the hold ended still counts (late), and resends the document
	 * that went out meanwhile with the old field.
	 * Pure: the clock is passed in, the shell sends what it is told to.
	 */
	function createGlobalsGuard(holdMs = GLOBALS_HOLD_MS) {
		// field -> { befores: Set<fieldJson>, next }. Every value the store's
		// copy may still hold for the field (each commit's previous value
		// since the store last adopted a delivered document), all mapping to
		// the newest committed value: after two commits X to Y and Y to Z the
		// store can still hold X, and X must become Z, not go back out.
		const confirmed = new Map();
		let inFlight = 0;
		let since = 0;
		let held = null;
		let lastKnown = null;
		const splice = (doc) => {
			if (!isPlainObject(doc)) return doc;
			let out = doc;
			for (const [field, { befores, next }] of confirmed) {
				if (befores.has(fieldJson(out[field]))) out = setOwn({ ...out }, field, next);
			}
			return out;
		};
		/** Records one commit the plugin confirmed; true when it was one. */
		const confirm = (reply) => {
			if (!isPlainObject(reply) || reply.ok !== true || typeof reply.field !== "string" || !Object.hasOwn(reply, "next")) return false;
			const previous = reply.previousPresent === true ? fieldJson(reply.previous) : fieldJson(undefined);
			const earlier = confirmed.get(reply.field);
			const befores = new Set(earlier === undefined ? [] : [...earlier.befores, fieldJson(earlier.next)]);
			befores.add(previous);
			befores.delete(fieldJson(reply.next));
			confirmed.set(reply.field, { befores, next: reply.next });
			return true;
		};
		const sent = (doc) => {
			lastKnown = doc;
			return doc;
		};
		const holding = (now) => inFlight > 0 && now - since < holdMs;
		return {
			/** An apply went out: hold whole-document writes from now. */
			begin(now) {
				if (inFlight === 0) since = now;
				inFlight += 1;
			},
			/** The plugin answered (null: no answer in time). */
			settle(reply) {
				inFlight = Math.max(0, inFlight - 1);
				confirm(reply);
			},
			/**
			 * An answer that came after the hold ended on its own (settle(null)
			 * ran for it). The commit is spliced from now on; when a document
			 * already went out still carrying the field as it was before the
			 * commit, that document goes again with the commit in it (returned
			 * here for the shell to send), so the late commit is not undone.
			 */
			late(reply, now) {
				if (!confirm(reply)) return null;
				// A document held for another apply is spliced when it goes.
				if (held !== null || lastKnown === null) return null;
				const out = splice(lastKnown);
				if (out === lastKnown) return null;
				if (holding(now)) {
					held = out;
					return null;
				}
				return sent(out);
			},
			/** A whole document the panel is about to save: hold it, or send
			 * it with every committed field spliced in. */
			outgoing(doc, now) {
				const out = splice(doc);
				if (holding(now)) {
					held = out;
					return { hold: true, doc: out };
				}
				return { hold: false, doc: sent(out) };
			},
			/**
			 * A whole document the person chose as it is (Replace shared
			 * settings with a backup). It goes now, never held and never
			 * spliced: a backup taken before a Link or Save press carries the
			 * older list on purpose. Every splice ends, and a held save is
			 * dropped (the chosen document replaces it).
			 */
			explicit(doc) {
				confirmed.clear();
				held = null;
				return sent(doc);
			},
			/** The held document to send now (spliced), once nothing holds it. */
			release(now) {
				if (held === null || holding(now)) return null;
				const out = splice(held);
				held = null;
				return sent(out);
			},
			/** When the hold ends on its own (the plugin never answered). */
			holdEndsAt() {
				return inFlight > 0 ? since + holdMs : null;
			},
			/** A document delivered to the panel. */
			received(doc) {
				if (!isPlainObject(doc)) return;
				lastKnown = doc;
				for (const [field, { befores }] of [...confirmed]) {
					if (!befores.has(fieldJson(doc[field]))) confirmed.delete(field);
				}
			},
			holding,
			/** The fields still being spliced (the suites read it). */
			splicing: () => [...confirmed.keys()]
		};
	}

	/** Advanced > Reading links, one line: what is stored and in use. */
	function linksSummary(globals, workspace) {
		if (isPlainObject(workspace) && isPlainObject(workspace.counts)) {
			const { stored, active, waiting, ignored } = workspace.counts;
			if (stored === 0) return "No links";
			const parts = [`${stored} link${stored === 1 ? "" : "s"}`];
			if (active > 0) parts.push(`${active} in use`);
			if (waiting > 0) parts.push(`${waiting} waiting`);
			if (ignored > 0) parts.push(`${ignored} ignored`);
			return parts.join(" · ");
		}
		const raw = isPlainObject(globals) ? globals.readingLinks : undefined;
		if (raw === undefined || (Array.isArray(raw) && raw.length === 0)) return "No links";
		return Array.isArray(raw) ? `${raw.length} link${raw.length === 1 ? "" : "s"}` : "Not a list";
	}

	/** Advanced > Calculated readings, one line. */
	function calcSummary(globals, workspace) {
		const rows = isPlainObject(workspace) && Array.isArray(workspace.rows) ? workspace.rows : null;
		const raw = isPlainObject(globals) ? globals.calculatedReadings : undefined;
		const count = rows !== null ? rows.length : Array.isArray(raw) ? raw.length : 0;
		if (rows === null && raw !== undefined && !Array.isArray(raw)) return "Not a list";
		if (count === 0) return "None";
		const invalid = rows === null ? 0 : rows.filter((row) => isPlainObject(row) && row.ok !== true).length;
		return `${count} defined${invalid > 0 ? ` · ${invalid} not valid` : ""}`;
	}

	return {
		fieldJson,
		GLOBALS_HOLD_MS,
		createGlobalsGuard,
		linksSummary,
		calcSummary,
		themeName,
		storedKeyLayout,
		dialView,
		trendWindow,
		lookOf,
		isArtLook,
		ART_LOOKS,
		STARS,
		TONES,
		starsOf,
		toneOf,
		drawnStars,
		skyShown,
		sharedSkyOf,
		lightTheme,
		STARS_TEXT,
		TONE_TEXT,
		wordsOf,
		dialBackground,
		keyBackground,
		keyAccentWords,
		accentWordsLook,
		dialAccentWords,
		looksGenOf,
		ownLooksLine,
		stampOwnLooks,
		pressBehavior,
		detailsBehavior,
		keyAlertTimingSummary,
		keyAlertSlot,
		alertRowPlan,
		patchKeyAlertRule,
		detailMode,
		detailFilterAlternatives,
		detailFilterPattern,
		detailFilterGlob,
		detailFilterMatcher,
		foldedUnits,
		globMatch,
		detailDensity,
		readingSummary,
		displaySummary,
		alertsSummary,
		alertsRoom,
		alertTimingSummary,
		alertNoteText,
		alertDwellMsOf,
		alertSnoozeMsOf,
		alertRuleOf,
		patchAlertRule,
		withoutAlertRule,
		alertUnitUsable,
		alertEditFields,
		alertFieldUnit,
		alertRuleSeed,
		provenDisplayUnit,
		provenStamp,
		alertStampProof,
		alertOwnFieldNotes,
		alertNotes,
		keyInteractionSummary,
		dialInteractionSummary,
		groupsActive,
		claimedGroups,
		gestureWords,
		pollIntervalOf,
		sharedChoiceShown,
		controlSummary,
		advancedSummary,
		sharedDefaultsSummary,
		connectionSummary,
		thresholdText,
		splitKeyList,
		mergeKept,
		patchEntry,
		patchNames,
		patchColors,
		sharedDocForWell,
		sharedDocToWrite,
		setOwn,
		sortedJson,
		autoCycleMsOf,
		same,
		READING_FORMATS_CAP,
		FORMAT_DECIMALS,
		readingFormatOf,
		patchReadingFormat,
		formatRowPlan,
		formatsSummary,
		LAYOUT_NAMES,
		VIEW_NAMES,
		GESTURE
	};
})();
