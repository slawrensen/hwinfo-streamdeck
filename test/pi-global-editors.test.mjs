/**
 * Advanced > Reading links and Advanced > Calculated readings, the shipped
 * panel bytes (ui/pi-model.js, ui/pi-shell.js, ui/pi-links.js,
 * ui/pi-calc.js) in a node vm over a small fake DOM, a fake sdpi store and
 * socket, and a hand-moved clock.
 *
 * What it proves:
 * - opening, refreshing, searching, choosing, previewing and cancelling
 *   send only read requests: no settings write, no shared settings write,
 *   no apply;
 * - one explicit Link, Unlink, Save or Delete press sends exactly one
 *   apply message carrying the basis signature the panel was shown;
 * - the shell holds the panel's own whole-document shared saves while an
 *   apply is in flight, then splices the plugin's committed field into any
 *   document that still carries the old value, so a stale store never
 *   puts an old list back.
 *
 * The fake DOM is not a browser: layout, focus timing and native widgets
 * stay with the e2e panel suites.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import vm from "node:vm";

const UI = new URL("../com.lawrensen.hwinfo.sdPlugin/ui/", import.meta.url);
const read = (name) => ({ name, source: readFileSync(new URL(name, UI), "utf8") });
const SCRIPTS = ["pi-model.js", "pi-shell.js", "pi-links.js", "pi-calc.js"].map(read);
const plain = (v) => JSON.parse(JSON.stringify(v));

// ------------------------------------------------------------- fake DOM
class FakeElement {
	constructor(tag, doc) {
		this.tagName = tag.toUpperCase();
		this.doc = doc;
		this.id = "";
		this.className = "";
		this.hidden = false;
		this._text = "";
		this.value = "";
		this.placeholder = "";
		this.type = "";
		this.disabled = false;
		this.checked = false;
		this.open = false;
		this.label = "";
		this.htmlFor = "";
		this.dataset = {};
		this.style = { setProperty() {} };
		this.attrs = {};
		this.children = [];
		this.parentElement = null;
		this.listeners = {};
	}
	get textContent() {
		return this.children.length === 0 ? this._text : this._text + this.children.map((c) => c.textContent).join("");
	}
	set textContent(v) {
		this.children = [];
		this._text = String(v);
	}
	get classList() {
		const set = () => new Set(this.className.split(/\s+/).filter(Boolean));
		const list = {
			contains: (n) => set().has(n),
			add: (...n) => (this.className = [...new Set([...set(), ...n])].join(" ")),
			remove: (...n) => (this.className = [...set()].filter((c) => !n.includes(c)).join(" ")),
			toggle: (n, force) => {
				const on = force ?? !set().has(n);
				if (on) list.add(n);
				else list.remove(n);
				return on;
			}
		};
		return list;
	}
	addEventListener(type, fn) {
		(this.listeners[type] ??= []).push(fn);
	}
	removeEventListener() {}
	fire(type, extra = {}) {
		for (const fn of [...(this.listeners[type] ?? [])]) fn({ type, target: this, detail: 1, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}, ...extra });
	}
	appendChild(child) {
		if (child.tagName === "#FRAGMENT") {
			for (const c of [...child.children]) this.appendChild(c);
			child.children = [];
			return child;
		}
		if (child.parentElement !== null) child.parentElement.children = child.parentElement.children.filter((c) => c !== child);
		child.parentElement = this;
		this.children.push(child);
		return child;
	}
	append(...nodes) {
		for (const n of nodes) this.appendChild(n);
	}
	replaceChildren(...nodes) {
		for (const c of this.children) c.parentElement = null;
		this.children = [];
		this._text = "";
		this.append(...nodes);
	}
	remove() {
		if (this.parentElement !== null) this.parentElement.children = this.parentElement.children.filter((c) => c !== this);
		this.parentElement = null;
	}
	contains(node) {
		for (let n = node; n !== null && n !== undefined; n = n.parentElement) if (n === this) return true;
		return false;
	}
	closest(selector) {
		if (this.matches(selector)) return this;
		return this.parentElement === null ? null : this.parentElement.closest(selector);
	}
	querySelector(selector) {
		return this.querySelectorAll(selector)[0] ?? null;
	}
	querySelectorAll(selector) {
		const out = [];
		const walk = (n) => {
			for (const c of n.children) {
				if (c.matches(selector)) out.push(c);
				walk(c);
			}
		};
		walk(this);
		return out;
	}
	matches(selectorList) {
		return selectorList.split(",").some((sel) => {
			const s = sel.trim();
			const tag = /^[a-z][a-z0-9-]*/i.exec(s)?.[0];
			if (tag !== undefined && tag.toUpperCase() !== this.tagName) return false;
			for (const [, cls] of s.matchAll(/\.([A-Za-z0-9_-]+)/g)) if (!this.classList.contains(cls)) return false;
			for (const [, id] of s.matchAll(/#([A-Za-z0-9_-]+)/g)) if (this.id !== id) return false;
			for (const [, name, , val] of s.matchAll(/\[([a-z-]+)(="?([^\]"]*)"?)?\]/g)) {
				const actual = name.startsWith("data-") ? this.dataset[name.slice(5).replace(/-([a-z])/g, (_m, c) => c.toUpperCase())] : (this.attrs[name] ?? (name === "id" ? this.id || undefined : undefined));
				if (val === undefined ? actual === undefined : String(actual) !== val) return false;
			}
			return true;
		});
	}
	setAttribute(k, v) {
		this.attrs[k] = String(v);
	}
	getAttribute(k) {
		return this.attrs[k] ?? null;
	}
	hasAttribute(k) {
		return k in this.attrs;
	}
	removeAttribute(k) {
		delete this.attrs[k];
	}
	toggleAttribute(k, force) {
		const on = force ?? !(k in this.attrs);
		if (on) this.attrs[k] = "";
		else delete this.attrs[k];
		return on;
	}
	focus() {
		this.doc.activeElement = this;
	}
	blur() {
		if (this.doc.activeElement === this) this.doc.activeElement = this.doc.body;
		this.fire("blur");
	}
	scrollIntoView() {}
	getBoundingClientRect() {
		return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
	}
	/** A person's press: the click handlers run (detail 1 = a pointer click). */
	click(extra = {}) {
		this.fire("click", extra);
	}
}

class FakeDocument {
	constructor() {
		this.documentElement = new FakeElement("html", this);
		this.body = new FakeElement("body", this);
		this.documentElement.appendChild(this.body);
		this.activeElement = this.body;
		this.visibilityState = "visible";
		this.byId = new Map();
		this.listeners = {};
	}
	getElementById(id) {
		return this.byId.get(id) ?? null;
	}
	createElement(tag) {
		return new FakeElement(tag, this);
	}
	createDocumentFragment() {
		return new FakeElement("#fragment", this);
	}
	querySelector(s) {
		return this.body.querySelector(s);
	}
	querySelectorAll(s) {
		return this.body.querySelectorAll(s);
	}
	addEventListener(type, fn) {
		(this.listeners[type] ??= []).push(fn);
	}
	removeEventListener() {}
	make(id, tag = "div", parent = this.body, className = "") {
		const el = new FakeElement(tag, this);
		el.id = id;
		el.className = className;
		this.byId.set(id, el);
		parent.appendChild(el);
		return el;
	}
}

