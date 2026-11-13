/**
 * Advanced > Shared defaults and Connection: the bound shared
 * fields of both sensor panels, as the shipped panel bytes (ui/pi-model.js,
 * ui/pi-shell.js) bind them, in a node vm over a small fake DOM that holds
 * every bound control of the shipped panel HTML, a fake sdpi store and
 * socket.
 *
 * What it proves:
 * - a shared select shows what the runtime draws: a stored blank ("" or
 *   only spaces) is no newer version's choice, so it shows the runtime's
 *   reading of it (its default, and 250 ms for Read every) with no kept
 *   option, exactly like an absent field; a value this version does not
 *   offer still shows as kept, and nothing is written on open, so the
 *   stored value stays as it was until the person picks another;
 * - while a Sensor Dial draws part of a running strip, the strip's field
 *   redirects reach the dial's own Display fields only: the Shared
 *   defaults Text color and Dim labels, units and stats show and save the
 *   shared settings (the owner's + XL, 2026-10-28: the shared Text color
 *   showed the strip's Default as 'Stored value "" (not in this list,
 *   kept)', and a pick there edited the strip).
 *
 * The fake DOM is not a browser: e2e:pi-panels and e2e:pi-strip check the
 * same in headless Chromium.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import vm from "node:vm";

import { parsePollInterval, parseSourceMode } from "../src/poller.ts";
import { parseFaceFont } from "../src/ui/face-font.ts";
import { parseDataUnitsPref } from "../src/ui/measure.ts";
import { applyGlobalThemeSettings, effectiveTextFor, getDeckTheme, typeAccentsEnabled } from "../src/ui/theme-store.ts";

const UI = new URL("../com.lawrensen.hwinfo.sdPlugin/ui/", import.meta.url);
const source = (name) => readFileSync(new URL(name, UI), "utf8");
const SCRIPTS = ["pi-model.js", "pi-shell.js"].map((name) => ({ name, source: source(name) }));
const plain = (v) => JSON.parse(JSON.stringify(v));

// ------------------------------------------------------------- fake DOM
class FakeElement {
	constructor(tag, doc) {
		this.tagName = tag.toUpperCase();
		this.doc = doc;
		this.id = "";
		this.className = "";
		this.hidden = false;
		this.disabled = false;
		this.checked = false;
		this.open = false;
		this.type = "";
		this.dataset = {};
		this.style = { setProperty() {} };
		this.attrs = {};
		this.children = [];
		this.parentElement = null;
		this.listeners = {};
		this._text = "";
		this._value = "";
	}
	get value() {
		return this._value;
	}
	set value(v) {
		this._value = String(v);
	}
	get textContent() {
		return this._text + this.children.map((c) => c.textContent).join("");
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
	fire(type) {
		for (const fn of [...(this.listeners[type] ?? [])]) fn({ type, target: this, detail: 1, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
	}
	appendChild(child) {
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
				const actual = this.getAttribute(name) ?? undefined;
				if (val === undefined ? actual === undefined : actual !== val) return false;
			}
			return true;
		});
	}
	setAttribute(k, v) {
		if (k.startsWith("data-")) this.dataset[dataKey(k)] = String(v);
		else this.attrs[k] = String(v);
	}
	getAttribute(k) {
		if (k.startsWith("data-")) return this.dataset[dataKey(k)] ?? null;
		if (k === "id") return this.id === "" ? null : this.id;
		return this.attrs[k] ?? null;
	}
	hasAttribute(k) {
		return this.getAttribute(k) !== null;
	}
	removeAttribute(k) {
		if (k.startsWith("data-")) delete this.dataset[dataKey(k)];
		else delete this.attrs[k];
	}
	toggleAttribute(k, force) {
		const on = force ?? !this.hasAttribute(k);
		if (on) this.setAttribute(k, "");
		else this.removeAttribute(k);
		return on;
	}
	focus() {
		this.doc.activeElement = this;
	}
	blur() {
		if (this.doc.activeElement === this) this.doc.activeElement = this.doc.body;
	}
	scrollIntoView() {}
	getBoundingClientRect() {
		return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
	}
}
const dataKey = (attr) => attr.slice(5).replace(/-([a-z])/g, (_m, c) => c.toUpperCase());

/** A single select: its value is its selected option's, and setting a value
 * no option has selects nothing, as in a browser. */
