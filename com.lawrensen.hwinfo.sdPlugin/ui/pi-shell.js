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
		state.connectedAt = Date.now();
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
	function validateNumber(el) {
		const raw = el.value.trim();
		const ok = raw === "" || Number.isFinite(Number(raw.replace(",", ".")));
		const err = document.getElementById(`${el.id}-error`);
		el.setAttribute("aria-invalid", ok ? "false" : "true");
		if (err !== null) {
			err.hidden = ok;
			err.textContent = ok ? "" : `Not a number. ${el.dataset.ignoredBy ?? "Alerts"} ignore${el.dataset.ignoredBy === undefined ? "" : "s"} this field until it is one.`;
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
				if (el.dataset.validate === "number") validateNumber(el);
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

	/** Re-reads every bound control from the store (after a wholesale apply). */
	function resyncBound() {
		for (const { el, get } of bound) get().then((value) => showValue(el, value));
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
	// to any key, and the plugin keeps none of it: it lives in this webview's
	// storage, which the app empties when the plugin restarts (bench
	// 2026-09-23). A fresh start shows the defaults, and one press on Open
	// all gets back whatever a person had open. Storage that throws or is
	// missing leaves the defaults.
	const sections = Array.from(document.querySelectorAll("details.hw-sec[id]"));
	const foldsKey = `hw.folds.${kind}`;
	let folds = {};
	try {
		const stored = JSON.parse(localStorage.getItem(foldsKey) ?? "{}");
		if (isDoc(stored)) folds = stored;
	} catch {
		folds = {};
	}
	for (const section of sections) {
		if (typeof folds[section.id] === "boolean") section.open = folds[section.id];
	}
	const keepFolds = () => {
		try {
			localStorage.setItem(foldsKey, JSON.stringify(folds));
		} catch {
			/* no storage: the next panel starts from the defaults */
		}
	};
	/** A person opening or folding every section at once, remembered like
	 * a single toggle and said once (the sections are not focused, so their
	 * own expanded state is not read). Every press is spoken: the text
	 * alternates a trailing no-break space so a repeat still differs. */
	let foldsSaid = 0;
	const setAllFolds = (open) => {
		for (const s of sections) {
			s.open = open;
			folds[s.id] = open;
		}
		keepFolds();
		if (foldsSaid++ === 0) announce("folds", "");
		announce("folds", `${open ? "All sections open" : "All sections folded"}${foldsSaid % 2 === 0 ? "\u00a0" : ""}`);
	};
	let toggledByPerson = null;
	document.addEventListener("click", (ev) => {
		const summary = ev.target instanceof Element ? ev.target.closest("details.hw-sec[id] > summary") : null;
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
			keepFolds();
		});
	}

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
		el.scrollIntoView({ block: "center" });
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
				if (reading.key === key) return { label: reading.label, source: group.name };
			}
		}
		return null;
	}

	/** The data state in one word and a tone; never "Live" unless it is. */
	function dataState() {
		const p = state.preview;
		const s = state.settings;
		const configured = typeof s.readingKey === "string" && s.readingKey !== "";
		if (p === null) {
			const waited = state.connectedAt > 0 && Date.now() - state.connectedAt > 3000;
			return waited && !state.heardFromPlugin ? { text: "The plugin is not responding", tone: "danger" } : { text: "Connecting to the plugin", tone: "muted" };
		}
		if (p.state === "unavailable") return { text: "No HWiNFO data", tone: "danger" };
		if (!configured) return { text: "No reading selected", tone: "muted" };
		if (p.missing === true) return { text: "Saved reading not found", tone: "warn" };
		if (p.state === "stale") return { text: "Not updating", tone: "warn" };
		return { text: p.source === "gadget" ? "Live · Gadget registry" : "Live · Shared Memory", tone: "ok" };
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
	function announce(channel, text) {
		const had = lastSaid.has(channel);
		const before = lastSaid.get(channel);
		lastSaid.set(channel, text);
		if (had && before !== text) announcer.textContent = text;
	}

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
		const custom = typeof s.label === "string" && s.label.trim() !== "" ? s.label.trim() : null;
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
		if (p === null && state.connectedAt > 0 && Date.now() - state.connectedAt > 3000 && !state.heardFromPlugin) {
			tone = "danger";
			lines = ["The HWiNFO Sensors plugin is not answering this panel. Settings you change here are still saved; restarting the Stream Deck app restarts the plugin."];
		} else if (p !== null && p.state === "unavailable") {
			tone = "danger";
			lines = [p.hint || "HWiNFO data is unavailable.", configured ? "Your reading and every setting stay saved. Display settings can still be changed; they apply when data returns." : "Readings appear here once HWiNFO publishes data."];
			actions = [["retry", "Retry now"], ["setup", "HWiNFO setup steps"]];
		} else if (p !== null && configured && p.missing === true) {
			tone = "warn";
			lines = [
				`The saved reading is not in HWiNFO's current sensor list${tree !== null && Array.isArray(tree.groups) && tree.groups.length === 0 ? " (HWiNFO publishes no readings right now)" : ""}. It stays saved with its label and colors, and shows again if HWiNFO publishes it (for example after a sensor wakes or HWiNFO restarts).`,
				"To use a different reading instead, pick one above."
			];
			actions = [["retry", "Reload sensor list"]];
		} else if (p !== null && p.state === "stale") {
			// Static text: the plugin's hint counts seconds, and a live region
			// that changed every tick would be read out every tick.
			tone = "warn";
			lines = [
				p.source === "gadget" ? "HWiNFO's Gadget registry stopped changing. Check that HWiNFO is still running with Gadget reporting enabled." : "HWiNFO stopped updating. Check that the Sensors window is open and Shared Memory Support is still enabled.",
				`The ${kind === "dial" ? 'dial shows "HWiNFO stalled"' : 'key shows "Not updating"'} until HWiNFO resumes. Your reading and settings are unchanged.`
			];
			actions = [["retry", "Retry now"]];
		} else if (tree !== null && tree.state === "ok" && Array.isArray(tree.groups) && tree.groups.length === 0) {
			tone = "warn";
			lines = ["HWiNFO is running but publishes no readings."];
			actions = [["setup", "HWiNFO setup steps"]];
		} else if (p !== null && p.state === "ok" && p.source === "gadget" && p.hint) {
			tone = "info";
			lines = [p.hint];
		}
		const signature = JSON.stringify([tone, lines, actions]);
		if (box.dataset.signature === signature) return;
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
		box.replaceChildren(frag);
		if (focusedAction !== undefined) box.querySelector(`[data-status-action="${focusedAction}"]`)?.focus({ preventScroll: true });
	}
	document.addEventListener("click", (ev) => {
		const button = ev.target instanceof Element ? ev.target.closest("[data-status-action]") : null;
		if (button === null) return;
		if (button.dataset.statusAction === "retry") {
			emit("retry");
			client.send("sendToPlugin", { event: "getSensorTree" });
			client.send("sendToPlugin", { event: "getPreview" });
		} else if (button.dataset.statusAction === "setup") {
			reveal("setup-help");
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
		labelOf: (key) => labelOf(key)?.label ?? null,
		summary: (section, fn) => {
			summaries.set(section, fn);
			scheduleRender();
		},
		scheduleRender,
		resyncBound,
		announce,
		model: hwModel
	};
})();