// ------------------------------------------------------------- the panel
const SM_CPU = "f0001234:0:1000001";
const G_CPU = "g:CPU Test:CPU Package";
const G_GPU = "g:GPU Test:GPU Temperature";
const CALC = "calc:AAAAAAAAAAAAAAAAAAAAAA";

/** Mounts the shell and both editors over one fake panel. */
function mount({ settings = { readingKey: SM_CPU }, globals = { theme: "void" } } = {}) {
	const clock = { now: 1000 };
	let timerSeq = 0;
	const timers = new Map();
	const schedule = (fn, ms, repeat) => {
		const id = ++timerSeq;
		timers.set(id, { at: clock.now + Math.max(0, Number(ms) || 0), fn, repeat: repeat ? Math.max(1, Number(ms) || 1) : 0 });
		return id;
	};
	const doc = new FakeDocument();
	doc.body.dataset.kind = "key";
	for (const id of ["hw-head", "head-reading", "head-source", "head-state", "reading-status", "face"]) doc.make(id);
	const links = doc.make("sec-links", "details", doc.body, "hw-sub");
	const focusRow = doc.make("links-focus-row", "div", links);
	doc.make("links-focus", "select", focusRow);
	for (const [id, tag] of [["links-card", "div"], ["links-scan", "button"], ["links-filter", "input"], ["links-candidate", "select"], ["links-chosen", "div"], ["links-scope", "p"], ["links-link", "button"], ["links-note", "div"], ["links-list", "ul"], ["links-prereq", "ul"]]) doc.make(id, tag, links);
	const calc = doc.make("sec-calc", "details", doc.body, "hw-sub");
	for (const [id, tag] of [["calc-list", "ul"], ["calc-new", "button"]]) doc.make(id, tag, calc);
	const form = doc.make("calc-form", "div", calc);
	form.hidden = true;
	for (const [id, tag] of [["calc-op", "select"], ["calc-inputs", "div"], ["calc-add-input", "button"], ["calc-percent-row", "label"], ["calc-percent", "input"], ["calc-label", "input"], ["calc-preview-value", "p"], ["calc-preview-expression", "p"], ["calc-preview-message", "p"], ["calc-save", "button"], ["calc-cancel", "button"]]) doc.make(id, tag, form);
	doc.make("calc-note", "div", calc);
	doc.getElementById("calc-op").value = "sum";
	// Each section's one-line summary (data-summary in the panel HTML).
	for (const name of ["links", "calc"]) doc.make(`sum-${name}`, "span").dataset.summary = name;

	const store = structuredClone(settings);
	const globalStore = structuredClone(globals);
	const settingsWrites = [];
	const globalWrites = [];
	const sent = [];
	const piSubscribers = [];
	const globalSubscribers = [];
	const settingsSubscribers = [];
	const useStore = (target, save) => (name) => [() => Promise.resolve(target[name]), (v) => {
		target[name] = v;
		save({ ...target });
	}];
	const SDPIComponents = {
		useSettings: useStore(store, (d) => SDPIComponents.streamDeckClient.setSettings(d)),
		useGlobalSettings: useStore(globalStore, (d) => SDPIComponents.streamDeckClient.setGlobalSettings(d)),
		streamDeckClient: {
			send: (event, payload) => sent.push(plain({ event, payload })),
			sendToPropertyInspector: { subscribe: (cb) => piSubscribers.push(cb) },
			didReceiveSettings: { subscribe: (cb) => settingsSubscribers.push(cb) },
			didReceiveGlobalSettings: { subscribe: (cb) => globalSubscribers.push(cb) },
			getConnectionInfo: async () => ({ actionInfo: { context: "ctx" } }),
			getGlobalSettings: async () => globalStore,
			setSettings: (d) => settingsWrites.push(plain(d)),
			setGlobalSettings: (d) => globalWrites.push(plain(d))
		}
	};
	const sandbox = {
		document: doc,
		console: { log() {}, warn() {}, error: (...a) => { throw new Error(`panel logged an error: ${a.join(" ")}`); } },
		SDPIComponents,
		setTimeout: (fn, ms) => schedule(fn, ms, false),
		clearTimeout: (id) => timers.delete(id),
		setInterval: (fn, ms) => schedule(fn, ms, true),
		clearInterval: (id) => timers.delete(id),
		requestAnimationFrame: (fn) => schedule(fn, 16, false),
		cancelAnimationFrame: (id) => timers.delete(id),
		queueMicrotask,
		performance: { now: () => clock.now, mark() {}, measure() {}, getEntriesByName: () => [] },
		HTMLElement: FakeElement,
		Element: FakeElement,
		Node: FakeElement,
		innerHeight: 410,
		addEventListener() {},
		removeEventListener() {},
		scrollBy() {},
		location: { reload() {} }
	};
	sandbox.window = sandbox;
	sandbox.self = sandbox;
	const context = vm.createContext(sandbox);
	for (const { name, source } of SCRIPTS) vm.runInContext(source, context, { filename: name });
	const el = (id) => doc.getElementById(id);
	const settle = async () => {
		for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
	};
	const advance = async (ms) => {
		const end = clock.now + ms;
		await settle();
		for (;;) {
			const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
			if (due === undefined) break;
			const [id, t] = due;
			clock.now = Math.max(clock.now, t.at);
			if (t.repeat > 0) t.at += t.repeat;
			else timers.delete(id);
			t.fn();
			await settle();
		}
		clock.now = end;
		await settle();
	};
	const feed = (payload) => {
		for (const cb of piSubscribers) cb({ payload: plain(payload) });
	};
	const deliverGlobals = (doc) => {
		const d = structuredClone(doc);
		Object.keys(globalStore).forEach((k) => delete globalStore[k]);
		Object.assign(globalStore, structuredClone(d));
		for (const cb of globalSubscribers) cb({ payload: { settings: structuredClone(d) } });
	};
	const openSection = (id) => {
		el(id).open = true;
		el(id).fire("toggle");
	};
	const reads = () => sent.filter((m) => m.event === "sendToPlugin").map((m) => m.payload);
	/** The panel's shared store saving one field, as a bound control does. */
	const saveGlobal = (name, value) => SDPIComponents.useGlobalSettings(name)[1](value);
	return { sandbox, doc, el, sent, reads, settingsWrites, globalWrites, store, globalStore, feed, advance, settle, openSection, deliverGlobals, saveGlobal, clock, shell: () => sandbox.hwShell, deliverInitial: () => { for (const cb of settingsSubscribers) cb({ payload: { settings: structuredClone(store) } }); deliverGlobals(globalStore); } };
}

const modelScope = {};
new Function("self", read("pi-model.js").source)(modelScope);
const model = modelScope.hwModel;