const NONE = Symbol("no option selected");
class FakeSelect extends FakeElement {
	constructor(doc) {
		super("select", doc);
		this.selected = null;
	}
	get options() {
		return this.children.filter((c) => c.tagName === "OPTION");
	}
	get selectedOptions() {
		if (this.selected === NONE) return [];
		if (this.selected !== null && this.selected.parentElement === this) return [this.selected];
		return this.options.length === 0 ? [] : [this.options[0]];
	}
	get value() {
		return this.selectedOptions[0]?.value ?? "";
	}
	set value(v) {
		this.selected = this.options.find((o) => o.value === String(v)) ?? NONE;
	}
	/** What a person sees in the closed select. */
	get shown() {
		return this.selectedOptions[0]?.textContent ?? "";
	}
}

class FakeDocument {
	constructor() {
		this.documentElement = new FakeElement("html", this);
		this.body = new FakeElement("body", this);
		this.documentElement.appendChild(this.body);
		this.activeElement = this.body;
		this.visibilityState = "visible";
		this.listeners = {};
	}
	getElementById(id) {
		return id === "" ? null : (this.body.querySelector(`#${id}`) ?? null);
	}
	createElement(tag) {
		return tag.toLowerCase() === "select" ? new FakeSelect(this) : new FakeElement(tag, this);
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
}

// ------------------------------------------------- the shipped controls
const attrsOf = (text) => Object.fromEntries([...text.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(([, k, v]) => [k, v ?? ""]));
const decode = (text) => text.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();

/** Every bound control ([data-setting]) of a shipped panel, with its options. */
function boundControls(panel) {
	const html = source(panel);
	const out = [];
	for (const [, attrs, body] of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)) {
		const a = attrsOf(attrs);
		if (a["data-setting"] === undefined) continue;
		const options = [...body.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)].map(([, o, text]) => ({ value: attrsOf(o).value ?? "", text: decode(text) }));
		out.push({ tag: "select", attrs: a, options });
	}
	for (const [, tag, attrs] of html.matchAll(/<(input|textarea)\b([^>]*?)\/?>/g)) {
		const a = attrsOf(attrs);
		if (a["data-setting"] !== undefined) out.push({ tag, attrs: a, options: [] });
	}
	return out;
}

