/* The panel shell every property inspector shares: one place that sees the
   settings documents and every write, the native-control bindings, the
   section summaries, the header with the device face, and the status line.

   Writes go through the vendored sdpi settings store (useSettings /
   useGlobalSettings), exactly as before: each edit merges one field into
   the store's copy of the document and saves the WHOLE document, so fields
   this build does not know ride along untouched. The shell wraps the
   client's setSettings/setGlobalSettings only to OBSERVE those saves (the
   app never echoes a panel's own write back to it); it never adds one.
   Opening, closing, scrolling, expanding a section, searching and focusing
   write nothing. */
/* global SDPIComponents, hwModel */
self.hwShell = (() => {
	"use strict";

	const { streamDeckClient: client, useSettings, useGlobalSettings } = SDPIComponents;
	const kind = document.body.dataset.kind ?? "key";
	const listeners = new Map();
	const on = (name, fn) => {
		const list = listeners.get(name) ?? [];
		list.push(fn);
		listeners.set(name, list);
	};
	const emit = (name, arg) => {
		for (const fn of listeners.get(name) ?? []) {
			try {
				fn(arg);
			} catch (err) {
				console.error(`hw panel: ${name} listener failed`, err);
			}
		}
	};

	/** What the panel knows right now. `writes`/`globalWrites` count saves
	 * (the suites read them through window.__hwPanel; nothing else does). */
	const state = {
		kind,
		context: "",
		settings: {},
		globals: {},
		preview: null,
		face: "",
		tree: null,
		treeAt: 0,
		writes: 0,
		globalWrites: 0,
		heardFromPlugin: false,
		connectedAt: 0
	};
	window.__hwPanel = state;

	const isDoc = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

	const setSettings = client.setSettings.bind(client);
	client.setSettings = (doc) => {
		state.writes += 1;
		if (isDoc(doc)) state.settings = doc;
		emit("settings", { origin: "local" });
		return setSettings(doc);
	};
	const setGlobals = client.setGlobalSettings.bind(client);
	client.setGlobalSettings = (doc) => {
		state.globalWrites += 1;
		if (isDoc(doc)) state.globals = doc;
		emit("globals", { origin: "local" });
		return setGlobals(doc);
	};
	client.didReceiveSettings.subscribe((ev) => {
		const doc = ev?.payload?.settings;
		if (!isDoc(doc)) return;
		state.settings = doc;
		emit("settings", { origin: "echo" });
	});
	client.didReceiveGlobalSettings.subscribe((ev) => {
		const doc = ev?.payload?.settings;
		if (!isDoc(doc)) return;
		state.globals = doc;
		emit("globals", { origin: "echo" });
	});
	client.getConnectionInfo().then((info) => {
		state.context = info?.actionInfo?.context ?? "";
		state.connectedAt = performance.now();
		// Sensor panels ask once for the current face; the plugin also sends
		// one with every tick, so this only shortens the first wait.
		if (kind === "key" || kind === "dial") client.send("sendToPlugin", { event: "getPreview" });
		emit("connected", info);
		scheduleRender();
		// A plugin that never answers is the one state this panel cannot
		// hide: say so instead of waiting forever.
		setTimeout(scheduleRender, 3200);
	});
	client.sendToPropertyInspector.subscribe((ev) => {
		const p = ev?.payload;
		if (!isDoc(p)) return;
		state.heardFromPlugin = true;
		if (p.event === "preview") {
			// A preview for another context (a late reply after a quick
			// switch) is never shown here.
			if (typeof p.context === "string" && state.context !== "" && p.context !== state.context) return;
			if (typeof p.face === "string") state.face = p.face;
			state.preview = p;
			emit("preview", p);
		} else if (p.event === "sensorTree") {
			state.tree = p;
			state.treeAt = performance.now();
			emit("tree", p);
		}
		scheduleRender();
	});

	// --- native controls bound to one setting each ----------------------------
	// <select|input data-setting="x" [data-global] [data-default="v"]>. The
	// default is DISPLAY only (what the runtime does when the field is absent);
	// it is never written. A stored value no option offers (a newer version's
	// choice) is shown as such and kept until the person picks another.
	const bound = [];
	// Text saves waiting out their debounce. Switching to another action
	// unloads this page; the pending text is saved first, to this panel's
	// own context (the socket and registration are still this page's).
	const pendingFlushes = new Set();
	const flushPending = () => {
		for (const flush of [...pendingFlushes]) flush();
	};
	window.addEventListener("pagehide", flushPending);
	// The app tears a panel down as soon as another action is selected, and
	// a save sent from pagehide does not land (bench 2026-09-23, Stream Deck
	// 7.4.2: 20 of 20 labels typed within 200 ms of a switch were lost). The
	// pointer leaves the panel, or the panel loses focus, before a click
	// elsewhere can select another action, so pending text is saved then.
	document.documentElement.addEventListener("mouseleave", flushPending);
	window.addEventListener("blur", flushPending);

	function showValue(el, value) {
		if (el.type === "checkbox") {
			// The runtime reads a default-on flag as "on unless false" and a
			// default-off flag as "on only if true"; junk shows what it does.
			const on = el.dataset.default === "true" ? value !== false : value === true;
			if (el.checked !== on) el.checked = on;
			return;
		}
		if ((el.tagName === "INPUT" || el.tagName === "TEXTAREA") && document.activeElement === el) return; // never under the caret
		const text = value === undefined || value === null ? (el.dataset.default ?? "") : typeof value === "string" ? value : JSON.stringify(value);
		if (el.tagName === "SELECT") {
			let unknown = el.querySelector("option[data-unknown]");
			const known = Array.from(el.options).some((o) => !o.hasAttribute("data-unknown") && o.value === text);
			if (!known) {
				if (unknown === null) {
					unknown = document.createElement("option");
					unknown.dataset.unknown = "";
					unknown.disabled = true;
					el.appendChild(unknown);
				}
				unknown.value = text;
				unknown.textContent = keptLabel(el, text);
			} else if (unknown !== null) {
				unknown.remove();
			}
		}
		if (el.value !== text) el.value = text;
		if (el.tagName === "INPUT" && el.dataset.validate === "number") validateNumber(el);
	}

	/** The kept option's text. A stored value no option offers may still be
	 * one the runtime uses (an auto cycle interval set by a newer version or
	 * a configuration document), so the text says only what is true: it is
	 * not in this list and it is kept. */
	function keptLabel(el, text) {
		if (el.dataset.kept === "interval") {
			const ms = Number(text);
			if (Number.isInteger(ms) && ms > 0) return `Every ${ms % 60000 === 0 ? `${ms / 60000} min` : `${ms / 1000} s`} (not in this list, kept)`;
		}
		return `Stored value "${text}" (not in this list, kept)`;
	}

	/** Thresholds and ranges: the runtime reads "70,5" as 70.5 and ignores
	 * anything else. The text is saved as typed (nothing is lost); the
	 * field says what will ignore it. */
	function validateNumber(el, typed = false) {
		const raw = el.value.trim();
		const ok = raw === "" || Number.isFinite(Number(raw.replace(",", ".")));
		const err = document.getElementById(`${el.id}-error`);
		const wasInvalid = el.getAttribute("aria-invalid") === "true";
		el.setAttribute("aria-invalid", ok ? "false" : "true");
		if (err !== null) {
			err.hidden = ok;
			err.textContent = ok ? "" : `Not a number. ${el.dataset.ignoredBy ?? "Alerts"} ignore${el.dataset.ignoredBy === undefined ? "" : "s"} this field until it is one.`;
			// Said once when typing makes the field invalid (the message is
			// linked by aria-describedby, which nothing speaks while typing);
			// never on load and never per keystroke.
			if (typed && !ok && !wasInvalid) announce("validate", err.textContent, { repeat: true });
		}
	}

	function bindControl(el) {
		const setting = el.dataset.setting;
		const store = el.hasAttribute("data-global") ? useGlobalSettings : useSettings;
		const [get, save] = store(setting, (value) => showValue(el, value), null);
		const isText = el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && el.type !== "checkbox");
		let timer = 0;
		let composing = false;
		const flush = () => {
			if (composing) return; // an IME still owns the text; its end schedules the save
			clearTimeout(timer);
			timer = 0;
			pendingFlushes.delete(flush);
			save(el.value);
		};
		const schedule = () => {
			clearTimeout(timer);
			timer = setTimeout(flush, 200);
			pendingFlushes.add(flush);
		};
		if (el.type === "checkbox") {
			el.addEventListener("change", () => save(el.checked));
		} else if (el.tagName === "SELECT") {
			el.addEventListener("change", () => {
				if (el.selectedOptions[0]?.hasAttribute("data-unknown")) return;
				save(el.value);
				// The kept value is gone from the document once another is picked.
				el.querySelector("option[data-unknown]")?.remove();
			});
		} else if (isText) {
			// Typing saves 200 ms after the last keystroke (the sdpi textfield
			// cadence), never mid-composition, and at once on commit.
			el.addEventListener("compositionstart", () => {
				composing = true;
			});
			el.addEventListener("compositionend", () => {
				composing = false;
				schedule();
			});
			el.addEventListener("input", () => {
				if (el.dataset.validate === "number") validateNumber(el, true);
				if (composing) return;
				schedule();
			});
			el.addEventListener("change", () => {
				if (timer !== 0) flush();
			});
		}
		get().then((value) => showValue(el, value));
		bound.push({ el, setting, get });
	}

	for (const el of document.querySelectorAll("[data-setting]")) bindControl(el);

	/** Re-reads bound controls from the store (after a wholesale apply):
	 * every one, or only those bound to the named settings. */
	function resyncBound(settings) {
		for (const { el, setting, get } of bound) {
			if (settings === undefined || settings.includes(setting)) get().then((value) => showValue(el, value));
		}
	}
	on("settings", (ev) => {
		if (ev.origin === "echo") resyncBound();
	});
	on("globals", () => resyncBound());

	// --- sections keep the folds a person chose -------------------------------
	// Selecting another key loads a fresh panel, so without memory every
	// section a person opened snapped shut again while they went from key to
	// key. Each section stays as it was last left, per kind of panel (NN/g:
	// "Items that are opened or closed should remain in that state until the
	// user changes it"). Only a person's toggle is remembered, never a reveal
	// or a script. The two chevron buttons in the header's top corner open or
	// fold them all (Alt-click on a section title does the same).
	// A view preference, never a setting, so folding a section writes nothing
	// to any key. The plugin holds the folds in memory while it runs
	// (src/panel-folds.ts): the app gives every panel it opens fresh web
	// storage, kept only across a reload of that same panel (bench
	// 2026-09-24), so a panel cannot carry them to the next key itself. A
	// restart shows the defaults again, one press on Open all from
	// everything open. The panels' HTML starts with data-folds-pending, so
	// the sections are hidden from the very first paint until the plugin
	// answers; a remembered fold never flashes the defaults first. The wait
	// is capped at 600 ms after the panel connects (the round trip measured
	// about 320 ms in the Stream Deck app on the owner's deck, 2026-09-26),
	// and at 1.5 s overall for a plugin that never connects.
	// The groups inside Advanced (details.hw-sub) fold and are remembered
	// the same way; "How this works" help is not a section and is neither.
	const sections = Array.from(document.querySelectorAll("details.hw-sec[id], details.hw-sub[id]"));
	const folds = {};
	const keepFolds = () => client.send("sendToPlugin", { event: "setPanelFolds", kind, folds });
	// A section a person toggled on this page keeps that state even if the
	// plugin's answer arrives after the toggle.
	const touched = new Set();
	// Whether the person has pressed, typed, scrolled or moved focus to a
	// control in this panel yet. Focus counts because assistive technology
	// can move it with no key or pointer event reaching the page; the page
	// itself taking focus (the body) does not.
	let personActed = false;
	const ACTS = ["pointerdown", "keydown", "wheel", "focusin"];
	const acted = (ev) => {
		if (ev.type === "focusin" && (ev.target === document.body || ev.target === document.documentElement)) return;
		personActed = true;
		for (const type of ACTS) document.removeEventListener(type, acted, true);
	};
	for (const type of ACTS) document.addEventListener(type, acted, { capture: true, passive: true });
	const foldsReady = (why) => {
		if (!document.documentElement.hasAttribute("data-folds-pending")) return;
		document.documentElement.removeAttribute("data-folds-pending");
		performance.mark(`hw-folds-${why}`);
	};
	if (sections.length === 0) foldsReady("none");
	else {
		setTimeout(() => foldsReady("timeout"), 1500);
		client.getConnectionInfo().then(() => {
			performance.mark("hw-connected");
			client.send("sendToPlugin", { event: "getPanelFolds", kind });
			setTimeout(() => foldsReady("timeout"), 600);
		});
	}
	client.sendToPropertyInspector.subscribe((ev) => {
		const p = ev?.payload;
		if (!isDoc(p) || p.event !== "panelFolds" || p.kind !== kind || !isDoc(p.folds)) return;
		for (const [id, open] of Object.entries(p.folds)) {
			if (typeof open === "boolean" && !touched.has(id)) folds[id] = open;
		}
		// On the Stream Deck app the answer can land after the panel shows
		// (hardware, 2026-09-26: shown at the then 300 ms cap, answer 17 ms
		// later). It
		// still applies until the person presses, types, scrolls or moves
		// focus; after that it only opens sections, never folds one under
		// them (ADR05, AX03).
		// The memory itself is untouched either way.
		const showing = !document.documentElement.hasAttribute("data-folds-pending");
		if (showing) performance.mark("hw-folds-late");
		for (const section of sections) {
			if (typeof folds[section.id] !== "boolean") continue;
			if (showing && personActed && !folds[section.id]) continue;
			section.open = folds[section.id];
		}
		foldsReady("answer");
	});
	/** A person opening or folding every section at once, remembered like
	 * a single toggle and said once (the sections are not focused, so their
	 * own expanded state is not read). Every press is spoken: the text
	 * alternates a trailing no-break space so a repeat still differs. */
	let foldsSaid = 0;
	const setAllFolds = (open) => {
		for (const s of sections) {
			s.open = open;
			folds[s.id] = open;
			touched.add(s.id);
		}
		keepFolds();
		if (foldsSaid++ === 0) announce("folds", "");
		announce("folds", `${open ? "All sections open" : "All sections folded"}${foldsSaid % 2 === 0 ? "\u00a0" : ""}`);
	};
	let toggledByPerson = null;
	document.addEventListener("click", (ev) => {
		const summary = ev.target instanceof Element ? ev.target.closest("details.hw-sec[id] > summary, details.hw-sub[id] > summary") : null;
		if (summary === null) return;
		const section = summary.parentElement;
		if (ev.altKey) {
			ev.preventDefault();
			setAllFolds(!section.open);
			return;
		}
		toggledByPerson = section;
	});

	// Open all and Fold all: one toolbar, one Tab stop, arrow keys between
	// the two (APG toolbar). A button that would change nothing (every shown
	// section already open, or already folded) says so with aria-disabled
	// and stays focusable, so focus never drops to the page after a press.
	const foldBar = document.getElementById("hw-folds");
	const foldButtons = foldBar === null ? [] : Array.from(foldBar.querySelectorAll("button[data-folds]"));
	const syncFoldBar = () => {
		const shown = sections.filter((s) => !s.hidden);
		for (const button of foldButtons) {
			const open = button.dataset.folds === "open";
			button.setAttribute("aria-disabled", String(shown.every((s) => s.open === open)));
		}
	};
	if (foldBar !== null && sections.length < 2) foldBar.hidden = true;
	else if (foldBar !== null) {
		foldBar.addEventListener("click", (ev) => {
			const button = ev.target instanceof Element ? ev.target.closest("button[data-folds]") : null;
			if (button === null || button.getAttribute("aria-disabled") === "true") return;
			setAllFolds(button.dataset.folds === "open");
		});
		foldBar.addEventListener("keydown", (ev) => {
			const at = foldButtons.indexOf(document.activeElement);
			if (at < 0) return;
			const to = { ArrowLeft: at - 1, ArrowRight: at + 1, Home: 0, End: foldButtons.length - 1 }[ev.key];
			if (to === undefined) return;
			ev.preventDefault();
			const next = foldButtons[(to + foldButtons.length) % foldButtons.length];
			for (const button of foldButtons) button.tabIndex = button === next ? 0 : -1;
			next.focus();
		});
		syncFoldBar();
	}
	for (const section of sections) {
		section.addEventListener("toggle", () => {
			syncFoldBar();
			if (toggledByPerson !== section) return;
			toggledByPerson = null;
			folds[section.id] = section.open;
			touched.add(section.id);
			keepFolds();
		});
	}

	// --- a press that lands where the panel just scrolled --------------------
	// When the panel itself moves the page under a resting pointer (a reading
	// list brought into view as it opens, a reveal), whatever slid under the
	// pointer must not take the next press: the second press of a double
	// click would pick or tick a reading the person never aimed at. For half
	// a second after such a scroll, a press within 4 px of where the pointer
	// rested is swallowed; moving the pointer ends the guard at once.
	// Keyboard input is never affected (round 3, re-review VY01, PY01, AY01).
	const pointer = { x: -1, y: -1 };
	let panelScroll = null; // { at, x, y }
	document.addEventListener("pointermove", (ev) => {
		pointer.x = ev.clientX;
		pointer.y = ev.clientY;
		if (panelScroll !== null && Math.hypot(ev.clientX - panelScroll.x, ev.clientY - panelScroll.y) >= 4) panelScroll = null;
	}, true);
	function markPanelScroll() {
		panelScroll = { at: performance.now(), x: pointer.x, y: pointer.y };
	}
	const staleAt = (ev) => {
		if (panelScroll === null) return false;
		if (performance.now() - panelScroll.at > 500) {
			panelScroll = null;
			return false;
		}
		return Math.hypot(ev.clientX - panelScroll.x, ev.clientY - panelScroll.y) < 4;
	};
	const swallow = (ev) => {
		ev.preventDefault();
		ev.stopImmediatePropagation();
	};
	// One verdict per press, taken at its pointerdown: a press that began
	// inside the window stays swallowed through its click, even when the
	// click lands after the half second (re-review audit FA03).
	let pressStale = null;
	document.addEventListener("pointerdown", (ev) => {
		pressStale = staleAt(ev);
		if (pressStale) swallow(ev);
	}, true);
	// A tap moves no pointer before it presses: its position is where the
	// next press is measured from (FA04). Registered after the verdict.
	document.addEventListener("pointerdown", (ev) => {
		pointer.x = ev.clientX;
		pointer.y = ev.clientY;
	}, true);
	// The release is left alone: the opening press's own mouseup selects the
	// search text, and no row acts on a release.
	document.addEventListener("mousedown", (ev) => {
		if (pressStale ?? staleAt(ev)) swallow(ev);
	}, true);
	document.addEventListener("click", (ev) => {
		if (ev.detail === 0) return; // a keyboard activation
		const stale = pressStale ?? staleAt(ev);
		pressStale = null;
		if (stale) swallow(ev);
	}, true);

	// An armed button (remove a group, Merge, Replace shared settings) asks
	// for a second, fresh press. A held Enter or Space repeats its keydown
	// every few tens of ms after about half a second, which would outlast the
	// double-press guard and confirm without the person pressing again: a
	// repeated key never activates an armed button (round 3, re-review PY02,
	// AY01).
	document.addEventListener(
		"keydown",
		(ev) => {
			if (!ev.repeat || (ev.key !== "Enter" && ev.key !== " ")) return;
			if (ev.target instanceof HTMLElement && ev.target.dataset.armed === "true") {
				ev.preventDefault();
				ev.stopImmediatePropagation();
			}
		},
		true
	);

	// --- disclosure: open a section and bring a target into view ----------------
	/** Opens every closed disclosure around `target`, scrolls it into view and
	 * focuses it (or its first focusable). A UI move, never a write. */
	function reveal(target) {
		const el = typeof target === "string" ? document.getElementById(target) : target;
		if (el === null || el === undefined) return;
		// The target itself too: "HWiNFO setup steps" is a disclosure, and
		// landing on it closed would ask for a second click.
		for (let n = el; n !== null; n = n.parentElement) {
			if (n.tagName === "DETAILS" && !n.open) n.open = true;
		}
		// A reading picker opens its list on focus: its field goes just under
		// the pinned header, so the list opens below it on screen instead
		// of under the fold (round 3, R17). Anything else is centered.
		const pickerField = el.closest(".hw-picker")?.closest(".hw-field") ?? null;
		if (pickerField !== null) {
			const root = document.documentElement;
			const head = root.hasAttribute("data-pin") && !root.hasAttribute("data-pin-off") ? document.querySelector(".hw-head[data-pin]") : null;
			const pinned = head === null ? 0 : head.getBoundingClientRect().bottom;
			window.scrollBy({ top: pickerField.getBoundingClientRect().top - pinned - 8, behavior: "instant" });
		} else {
			el.scrollIntoView({ block: "center" });
		}
		markPanelScroll();
		const focusable = el.matches("input,select,textarea,button,summary,[tabindex]") ? el : el.querySelector("summary,input,select,textarea,button,[tabindex]");
		focusable?.focus({ preventScroll: true });
	}
	document.addEventListener("click", (ev) => {
		const link = ev.target instanceof Element ? ev.target.closest("[data-reveal]") : null;
		if (link === null) return;
		ev.preventDefault();
		reveal(link.dataset.reveal);
	});

	// --- summaries, header and status: one coalesced render ----------------------
	const summaries = new Map(); // section -> () => string
	let queued = false;
	function scheduleRender() {
		if (queued) return;
		queued = true;
		requestAnimationFrame(() => {
			queued = false;
			render();
		});
	}
	on("settings", scheduleRender);
	on("globals", scheduleRender);

	const setText = (el, text) => {
		if (el !== null && el.textContent !== text) el.textContent = text;
	};

	function labelOf(key) {
		const tree = state.tree?.groups;
		if (!Array.isArray(tree)) return null;
		for (const group of tree) {
			for (const reading of group.readings) {
				// Alias-aware: a saved key the tree lists under a linked key
				// (reading.keys, 1.7 linked readings) names the live reading.
				if (reading.key === key || (Array.isArray(reading.keys) && reading.keys.includes(key))) return { label: reading.label, source: group.name };
			}
		}
		return null;
	}

	/** What the face draws while the source is stale (src/ui/state-screens.ts):
	 * Gadget cannot measure freshness, so it never claims the data stopped. */
	const staleFace = (p) => (p.source === "gadget" ? "Age unknown" : kind === "dial" ? "No new data" : "Not updating");

	/** A stale Shared Memory age in words, from the plugin's evidence clock
	 * (whole seconds). Coarser as it grows, so a long outage repaints the
	 * header once a minute instead of every second. */
	function ageText(ms) {
		const s = Math.floor(ms / 1000);
		if (s < 60) return `${s} s`;
		const m = Math.floor(s / 60);
		return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
	}

	/** The data state in one word and a tone; never "Live" unless it is. */
	function dataState() {
		const p = state.preview;
		const s = state.settings;
		const configured = typeof s.readingKey === "string" && s.readingKey !== "";
		if (p === null) {
			const waited = state.connectedAt > 0 && performance.now() - state.connectedAt > 3000;
			return waited && !state.heardFromPlugin ? { text: "The plugin is not responding", tone: "danger" } : { text: "Connecting to the plugin", tone: "muted" };
		}
		if (p.state === "unavailable") return { text: "No HWiNFO data", tone: "danger" };
		// The heading already says no reading is picked; the state line says
		// whether there is HWiNFO data to pick from.
		if (!configured) {
			if (p.holding === true) return { text: "Reopening HWiNFO's source", tone: "warn" };
			if (p.state === "stale") return { text: p.source === "gadget" ? "HWiNFO data age unknown" : "HWiNFO data not updating", tone: "warn" };
			return { text: `HWiNFO ready · ${p.source === "gadget" ? "Gadget registry" : "Shared Memory"}`, tone: "muted" };
		}
		if (p.missing === true) return { text: "Saved reading not found", tone: "warn" };
		// The poller is riding out a source reopen on the last values: the
		// state still reads as before, but nothing new is being read.
		if (p.holding === true) return { text: `Reopening source · ${kind === "dial" ? "dial" : "key"} unchanged`, tone: "warn" };
		if (p.state === "stale") return { text: typeof p.staleForMs === "number" ? `${staleFace(p)} for ${ageText(p.staleForMs)}` : staleFace(p), tone: "warn" };
		return { text: p.source === "gadget" ? "Live · Gadget registry" : "Live · Shared Memory", tone: "ok" };
	}

	/** A data source forced to one provider, in the Connection select's words. */
	function forcedSource() {
		const src = state.globals.source;
		return src === "gadget" ? "Gadget registry only" : src === "shared-memory" ? "Shared Memory only" : null;
	}

	/** The words a face SVG draws, in document order. Parsed as inert XML
	 * data (a parsed document runs no script and is never inserted). */
	let faceText = "";
	function drawnText(svg) {
		try {
			const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
			if (doc.getElementsByTagName("parsererror").length > 0) return "";
			const words = Array.from(doc.getElementsByTagName("text"), (t) => t.textContent.replace(/\s+/g, " ").trim()).filter((w) => w !== "");
			return words.join(" ").slice(0, 200);
		} catch {
			return "";
		}
	}

	// One persistent polite region for notes that are rebuilt with their
	// lists (rotation and detail counts): a live region created together
	// with its text is often not read, and a rebuilt one is read again for
	// nothing. A channel speaks only when its text changes after the first.
	const announcer = document.createElement("div");
	announcer.className = "hw-sr-only";
	announcer.setAttribute("role", "status");
	announcer.setAttribute("aria-live", "polite");
	document.body.appendChild(announcer);
	const lastSaid = new Map();
	/** `repeat`: say it even when it equals the channel's last words (a
	 * second identical move is a new event); the region text alternates a
	 * trailing no-break space so the change is still a change. `quiet`:
	 * only record the words (a redraw nobody asked for), so the next change
	 * a person makes is measured against what is on screen, and said. */
	function announce(channel, text, { repeat = false, quiet = false } = {}) {
		const had = lastSaid.has(channel);
		const before = lastSaid.get(channel);
		lastSaid.set(channel, text);
		if (!had || quiet) return;
		if (before !== text) announcer.textContent = text;
		else if (repeat) announcer.textContent = announcer.textContent === text ? `${text}\u00a0` : text;
	}
	announce("validate", ""); // primed: a field's first typo is said
	announce("check", ""); // primed: a Check again that fixes the problem is said

	// The pinned header's real height, for scroll padding and the sticky
	// dock; a header taller than a third of the panel is not pinned.
	const pinnedHead = document.querySelector(".hw-head[data-pin]");
	if (pinnedHead !== null && typeof ResizeObserver === "function") {
		const measure = () => {
			const h = Math.ceil(pinnedHead.getBoundingClientRect().height);
			document.documentElement.style.setProperty("--hw-head-h", `${h}px`);
			document.documentElement.toggleAttribute("data-pin-off", h > window.innerHeight / 3);
		};
		new ResizeObserver(measure).observe(pinnedHead);
		window.addEventListener("resize", measure);
		measure();
	}

	function renderHeader() {
		const head = document.getElementById("hw-head");
		if (head === null || (kind !== "key" && kind !== "dial")) return;
		const s = state.settings;
		const p = state.preview;
		const configured = typeof s.readingKey === "string" && s.readingKey !== "";
		const found = configured ? labelOf(s.readingKey) : null;
		const reading = p?.reading ?? (found === null ? null : { label: found.label, source: found.source });
		// The dial's title precedence: its own label, then the name the
		// rotation gives this reading, then HWiNFO's label. The header leads
		// with what the dial shows and keeps HWiNFO's name on the source line
		// (round 3, R43).
		const label = typeof s.label === "string" && s.label.trim() !== "" ? s.label.trim() : null;
		const named = kind === "dial" && configured && isDoc(s.rotationNames) && typeof s.rotationNames[s.readingKey] === "string" && s.rotationNames[s.readingKey].trim() !== "" ? s.rotationNames[s.readingKey].trim() : null;
		const custom = label ?? named;
		setText(document.getElementById("head-reading"), !configured ? "No reading selected" : reading !== null ? (custom ?? reading.label) : (custom ?? "Saved reading"));
		setText(
			document.getElementById("head-source"),
			reading !== null ? `${custom !== null ? `${reading.label} · ` : ""}${reading.source}` : configured && custom !== null ? "Saved reading" : ""
		);
		const ds = dataState();
		const stateEl = document.getElementById("head-state");
		if (stateEl !== null) {
			setText(stateEl, ds.text);
			stateEl.dataset.tone = ds.tone;
		}
		const img = document.getElementById("face-img");
		const figure = document.getElementById("face");
		if (img !== null && figure !== null) {
			if (state.face !== "" && img.dataset.face !== state.face) {
				img.dataset.face = state.face;
				img.src = `data:image/svg+xml,${encodeURIComponent(state.face)}`;
				faceText = drawnText(state.face);
			}
			figure.hidden = state.face === "";
			// The alt text reads what the face itself draws (a status screen
			// included), so it can never describe a value the key is not showing.
			const alt = `${kind === "dial" ? "Dial" : "Key"} face now: ${faceText !== "" ? faceText : (custom ?? reading?.label ?? ds.text)}`;
			if (img.alt !== alt) img.alt = alt;
		}
	}

	/** The Reading section's status block: a reason and the local repair. */
	function renderStatus() {
		const box = document.getElementById("reading-status");
		if (box === null) return;
		const p = state.preview;
		const s = state.settings;
		const configured = typeof s.readingKey === "string" && s.readingKey !== "";
		const tree = state.tree;
		let tone = "";
		let lines = [];
		let actions = [];
		if (p === null && state.connectedAt > 0 && performance.now() - state.connectedAt > 3000 && !state.heardFromPlugin) {
			tone = "danger";
			lines = ["The HWiNFO Sensors plugin is not answering this panel. Settings you change here are still saved; restarting the Stream Deck app restarts the plugin."];
		} else if (p !== null && p.state === "unavailable") {
			tone = "danger";
			lines = [p.hint || "HWiNFO data is unavailable."];
			// A source forced to one provider never tries the other, which
			// the generic hint cannot know: say so and point at the setting.
			const forced = forcedSource();
			if (forced !== null) {
				lines.push(
					state.globals.source === "gadget"
						? "Data source is set to Gadget registry only, so Shared Memory is never read, even when enabled. Auto tries Shared Memory first, then Gadget."
						: "Data source is set to Shared Memory only, so the Gadget registry is never read. Auto falls back to Gadget."
				);
			}
			lines.push(configured ? "Your reading and every setting stay saved. Display settings can still be changed; they apply when data returns." : "Readings appear under Reading once HWiNFO publishes data.");
			actions = [["retry", "Check again"], ["setup", "HWiNFO setup steps"]];
			if (forced !== null) actions.push(["source", "Data source setting"]);
		} else if (p !== null && configured && p.missing !== true && p.holding === true) {
			tone = "warn";
			lines = [`The plugin is reopening HWiNFO's data source (a sensor layout change, an HWiNFO restart or a busy source). The ${kind === "dial" ? "dial" : "key"} stays as it was for up to 15 s after the last new data, then shows live values or the problem. Your reading and settings are unchanged.`];
		} else if (p !== null && ((configured && p.missing === true) || p.state === "stale")) {
			// A missing reading and a stale source are separate facts, and a
			// stale snapshot can carry both: each gets its own lines.
			tone = "warn";
			const missing = configured && p.missing === true;
			if (missing) {
				lines.push(
					`The saved reading is not in HWiNFO's current sensor list${tree !== null && Array.isArray(tree.groups) && tree.groups.length === 0 ? " (HWiNFO publishes no readings right now)" : ""}. It stays saved with its label and colors, and shows again if HWiNFO publishes it (for example after a sensor wakes or HWiNFO restarts).`
				);
				actions.push(["retry", "Reload sensor list"], ["pick", "Pick another reading"]);
			}
			if (p.state === "stale") {
				// The words follow the plugin's evidence-based status. Gadget's
				// hint is fixed text (its freshness cannot be measured), so it is
				// shown as sent; the Shared Memory hint counts seconds, and a
				// live region that changed every tick would be read out every
				// tick, so that line stays fixed here.
				lines.push(
					p.source === "gadget"
						? p.hint || "Gadget freshness is unknown. Check HWiNFO and Gadget reporting, or use Shared Memory Support."
						: "No new Shared Memory measurements are arriving. Check HWiNFO and Shared Memory Support; a busy connection can also prevent reads."
				);
				if (!missing) lines.push(`The ${kind === "dial" ? "dial" : "key"} shows "${staleFace(p)}" until new data arrives. Your reading and settings are unchanged.`);
				if (!missing) actions.push(["retry", "Check again"]);
			}
		} else if (tree !== null && tree.state === "ok" && Array.isArray(tree.groups) && tree.groups.length === 0) {
			tone = "warn";
			lines = ["HWiNFO is running but publishes no readings."];
			actions = [["setup", "HWiNFO setup steps"]];
		} else if (p !== null && p.state === "ok" && p.source === "gadget" && p.hint) {
			// One line on every healthy Gadget panel; the plugin's whole
			// account sits under Advanced > Connection (#source-now). A
			// withheld-reading note asks the person to act, so when the
			// plugin sends one the whole hint stays here (round 3, R11).
			tone = "info";
			lines = [/withheld/.test(p.hint) ? p.hint : "Gadget registry: current values only, no min, max or average."];
		}
		renderSourceNow(p);
		const signature = JSON.stringify([tone, lines, actions]);
		if (box.dataset.signature === signature) {
			answerCheck(box, tone);
			return;
		}
		box.dataset.signature = signature;
		box.dataset.tone = tone;
		// The region (role=status, polite) stays in the page; it changes only
		// when the kind of problem changes, never per tick. A focused action
		// button keeps focus across the rebuild when the same action remains.
		const focusedAction = box.contains(document.activeElement) ? document.activeElement.dataset.statusAction : undefined;
		const frag = document.createDocumentFragment();
		for (const line of lines) {
			const para = document.createElement("p");
			para.textContent = line;
			frag.appendChild(para);
		}
		if (actions.length > 0) {
			const row = document.createElement("div");
			row.className = "hw-actions";
			for (const [action, label] of actions) {
				const button = document.createElement("button");
				button.type = "button";
				button.className = "hw-btn";
				button.dataset.statusAction = action;
				button.textContent = label;
				row.appendChild(button);
			}
			frag.appendChild(row);
		}
		if (actions.some(([action]) => action === "retry")) {
			const ack = document.createElement("p");
			ack.className = "hw-status-ack";
			frag.appendChild(ack);
		}
		const hadFocus = box.contains(document.activeElement);
		box.replaceChildren(frag);
		if (focusedAction !== undefined) box.querySelector(`[data-status-action="${focusedAction}"]`)?.focus({ preventScroll: true });
		// The press that fixed the problem is answered too: the region
		// empties, so the panel says so once and keeps focus on a control
		// that stays (round 3, re-review AY06).
		if (tone === "" && (checkAskedAt !== 0 || hadFocus)) {
			checkAskedAt = 0;
			const picked = typeof state.settings?.readingKey === "string" && state.settings.readingKey !== "";
			announce("check", picked ? "HWiNFO answered: the reading is live again." : "HWiNFO is answering again.", { repeat: true });
			if (hadFocus && !box.contains(document.activeElement)) document.querySelector("#sec-reading > summary, details.hw-sec > summary")?.focus({ preventScroll: true });
		}
		answerCheck(box, tone);
	}

	// Check again and Reload sensor list ask the plugin for a fresh answer.
	// When the answer is the same problem, one line in the status region
	// says it came back and when, so a press is never met with silence;
	// only that line's text changes, so only it is read out (round 3, R20).
	let checkAskedAt = 0;
	let checkAskedFor = ""; // the status the person saw when they pressed
	function answerCheck(box, tone) {
		if (checkAskedAt === 0 || state.treeAt < checkAskedAt) return;
		checkAskedAt = 0;
		const ack = box.querySelector(".hw-status-ack");
		// A different answer speaks for itself (the block was rebuilt).
		if (ack === null || tone === "" || box.dataset.signature !== checkAskedFor) return;
		const ms = hwModel.pollIntervalOf(state.globals.pollIntervalMs);
		const every = ms >= 1000 ? `${ms / 1000} s` : `${ms} ms`;
		const at = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
		ack.textContent = `Checked again at ${at}: no change yet. The plugin also reads HWiNFO every ${every} on its own.`;
	}

	// Advanced > Connection carries the plugin's whole account of a
	// healthy Gadget source, the status line's "More".
	function renderSourceNow(p) {
		const el = document.getElementById("source-now");
		if (el === null) return;
		const text = p !== null && p.state === "ok" && p.source === "gadget" && p.hint ? p.hint : "";
		if (el.textContent !== text) el.textContent = text;
		el.hidden = text === "";
	}
	document.addEventListener("click", (ev) => {
		const button = ev.target instanceof Element ? ev.target.closest("[data-status-action]") : null;
		if (button === null) return;
		if (button.dataset.statusAction === "retry") {
			checkAskedAt = performance.now();
			checkAskedFor = document.getElementById("reading-status")?.dataset.signature ?? "";
			// The previous answer stays until the new one replaces it in
			// place, so the block does not bounce on every press.
			emit("retry");
			client.send("sendToPlugin", { event: "getSensorTree" });
			client.send("sendToPlugin", { event: "getPreview" });
		} else if (button.dataset.statusAction === "setup") {
			reveal("setup-help");
		} else if (button.dataset.statusAction === "source") {
			reveal("shared-source");
		} else if (button.dataset.statusAction === "pick") {
			reveal("picker-search");
		}
	});

	function renderSummaries() {
		for (const [section, fn] of summaries) {
			let text = "";
			try {
				text = fn(state);
			} catch (err) {
				console.error(`hw panel: ${section} summary failed`, err);
			}
			setText(document.querySelector(`[data-summary="${section}"]`), text);
		}
	}

	function render() {
		renderHeader();
		renderStatus();
		renderSummaries();
		emit("render", state);
	}

	return {
		state,
		kind,
		on,
		emit,
		reveal,
		markPanelScroll,
		labelOf: (key) => labelOf(key)?.label ?? null,
		summary: (section, fn) => {
			summaries.set(section, fn);
			scheduleRender();
		},
		scheduleRender,
		resyncBound,
		// Text the panel commits itself (rotation and group names, detail
		// cell labels) joins the same leave flush as the bound fields.
		addLeaveFlush: (flush) => pendingFlushes.add(flush),
		dropLeaveFlush: (flush) => pendingFlushes.delete(flush),
		announce,
		model: hwModel
	};
})();