// ------------------------------------------------------------- workspaces
const LINK_ROW = { index: 0, sharedMemory: SM_CPU, gadget: G_CPU, unit: "°C", health: "active-shared-memory", healthText: "In use: Shared Memory is publishing it.", readiness: "ready", readinessText: "Gadget registry reading seen in this session in the same unit.", removable: true, sm: { key: SM_CPU, provider: "shared-memory", sensor: "CPU Test", label: "CPU Package", unit: "°C", type: 1, display: "61.0 °C", availability: "live", availabilityText: "Live on Shared Memory" }, gd: null };
function linksWorkspace(over = {}) {
	return {
		signature: "sig-links-1",
		mode: "auto",
		active: "shared-memory",
		state: "ok",
		max: 128,
		rows: [],
		counts: { stored: 0, active: 0, waiting: 0, ignored: 0 },
		focus: {
			key: SM_CPU,
			provider: "shared-memory",
			notLinkable: "",
			endpoint: { key: SM_CPU, provider: "shared-memory", sensor: "CPU Test", label: "CPU Package", unit: "°C", type: 1, display: "61.0 °C", availability: "live", availabilityText: "Live on Shared Memory" },
			linkedRow: -1,
			candidates: [
				{ key: G_CPU, provider: "gadget", sensor: "CPU Test", label: "CPU Package", unit: "°C", type: 1, display: "62.0 °C", availability: "read-once", availabilityText: "Read once, age unknown", suggestion: "same-name", suggestionText: "Same source name, label and unit", blocked: null, blockedText: "" },
				{ key: G_GPU, provider: "gadget", sensor: "GPU Test", label: "GPU Temperature", unit: "°C", type: 1, display: "54.0 °C", availability: "read-once", availabilityText: "Read once, age unknown", suggestion: null, suggestionText: "", blocked: null, blockedText: "" },
				{ key: "g:Board:Pump", provider: "gadget", sensor: "Board", label: "Pump", unit: "RPM", type: 3, display: "1800 RPM", availability: "read-once", availabilityText: "Read once", suggestion: null, suggestionText: "", blocked: "unit-mismatch", blockedText: "The units differ (°C and RPM). A link never converts units." }
			],
			moreCandidates: 0
		},
		prerequisites: [{ id: "not-read", text: "Gadget registry has not been read in this session, so its readings and units are unknown.", action: "scan" }],
		scan: null,
		...over
	};
}
const lastRead = (m, event) => m.reads().filter((p) => p.event === event).at(-1);
const noWrites = (m, what) => {
	assert.deepEqual(m.settingsWrites, [], `${what}: no settings write`);
	assert.deepEqual(m.globalWrites, [], `${what}: no shared settings write`);
	assert.equal(m.reads().filter((p) => p.event === "applyLink" || p.event === "applyCalculated").length, 0, `${what}: no apply`);
};

// ------------------------------------------------------------- guard (pure)
describe("the shell's guard for plugin-written global fields (pi-model.js)", () => {
	const reply = (next, previous, previousPresent = true) => ({ ok: true, field: "readingLinks", previous, previousPresent, next });

	it("passes documents through untouched while nothing is in flight", () => {
		const guard = model.createGlobalsGuard();
		const doc = { theme: "void", readingLinks: [1] };
		assert.deepEqual(guard.outgoing(doc, 0), { hold: false, doc });
	});

	it("holds while an apply is in flight, then sends the last held document with the committed field spliced in", () => {
		const guard = model.createGlobalsGuard();
		guard.begin(0);
		assert.equal(guard.outgoing({ theme: "void", readingLinks: ["old"] }, 10).hold, true);
		assert.equal(guard.outgoing({ theme: "paper", readingLinks: ["old"] }, 20).hold, true);
		assert.equal(guard.release(30), null, "still holding");
		guard.settle(reply(["old", "new"], ["old"]));
		assert.deepEqual(guard.release(40), { theme: "paper", readingLinks: ["old", "new"] }, "the last edit, with the commit");
		assert.equal(guard.release(50), null, "sent once");
	});

	it("keeps splicing later stale documents until a delivery shows the store has the new value", () => {
		const guard = model.createGlobalsGuard();
		guard.begin(0);
		guard.settle(reply([{ b: 2, a: 1 }], []));
		assert.deepEqual(guard.outgoing({ pollIntervalMs: "250", readingLinks: [] }, 10).doc, { pollIntervalMs: "250", readingLinks: [{ b: 2, a: 1 }] });
		guard.received({ readingLinks: [] }); // an old copy: still spliced
		assert.deepEqual(guard.splicing(), ["readingLinks"]);
		guard.received({ readingLinks: [{ a: 1, b: 2 }] }); // key order is not meaning
		assert.deepEqual(guard.splicing(), []);
		assert.deepEqual(guard.outgoing({ readingLinks: [] }, 20).doc, { readingLinks: [] }, "after adoption a deliberate value is the person's");
	});

	it("never splices over a value other than the one the commit replaced", () => {
		const guard = model.createGlobalsGuard();
		guard.begin(0);
		guard.settle(reply(["new"], ["old"]));
		assert.deepEqual(guard.outgoing({ readingLinks: ["someone else"] }, 5).doc, { readingLinks: ["someone else"] });
	});

	it("an absent field before the commit is spliced into a document that still lacks it", () => {
		const guard = model.createGlobalsGuard();
		guard.begin(0);
		guard.settle({ ok: true, field: "calculatedReadings", previous: null, previousPresent: false, next: [{ id: CALC }] });
		assert.deepEqual(guard.outgoing({ theme: "void" }, 1).doc, { theme: "void", calculatedReadings: [{ id: CALC }] });
		assert.deepEqual(guard.outgoing({ theme: "void", calculatedReadings: null }, 1).doc, { theme: "void", calculatedReadings: null }, "null is not absent");
	});

	it("a refusal or no answer splices nothing; the hold ends after 3 s on its own", () => {
		const guard = model.createGlobalsGuard();
		guard.begin(0);
		assert.equal(guard.holdEndsAt(), model.GLOBALS_HOLD_MS);
		guard.outgoing({ readingLinks: ["old"] }, 1);
		assert.equal(guard.holding(model.GLOBALS_HOLD_MS - 1), true);
		assert.equal(guard.holding(model.GLOBALS_HOLD_MS), false);
		assert.deepEqual(guard.release(model.GLOBALS_HOLD_MS), { readingLinks: ["old"] });
		guard.settle({ ok: false, reason: "stale-basis", field: "readingLinks" });
		guard.settle(null);
		assert.deepEqual(guard.splicing(), []);
	});

	it("chained commits to one field: every value the store may still hold becomes the newest commit", () => {
		const guard = model.createGlobalsGuard();
		const X = [{ a: 1 }];
		const Y = [{ a: 1 }, { b: 2 }];
		const Z = [{ a: 1 }, { b: 2 }, { c: 3 }];
		guard.begin(0);
		guard.settle(reply(Y, X));
		guard.begin(10);
		guard.settle(reply(Z, Y)); // the plugin's fresh read had Y
		assert.deepEqual(guard.outgoing({ theme: "paper", readingLinks: X }, 20).doc, { theme: "paper", readingLinks: Z }, "the store's original copy never goes back out");
		assert.deepEqual(guard.outgoing({ theme: "paper", readingLinks: Y }, 20).doc, { theme: "paper", readingLinks: Z });
		guard.received({ readingLinks: X }); // an old copy: still spliced
		assert.deepEqual(guard.splicing(), ["readingLinks"]);
		guard.received({ readingLinks: Z });
		assert.deepEqual(guard.splicing(), []);
	});

	it("a late answer counts, and resends the document that went out with the old field", () => {
		const guard = model.createGlobalsGuard();
		guard.begin(0);
		guard.outgoing({ theme: "forest", readingLinks: ["old"] }, 10);
		guard.settle(null); // no answer in 3 s
		assert.deepEqual(guard.release(model.GLOBALS_HOLD_MS), { theme: "forest", readingLinks: ["old"] });
		assert.deepEqual(guard.late(reply(["old", "new"], ["old"]), model.GLOBALS_HOLD_MS + 500), { theme: "forest", readingLinks: ["old", "new"] });
		assert.deepEqual(guard.outgoing({ theme: "paper", readingLinks: ["old"] }, model.GLOBALS_HOLD_MS + 600).doc, { theme: "paper", readingLinks: ["old", "new"] });
		assert.equal(guard.late({ ok: false, reason: "stale-basis", field: "readingLinks" }, model.GLOBALS_HOLD_MS + 700), null, "a late refusal sends nothing");
	});

	it("a document the person chose as it is goes unspliced and ends every splice", () => {
		const guard = model.createGlobalsGuard();
		const X = [{ a: 1 }];
		const Y = [{ a: 1 }, { b: 2 }];
		guard.begin(0);
		guard.settle(reply(Y, X));
		assert.deepEqual(guard.outgoing({ readingLinks: X }, 10).doc, { readingLinks: Y }, "an ordinary save is spliced");
		assert.deepEqual(guard.explicit({ theme: "void", readingLinks: X }), { theme: "void", readingLinks: X }, "the backup's older list goes as chosen");
		assert.deepEqual(guard.splicing(), []);
		assert.deepEqual(guard.outgoing({ theme: "paper", readingLinks: X }, 20).doc, { theme: "paper", readingLinks: X });
		guard.begin(30);
		guard.outgoing({ theme: "forest", readingLinks: X }, 31);
		guard.explicit({ readingLinks: [] });
		assert.equal(guard.release(model.GLOBALS_HOLD_MS + 40), null, "a held save is dropped: the chosen document replaced it");
	});

	it("the one-line summaries say what is stored and in use", () => {
		assert.equal(model.linksSummary({}, null), "No links");
		assert.equal(model.linksSummary({ readingLinks: [{}, {}] }, null), "2 links");
		assert.equal(model.linksSummary({ readingLinks: "x" }, null), "Not a list");
		assert.equal(model.linksSummary({}, { counts: { stored: 3, active: 1, waiting: 1, ignored: 1 } }), "3 links · 1 in use · 1 waiting · 1 ignored");
		assert.equal(model.calcSummary({}, null), "None");
		assert.equal(model.calcSummary({ calculatedReadings: [{}, {}] }, null), "2 defined");
		assert.equal(model.calcSummary({}, { rows: [{ ok: true }, { ok: false }] }), "2 defined · 1 not valid");
	});
});