/** Mounts the shell over one panel's bound controls. */
function mount(panel, { settings = { readingKey: "f0001234:0:1000001" }, globals = {} } = {}) {
	const doc = new FakeDocument();
	doc.body.dataset.kind = panel === "sensor-dial.html" ? "dial" : "key";
	for (const id of ["hw-head", "head-reading", "head-source", "head-state", "reading-status", "face"]) {
		const el = doc.createElement("div");
		el.id = id;
		doc.body.appendChild(el);
	}
	const controls = [];
	for (const { tag, attrs, options } of boundControls(panel)) {
		const el = doc.createElement(tag);
		for (const [k, v] of Object.entries(attrs)) {
			if (k === "id") el.id = v;
			else if (k === "type") el.type = v;
			else el.setAttribute(k, v);
		}
		for (const { value, text } of options) {
			const o = doc.createElement("option");
			o.value = value;
			o.textContent = text;
			el.appendChild(o);
		}
		doc.body.appendChild(el);
		controls.push(el);
	}
	const store = structuredClone(settings);
	const globalStore = structuredClone(globals);
	const settingsWrites = [];
	const globalWrites = [];
	const globalSubscribers = [];
	const useStore = (target, save) => (name) => [
		() => Promise.resolve(target[name]),
		(v) => {
			target[name] = v;
			save({ ...target });
		}
	];
	const SDPIComponents = {
		useSettings: useStore(store, (d) => SDPIComponents.streamDeckClient.setSettings(d)),
		useGlobalSettings: useStore(globalStore, (d) => SDPIComponents.streamDeckClient.setGlobalSettings(d)),
		streamDeckClient: {
			send() {},
			sendToPropertyInspector: { subscribe() {} },
			didReceiveSettings: { subscribe() {} },
			didReceiveGlobalSettings: { subscribe: (cb) => globalSubscribers.push(cb) },
			getConnectionInfo: async () => ({ actionInfo: { context: "ctx", payload: { settings: store } } }),
			getGlobalSettings: async () => globalStore,
			setSettings: (d) => settingsWrites.push(plain(d)),
			setGlobalSettings: (d) => globalWrites.push(plain(d))
		}
	};
	let timerSeq = 0;
	const sandbox = {
		document: doc,
		console: {
			log() {},
			warn() {},
			error: (...a) => {
				throw new Error(`panel logged an error: ${a.join(" ")}`);
			}
		},
		SDPIComponents,
		// No timer ever runs: the checks below need none, and a save the
		// shell would schedule cannot land behind a check.
		setTimeout: () => ++timerSeq,
		clearTimeout() {},
		setInterval: () => ++timerSeq,
		clearInterval() {},
		requestAnimationFrame: () => ++timerSeq,
		cancelAnimationFrame() {},
		queueMicrotask,
		performance: { now: () => 1000, mark() {}, measure() {}, getEntriesByName: () => [] },
		HTMLElement: FakeElement,
		Element: FakeElement,
		Node: FakeElement,
		innerHeight: 900,
		addEventListener() {},
		removeEventListener() {},
		scrollBy() {},
		location: { reload() {} }
	};
	sandbox.window = sandbox;
	sandbox.self = sandbox;
	vm.createContext(sandbox);
	for (const { name, source: code } of SCRIPTS) vm.runInContext(code, sandbox, { filename: name });
	const settle = async () => {
		for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve));
	};
	/** The host delivering the shared document, as at load. */
	const deliverGlobals = async () => {
		for (const cb of globalSubscribers) cb({ payload: { settings: structuredClone(globalStore) } });
		await settle();
	};
	const control = (setting, global) => controls.find((el) => el.dataset.setting === setting && el.hasAttribute("data-global") === global);
	return { shell: () => sandbox.hwShell, control, controls, store, globalStore, settingsWrites, globalWrites, settle, deliverGlobals };
}

/** Opens a panel the way the host does: the shell binds, then the shared
 * document arrives. */
async function open(panel, options) {
	const m = mount(panel, options);
	await m.deliverGlobals();
	return m;
}

const kept = (el) => el.options.filter((o) => o.hasAttribute("data-unknown"));
const pick = (el, value) => {
	el.value = value;
	el.fire("change");
};
const toggle = (el, on) => {
	el.checked = on;
	el.fire("change");
};

// ------------------------------------------------- the runtime's reading
// What the plugin draws for a stored shared value, read with its own
// parsers. The theme is the exception: a stored theme it does not know
// (a blank included) leaves the deck theme it already resolved, which the
// panel shows as the select's default (pi-common.js syncSharedThemeDefault
// keeps data-default at that resolved id).
const RUNTIME = {
	theme: (raw, el) => {
		applyGlobalThemeSettings({ theme: "ember" });
		applyGlobalThemeSettings({ theme: raw });
		assert.equal(getDeckTheme(), "ember", `theme ${JSON.stringify(raw)}: the runtime keeps the deck theme it resolved`);
		return el.dataset.default;
	},
	textMode: (raw) => {
		applyGlobalThemeSettings({ textMode: raw });
		return effectiveTextFor({}).mode;
	},
	textFont: (raw) => parseFaceFont(raw),
	typeAccents: (raw) => {
		applyGlobalThemeSettings({ typeAccents: raw });
		return typeAccentsEnabled() ? "on" : "off";
	},
	dataUnits: (raw) => parseDataUnitsPref(raw),
	source: (raw) => parseSourceMode(raw),
	pollIntervalMs: (raw) => String(parsePollInterval(raw))
};
const BLANKS = ["", " ", "\t"];
const PANELS = ["sensor-reading.html", "sensor-dial.html"];

describe("shared selects show what the runtime draws", () => {
	for (const panel of PANELS) {
		it(`${panel}: every shared select is one the runtime reads here`, () => {
			const shared = boundControls(panel)
				.filter((c) => c.tag === "select" && c.attrs["data-global"] !== undefined)
				.map((c) => c.attrs["data-setting"]);
			assert.deepEqual(shared.sort(), Object.keys(RUNTIME).sort(), "a new shared select needs its runtime reading here");
		});

		for (const setting of Object.keys(RUNTIME)) {
			it(`${panel}: ${setting} stored blank shows the runtime's choice, not a kept value, and opening writes nothing`, async () => {
				for (const blank of BLANKS) {
					const m = await open(panel, { globals: { theme: "void", [setting]: blank } });
					const el = m.control(setting, true);
					const drawn = RUNTIME[setting](blank, el);
					assert.ok(
						el.options.some((o) => o.value === drawn && !o.hasAttribute("data-unknown")),
						`${setting} ${JSON.stringify(blank)}: the runtime's ${JSON.stringify(drawn)} is offered`
					);
					assert.equal(el.value, drawn, `${setting} ${JSON.stringify(blank)}: shows ${JSON.stringify(drawn)}, saw ${JSON.stringify(el.shown)}`);
					assert.deepEqual(
						kept(el).map((o) => o.textContent),
						[],
						`${setting} ${JSON.stringify(blank)}: no kept option`
					);
					assert.deepEqual([m.settingsWrites.length, m.globalWrites.length], [0, 0], `${setting} ${JSON.stringify(blank)}: opening writes nothing`);
					assert.equal(m.globalStore[setting], blank, "the stored blank is left as it was");
				}
			});
		}

		it(`${panel}: absent and null show the default; the runtime reads them the same way`, async () => {
			for (const globals of [{}, Object.fromEntries(Object.keys(RUNTIME).map((k) => [k, null]))]) {
				const m = await open(panel, { globals });
				for (const setting of Object.keys(RUNTIME)) {
					const el = m.control(setting, true);
					assert.equal(el.value, el.dataset.default, `${setting} ${JSON.stringify(globals[setting])}`);
					assert.equal(RUNTIME[setting](globals[setting], el), el.dataset.default, `${setting}: the runtime's default is the select's`);
					assert.deepEqual(kept(el), [], `${setting}: no kept option`);
				}
				assert.deepEqual([m.settingsWrites.length, m.globalWrites.length], [0, 0]);
			}
		});

		it(`${panel}: a value this version does not offer still shows as kept, and stays stored through another edit`, async () => {
			const m = await open(panel, { globals: { theme: "void", textMode: "neon-future", pollIntervalMs: "750" } });
			const text = m.control("textMode", true);
			assert.equal(text.shown, 'Stored value "neon-future" (not in this list, kept)');
			assert.deepEqual(
				kept(text).map((o) => [o.value, o.disabled]),
				[["neon-future", true]]
			);
			const poll = m.control("pollIntervalMs", true);
			assert.equal(poll.shown, 'Stored value "750" (not in this list, kept)');
			assert.deepEqual([m.settingsWrites.length, m.globalWrites.length], [0, 0], "opening writes nothing");
			pick(m.control("textFont", true), "segoe-ui");
			await m.settle();
			assert.equal(m.globalWrites.length, 1, "one shared write");
			assert.deepEqual(
				[m.globalWrites[0].textFont, m.globalWrites[0].textMode, m.globalWrites[0].pollIntervalMs],
				["segoe-ui", "neon-future", "750"],
				"the kept values ride along unchanged"
			);
		});

		it(`${panel}: a blank stays stored through another edit, and a pick replaces it`, async () => {
			const m = await open(panel, { globals: { theme: "void", textMode: "", pollIntervalMs: "" } });
			pick(m.control("textFont", true), "segoe-ui");
			await m.settle();
			assert.deepEqual([m.globalWrites.at(-1).textMode, m.globalWrites.at(-1).pollIntervalMs], ["", ""], "never rewritten by the panel");
			pick(m.control("textMode", true), "dim");
			await m.settle();
			assert.equal(m.globalWrites.at(-1).textMode, "dim");
			assert.equal(m.settingsWrites.length, 0, "the shared field never writes the key's or dial's own settings");
		});
	}
});