// ------------------------------------------------------------- the shell
describe("the shell holds the panel's own shared saves while the plugin commits a field", () => {
	it("a shared save during an apply waits, then goes out with the committed list spliced in", async () => {
		const m = mount({ globals: { theme: "void", readingLinks: [] } });
		m.deliverInitial();
		await m.advance(0);
		const pending = m.shell().applyGlobalField({ event: "applyLink", op: "link", sharedMemory: SM_CPU, gadget: G_CPU, baseSignature: "s0" });
		const apply = lastRead(m, "applyLink");
		assert.equal(typeof apply.requestId, "string");
		m.saveGlobal("pollIntervalMs", "250"); // the person changes Read every meanwhile
		assert.deepEqual(m.globalWrites, [], "held while the plugin commits");
		const next = [{ sharedMemory: SM_CPU, gadget: G_CPU, unit: "°C", sensorType: 1 }];
		m.feed({ event: "linkApplied", requestId: apply.requestId, ok: true, field: "readingLinks", previous: [], previousPresent: true, next, signature: "s1" });
		const result = await pending;
		assert.equal(result.ok, true);
		assert.deepEqual(m.globalWrites, [{ theme: "void", readingLinks: next, pollIntervalMs: "250" }]);
		assert.deepEqual(m.shell().state.globals.readingLinks, next, "the panel reads the committed list");
		// The store never heard the plugin's write: its next save still
		// carries the empty list, and the shell puts the commit back in.
		m.saveGlobal("theme", "paper");
		assert.deepEqual(m.globalWrites.at(-1), { theme: "paper", readingLinks: next, pollIntervalMs: "250" });
	});

	it("without an answer the held save goes out unchanged after 3 s and the promise settles empty", async () => {
		const m = mount({ globals: { readingLinks: ["mine"] } });
		m.deliverInitial();
		await m.advance(0);
		let settled = "pending";
		void m.shell().applyGlobalField({ event: "applyLink", op: "unlink", sharedMemory: SM_CPU, gadget: G_CPU, baseSignature: "s" }).then((r) => (settled = r));
		m.saveGlobal("theme", "forest");
		await m.advance(2900);
		assert.deepEqual(m.globalWrites, []);
		assert.equal(settled, "pending");
		await m.advance(200);
		assert.equal(settled, null);
		assert.deepEqual(m.globalWrites, [{ readingLinks: ["mine"], theme: "forest" }]);
	});

	it("two commits to one field with no delivery between: the store's next save carries the second commit", async () => {
		const m = mount({ globals: { theme: "void", readingLinks: [] } });
		m.deliverInitial();
		await m.advance(0);
		const one = [{ sharedMemory: SM_CPU, gadget: G_CPU, unit: "°C", sensorType: 1 }];
		const two = [...one, { sharedMemory: "f0001234:0:1000002", gadget: G_GPU, unit: "°C", sensorType: 1 }];
		const first = m.shell().applyGlobalField({ event: "applyLink", op: "link", sharedMemory: SM_CPU, gadget: G_CPU, baseSignature: "s0" });
		m.feed({ event: "linkApplied", requestId: lastRead(m, "applyLink").requestId, ok: true, field: "readingLinks", previous: [], previousPresent: true, next: one, signature: "s1" });
		await first;
		const second = m.shell().applyGlobalField({ event: "applyLink", op: "link", sharedMemory: "f0001234:0:1000002", gadget: G_GPU, baseSignature: "s1" });
		m.feed({ event: "linkApplied", requestId: lastRead(m, "applyLink").requestId, ok: true, field: "readingLinks", previous: one, previousPresent: true, next: two, signature: "s2" });
		await second;
		assert.deepEqual(m.globalStore.readingLinks, [], "the app never echoed the plugin's writes to the store");
		m.saveGlobal("theme", "paper");
		assert.deepEqual(m.globalWrites, [{ theme: "paper", readingLinks: two }], "both links survive the panel's own save");
		assert.deepEqual(m.shell().state.globals.readingLinks, two);
	});

	it("an answer after the 3 s hold still counts: the save that went out meanwhile goes again with the commit", async () => {
		const m = mount({ globals: { theme: "void", readingLinks: [] } });
		m.deliverInitial();
		await m.advance(0);
		let settled = "pending";
		void m.shell().applyGlobalField({ event: "applyLink", op: "link", sharedMemory: SM_CPU, gadget: G_CPU, baseSignature: "s0" }).then((r) => (settled = r));
		const apply = lastRead(m, "applyLink");
		m.saveGlobal("theme", "forest");
		await m.advance(3100);
		assert.equal(settled, null);
		assert.deepEqual(m.globalWrites, [{ theme: "forest", readingLinks: [] }], "the held save went out as it was");
		const next = [{ sharedMemory: SM_CPU, gadget: G_CPU, unit: "°C", sensorType: 1 }];
		m.feed({ event: "linkApplied", requestId: apply.requestId, ok: true, field: "readingLinks", previous: [], previousPresent: true, next, signature: "s1" });
		await m.advance(20);
		assert.deepEqual(m.globalWrites.at(-1), { theme: "forest", readingLinks: next }, "the late commit is put back, not undone");
		assert.deepEqual(m.shell().state.globals.readingLinks, next);
		m.saveGlobal("theme", "paper");
		assert.deepEqual(m.globalWrites.at(-1), { theme: "paper", readingLinks: next });
	});

	// Each editor's summary reads the list it last fetched, so a list
	// fetched before a commit whose answer came late would keep the old count.
	const closeSection = async (m, id) => {
		m.el(id).open = false;
		m.el(id).fire("toggle");
		await m.advance(20);
	};

	it("after a Calculated readings answer past the 3 s hold, a list fetched earlier is asked for again, and the summary counts the new reading", async () => {
		const m = mount({ globals: { theme: "void", calculatedReadings: [] } });
		m.deliverInitial();
		await m.advance(0);
		m.openSection("sec-calc");
		m.feed({ event: "calculated", requestId: lastRead(m, "getCalculated").requestId, workspace: calcWorkspace() });
		await m.advance(20);
		await closeSection(m, "sec-calc");
		assert.equal(m.el("sum-calc").textContent, "None");
		const asks = () => m.reads().filter((p) => p.event === "getCalculated");
		const before = asks().length;
		void m.shell().applyGlobalField({ event: "applyCalculated", op: "create", baseSignature: "s0" });
		const apply = lastRead(m, "applyCalculated");
		await m.advance(3100);
		assert.equal(asks().length, before, "no answer yet, nothing to ask for");
		m.feed({ event: "calculatedApplied", requestId: apply.requestId, ok: true, op: "create", id: CALC, field: "calculatedReadings", previous: [], previousPresent: true, next: [{ id: CALC, op: "sum", inputs: [SM_CPU, "f0001234:0:1000002"], unit: "W", sensorType: 5 }], signature: "s1" });
		await m.advance(20);
		assert.equal(asks().length, before + 1, "the closed section asks for its list again");
		m.feed({ event: "calculated", requestId: asks().at(-1).requestId, workspace: calcWorkspace({ signature: "sig-calc-2", rows: [CALC_ROW] }) });
		await m.advance(20);
		assert.equal(m.el("sum-calc").textContent, "1 defined");
		assert.deepEqual(m.settingsWrites, [], "no settings write");
		assert.equal(m.globalWrites.length, 1, "the guard's one resend of the late commit; asking for the list writes nothing");
	});

	it("after a Reading links answer past the 3 s hold, a list fetched earlier is asked for again, and the summary counts the new link", async () => {
		const m = mount({ globals: { theme: "void", readingLinks: [] } });
		m.deliverInitial();
		await m.advance(0);
		m.openSection("sec-links");
		m.feed({ event: "links", requestId: lastRead(m, "getLinks").requestId, workspace: linksWorkspace() });
		await m.advance(20);
		await closeSection(m, "sec-links");
		assert.equal(m.el("sum-links").textContent, "No links");
		const asks = () => m.reads().filter((p) => p.event === "getLinks");
		const before = asks().length;
		void m.shell().applyGlobalField({ event: "applyLink", op: "link", sharedMemory: SM_CPU, gadget: G_CPU, baseSignature: "s0" });
		const apply = lastRead(m, "applyLink");
		await m.advance(3100);
		assert.equal(asks().length, before, "no answer yet, nothing to ask for");
		m.feed({ event: "linkApplied", requestId: apply.requestId, ok: true, field: "readingLinks", previous: [], previousPresent: true, next: [{ sharedMemory: SM_CPU, gadget: G_CPU, unit: "°C", sensorType: 1 }], signature: "s1" });
		await m.advance(20);
		assert.equal(asks().length, before + 1, "the closed section asks for its list again");
		assert.equal(asks().at(-1).scan, undefined, "a read only, never a scan");
		m.feed({ event: "links", requestId: asks().at(-1).requestId, workspace: linksWorkspace({ signature: "sig-links-2", rows: [LINK_ROW], counts: { stored: 1, active: 1, waiting: 0, ignored: 0 } }) });
		await m.advance(20);
		assert.equal(m.el("sum-links").textContent, "1 link · 1 in use");
		assert.deepEqual(m.settingsWrites, [], "no settings write");
		assert.equal(m.globalWrites.length, 1, "the guard's one resend of the late commit; asking for the list writes nothing");
	});

	it("Replace with a backup taken before a Link press writes the backup's links, not the newer ones", async () => {
		const backup = [{ sharedMemory: SM_CPU, gadget: G_CPU, unit: "°C", sensorType: 1 }];
		const m = mount({ globals: { theme: "void", readingLinks: backup } });
		m.deliverInitial();
		await m.advance(0);
		const pending = m.shell().applyGlobalField({ event: "applyLink", op: "link", sharedMemory: "f0001234:0:1000002", gadget: G_GPU, baseSignature: "s0" });
		const next = [...backup, { sharedMemory: "f0001234:0:1000002", gadget: G_GPU, unit: "°C", sensorType: 1 }];
		m.feed({ event: "linkApplied", requestId: lastRead(m, "applyLink").requestId, ok: true, field: "readingLinks", previous: backup, previousPresent: true, next, signature: "s1" });
		await pending;
		m.sandbox.SDPIComponents.streamDeckClient.setGlobalSettings({ theme: "void", readingLinks: backup }, { explicit: true });
		assert.deepEqual(m.globalWrites, [{ theme: "void", readingLinks: backup }], "the pasted backup lands as pasted");
		assert.deepEqual(m.shell().state.globals.readingLinks, backup);
		m.saveGlobal("theme", "paper");
		assert.deepEqual(m.globalWrites.at(-1).readingLinks, backup, "and the splice does not come back on the next save");
	});

	it("a deleted calculated reading is said to be no longer defined, never to return from HWiNFO", async () => {
		const m = mount({ settings: { readingKey: CALC } });
		m.deliverInitial();
		await m.advance(0);
		m.feed({ event: "preview", context: "ctx", state: "ok", source: "shared-memory", missing: true, hint: "" });
		await m.advance(20);
		const box = m.el("reading-status");
		assert.match(box.textContent, /saved calculated reading is no longer defined/);
		assert.doesNotMatch(box.textContent, /HWiNFO's current sensor list|sensor wakes|HWiNFO restarts/);
		const actions = box.querySelectorAll("button").map((b) => [b.dataset.statusAction, b.textContent]);
		assert.deepEqual(actions, [["pick", "Pick another reading"], ["calc", "Calculated readings"]]);
		document_click(m, box.querySelectorAll("button")[1]);
		await m.advance(20);
		assert.equal(m.el("sec-calc").open, true);
		noWrites(m, "the status block of a deleted calculated reading");
	});

	it("the recovery beside a missing saved reading opens Reading links on it", async () => {
		const m = mount({ settings: { readingKey: SM_CPU } });
		m.deliverInitial();
		await m.advance(0);
		m.feed({ event: "preview", context: "ctx", state: "ok", source: "gadget", missing: true, hint: "" });
		await m.advance(20);
		const button = m.el("reading-status").querySelectorAll("button").find((b) => b.dataset.statusAction === "pair");
		assert.ok(button, "the status block offers the link");
		assert.equal(button.textContent, "Link it to a Gadget reading");
		document_click(m, button);
		await m.advance(20);
		assert.equal(m.el("sec-links").open, true);
		assert.equal(lastRead(m, "getLinks").focusKey, SM_CPU);
		noWrites(m, "the recovery press");
	});
});

/** A keyboard activation (detail 0, so the shell's pointer guards stand
 * aside) that reaches the document listeners the shell installed. */
function document_click(m, el) {
	el.click({ detail: 0 });
	for (const fn of m.sandbox.document.listeners.click ?? []) fn({ type: "click", target: el, detail: 0, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
}

// ------------------------------------------------------------- links panel
describe("Reading links panel: only an explicit press writes", () => {
	async function opened(over) {
		const m = mount({ globals: { theme: "void" } });
		m.deliverInitial();
		await m.advance(0);
		m.openSection("sec-links");
		const ask = lastRead(m, "getLinks");
		assert.ok(ask, "opening asks for the workspace");
		m.feed({ event: "links", requestId: ask.requestId, workspace: linksWorkspace(over) });
		await m.advance(20);
		return m;
	}

	it("opening, refreshing, filtering, choosing and refocusing send reads only", async () => {
		const m = await opened();
		assert.equal(lastRead(m, "getLinks").focusKey, SM_CPU);
		assert.equal(lastRead(m, "getLinks").scan, undefined, "opening never reads the other source");
		const candidate = m.el("links-candidate");
		assert.deepEqual(candidate.children.map((o) => [o.value, o.disabled]), [["", false], [G_CPU, false], [G_GPU, false], ["g:Board:Pump", true]]);
		assert.match(candidate.children[1].textContent, /suggested: same source name, label and unit/);
		assert.match(candidate.children[3].textContent, /units differ/);
		assert.equal(candidate.value, "", "nothing is preselected");
		assert.equal(m.el("links-link").getAttribute("aria-disabled"), "true");
		const before = m.reads().length;
		m.el("links-filter").value = "gpu";
		m.el("links-filter").fire("input");
		assert.deepEqual(m.el("links-candidate").children.map((o) => o.value), ["", G_GPU]);
		m.el("links-filter").value = "";
		m.el("links-filter").fire("input");
		candidate.value = G_CPU;
		candidate.fire("change");
		assert.match(m.el("links-scope").textContent, /^Links CPU Package \(Shared Memory, °C\) with CPU Package \(Gadget, °C\) for every key and dial\.$/);
		assert.equal(m.el("links-link").getAttribute("aria-disabled"), "false");
		assert.equal(m.el("links-chosen").hidden, false);
		assert.deepEqual(m.el("links-chosen").children.map((p) => p.textContent), ["Gadget: CPU Package (CPU Test), °C", "62.0 °C · Read once, age unknown"], "the other reading's source, unit, value and availability");
		assert.equal(m.reads().length, before, "searching and choosing send nothing at all");
		await m.advance(6100);
		assert.ok(m.reads().slice(before).every((p) => p.event === "getLinks" && p.scan === undefined), "the open section refreshes with reads only");
		noWrites(m, "browsing the link editor");
	});

	it("Look on Gadget asks for one scan of the other source, nothing else", async () => {
		const m = await opened();
		assert.equal(m.el("links-scan").textContent, "Look on Gadget");
		m.el("links-scan").click();
		const ask = lastRead(m, "getLinks");
		assert.deepEqual([ask.scan, ask.provider], [true, "gadget"]);
		noWrites(m, "a scan");
	});

	it("one Link press sends exactly one applyLink with the basis it was shown", async () => {
		const m = await opened();
		m.el("links-candidate").value = G_CPU;
		m.el("links-candidate").fire("change");
		m.el("links-link").click();
		const applies = m.reads().filter((p) => p.event === "applyLink");
		assert.equal(applies.length, 1);
		assert.deepEqual({ ...applies[0], requestId: "-" }, { event: "applyLink", op: "link", sharedMemory: SM_CPU, gadget: G_CPU, baseSignature: "sig-links-1", focusKey: SM_CPU, requestId: "-" });
		m.feed({ event: "linkApplied", requestId: applies[0].requestId, ok: true, field: "readingLinks", previous: null, previousPresent: false, next: [{ sharedMemory: SM_CPU, gadget: G_CPU, unit: "°C", sensorType: 1 }], signature: "sig-links-2", workspace: linksWorkspace({ signature: "sig-links-2", rows: [LINK_ROW], counts: { stored: 1, active: 1, waiting: 0, ignored: 0 } }) });
		await m.advance(20);
		assert.match(m.el("links-note").textContent, /^Linked\./);
		assert.equal(m.el("links-list").children.length, 1);
		assert.equal(m.reads().filter((p) => p.event === "getLinks").length, 1, "the answer carries the new list: no second ask");
		assert.deepEqual(m.settingsWrites, [], "a link never writes this key's settings");
		assert.deepEqual(m.globalWrites, [], "the plugin writes the list, the panel does not");
	});

	it("a linked focus: Replace link is offered and one press sends one relink of that row", async () => {
		const row = { ...LINK_ROW, gadget: G_GPU };
		const base = linksWorkspace();
		const m = await opened({
			rows: [row],
			counts: { stored: 1, active: 1, waiting: 0, ignored: 0 },
			focus: { ...base.focus, linkedRow: 0, candidates: base.focus.candidates.map((c) => (c.key === G_GPU ? { ...c, blocked: "duplicate", blockedText: "These two readings are linked already." } : c)) }
		});
		assert.equal(m.el("links-link").textContent, "Replace link");
		m.el("links-candidate").value = G_CPU;
		m.el("links-candidate").fire("change");
		assert.equal(m.el("links-link").getAttribute("aria-disabled"), "false");
		m.el("links-link").click();
		const applies = m.reads().filter((p) => p.event === "applyLink");
		assert.equal(applies.length, 1);
		assert.deepEqual({ ...applies[0], requestId: "-" }, { event: "applyLink", op: "relink", sharedMemory: SM_CPU, gadget: G_CPU, previous: { sharedMemory: SM_CPU, gadget: G_GPU }, baseSignature: "sig-links-1", focusKey: SM_CPU, requestId: "-" });
		noWrites({ ...m, reads: () => [] }, "a relink press");
	});

	it("a refusal is shown in words and the list refreshed from the answer", async () => {
		const m = await opened();
		m.el("links-candidate").value = G_GPU;
		m.el("links-candidate").fire("change");
		m.el("links-link").click();
		const apply = lastRead(m, "applyLink");
		m.feed({ event: "linkApplied", requestId: apply.requestId, ok: false, reason: "stale-basis", reasonText: "The links changed in another panel or document since this list was shown. Check the refreshed list and press again.", workspace: linksWorkspace({ signature: "sig-links-9" }) });
		await m.advance(20);
		assert.equal(m.el("links-note").dataset.tone, "warn");
		assert.match(m.el("links-note").textContent, /changed in another panel/);
	});

	it("Unlink asks for a second press; the first and a blur send nothing", async () => {
		const m = await opened({ rows: [LINK_ROW], counts: { stored: 1, active: 1, waiting: 0, ignored: 0 } });
		const unlink = m.el("links-list").querySelector(".hw-link-unlink");
		unlink.click();
		assert.equal(unlink.dataset.armed, "true");
		assert.equal(unlink.textContent, "Press again to unlink");
		noWrites(m, "arming Unlink");
		unlink.blur();
		assert.equal(unlink.dataset.armed, "false");
		unlink.click();
		unlink.click({ detail: 2 }); // the second click of a double-click only waits
		noWrites(m, "a double-click");
		await m.advance(500);
		unlink.click();
		const applies = m.reads().filter((p) => p.event === "applyLink");
		assert.equal(applies.length, 1);
		assert.deepEqual([applies[0].op, applies[0].sharedMemory, applies[0].gadget, applies[0].baseSignature], ["unlink", SM_CPU, G_CPU, "sig-links-1"]);
	});

	it("keyboard focus survives a rebuild: the pressed Look on line and an unlinked row hand focus on", async () => {
		const m = await opened({ rows: [LINK_ROW], counts: { stored: 1, active: 1, waiting: 0, ignored: 0 } });
		const inline = m.el("links-prereq").querySelector("button");
		inline.focus();
		inline.click();
		const ask = lastRead(m, "getLinks");
		assert.equal(ask.scan, true);
		m.feed({ event: "links", requestId: ask.requestId, workspace: linksWorkspace({ rows: [LINK_ROW], counts: { stored: 1, active: 1, waiting: 0, ignored: 0 }, prerequisites: [], scan: { provider: "gadget", text: "Read Gadget registry once: 3 readings known from it in this session.", throttled: false } }) });
		await m.advance(20);
		assert.equal(m.el("links-prereq").children.length, 0, "the line went");
		assert.ok(m.doc.activeElement === m.el("links-scan"), "focus moved to Look on Gadget, not to the page");
		const unlink = m.el("links-list").querySelector(".hw-link-unlink");
		unlink.focus();
		await m.advance(2000);
		m.feed({ event: "links", requestId: lastRead(m, "getLinks").requestId, workspace: linksWorkspace({ prerequisites: [] }) });
		await m.advance(20);
		assert.ok(m.doc.activeElement === m.el("links-candidate"), "the row went; focus moved to the list of readings");
	});

	it("the 2 s refresh asks with the list it holds; an unchanged answer keeps the list and updates the chosen value", async () => {
		const base = linksWorkspace();
		const withSig = (focus) => linksWorkspace({ focus: { ...base.focus, candidatesSignature: "cs-1", candidatesUnchanged: false, ...focus } });
		const m = await opened({ focus: withSig().focus });
		m.el("links-candidate").value = G_GPU;
		m.el("links-candidate").fire("change");
		const options = [...m.el("links-candidate").children];
		await m.advance(2000);
		const ask = lastRead(m, "getLinks");
		assert.deepEqual([ask.candidatesSignature, ask.chosen], ["cs-1", G_GPU]);
		const gpu = base.focus.candidates.find((c) => c.key === G_GPU);
		m.feed({ event: "links", requestId: ask.requestId, workspace: withSig({ candidates: [{ ...gpu, display: "57.0 °C" }], candidatesUnchanged: true }) });
		await m.advance(20);
		assert.deepEqual([...m.el("links-candidate").children], options, "the list was not rebuilt");
		assert.equal(m.el("links-candidate").value, G_GPU, "the choice stands");
		assert.equal(m.el("links-chosen").children[1].textContent, "57.0 °C · Read once, age unknown");
		const before = m.reads().length;
		await m.advance(2000);
		const next = lastRead(m, "getLinks");
		m.feed({ event: "links", requestId: next.requestId, workspace: linksWorkspace({ focus: { ...base.focus, candidates: [], candidatesSignature: "cs-other", candidatesUnchanged: true } }) });
		await m.advance(20);
		const recovery = lastRead(m, "getLinks");
		assert.ok(m.reads().length > before + 1 && recovery.candidatesSignature === undefined, "an answer for a list this panel does not hold asks for the whole list");
		assert.equal(m.el("links-candidate").children.length, 4, "and keeps showing the list it has meanwhile");
		noWrites(m, "refreshing");
	});

	it("the focus card's value line is held to one line, as the chosen reading's is", async () => {
		const m = await opened();
		const lines = m.el("links-card").children;
		assert.deepEqual(lines.map((p) => [p.textContent, p.className]), [
			["Shared Memory: CPU Package (CPU Test), °C", ""],
			["61.0 °C · Live on Shared Memory", "hw-link-value"]
		]);
	});

	it("live values change only the words inside existing lines", async () => {
		const m = await opened({ rows: [LINK_ROW], counts: { stored: 1, active: 1, waiting: 0, ignored: 0 } });
		const li = m.el("links-list").children[0];
		const value = li.children.find((p) => p.dataset.line === "1");
		await m.advance(2000);
		const ask = lastRead(m, "getLinks");
		m.feed({ event: "links", requestId: ask.requestId, workspace: linksWorkspace({ rows: [{ ...LINK_ROW, sm: { ...LINK_ROW.sm, display: "64.0 °C" } }], counts: { stored: 1, active: 1, waiting: 0, ignored: 0 } }) });
		await m.advance(20);
		assert.equal(m.el("links-list").children[0], li, "the row was not rebuilt");
		assert.equal(value.textContent, "64.0 °C · Live on Shared Memory");
	});
});

// ------------------------------------------------------------- calc panel
const CALC_ROW = { index: 0, id: CALC, ok: true, reason: null, reasonText: "", label: "CPU Package Power + GPU Power", custom: false, labelRefusal: null, labelRefusalText: "", opText: "Sum", inputs: [{ key: "f0001234:0:5000001", label: "CPU Package Power", source: "Test", present: true }, { key: "f0001234:0:5000002", label: "GPU Power", source: "Test", present: true }], display: "245 W", unit: "W", state: "ok", stateText: "", expression: "CPU Package Power + GPU Power", draft: { op: "sum", inputs: ["f0001234:0:5000001", "f0001234:0:5000002"], percent: false, label: "" } };
const calcWorkspace = (over = {}) => ({ signature: "sig-calc-1", rows: [], overCap: false, unreadable: false, max: 32, maxInputs: 8, ops: [], ...over });
const TREE = { event: "sensorTree", state: "ok", hint: "", groups: [{ name: "Test", matchName: "Test", readings: [{ key: "f0001234:0:5000001", keys: ["f0001234:0:5000001"], label: "CPU Package Power", unit: "W", value: 65, type: 5, display: "65 W" }, { key: "f0001234:0:5000002", keys: ["f0001234:0:5000002"], label: "GPU Power", unit: "W", value: 180, type: 5, display: "180 W" }] }] };

describe("Calculated readings panel: only Save and Delete write", () => {
	async function opened(over) {
		const m = mount();
		m.deliverInitial();
		await m.advance(0);
		m.feed(TREE);
		m.openSection("sec-calc");
		const ask = lastRead(m, "getCalculated");
		assert.ok(ask, "opening asks for the list");
		m.feed({ event: "calculated", requestId: ask.requestId, workspace: calcWorkspace(over) });
		await m.advance(20);
		return m;
	}

	it("opening, a new draft, picking inputs, previewing, a label and Cancel send reads only", async () => {
		const m = await opened({ rows: [CALC_ROW] });
		assert.equal(m.el("calc-list").children.length, 1);
		assert.match(m.el("calc-list").children[0].textContent, /245 W/);
		m.el("calc-new").click();
		assert.equal(m.el("calc-form").hidden, false);
		const selects = m.el("calc-inputs").querySelectorAll("select");
		assert.equal(selects.length, 2);
		assert.match(m.el("calc-preview-message").textContent, /Pick a reading in every row/);
		selects[0].value = "f0001234:0:5000001";
		selects[0].fire("change");
		selects[1].value = "f0001234:0:5000002";
		selects[1].fire("change");
		await m.advance(200);
		const preview = lastRead(m, "previewCalculated");
		assert.deepEqual(preview.draft, { op: "sum", inputs: ["f0001234:0:5000001", "f0001234:0:5000002"], percent: false, label: "" });
		m.feed({ event: "calculatedPreview", requestId: preview.requestId, preview: { ok: true, reason: null, reasonText: "", generatedLabel: "CPU Package Power + GPU Power", label: "CPU Package Power + GPU Power", labelRefusal: null, labelRefusalText: "", display: "245 W", unit: "W", state: "ok", stateText: "", expression: "CPU Package Power + GPU Power", allowedOps: ["sum"] } });
		await m.advance(20);
		assert.equal(m.el("calc-preview-value").textContent, "CPU Package Power + GPU Power = 245 W");
		assert.equal(m.el("calc-preview-expression").textContent, "Expression: CPU Package Power + GPU Power · unit W");
		assert.equal(m.el("calc-save").getAttribute("aria-disabled"), "false");
		m.el("calc-label").value = "Total system power";
		m.el("calc-label").fire("input");
		await m.advance(200);
		assert.equal(lastRead(m, "previewCalculated").draft.label, "Total system power");
		m.el("calc-cancel").click();
		assert.equal(m.el("calc-form").hidden, true);
		const kinds = new Set(m.reads().map((p) => p.event));
		assert.deepEqual([...kinds].sort(), ["getCalculated", "getPanelFolds", "getPreview", "previewCalculated"], "reads only");
		noWrites(m, "drafting and cancelling");
	});

	it("one Save press sends exactly one applyCalculated with the basis it was shown", async () => {
		const m = await opened();
		m.el("calc-new").click();
		const selects = m.el("calc-inputs").querySelectorAll("select");
		selects[0].value = "f0001234:0:5000001";
		selects[0].fire("change");
		selects[1].value = "f0001234:0:5000002";
		selects[1].fire("change");
		await m.advance(200);
		const preview = lastRead(m, "previewCalculated");
		m.feed({ event: "calculatedPreview", requestId: preview.requestId, preview: { ok: true, reason: null, reasonText: "", generatedLabel: "A + B", label: "A + B", labelRefusal: null, labelRefusalText: "", display: "245 W", unit: "W", state: "ok", stateText: "", expression: "A + B", allowedOps: [] } });
		await m.advance(20);
		m.el("calc-save").click();
		const applies = m.reads().filter((p) => p.event === "applyCalculated");
		assert.equal(applies.length, 1);
		assert.deepEqual({ ...applies[0], requestId: "-" }, { event: "applyCalculated", op: "create", draft: { op: "sum", inputs: ["f0001234:0:5000001", "f0001234:0:5000002"], percent: false, label: "" }, baseSignature: "sig-calc-1", requestId: "-" });
		m.feed({ event: "calculatedApplied", requestId: applies[0].requestId, ok: true, op: "create", id: CALC, field: "calculatedReadings", previous: null, previousPresent: false, next: [{ id: CALC }], signature: "sig-calc-2", workspace: calcWorkspace({ signature: "sig-calc-2", rows: [CALC_ROW] }) });
		await m.advance(20);
		assert.equal(m.el("calc-form").hidden, true);
		assert.equal(m.reads().filter((p) => p.event === "getCalculated").length, 1, "the answer carries the new list: no second ask");
		assert.match(m.el("calc-note").textContent, /Calculated \(plugin\) group/);
		assert.ok(m.reads().some((p) => p.event === "getSensorTree"), "the pickers fetch the list with the new reading");
		assert.deepEqual(m.settingsWrites, []);
		assert.deepEqual(m.globalWrites, []);
	});

	it("Save stays inert while the preview refuses the draft", async () => {
		const m = await opened();
		m.el("calc-new").click();
		const selects = m.el("calc-inputs").querySelectorAll("select");
		selects[0].value = "f0001234:0:5000001";
		selects[0].fire("change");
		selects[1].value = "f0001234:0:5000002";
		selects[1].fire("change");
		await m.advance(200);
		const preview = lastRead(m, "previewCalculated");
		m.feed({ event: "calculatedPreview", requestId: preview.requestId, preview: { ok: false, reason: "op-not-allowed", reasonText: "This operation does not fit these units.", generatedLabel: "", label: "", labelRefusal: null, labelRefusalText: "", display: "", unit: "", state: null, stateText: "", expression: "", allowedOps: [] } });
		await m.advance(20);
		assert.equal(m.el("calc-save").getAttribute("aria-disabled"), "true");
		assert.match(m.el("calc-preview-message").textContent, /does not fit/);
		m.el("calc-save").click();
		noWrites(m, "a refused draft");
	});

	it("Remove on an input row moves focus to the next row's control, not the page", async () => {
		const m = await opened();
		m.el("calc-new").click();
		m.el("calc-add-input").click();
		const removes = () => m.el("calc-inputs").querySelectorAll("button");
		assert.equal(removes().length, 3);
		removes()[1].focus();
		removes()[1].click();
		assert.equal(m.el("calc-inputs").querySelectorAll("select").length, 2);
		assert.ok(m.doc.activeElement === m.el("calc-inputs").querySelectorAll("select")[1], "the row that took its place");
		noWrites(m, "removing an input row");
	});

	it("Delete asks for a second press", async () => {
		const m = await opened({ rows: [CALC_ROW] });
		const del = m.el("calc-list").querySelector(".hw-calc-delete");
		del.click();
		assert.equal(del.textContent, "Press again to delete");
		noWrites(m, "arming Delete");
		await m.advance(500);
		del.click();
		const applies = m.reads().filter((p) => p.event === "applyCalculated");
		assert.deepEqual(applies.map((p) => [p.op, p.id, p.baseSignature]), [["delete", CALC, "sig-calc-1"]]);
	});

	it("Edit opens the stored definition as a draft and saves it as an update", async () => {
		const m = await opened({ rows: [CALC_ROW] });
		const edit = m.el("calc-list").querySelectorAll("button").find((b) => b.textContent === "Edit");
		edit.click();
		await m.advance(200);
		const preview = lastRead(m, "previewCalculated");
		assert.equal(preview.editingId, CALC);
		m.feed({ event: "calculatedPreview", requestId: preview.requestId, preview: { ok: true, reason: null, reasonText: "", generatedLabel: "A + B", label: "A + B", labelRefusal: null, labelRefusalText: "", display: "245 W", unit: "W", state: "ok", stateText: "", expression: "A + B", allowedOps: [] } });
		await m.advance(20);
		m.el("calc-save").click();
		const apply = lastRead(m, "applyCalculated");
		assert.deepEqual([apply.op, apply.id], ["update", CALC]);
	});
});