describe("a dial on a running strip keeps its shared fields shared", () => {
	const STRIP = () => {
		const sent = [];
		const field = (setting, value) => ({ value: () => value, set: (v) => sent.push([setting, v]) });
		// What pi-strip.js points at the strip while the dial draws part of
		// one: a strip with no text color of its own reads "" (Default).
		return { sent, targets: { textMode: field("textMode", ""), textColor: field("textColor", ""), textDimSecondary: field("textDimSecondary", false), dialBackground: field("dialBackground", ""), dialAccentWords: field("dialAccentWords", null), decimals: field("decimals", "auto"), fahrenheit: field("fahrenheit", false) } };
	};
	const GLOBALS = { theme: "ember", textMode: "custom", textColor: "#ffcc00", textDimSecondary: true, textFont: "tahoma", typeAccents: "off" };

	it("Shared defaults Text color and Dim labels show the shared settings, not the strip's", async () => {
		const m = await open("sensor-dial.html", { globals: GLOBALS });
		const strip = STRIP();
		m.shell().redirect(strip.targets);
		await m.settle();
		const shared = m.control("textMode", true);
		assert.equal(shared.value, "custom", `Shared defaults Text color shows ${JSON.stringify(shared.shown)}`);
		assert.deepEqual(kept(shared), [], "no kept option");
		assert.equal(m.control("textDimSecondary", true).checked, true, "the shared Dim labels box shows the shared value");
		// The dial's own Display fields show the strip's.
		assert.equal(m.control("textMode", false).value, "", "Display's Text color shows the strip's Default");
		assert.equal(m.control("textDimSecondary", false).checked, false);
		assert.deepEqual([m.settingsWrites.length, m.globalWrites.length, strip.sent.length], [0, 0, 0], "nothing written");
	});

	it("the owner's + XL: no shared text mode stored, the strip has none either", async () => {
		const m = await open("sensor-dial.html", { globals: { theme: "ember", textFont: "tahoma", typeAccents: "off", dialBackground: "nebula", keyBackground: "nebula" } });
		m.shell().redirect(STRIP().targets);
		await m.settle();
		const shared = m.control("textMode", true);
		assert.equal(shared.shown, "Theme text");
		assert.deepEqual(
			kept(shared).map((o) => o.textContent),
			[]
		);
	});

	it("a pick on Shared defaults Text color, or a toggle of its Dim labels box, saves the shared settings and never edits the strip", async () => {
		const m = await open("sensor-dial.html", { globals: GLOBALS });
		const strip = STRIP();
		m.shell().redirect(strip.targets);
		await m.settle();
		toggle(m.control("textDimSecondary", true), false);
		await m.settle();
		assert.deepEqual(strip.sent, [], "no strip edit");
		assert.equal(m.globalWrites.length, 1, "one shared write");
		assert.equal(m.globalWrites[0].textDimSecondary, false);
		pick(m.control("textMode", true), "dim");
		await m.settle();
		assert.deepEqual(strip.sent, [], "no strip edit");
		assert.equal(m.globalWrites.length, 2, "one more shared write");
		assert.equal(m.globalWrites[1].textMode, "dim");
		assert.equal(m.settingsWrites.length, 0, "the dial's own settings are untouched");
	});

	it("the dial's own Display Text color still edits the strip", async () => {
		const m = await open("sensor-dial.html", { globals: GLOBALS });
		const strip = STRIP();
		m.shell().redirect(strip.targets);
		await m.settle();
		pick(m.control("textMode", false), "dim");
		toggle(m.control("textDimSecondary", false), true);
		await m.settle();
		assert.deepEqual(strip.sent, [
			["textMode", "dim"],
			["textDimSecondary", true]
		]);
		assert.deepEqual([m.settingsWrites.length, m.globalWrites.length], [0, 0], "no settings or shared write");
	});
});
