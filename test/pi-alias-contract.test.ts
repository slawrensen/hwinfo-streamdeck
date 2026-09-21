/**
 * The property inspector's alias contract, proven through the PRODUCTION
 * panel: ui/pi-common.js is loaded in a node vm over a minimal fake DOM
 * and a fake SDPIComponents store, then fed the REAL sensorTree and
 * preview payloads that src/pi-protocol.ts builds over applyReadingLinks
 * snapshots. Whatever the runtime resolves through a confirmed link (a
 * saved Shared Memory key while the Gadget provider is live, and the
 * reverse) the editor must name, tick and color the same way, and it may
 * never rewrite a saved key to do so. The config document half drives
 * Copy and Apply through their own buttons on the same file, and the
 * identity table at the end runs the extracted bareKey, namedKey and
 * mapReadingKeys helpers verbatim over every whitespace edge a Gadget
 * label can carry.
 *
 * The fake DOM supports exactly the selectors and element behavior the two
 * settings panels use; it is not a browser, so nothing here speaks for
 * layout, focus timing or native drag. Those stay with the e2e PI harness.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import vm from "node:vm";

import { composeDialSvg, type DialRenderState } from "../src/actions/sensor-dial";
import { resolveDetailGroup } from "../src/detail/detail-group";
import { composeChunkFace } from "../src/detail/detail-faces";
import { detailTilesOf } from "../src/detail/detail-settings";
import { DetailNavigator, type DeviceDetailState } from "../src/detail/navigation";
import { applyReadingLinks, parseReadingLinks } from "../src/hwinfo/reading-links";
import { SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";
import { buildPreview, buildSensorTree } from "../src/pi-protocol";
import type { PollerStatus } from "../src/poller";
import { rotationReadings } from "../src/rotation";
import { SessionStatsStore } from "../src/stats";
import { applyGlobalThemeSettings } from "../src/ui/theme-store";
import { loadThemes } from "../src/ui/themes";
import { DIM_VALUE_BLEND, mixToward } from "../src/ui/text-colors";
import { contrast } from "./wcag";

/** A status with data: every fixture here is one. */
type OkStatus = Extract<PollerStatus, { state: "ok" }>;

const PI_PATH = new URL("../com.lawrensen.hwinfo.sdPlugin/ui/pi-common.js", import.meta.url);
const PI_SOURCE = readFileSync(PI_PATH, "utf8");

// ------------------------------------------------------------- fixtures
const SM = ["f0000501:0:1000000", "e0002000:0:1000000", "f7006687:0:3000001"] as const;
const G = ["g:Sample sensors:CPU Temp", "g:Sample sensors:GPU Temp", "g:Sample sensors:Pump"] as const;
const LABELS = ["CPU Temp", "GPU Temp", "Pump"] as const;
const LINKS = [
	{ sharedMemory: SM[0], gadget: G[0], unit: "°C", sensorType: SensorType.Temperature },
	{ sharedMemory: SM[1], gadget: G[1], unit: "°C", sensorType: SensorType.Temperature },
	{ sharedMemory: SM[2], gadget: G[2], unit: "RPM", sensorType: SensorType.Fan }
];
const NOT_PRESENT = "⚠ Sensor not present. Pick again";
const RESTING = "Search sensors…";

function sample(key: string, id: number, label: string, type: SensorType, unit: string, value: number, sensorIndex = 0): Reading {
	return { key, sensorIndex, id, label, type, unit, value, valueMin: value, valueMax: value, valueAvg: value, statistics: "unavailable" };
}

/** The snapshot as the Gadget provider publishes it: gadget keys only. */
function gadgetSnapshot(): SensorSnapshot {
	const readings = [sample(G[0], 1, LABELS[0], SensorType.Temperature, "°C", 71.4), sample(G[1], 2, LABELS[1], SensorType.Temperature, "°C", 76.2), sample(G[2], 3, LABELS[2], SensorType.Fan, "RPM", 2850)];
	return { pollTime: 1, valueRevision: 1, version: 2, revision: 0, sensors: [{ index: 0, id: 0x31, instance: 0, name: "Sample sensors" }], readings, byKey: new Map(readings.map((r) => [r.key, r])) };
}

/** The same snapshot with the confirmed links applied, as poller.tick does. */
function linkedStatus(links: readonly unknown[] = LINKS): OkStatus {
	return { state: "ok", source: "gadget", snapshot: applyReadingLinks(gadgetSnapshot(), parseReadingLinks(links), 1) };
}

const values = (svg: string): string[] => [...svg.matchAll(/font-weight="700" fill="([^"]+)">[^<]+<\/text>/g)].map((m) => m[1]!);
const OVERVIEW = { dialView: "overview", theme: "void", textMode: "theme", overviewLabels: "full" };
function dialState(settings: Record<string, unknown>): DialRenderState {
	return { settings: settings as DialRenderState["settings"], stats: new SessionStatsStore(), statMode: "current", overlay: null, pinned: false, cyclePaused: false };
}
const paint = (settings: Record<string, unknown>, status: OkStatus): string[] => values(composeDialSvg(dialState(settings), status, () => []));
/** Settings objects come back from the vm realm; compare by value. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// ------------------------------------------------------------- fake DOM
type FakeEvent = Record<string, unknown> & { type: string; target: FakeElement };
type Listener = (ev: FakeEvent) => void;

class FakeClassList {
	constructor(private readonly el: FakeElement) {}
	private read(): Set<string> {
		return new Set(this.el.className.split(/\s+/).filter(Boolean));
	}
	private write(set: Set<string>): void {
		this.el.className = [...set].join(" ");
	}
	add(...names: string[]): void {
		const s = this.read();
		for (const n of names) s.add(n);
		this.write(s);
	}
	remove(...names: string[]): void {
		const s = this.read();
		for (const n of names) s.delete(n);
		this.write(s);
	}
	contains(name: string): boolean {
		return this.read().has(name);
	}
	toggle(name: string, force?: boolean): boolean {
		const s = this.read();
		const on = force ?? !s.has(name);
		if (on) s.add(name);
		else s.delete(name);
		this.write(s);
		return on;
	}
}

class FakeElement {
	readonly tagName: string;
	id = "";
	className = "";
	hidden = false;
	textContent = "";
	value = "";
	placeholder = "";
	title = "";
	type = "";
	disabled = false;
	checked = false;
	tabIndex = -1;
	innerHTML = "";
	htmlFor = "";
	draggable = false;
	spellcheck = true;
	dataset: Record<string, string> = {};
	style: Record<string, string> = {};
	attrs: Record<string, string> = {};
	children: FakeElement[] = [];
	parent: FakeElement | null = null;
	listeners: Record<string, Listener[]> = {};
	readonly classList = new FakeClassList(this);
	constructor(
		tagName: string,
		private readonly doc: FakeDocument
	) {
		this.tagName = tagName.toUpperCase();
	}
	get shadowRoot(): null {
		return null;
	}
	addEventListener(type: string, fn: Listener): void {
		(this.listeners[type] ??= []).push(fn);
	}
	removeEventListener(): void {}
	fire(type: string, extra: Record<string, unknown> = {}): void {
		for (const fn of [...(this.listeners[type] ?? [])]) {
			fn({ type, target: this, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}, composedPath: () => this.path(), ...extra });
		}
	}
	path(): FakeElement[] {
		return ancestors(this);
	}
	appendChild(child: FakeElement): FakeElement {
		if (child.tagName === "#FRAGMENT") {
			for (const c of [...child.children]) this.appendChild(c);
			child.children = [];
			return child;
		}
		child.parent?.removeChild(child);
		child.parent = this;
		this.children.push(child);
		return child;
	}
	append(...nodes: FakeElement[]): void {
		for (const n of nodes) this.appendChild(n);
	}
	removeChild(child: FakeElement): void {
		this.children = this.children.filter((c) => c !== child);
		child.parent = null;
	}
	replaceChildren(...nodes: FakeElement[]): void {
		for (const c of this.children) c.parent = null;
		this.children = [];
		this.append(...nodes);
	}
	replaceWith(node: FakeElement): void {
		const p = this.parent;
		if (p === null) return;
		const i = p.children.indexOf(this);
		p.children[i] = node;
		node.parent = p;
		this.parent = null;
	}
	contains(node: unknown): boolean {
		let n = node as FakeElement | null;
		while (n !== null) {
			if (n === this) return true;
			n = n.parent;
		}
		return false;
	}
	closest(selector: string): FakeElement | null {
		return ancestors(this).find((n) => matches(n, selector)) ?? null;
	}
	querySelector(selector: string): FakeElement | null {
		return this.querySelectorAll(selector)[0] ?? null;
	}
	querySelectorAll(selector: string): FakeElement[] {
		const out: FakeElement[] = [];
		const walk = (n: FakeElement): void => {
			for (const c of n.children) {
				if (matches(c, selector)) out.push(c);
				walk(c);
			}
		};
		walk(this);
		return out;
	}
	setAttribute(k: string, v: unknown): void {
		this.attrs[k] = String(v);
		if (k === "placeholder") this.placeholder = String(v);
	}
	getAttribute(k: string): string | null {
		return this.attrs[k] ?? null;
	}
	focus(): void {
		this.doc.activeElement = this;
	}
	blur(): void {
		if (this.doc.activeElement === this) this.doc.activeElement = this.doc.body;
	}
	select(): void {}
	scrollIntoView(): void {}
	click(): void {
		this.fire("click");
	}
	dispatchEvent(ev: { type: string }): boolean {
		this.fire(ev.type, ev as unknown as Record<string, unknown>);
		return true;
	}
	getBoundingClientRect(): Record<string, number> {
		return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
	}
}

/** The element and its parents, nearest first (composedPath order). */
function ancestors(el: FakeElement): FakeElement[] {
	const out: FakeElement[] = [];
	for (let n: FakeElement | null = el; n !== null; n = n.parent) out.push(n);
	return out;
}

/** A CSS subset: tag, .class, #id, [attr], [attr=value] (data-* through
 * dataset, else an attribute, else the property) and :not(simple). */
function matches(el: FakeElement, selectorList: string): boolean {
	return selectorList.split(",").some((selector) => {
		let s = selector.trim();
		for (const [whole, inner] of s.matchAll(/:not\(([^)]*)\)/g)) {
			if (matches(el, inner!)) return false;
			s = s.replace(whole, "");
		}
		const tag = /^[a-z][a-z0-9-]*/i.exec(s)?.[0];
		if (tag !== undefined && tag.toUpperCase() !== el.tagName) return false;
		for (const [, cls] of s.matchAll(/\.([A-Za-z0-9_-]+)/g)) if (!el.classList.contains(cls!)) return false;
		for (const [, id] of s.matchAll(/#([A-Za-z0-9_-]+)/g)) if (el.id !== id) return false;
		for (const [, name, , , val] of s.matchAll(/\[([a-z-]+)(=("?)([^\]"]*)"?)?\]/g)) {
			const actual = name!.startsWith("data-") ? el.dataset[name!.slice(5)] : (el.attrs[name!] ?? (el as unknown as Record<string, unknown>)[name!]);
			if (val === undefined ? actual === undefined || actual === false : String(actual) !== val) return false;
		}
		return true;
	});
}

class FakeDocument {
	readonly body: FakeElement;
	activeElement: FakeElement;
	private readonly elements = new Map<string, FakeElement>();
	constructor(readonly title: string) {
		this.body = new FakeElement("body", this);
		this.activeElement = this.body;
	}
	getElementById(id: string): FakeElement | null {
		return this.elements.get(id) ?? null;
	}
	createElement(tag: string): FakeElement {
		return new FakeElement(tag, this);
	}
	createDocumentFragment(): FakeElement {
		return new FakeElement("#fragment", this);
	}
	querySelector(selector: string): FakeElement | null {
		return this.body.querySelector(selector);
	}
	querySelectorAll(selector: string): FakeElement[] {
		return this.body.querySelectorAll(selector);
	}
	addEventListener(): void {}
	execCommand(): boolean {
		return true;
	}
	/** An element with an id, parented under `parent` (the body by default). */
	make(id: string, tag = "div", parent: FakeElement = this.body): FakeElement {
		const el = new FakeElement(tag, this);
		el.id = id;
		this.elements.set(id, el);
		parent.appendChild(el);
		return el;
	}
}

// ------------------------------------------------------ mounted panel
type Write = { name: string; value: unknown };
type Mounted = {
	doc: FakeDocument;
	store: Record<string, unknown>;
	writes: Write[];
	sent: { event: string; payload: unknown }[];
	/** Every whole document Apply pushed through setSettings. */
	applied: unknown[];
	clipboard: { text: string };
	el(id: string): FakeElement;
	feed(payload: unknown): void;
	/** Runs every followSetting poll once and lets timers and microtasks settle. */
	flush(): Promise<void>;
	/** Simulates the app echoing didReceiveSettings for one field. */
	echo(name: string, value: unknown): void;
	/** The last write of one field, by value. */
	lastWrite(name: string): unknown;
};

const SHARED_IDS = ["preview-value", "preview-stats", "status-hint", "theme-gallery", "picker-list", "picker-refresh", "config-key", "config-deck", "config-note", "config-key-copy", "config-key-apply", "config-deck-copy", "config-deck-apply"];
const DIAL_IDS = ["rotation-set", "rotation-help", "reading-color-list", "overview-rows", "sensor-value-colors"];
const READING_IDS = ["detail-config", "detail-custom", "detail-filter", "detail-list", "detail-filter-count", "pickerd-list", "show-help", "press-block", "role-note", "detail-unsupported"];

/** Loads the production panel over a fresh DOM, store and socket. */
function mountPanel(shape: "dial" | "reading", seed: Record<string, unknown>, globalSeed: Record<string, unknown> = {}, replies?: { settings?: () => Promise<Record<string, unknown>>; globals?: () => Promise<Record<string, unknown>>; textControls?: boolean }): Mounted {
	const doc = new FakeDocument(shape === "dial" ? "Sensor Dial settings" : "Sensor Reading settings");
	for (const id of [...SHARED_IDS, ...(shape === "dial" ? DIAL_IDS : READING_IDS)]) doc.make(id, id.endsWith("-copy") || id.endsWith("-apply") ? "button" : id.startsWith("config-") && !id.endsWith("-note") ? "textarea" : "div");
	const pickerWrap = doc.createElement("div");
	pickerWrap.className = "hw-picker";
	doc.body.appendChild(pickerWrap);
	doc.make("picker-search", "input", pickerWrap);
	if (replies?.textControls) {
		doc.make("text-custom", "div");
		doc.make("text-color", "input");
	}
	if (shape === "dial") {
		doc.make("reading-color-preset", "select").value = "automatic";
	} else {
		const collectorWrap = doc.createElement("div");
		collectorWrap.className = "hw-picker";
		doc.body.appendChild(collectorWrap);
		doc.make("pickerd-search", "input", collectorWrap);
	}

	const store: Record<string, unknown> = { ...seed };
	const globalStore: Record<string, unknown> = { ...globalSeed };
	const subs = new Map<string, ((v: unknown) => void)[]>();
	const writes: Write[] = [];
	const applied: unknown[] = [];
	const sent: { event: string; payload: unknown }[] = [];
	const clipboard = { text: "" };
	const useStore = (target: Record<string, unknown>) => (name: string, cb?: (v: unknown) => void) => {
		if (cb !== undefined) (subs.get(name) ?? subs.set(name, []).get(name)!).push(cb);
		return [
			() => Promise.resolve(target[name]),
			(v: unknown) => {
				target[name] = v;
				writes.push({ name, value: plain(v) });
			}
		];
	};
	let piSubscriber: ((ev: { payload: unknown }) => void) | null = null;
	const SDPIComponents = {
		useSettings: useStore(store),
		useGlobalSettings: useStore(globalStore),
		streamDeckClient: {
			send: (event: string, payload: unknown) => sent.push({ event, payload }),
			sendToPropertyInspector: {
				subscribe: (cb: (ev: { payload: unknown }) => void) => {
					piSubscriber = cb;
				}
			},
			getSettings: async () => ({ settings: replies?.settings === undefined ? store : await replies.settings() }),
			getGlobalSettings: async () => replies?.globals === undefined ? globalStore : await replies.globals(),
			setSettings: (docValue: unknown) => {
				applied.push(plain(docValue));
			},
			setGlobalSettings: () => {}
		}
	};
	const intervals: (() => void)[] = [];
	const sandbox: Record<string, unknown> = {
		document: doc,
		console: { log() {}, warn() {}, error() {} },
		SDPIComponents,
		setTimeout,
		clearTimeout,
		queueMicrotask,
		setInterval: (fn: () => void) => {
			intervals.push(fn);
			return intervals.length;
		},
		clearInterval() {},
		Event,
		HTMLInputElement: FakeElement,
		Element: FakeElement,
		Node: FakeElement,
		navigator: {
			clipboard: {
				writeText: async (text: string) => {
					clipboard.text = text;
				}
			}
		},
		performance,
		location: { reload() {} },
		addEventListener() {}
	};
	sandbox.window = sandbox;
	vm.runInNewContext(PI_SOURCE, sandbox, { filename: "pi-common.js" });
	return {
		doc,
		store,
		writes,
		sent,
		applied,
		clipboard,
		el: (id) => {
			const found = doc.getElementById(id);
			assert.ok(found !== null, `#${id} exists`);
			return found;
		},
		feed: (payload) => {
			assert.ok(piSubscriber !== null, "the panel subscribed to sendToPropertyInspector");
			piSubscriber({ payload });
		},
		flush: async () => {
			for (const fn of intervals) fn();
			await new Promise((resolve) => setTimeout(resolve, 20));
		},
		echo: (name, value) => {
			store[name] = value;
			for (const cb of subs.get(name) ?? []) cb(value);
		},
		lastWrite: (name) => writes.filter((w) => w.name === name).at(-1)?.value
	};
}

/** Mounts, settles, and feeds the real tree and preview for `status`. */
async function openPanel(shape: "dial" | "reading", seed: Record<string, unknown>, status: OkStatus, globalSeed: Record<string, unknown> = {}): Promise<Mounted> {
	const m = mountPanel(shape, seed, globalSeed);
	await m.flush();
	assert.ok(m.sent.some((msg) => (msg.payload as { event?: string }).event === "getSensorTree"), "the panel asked for the tree");
	m.feed(buildSensorTree(status));
	m.feed(buildPreview(status, m.store as { readingKey?: string }, false));
	await m.flush();
	return m;
}

const chips = (m: Mounted, list = "rotation-set"): FakeElement[] => m.el(list).querySelectorAll(".hw-set-chip");
const chipNames = (m: Mounted, list = "rotation-set"): string[] => chips(m, list).map((c) => c.querySelector(".hw-set-name")!.textContent);
const pickerRows = (m: Mounted, list = "picker-list"): FakeElement[] => m.el(list).querySelectorAll(".hw-row");
const tickOf = (row: FakeElement): FakeElement => {
	const tick = row.querySelector(".hw-tick");
	assert.ok(tick !== null, `${row.dataset.key} has a membership tick`);
	return tick;
};
type ColorRow = { key: string; name: string; well: FakeElement; auto: FakeElement };
const colorRows = (m: Mounted): ColorRow[] => m.el("reading-color-list").children.map((row) => ({ key: row.children[0]!.dataset.key!, name: row.children[1]!.textContent, well: row.children[0]!, auto: row.children[2]! }));
const colorRow = (m: Mounted, key: string): ColorRow => {
	const row = colorRows(m).find((r) => r.key === key);
	assert.ok(row !== undefined, `a color row for ${key}`);
	return row;
};
/** Clicks the tick of one picker row as the browser would: the box has
 * already flipped to `checked` when the delegated click handler runs. */
const clickTick = (m: Mounted, key: string, checked: boolean, list = "picker-list"): void => {
	const row = pickerRows(m, list).find((r) => r.dataset.key === key);
	assert.ok(row !== undefined, `picker row ${key}`);
	const tick = tickOf(row);
	tick.checked = checked;
	m.el(list).fire("click", { target: tick });
};
const choosePreset = (m: Mounted, preset: string): void => {
	const select = m.el("reading-color-preset");
	select.value = preset;
	select.fire("change");
};
const copiedDocument = async (m: Mounted): Promise<Record<string, unknown>> => {
	m.el("config-key-copy").fire("click");
	await m.flush();
	return JSON.parse(m.el("config-key").value) as Record<string, unknown>;
};
const applyDocument = async (m: Mounted, docValue: Record<string, unknown>): Promise<Record<string, unknown>> => {
	const well = m.el("config-key");
	well.value = JSON.stringify(docValue);
	well.fire("input");
	const before = m.applied.length;
	m.el("config-key-apply").fire("click");
	await m.flush();
	assert.equal(m.applied.length, before + 1, "Apply pushed exactly one document");
	return m.applied.at(-1) as Record<string, unknown>;
};

applyGlobalThemeSettings({ theme: "void", typeAccents: "off", textMode: "theme" });

describe("remaining PI review regressions", () => {
	it("prototype-named theme settings keep the gallery and custom color seed usable", async () => {
		const m = mountPanel("dial", { readingKey: SM[0] }, {}, { textControls: true });
		await m.flush();
		m.echo("theme", "__proto__");
		m.feed({ event: "themes", ...loadThemes(), effectiveDeckTheme: "constructor" });
		await m.flush();
		assert.equal(m.el("text-color").value, loadThemes().themes.void!.value.toLowerCase());
		assert.equal(m.el("theme-gallery").children[0]!.title, "Deck default · Void");
		assert.equal(m.writes.length, 0);
	});

	it("real preview-only loss and recovery request a fresh sensor tree", async () => {
		const status = linkedStatus();
		const m = await openPanel("dial", { readingKey: SM[0] }, status);
		const before = m.sent.length;
		m.feed(buildPreview({ ...status, state: "stale", staleForMs: 16_000 }, { readingKey: SM[0] }, false));
		m.feed(buildPreview({ state: "unavailable", reason: "not-running", message: "Stopped" }, { readingKey: SM[0] }, false));
		m.feed(buildPreview(status, { readingKey: SM[0] }, false));
		assert.equal(m.sent.length, before + 1, "production tick sends previews, not unsolicited sensor trees");
		m.feed(buildPreview(status, { readingKey: SM[0] }, false));
		assert.equal(m.sent.length, before + 1, "one request stays in flight until its reply");
		assert.equal(m.writes.length, 0);
	});

	it("an ok preview from a changed provider refreshes the tree once", async () => {
		const status = linkedStatus();
		const m = await openPanel("dial", { readingKey: SM[0] }, status);
		const before = m.sent.length;
		const recovered = { ...status, source: "shared-memory" as const };
		m.feed(buildPreview(recovered, { readingKey: SM[0] }, false));
		m.feed(buildPreview(recovered, { readingKey: SM[0] }, false));
		assert.equal(m.sent.length, before + 1);
		m.feed(buildSensorTree(recovered));
		m.feed(buildPreview(recovered, { readingKey: SM[0] }, false));
		assert.equal(m.sent.length, before + 1);
		assert.equal(m.writes.length, 0);
	});

	it("the config document preserves an unknown own __proto__ field", async () => {
		const seed = JSON.parse('{"readingKey":"cpu:0:0","__proto__":{"future":"value"}}') as Record<string, unknown>;
		const m = mountPanel("dial", seed);
		await m.flush();
		const copied = await copiedDocument(m);
		assert.deepEqual(copied, seed);
		assert.deepEqual(await applyDocument(m, copied), seed);
	});

	for (const scope of ["key", "deck"] as const) {
		it(`a delayed ${scope} config read cannot overwrite a draft typed while waiting`, async () => {
			let answer: (value: Record<string, unknown>) => void = () => {};
			const reply = new Promise<Record<string, unknown>>((resolve) => { answer = resolve; });
			const m = mountPanel("dial", {}, {}, scope === "key" ? { settings: () => reply } : { globals: () => reply });
			await m.flush();
			m.el(`config-${scope}-copy`).fire("click");
			const well = m.el(`config-${scope}`);
			const draft = '{"readingLinks": [{"draft": true}]}';
			well.value = draft;
			well.fire("input");
			answer({ old: "saved" });
			await m.flush();
			assert.equal(well.value, draft);
			assert.equal(m.clipboard.text, draft);
			assert.equal(m.writes.length, 0);
		});

		it(`out-of-order ${scope} config reads keep the newest reply`, async () => {
			const answers: ((value: Record<string, unknown>) => void)[] = [];
			const read = (): Promise<Record<string, unknown>> => new Promise((resolve) => { answers.push(resolve); });
			const m = mountPanel("dial", {}, {}, scope === "key" ? { settings: read } : { globals: read });
			await m.flush();
			m.el(`config-${scope}-copy`).fire("click");
			m.el(`config-${scope}-copy`).fire("click");
			assert.equal(answers.length, 2);
			answers[1]!({ newest: true });
			await m.flush();
			answers[0]!({ old: true });
			await m.flush();
			assert.deepEqual(JSON.parse(m.el(`config-${scope}`).value), { newest: true });
			assert.deepEqual(JSON.parse(m.clipboard.text), { newest: true });
			assert.equal(m.writes.length, 0);
		});
	}

	it("a stale snapshot retains missing cues, unavailable clears them, and recovery requests a fresh tree", async () => {
		const status = linkedStatus();
		const m = await openPanel("dial", { readingKey: "gone:0:1", rotationKeys: ["gone:0:1"] }, status);
		const stale: PollerStatus = { ...status, state: "stale", staleForMs: 16_000 };
		m.feed(buildSensorTree(stale));
		m.feed(buildPreview(stale, { readingKey: "gone:0:1" }, false));
		assert.equal(m.el("preview-value").textContent, "sensor missing");
		assert.equal(m.el("picker-search").placeholder, NOT_PRESENT);
		assert.ok(chips(m)[0]!.classList.contains("missing"));
		const before = m.sent.length;
		m.feed(buildPreview(status, { readingKey: "gone:0:1" }, false));
		assert.equal(m.sent.length, before + 1, "ok after stale still requests a fresh tree");
		m.feed({ event: "sensorTree", state: "unavailable", groups: [], hint: "Down" });
		assert.equal(m.el("picker-search").placeholder, RESTING);
		assert.ok(!chips(m)[0]!.classList.contains("missing"));
		assert.equal(m.writes.length, 0);
	});

	it("linked duplicate cells cannot lend their label to the next tile, in the panel or an open detail session", async () => {
		const status = linkedStatus();
		const seed = { readingKey: SM[0], detailMode: "custom", detailKeys: [SM[1], G[1], SM[2]], detailTiles: [{ size: 1, labels: ["GPU"] }, { size: 1, labels: ["DUPLICATE"] }, { size: 1, labels: ["PUMP"] }] };
		const original = JSON.stringify(seed);
		const nav = new DetailNavigator({ switchProfile: async () => {} });
		assert.equal(await nav.enter({ deviceId: "review", deviceType: 0, settings: seed, snapshot: status.snapshot }), "entered");
		assert.deepEqual(nav.pageFor(nav.stateFor("review")!).specs.slice(0, 2).map((s) => s?.labels), [["GPU"], ["PUMP"]]);
		const m = await openPanel("reading", seed, status);
		assert.deepEqual(chipNames(m, "detail-list"), ["GPU", "PUMP"]);
		assert.equal(m.writes.length, 0);
		assert.equal(JSON.stringify(seed), original);
		nav.shutdown();
	});

	it("unlinking before an edit restores source cells and styles without writing settings", async () => {
		const status = linkedStatus();
		const seed = { readingKey: SM[0], detailMode: "custom", detailKeys: [G[0], SM[1], G[1], SM[2], "gone:0:1"], detailTiles: [{ size: 4, labels: ["GPU", "DUPLICATE", "PUMP", "MISSING"], colors: ["#AAAA11", "#FF0000", "#00FF00", "#0000FF"], automaticColors: [true, false, false, true], cellLabels: false }] };
		const m = await openPanel("reading", seed, status);
		const nav = new DetailNavigator({ switchProfile: async () => {} });
		await nav.enter({ deviceId: "review", deviceType: 0, settings: seed, snapshot: status.snapshot });
		const projected = nav.pageFor(nav.stateFor("review")!);
		assert.deepEqual(projected.chunks[0], [SM[1], SM[2], "gone:0:1"]);
		assert.deepEqual(projected.specs[0], { size: 3, labels: ["GPU", "PUMP", "MISSING"], colors: ["#AAAA11", "#00FF00", "#0000FF"], automaticColors: [true, false, true], cellLabels: false });
		assert.deepEqual(chipNames(m, "detail-list"), ["CPU Temp (Back tile)", "GPU", "PUMP", "MISSING"]);
		for (let i = 0; i < 3; i++) m.feed(buildSensorTree(status));
		m.echo("detailDensity", "2");
		m.echo("readingKey", G[0]); // the same primary via its other endpoint
		await m.flush();
		assert.equal(m.writes.length, 0, "tree and unrelated setting adoption never commits the projection");
		const unlinked = linkedStatus([]);
		m.feed(buildSensorTree(unlinked));
		nav.refresh("review", unlinked.snapshot);
		assert.deepEqual(chipNames(m, "detail-list").slice(1), ["GPU", "DUPLICATE", "PUMP", "MISSING"]);
		// Navigation retains its own raw primary, so an unlink makes the
		// Gadget primary a listed reading again, just as before projection.
		assert.deepEqual(nav.pageFor(nav.stateFor("review")!).specs[0], detailTilesOf(seed)[0]);
		assert.deepEqual(plain(m.store.detailTiles), seed.detailTiles);
		assert.deepEqual(plain(m.store.detailKeys), seed.detailKeys);
		assert.equal(m.writes.length, 0);
		nav.shutdown();
	});

	it("editing a survivor after projection commits one visible layout and unlink cannot resurrect hidden cells", async () => {
		const status = linkedStatus();
		const seed = { readingKey: SM[0], detailMode: "custom", detailKeys: [SM[1], G[1], SM[2]], detailTiles: [{ size: 1, labels: ["GPU"] }, { size: 1, labels: ["DUPLICATE"] }, { size: 1, labels: ["PUMP"] }] };
		const m = await openPanel("reading", seed, status);
		assert.ok(m.el("detail-list").querySelectorAll(".hw-set-note").some((n) => n.textContent.includes("Editing this list saves the shown layout")));
		const pump = chips(m, "detail-list").find((c) => c.dataset.key === SM[2])!;
		m.el("detail-list").fire("click", { target: pump.querySelector('.hw-detail-move[data-move="-1"]')! });
		assert.deepEqual(plain(m.store.detailKeys), [SM[2], SM[1]]);
		assert.deepEqual(detailTilesOf(m.store).map((s) => s.labels), [["PUMP"], ["GPU"]]);
		assert.equal(m.writes.filter((w) => w.name === "detailKeys").length, 1);
		m.feed(buildSensorTree(linkedStatus([])));
		assert.deepEqual(chipNames(m, "detail-list"), ["PUMP", "GPU"]);
		const remove = chips(m, "detail-list")[0]!.querySelector(".hw-set-remove")!;
		m.el("detail-list").fire("click", { target: remove });
		assert.deepEqual(plain(m.store.detailKeys), [SM[1]]);
		assert.deepEqual(detailTilesOf(m.store).map((s) => s.labels), [["GPU"]]);
	});

	it("a link update during a rename still edits the same saved reading", async () => {
		const seed = { readingKey: SM[0], detailMode: "custom", detailKeys: [SM[1], G[1], SM[2]], detailTiles: [{ size: 1, labels: ["GPU"] }, { size: 1, labels: ["DUPLICATE"] }, { size: 1, labels: ["PUMP"] }] };
		const m = await openPanel("reading", seed, linkedStatus([]));
		const pump = chips(m, "detail-list").find((c) => c.dataset.key === SM[2])!;
		m.el("detail-list").fire("click", { target: pump.querySelector(".hw-set-name")! });
		const input = m.el("detail-list").querySelector(".hw-cell-rename")!;
		input.value = "COOLANT";
		m.feed(buildSensorTree(linkedStatus()));
		m.el("detail-list").fire("change", { target: input });
		assert.deepEqual(detailTilesOf(m.store).map((s) => s.labels), [["GPU"], ["COOLANT"]]);
		assert.deepEqual(plain(m.store.detailKeys), [SM[1], SM[2]]);
	});

	for (const gesture of ["held size press", "whole tile drag"] as const) {
		it(`a link projection safely cancels an obsolete ${gesture}`, async () => {
			const seed = { readingKey: SM[0], detailMode: "custom", detailKeys: [SM[1], G[1], SM[2], "gone:0:1"], detailTiles: [{ size: 1, labels: ["GPU"] }, { size: 1, labels: ["DUPLICATE"] }, { size: 1, labels: ["PUMP"] }, { size: 1, labels: ["OTHER"] }] };
			const m = await openPanel("reading", seed, linkedStatus([]));
			const holder = chips(m, "detail-list").find((c) => c.dataset.key === SM[2])!.closest(".hw-tile")!;
			const button = holder.querySelector(".hw-tile-size")!;
			const data = new Map<string, string>();
			const dataTransfer = { setData: (type: string, value: string) => data.set(type, value), getData: (type: string) => data.get(type) ?? "", effectAllowed: "", dropEffect: "" };
			if (gesture === "held size press") m.el("detail-list").fire("mousedown", { target: button });
			else holder.querySelector(".hw-tile-grip")!.fire("dragstart", { dataTransfer });
			m.feed(buildSensorTree(linkedStatus()));
			if (gesture === "held size press") m.el("detail-list").fire("click", { target: button });
			else chips(m, "detail-list")[0]!.closest(".hw-tile")!.fire("drop", { dataTransfer, clientX: -1 });
			assert.equal(m.writes.length, 0, "an obsolete index cannot resize or move its new occupant");
			assert.deepEqual(plain(m.store.detailKeys), seed.detailKeys);
		});
	}
});

describe("detail colors retain automatic provenance through the production panel", () => {
	const readings = Array.from({ length: 9 }, (_, i) => sample(`tile:0:${i}`, i, `Reading ${i}`, SensorType.Voltage, "V", i + 1));
	const snapshot: SensorSnapshot = { pollTime: 1, version: 2, revision: 0, sensors: [{ index: 0, id: 1, instance: 0, name: "Tile fixture" }], readings, byKey: new Map(readings.map((r) => [r.key, r])) };
	const status: OkStatus = { state: "ok", source: "shared-memory", snapshot };
	const keys = readings.slice(1, 5).map((r) => r.key);
	const seed = { readingKey: readings[0]!.key, detailKeys: keys, detailMode: "custom", detailDensity: "4", detailTiles: [{ size: 4, cellLabels: false }] };
	const config = loadThemes();
	const colors = (m: Mounted, theme: string, mode: "theme" | "dim"): Map<string, string> => {
		const svg = composeChunkFace({ presentation: { theme } } as DeviceDetailState, m.store.detailKeys as string[], "current", status, {
			config, deckThemeId: theme, typeAccents: false,
			measure: { decimals: "auto", fahrenheit: false, dataUnits: "decimal" },
			text: { mode, color: undefined, dimSecondary: false }
		}, detailTilesOf(m.store)[0]);
		return new Map([...svg.matchAll(/font-weight="700" fill="([^"]+)">([^<]+)<\/text>/g)].map((match) => [match[2]!, match[1]!]));
	};
	function clickChip(m: Mounted, key: string, selector: string): void {
		const chip = chips(m, "detail-list").find((c) => c.dataset.key === key);
		const control = chip?.querySelector(selector);
		assert.ok(control, `${key} has ${selector}`);
		m.el("detail-list").fire("click", { target: control });
	}
	for (const mode of ["theme", "dim"] as const) {
		it(`${mode}: an ordinary move preserves each automatic number color on Paper and after a theme change`, async () => {
			const m = await openPanel("reading", seed, status);
			const before = colors(m, "paper", mode);
			const darkBefore = colors(m, "void", mode);
			clickChip(m, keys[0]!, '.hw-detail-move[data-move="1"]');
			assert.deepEqual(plain(m.store.detailKeys), [keys[1], keys[0], keys[2], keys[3]]);
			assert.deepEqual(colors(m, "paper", mode), before, "moving cannot turn an automatic color into a chosen color");
			assert.deepEqual(colors(m, "void", mode), darkBefore, "the same hue follows the reading on another theme");
			for (const color of colors(m, "paper", mode).values()) assert.ok(contrast(color, config.themes.paper!.bg) >= 4.5);
			const reopened = await openPanel("reading", plain(m.store), status);
			assert.deepEqual(colors(reopened, "paper", mode), before, "saved provenance survives panel reload");
		});
	}

	it("a chosen color equal to the slot default survives pruning and a later automatic move", async () => {
		const m = await openPanel("reading", { ...seed, detailTiles: [{ size: 4, colors: ["#4CC2FF", null, null, null] }] }, status);
		const first = chips(m, "detail-list")[0]!;
		const well = first.querySelector(".hw-tile-color")!;
		well.value = "#4CC2FF";
		well.fire("change");
		assert.equal(detailTilesOf(m.store)[0]?.colors[0], "#4CC2FF", "a chosen default hue is not equivalent to automatic");
		clickChip(m, keys[0]!, '.hw-detail-move[data-move="1"]');
		assert.equal(detailTilesOf(m.store)[0]?.colors[1], "#4CC2FF");
	});

	it("removing a quad cell and growing the tile retains an already carried automatic hue and labels", async () => {
		const m = await openPanel("reading", { ...seed, detailTiles: [{ size: 4, cellLabels: false, labels: ["A", "B", "C", "D"] }] }, status);
		clickChip(m, keys[0]!, '.hw-detail-move[data-move="1"]');
		const before = colors(m, "paper", "theme");
		clickChip(m, keys[0]!, ".hw-set-remove");
		assert.deepEqual(detailTilesOf(m.store)[0]?.labels, ["B", "C", "D"]);
		const arm = m.el("detail-list").querySelector('.hw-add[data-arm="0"]');
		assert.ok(arm);
		m.el("detail-list").fire("click", { target: arm });
		m.el("pickerd-search").fire("focus");
		clickTick(m, readings[5]!.key, true, "pickerd-list");
		const after = colors(m, "paper", "theme");
		assert.equal(after.get("3.00"), before.get("3.00"), "the previously moved hue keeps its automatic correction");
		assert.deepEqual(detailTilesOf(m.store)[0]?.automaticColors, [true, false, false, false]);
	});

	it("returning automatic hues to their original cells prunes a redundant plan", async () => {
		const m = await openPanel("reading", { ...seed, detailTiles: [] }, status);
		clickChip(m, keys[0]!, '.hw-detail-move[data-move="1"]');
		assert.ok(detailTilesOf(m.store).length > 0);
		clickChip(m, keys[0]!, '.hw-detail-move[data-move="-1"]');
		assert.deepEqual(plain(m.store.detailTiles), []);
	});

	it("choosing a carried hue clears its automatic flag and keeps exact Theme and blended Dim colors", async () => {
		const m = await openPanel("reading", seed, status);
		clickChip(m, keys[0]!, '.hw-detail-move[data-move="1"]');
		const well = chips(m, "detail-list").find((c) => c.dataset.key === keys[0])!.querySelector(".hw-tile-color")!;
		well.value = "#4CC2FF";
		well.fire("change");
		assert.equal(detailTilesOf(m.store)[0]?.automaticColors?.[1], false);
		assert.equal(colors(m, "paper", "theme").get("2.00"), "#4CC2FF");
		assert.equal(colors(m, "paper", "dim").get("2.00"), mixToward("#4CC2FF", config.themes.paper!.bg, DIM_VALUE_BLEND));
		clickChip(m, keys[0]!, '.hw-detail-move[data-move="-1"]');
		assert.equal(colors(m, "paper", "theme").get("2.00"), "#4CC2FF", "chosen semantics also survive another move");
	});

	it("an automatic hue never freezes an implicit partial tail or ghost into the plan", async () => {
		const m = await openPanel("reading", { ...seed, detailKeys: readings.slice(1, 7).map((r) => r.key) }, status);
		clickChip(m, keys[3]!, '.hw-detail-move[data-move="1"]');
		assert.equal(detailTilesOf(m.store).length, 1, "the partial tail remains uniform fill");
		m.echo("detailDensity", "1");
		await m.flush();
		assert.deepEqual(m.el("detail-list").querySelectorAll(".hw-tile:not(.ghost)").map((tile) => tile.querySelectorAll(".hw-set-chip").length), [4, 1, 1]);
		const g = await openPanel("reading", seed, status);
		const ghost = g.el("detail-list").querySelector(".hw-tile.ghost");
		assert.ok(ghost);
		ghost.fire("drop", { dataTransfer: { getData: () => keys[0] } });
		assert.equal(detailTilesOf(g.store).length, 1, "auto-only ghost leaver does not create its own tile");
		assert.equal(detailTilesOf(g.store)[0]?.size, 3);
	});

	it("shrinking untouched automatic cells back to the uniform density still prunes the plan", async () => {
		const m = await openPanel("reading", { ...seed, detailDensity: "3", detailKeys: readings.slice(1, 7).map((r) => r.key), detailTiles: [{ size: 4 }] }, status);
		clickChip(m, keys[0]!, ".hw-set-remove");
		assert.deepEqual(plain(m.store.detailTiles), []);
		m.echo("detailDensity", "1");
		await m.flush();
		assert.deepEqual(m.el("detail-list").querySelectorAll(".hw-tile:not(.ghost)").map((tile) => tile.querySelectorAll(".hw-set-chip").length), [1, 1, 1, 1, 1]);
	});

	it("a cross-tile drop that grows a quad carries an automatic hue without making it chosen", async () => {
		const m = await openPanel("reading", { ...seed, detailKeys: readings.slice(1, 8).map((r) => r.key), detailTiles: [{ size: 4, cellLabels: false }, { size: 3, cellLabels: false }] }, status);
		const before = colors(m, "paper", "theme").get("2.00");
		const target = chips(m, "detail-list").find((c) => c.dataset.key === readings[7]!.key)!;
		target.fire("drop", { clientX: 1, dataTransfer: { getData: () => keys[0] } });
		const plan = detailTilesOf(m.store);
		assert.equal(plan[0]?.size, 3);
		assert.equal(plan[1]?.size, 4);
		assert.equal(plan[1]?.automaticColors?.[3], true);
		const targetPanel = { ...m, store: { ...m.store, detailKeys: (m.store.detailKeys as string[]).slice(3), detailTiles: [plan[1]] } };
		assert.equal(colors(targetPanel, "paper", "theme").get("2.00"), before);
	});

	it("whole-tile movement clones the automatic flags with the colors", async () => {
		const m = await openPanel("reading", { ...seed, detailKeys: readings.slice(1).map((r) => r.key), detailTiles: [{ size: 4, cellLabels: false }, { size: 4, cellLabels: false }] }, status);
		clickChip(m, keys[0]!, '.hw-detail-move[data-move="1"]');
		const before = colors(m, "paper", "dim");
		const grip = m.el("detail-list").querySelector('.hw-tile-grip[data-tile="0"]');
		assert.ok(grip);
		m.el("detail-list").fire("keydown", { target: grip, key: "ArrowDown" });
		const plan = detailTilesOf(m.store);
		assert.deepEqual(plan[1]?.automaticColors, [true, true, false, false]);
		const movedPanel = { ...m, store: { ...m.store, detailKeys: (m.store.detailKeys as string[]).slice(4), detailTiles: [plan[1]] } };
		assert.deepEqual(colors(movedPanel, "paper", "dim"), before);
	});

	for (const destination of ["small tile", "ghost"] as const) {
		it(`a previously stored automatic hue still travels to a ${destination}`, async () => {
			const m = await openPanel("reading", { ...seed, detailKeys: destination === "ghost" ? keys : readings.slice(1, 7).map((r) => r.key) }, status);
			clickChip(m, keys[0]!, '.hw-detail-move[data-move="1"]');
			const target = destination === "ghost" ? m.el("detail-list").querySelector(".hw-tile.ghost") : chips(m, "detail-list").find((c) => c.dataset.key === readings[6]!.key);
			assert.ok(target);
			target.fire("drop", { clientX: 1, dataTransfer: { getData: () => keys[0] } });
			const plan = detailTilesOf(m.store);
			const tile = plan.at(-1)!;
			const index = destination === "ghost" ? 0 : 2;
			assert.equal(tile.colors[index], "#4CC2FF", "storage still controls whether a hue travels to a smaller tile");
			assert.equal(tile.automaticColors?.[index], true, "travel does not make the stored hue chosen");
		});
	}

	it("the panel and runtime salvage provenance identically without rewriting on open", async () => {
		for (const automaticColors of [undefined, "true", true, 1, null, [true, "true", true, 1, true]]) {
			const raw = [{ size: 4, colors: ["#4CC2FF", "#FF7E8E", "junk", "#FFFFFF"], automaticColors }];
			const before = JSON.stringify(raw);
			const m = await openPanel("reading", { ...seed, detailTiles: raw }, status);
			assert.equal(m.writes.length, 0);
			assert.equal(JSON.stringify(raw), before);
			const abc = m.el("detail-list").querySelector(".hw-tile-abc");
			assert.ok(abc);
			m.el("detail-list").fire("click", { target: abc });
			assert.deepEqual(detailTilesOf(m.store), detailTilesOf({ detailTiles: raw.map((tile) => ({ ...tile, cellLabels: false })) }));
		}
	});
});

describe("a saved Shared Memory selection and set while the Gadget provider is live", () => {
	const status = linkedStatus();
	const seed = { readingKey: SM[0], rotationKeys: [...SM], ...OVERVIEW, readingColors: { [SM[1]]: "#FF7E8E" } };
	let m: Mounted;

	it("the picker names the linked selection instead of asking to pick again, exactly as the preview line and the face resolve it", async () => {
		m = await openPanel("dial", seed, status);
		const search = m.el("picker-search");
		assert.equal(search.value, `${LABELS[0]}  ·  Sample sensors`);
		assert.equal(search.placeholder, RESTING);
		assert.ok(!search.classList.contains("missing"), "no missing mark on a resolvable key");
		assert.equal(m.el("preview-value").textContent, "71.4 °C");
		assert.ok(!composeDialSvg(dialState(m.store), status, () => []).includes("Sensor missing"));
		assert.equal(m.store.readingKey, SM[0], "the saved key is never rewritten");
	});

	it("every rotation chip resolves to its label and none is marked missing, like the rotation the dial runs", () => {
		assert.deepEqual(chipNames(m), [...LABELS]);
		assert.ok(chips(m).every((chip) => !chip.classList.contains("missing")));
		assert.equal(rotationReadings(m.store.rotationKeys as string[], SM[0], status.snapshot).length, 3);
	});

	it("reading color rows keep the saved keys and carry labels", () => {
		assert.deepEqual(colorRows(m).map((r) => r.key), [...SM], "one row per set member, under the saved key");
		assert.deepEqual(colorRows(m).map((r) => r.name), [...LABELS]);
		assert.equal(colorRow(m, SM[1]).well.value, "#FF7E8E");
	});

	it("the live rows tick as members through their aliases and the selection highlights its live row", () => {
		m.el("picker-search").fire("focus");
		const rows = pickerRows(m);
		assert.deepEqual(rows.map((r) => r.dataset.key), [...G], "the tree lists live keys only");
		for (const row of rows) assert.equal(tickOf(row).checked, true, `${row.dataset.key} ticks as a member`);
		assert.deepEqual(rows.filter((r) => r.classList.contains("selected")).map((r) => r.dataset.key), [G[0]]);
	});

	it("a second tick on the live twin writes nothing: a key and its aliases are one member", () => {
		const before = m.writes.length;
		clickTick(m, G[0], true);
		assert.equal(m.writes.length, before, "no write");
		assert.deepEqual(plain(m.store.rotationKeys), [...SM]);
		assert.equal(chips(m).length, 3);
	});

	it("unticking the live twin removes the saved key and every alias of that reading in one write", () => {
		const before = m.writes.length;
		clickTick(m, G[0], false);
		assert.equal(m.writes.filter((w) => w.name === "rotationKeys").length - m.writes.slice(0, before).filter((w) => w.name === "rotationKeys").length, 1, "one rotationKeys write");
		assert.deepEqual(m.lastWrite("rotationKeys"), [SM[1], SM[2]]);
		assert.deepEqual(chipNames(m), [LABELS[1], LABELS[2]]);
		assert.equal(rotationReadings(m.store.rotationKeys as string[], SM[1], status.snapshot).length, 2);
		assert.equal(tickOf(pickerRows(m).find((r) => r.dataset.key === G[0])!).checked, false, "the tick follows the set");
	});

	it("the config document names a hex key that resolves only through its alias", async () => {
		const exported = await copiedDocument(m);
		assert.equal(exported.readingKey, `${SM[0]}  ${LABELS[0]}`);
		assert.deepEqual(exported.rotationKeys, [`${SM[1]}  ${LABELS[1]}`, `${SM[2]}  ${LABELS[2]}`]);
		assert.deepEqual(exported.readingColors, { [SM[1]]: "#FF7E8E" }, "maps keyed by reading key stay bare");
		const back = await applyDocument(m, exported);
		assert.equal(back.readingKey, SM[0]);
		assert.deepEqual(back.rotationKeys, [SM[1], SM[2]]);
	});
});

describe("a color saved under the dormant endpoint while the rows are keyed by the live provider", () => {
	const status = linkedStatus();
	const colors = { [SM[1]]: "#FF7E8E", dormant: "#ABCDEF", future: { keep: "unknown" } };
	const seed = { readingKey: G[0], rotationKeys: [...G], ...OVERVIEW, readingColors: colors };
	let m: Mounted;

	it("the well shows the inherited color, names the key it came from, and Auto is enabled: the face paints it", async () => {
		m = await openPanel("dial", seed, status);
		const row = colorRow(m, G[1]);
		assert.equal(row.name, LABELS[1]);
		assert.equal(row.well.value, "#FF7E8E");
		assert.ok(row.well.title.includes(SM[1]), `the title names the alias the color is saved under: ${row.well.title}`);
		assert.equal(row.auto.disabled, false);
		assert.equal(m.el("reading-color-preset").value, "custom");
		assert.equal(paint(m.store, status)[1], "#FF7E8E", "the runtime inherits the color through the link");
	});

	it("Auto clears the color under every key of that reading and leaves unrelated entries alone", () => {
		colorRow(m, G[1]).auto.fire("click");
		assert.deepEqual(m.lastWrite("readingColors"), { dormant: "#ABCDEF", future: { keep: "unknown" } });
		assert.equal(colorRow(m, G[1]).well.value, "#FFFFFF");
		assert.equal(colorRow(m, G[1]).auto.disabled, true);
		assert.equal(m.el("reading-color-preset").value, "automatic");
		assert.notEqual(paint(m.store, status)[1], "#FF7E8E", "the face no longer paints it");
	});

	it("Uniform then Automatic does not resurrect the hidden color", async () => {
		m.echo("readingColors", { ...colors });
		await m.flush();
		assert.equal(colorRow(m, G[1]).well.value, "#FF7E8E");
		choosePreset(m, "uniform");
		const uniform = m.lastWrite("readingColors") as Record<string, unknown>;
		assert.deepEqual(uniform, { dormant: "#ABCDEF", future: { keep: "unknown" }, [G[0]]: "#4CC2FF", [G[1]]: "#4CC2FF", [G[2]]: "#4CC2FF" }, "the row keys are written and the alias entry is gone");
		assert.equal(paint(m.store, status)[1], "#4CC2FF");
		choosePreset(m, "automatic");
		assert.deepEqual(m.lastWrite("readingColors"), { dormant: "#ABCDEF", future: { keep: "unknown" } });
		assert.equal(m.el("reading-color-preset").value, "automatic");
		assert.ok(colorRows(m).every((r) => r.well.value === "#FFFFFF"));
		assert.notEqual(paint(m.store, status)[1], "#FF7E8E", "Automatic cleared what the face rendered");
	});
});

describe("both endpoints colored differently", () => {
	const status = linkedStatus();
	let m: Mounted;

	it("the row key wins over its alias, on the saved keys and on the live keys alike, mirroring the runtime", async () => {
		m = await openPanel("dial", { readingKey: SM[0], rotationKeys: [...SM], ...OVERVIEW, readingColors: { [SM[1]]: "#111111", [G[1]]: "#222222" } }, status);
		const saved = colorRow(m, SM[1]);
		assert.equal(saved.well.value, "#111111");
		assert.ok(!saved.well.title.includes(G[1]), "an exact color is not attributed to an alias");
		assert.equal(paint(m.store, status)[1], "#111111", "curated set: the set key's color");
		m.echo("rotationKeys", [...G]);
		m.echo("readingKey", G[0]);
		await m.flush();
		assert.equal(colorRow(m, G[1]).well.value, "#222222");
		assert.equal(paint(m.store, status)[1], "#222222", "live keys: the live key's color");
	});

	it("a well change leaves exactly one explicit entry for the reading", async () => {
		const row = colorRow(m, G[1]);
		row.well.value = "#333333";
		row.well.fire("change");
		assert.deepEqual(m.lastWrite("readingColors"), { [G[1]]: "#333333" });
		assert.equal(paint(m.store, status)[1], "#333333");
		m.echo("rotationKeys", [...SM]);
		m.echo("readingKey", SM[0]);
		await m.flush();
		const back = colorRow(m, SM[1]);
		assert.equal(back.well.value, "#333333", "the saved-key row inherits it");
		assert.ok(back.well.title.includes(G[1]));
		assert.equal(paint(m.store, status)[1], "#333333");
		back.auto.fire("click");
		assert.deepEqual(m.lastWrite("readingColors"), {});
	});
});

describe("without a usable link the editor falls back to exact keys, like the runtime", () => {
	it("conflicting pairs are dropped on both sides: the saved key is not present and the preview says so", async () => {
		const conflicting = [LINKS[0], { sharedMemory: SM[0], gadget: G[1], unit: "°C", sensorType: SensorType.Temperature }, LINKS[2]];
		const status = linkedStatus(conflicting);
		assert.equal(buildPreview(status, { readingKey: SM[0] }, false).missing, true);
		const m = await openPanel("dial", { readingKey: SM[0], rotationKeys: [SM[0], SM[2]], ...OVERVIEW }, status);
		const search = m.el("picker-search");
		assert.equal(search.placeholder, NOT_PRESENT);
		assert.ok(search.classList.contains("missing"));
		assert.equal(m.el("preview-value").textContent, "sensor missing");
		assert.deepEqual(chips(m).map((c) => c.classList.contains("missing")), [true, false], "the surviving pair still resolves");
		assert.deepEqual(chipNames(m), [SM[0], LABELS[2]]);
		assert.equal(rotationReadings(m.store.rotationKeys as string[], SM[0], status.snapshot).length, 1);
	});

	it("an unavailable counterpart (neither endpoint published) leaves the saved key exact and missing", async () => {
		const status = linkedStatus([{ sharedMemory: SM[0], gadget: "g:Sample sensors:Absent", unit: "°C", sensorType: SensorType.Temperature }]);
		const m = await openPanel("dial", { readingKey: SM[0], ...OVERVIEW }, status);
		assert.equal(m.el("picker-search").placeholder, NOT_PRESENT);
		assert.equal(m.el("preview-value").textContent, "sensor missing");
		assert.deepEqual(colorRows(m).map((r) => r.key), [SM[0]], "no tree group resolves, so the pick alone is listed");
	});

	it("a pair whose unit no longer matches is not an alias", async () => {
		const status = linkedStatus([{ sharedMemory: SM[0], gadget: G[0], unit: "RPM", sensorType: SensorType.Fan }]);
		const m = await openPanel("dial", { readingKey: SM[0], ...OVERVIEW }, status);
		assert.equal(m.el("picker-search").placeholder, NOT_PRESENT);
		assert.equal(buildPreview(status, { readingKey: SM[0] }, false).missing, true);
	});
});

describe("a legacy Gadget key the provider republishes", () => {
	const live = "g2:WyJHUFUiLCJIb3QgU3BvdDpNYXgiXQ";
	const legacy = "g:GPU:Hot Spot:Max";
	const reading: Reading = { ...sample(live, 1, "Hot Spot:Max", SensorType.Temperature, "°C", 70), linkedKeys: [live, legacy] };
	const byKey = new Map<string, Reading>([
		[live, reading],
		[legacy, { ...reading, key: legacy, aliasOf: live }]
	]);
	const status: OkStatus = { state: "ok", source: "gadget", snapshot: { pollTime: 1, version: 2, revision: 0, sensors: [{ index: 0, id: 1, instance: 0, name: "GPU" }], readings: [reading], byKey } };

	it("resolves in the picker, the preview and the document, and the g: spelling is never annotated", async () => {
		const m = await openPanel("dial", { readingKey: legacy, ...OVERVIEW }, status);
		assert.equal(m.el("picker-search").value, "Hot Spot:Max  ·  GPU");
		assert.equal(m.el("preview-value").textContent, "70.0 °C");
		const exported = await copiedDocument(m);
		assert.equal(exported.readingKey, legacy);
		assert.equal((await applyDocument(m, exported)).readingKey, legacy);
	});
});

describe("the reading panel's detail editor under a link", () => {
	const status = linkedStatus();

	it("the live filter count skips the live twin of a dormant primary, like the view does", async () => {
		const m = await openPanel("reading", { readingKey: SM[0], pressBehavior: "open-details", detailMode: "filter", detailFilter: "*" }, status);
		const group = resolveDetailGroup(status.snapshot, { readingKey: SM[0], detailMode: "filter", detailFilter: "*" });
		assert.deepEqual(group?.keys, [G[1], G[2]]);
		assert.equal(m.el("detail-filter-count").textContent, "Matches 2 readings right now.");
	});

	it("custom list chips resolve, the primary's live twin is refused, and an alias already listed is one member", async () => {
		const m = await openPanel("reading", { readingKey: SM[0], pressBehavior: "open-details", detailMode: "custom", detailKeys: [SM[1]] }, status);
		assert.deepEqual(chipNames(m, "detail-list"), [LABELS[1]]);
		assert.ok(chips(m, "detail-list").every((c) => !c.classList.contains("missing")));
		m.el("pickerd-search").fire("focus");
		const rows = pickerRows(m, "pickerd-list");
		const state = (key: string): { on: boolean; disabled: boolean } => {
			const tick = tickOf(rows.find((r) => r.dataset.key === key)!);
			return { on: tick.checked, disabled: tick.disabled };
		};
		assert.deepEqual(state(G[0]), { on: true, disabled: true }, "the opener's own reading, through its alias");
		assert.deepEqual(state(G[1]), { on: true, disabled: false }, "listed under its Shared Memory key");
		assert.deepEqual(state(G[2]), { on: false, disabled: false });
		const before = m.writes.length;
		clickTick(m, G[0], true, "pickerd-list");
		clickTick(m, G[1], true, "pickerd-list");
		assert.equal(m.writes.length, before, "neither the primary's twin nor a listed alias writes");
		const addAll = m.el("pickerd-list").querySelector(".hw-group-add");
		assert.ok(addAll !== null);
		m.el("pickerd-list").fire("mousedown", { target: addAll });
		assert.deepEqual(m.lastWrite("detailKeys"), [SM[1], G[2]], "+ all adds only what the view would list");
		assert.deepEqual(resolveDetailGroup(status.snapshot, { readingKey: SM[0], detailMode: "custom", detailKeys: m.store.detailKeys })?.keys, [SM[1], G[2]]);
		assert.equal(chips(m, "detail-list").length, 2, "one chip per tile the deck builds");
		clickTick(m, G[1], false, "pickerd-list");
		assert.deepEqual(m.lastWrite("detailKeys"), [G[2]], "unticking the live row removes the listed alias");
	});

	it("a listed alias of the primary parks as the Back tile chip and never occupies a cell", async () => {
		const m = await openPanel("reading", { readingKey: SM[0], pressBehavior: "open-details", detailMode: "custom", detailKeys: [G[0], SM[1]] }, status);
		const all = chips(m, "detail-list");
		assert.equal(all.length, 2);
		assert.equal(all[0]!.querySelector(".hw-set-name")!.textContent, `${LABELS[0]} (Back tile)`);
		assert.equal(all[0]!.dataset.tile, undefined, "parked outside the tiles");
		assert.ok(m.el("detail-list").querySelectorAll(".hw-set-note").some((n) => n.textContent.startsWith("1 reading across 1 tile")));
		assert.equal(m.writes.length, 0, "opening the panel wrote nothing");
	});
});

// --------------------------------------------- the config document
const g2 = (tuple: unknown[]): string => `g2:${Buffer.from(JSON.stringify(tuple)).toString("base64url")}`;
const HEX = "f0000301:0:8000005";
const HEX_DUP = "f0000301:0:8000005~1";
const G2_COLON = g2(["GPU", "Hot Spot:Max"]);
const G2_CRLF = g2(["GPU", "Line\r\nBreak"]);
const G2_NAMED = g2(["named", "GPU", "Reading 3"]);
/** Every key the identity table needs, published by one source named GPU. */
const IDENTITY_ROWS: [string, string][] = [
	[HEX, "GPU Temperature"],
	[HEX_DUP, "GPU Temperature"],
	["g:GPU:Temperature", "Temperature"],
	["g:GPU:Temperature ", "Temperature "],
	["g:GPU:Temperature ", "Temperature "],
	["g:GPU:Temperature　", "Temperature　"],
	["g:GPU:Temperature\t", "Temperature\t"],
	["g:GPU: Temperature", " Temperature"],
	["g:Test Source:Two  Spaces", "Two  Spaces"],
	["g: GPU:Temperature", "Temperature"],
	["g:GPU :Temperature", "Temperature"],
	["g:GPU:Temperature~1", "Temperature"],
	["g:GPU:Reading 3 ", "Reading 3 "],
	[G2_COLON, "Hot Spot:Max"],
	[G2_CRLF, "Line\r\nBreak"],
	[G2_NAMED, "Reading 3"]
];
function identityStatus(): OkStatus {
	const readings = IDENTITY_ROWS.map(([key, label], i) => sample(key, i + 1, label, SensorType.Temperature, "°C", 40 + i));
	return { state: "ok", source: "gadget", snapshot: { pollTime: 1, version: 2, revision: 0, sensors: [{ index: 0, id: 1, instance: 0, name: "GPU" }], readings, byKey: new Map(readings.map((r) => [r.key, r])) } };
}

describe("the config document round-trips every reading identity byte for byte", () => {
	const status = identityStatus();
	const seed = {
		readingKey: "g:GPU:Temperature ",
		secondaryReadingKey: "g:GPU:Temperature ",
		quadReadingKey3: "g:GPU:Temperature　",
		quadReadingKey4: "g:GPU:Temperature\t",
		detailKeys: ["g:GPU:Reading 3 ", HEX_DUP, G2_COLON, "g:GPU:Temperature "],
		rotationKeys: [HEX, G2_NAMED],
		rotationGroups: [{ name: "a", keys: [G2_CRLF, "g:GPU:Temperature "] }, "junk"],
		rotationNames: { "g:GPU:Temperature ": "Custom name" },
		readingColors: { [HEX]: "#ff0000" },
		futureBlob: { nested: { deep: [1, "two", { three: 3 }] }, keep: "yes" }
	};
	let m: Mounted;

	it("Copy annotates hex and g2: keys only and Apply hands the same document back", async () => {
		m = await openPanel("reading", seed, status);
		const exported = await copiedDocument(m);
		assert.equal(exported.readingKey, "g:GPU:Temperature ", "a g: key is written whole, trailing space included, and never named");
		assert.equal(exported.secondaryReadingKey, "g:GPU:Temperature ");
		assert.equal(exported.quadReadingKey3, "g:GPU:Temperature　");
		assert.equal(exported.quadReadingKey4, "g:GPU:Temperature\t");
		assert.deepEqual(exported.detailKeys, ["g:GPU:Reading 3 ", `${HEX_DUP}  GPU Temperature`, `${G2_COLON}  Hot Spot:Max`, "g:GPU:Temperature "]);
		assert.deepEqual(exported.rotationKeys, [`${HEX}  GPU Temperature`, `${G2_NAMED}  Reading 3`]);
		assert.deepEqual(exported.rotationGroups, [{ name: "a", keys: [`${G2_CRLF}  Line\r\nBreak`, "g:GPU:Temperature "] }, "junk"]);
		assert.deepEqual(exported.rotationNames, seed.rotationNames, "maps keyed by reading key are not annotated");
		assert.deepEqual(exported.readingColors, seed.readingColors);
		assert.deepEqual(exported.futureBlob, seed.futureBlob);
		assert.equal(m.clipboard.text, m.el("config-key").value);
		assert.deepEqual(await applyDocument(m, exported), seed);
	});

	it("Apply strips hand indents and names but keeps a g: key whole to its last character", async () => {
		const applied = await applyDocument(m, {
			readingKey: "  g:GPU:Temperature ",
			secondaryReadingKey: `  ${HEX}   GPU Temperature  `,
			quadReadingKey3: `${HEX_DUP}\tGPU Temperature`,
			quadReadingKey4: `${G2_COLON}  Hot Spot:Max`,
			detailKeys: [`\t${G2_NAMED}   Reading 3`, "g:GPU:Reading 3 ", `${HEX} g:looks like a gadget key`],
			rotationKeys: ["g:GPU:Temperature ", "g:GPU:Temperature　", "g:GPU:Temperature\t"],
			rotationGroups: [{ name: "a", keys: [" g:GPU:Temperature~1"] }],
			rotationNames: seed.rotationNames,
			futureBlob: seed.futureBlob
		});
		assert.equal(applied.readingKey, "g:GPU:Temperature ");
		assert.equal(applied.secondaryReadingKey, HEX);
		assert.equal(applied.quadReadingKey3, HEX_DUP);
		assert.equal(applied.quadReadingKey4, G2_COLON);
		assert.deepEqual(applied.detailKeys, [G2_NAMED, "g:GPU:Reading 3 ", HEX]);
		assert.deepEqual(applied.rotationKeys, ["g:GPU:Temperature ", "g:GPU:Temperature　", "g:GPU:Temperature\t"]);
		assert.deepEqual(applied.rotationGroups, [{ name: "a", keys: ["g:GPU:Temperature~1"] }]);
		assert.deepEqual(applied.rotationNames, seed.rotationNames);
		assert.deepEqual(applied.futureBlob, seed.futureBlob);
	});

	it("the custom list adopts a whitespace-edged Gadget key whole: chips resolve, the opener's own spelling parks, and the first edit writes every key back unchanged", () => {
		const all = chips(m, "detail-list");
		// The opener's own key (trailing space and all) parks first as the
		// Back tile chip; the other three fill the tiles in list order.
		assert.deepEqual(
			all.map((c) => c.dataset.key),
			["g:GPU:Temperature ", "g:GPU:Reading 3 ", HEX_DUP, G2_COLON]
		);
		assert.ok(all.every((c) => !c.classList.contains("missing")), "every listed key is in the tree");
		assert.deepEqual(chipNames(m, "detail-list"), ["Temperature  (Back tile)", "Reading 3 ", "GPU Temperature", "Hot Spot:Max"]);
		assert.equal(m.writes.length, 0, "adoption wrote nothing");
		// Chip removal is delegated to the list, like every other chip control.
		const remove = all[2]!.querySelector(".hw-set-remove");
		assert.ok(remove !== null);
		m.el("detail-list").fire("click", { target: remove });
		assert.deepEqual(m.lastWrite("detailKeys"), ["g:GPU:Reading 3 ", G2_COLON, "g:GPU:Temperature "]);
	});
});

// ----------------------------- the extracted helpers, case by case
function extractFunction(name: string): string {
	// Functions sit one tab deep inside the IIFE; the first "\n\t}" after
	// the signature is the function's own closing brace.
	const m = new RegExp(`\\n\\tfunction ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\t\\}\\n`).exec(PI_SOURCE);
	assert.ok(m !== null, `${name} is defined one tab deep in pi-common.js`);
	return m[0];
}
function extractConst(name: string): string {
	const m = new RegExp(`\\n\\tconst ${name} = \\[[^\\]]*\\];`).exec(PI_SOURCE);
	assert.ok(m !== null, `${name} is defined in pi-common.js`);
	return m[0];
}
const treeLabels = new Map(IDENTITY_ROWS);
const helpers = vm.runInNewContext(`${[extractConst("KEY_SCALAR_FIELDS"), extractConst("KEY_LIST_FIELDS"), extractFunction("bareKey"), extractFunction("namedKey"), extractFunction("mapReadingKeys")].join("\n")}\n({ bareKey, namedKey, mapReadingKeys });`, {
	readingLabelOf: (key: string) => treeLabels.get(key) ?? null
}) as {
	bareKey: (v: unknown) => unknown;
	namedKey: (v: unknown) => unknown;
	mapReadingKeys: (doc: unknown, fn: (v: unknown) => unknown) => Record<string, unknown>;
};
const { bareKey, namedKey, mapReadingKeys } = helpers;

/** Visible whitespace for failure messages. */
const show = (v: unknown): string => (typeof v !== "string" ? JSON.stringify(v) : `"${v.replace(/[^\x21-\x7e]/g, (c) => (c === " " ? "␣" : `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`))}"`);

/** One field through fillWell then Apply, exactly as pi-common.js wires them. */
function roundTrip(key: string): { exported: unknown; applied: unknown } {
	const exportedDoc = mapReadingKeys({ readingKey: key }, namedKey);
	const appliedDoc = mapReadingKeys(JSON.parse(JSON.stringify(exportedDoc, null, "\t")), bareKey);
	return { exported: exportedDoc.readingKey, applied: appliedDoc.readingKey };
}

const IDENTITY_CASES: { id: string; what: string; key: string; annotated?: string }[] = [
	{ id: "C01", what: "hex key in the tree", key: HEX, annotated: `${HEX}  GPU Temperature` },
	{ id: "C02", what: "hex key with a ~1 suffix", key: HEX_DUP, annotated: `${HEX_DUP}  GPU Temperature` },
	{ id: "C03", what: "hex key not in the tree stays bare", key: "e0002000:0:5000000", annotated: "e0002000:0:5000000" },
	{ id: "C04", what: "g: plain", key: "g:GPU:Temperature", annotated: "g:GPU:Temperature" },
	{ id: "C05", what: "g: internal double space", key: "g:Test Source:Two  Spaces" },
	{ id: "C06", what: "g: label with a leading space", key: "g:GPU: Temperature" },
	{ id: "C07", what: "g: sensor with a leading space", key: "g: GPU:Temperature" },
	{ id: "C08", what: "g: sensor with a trailing space", key: "g:GPU :Temperature" },
	{ id: "C09", what: "g: legacy ~1 suffix (a 1.6.0 stored key)", key: "g:GPU:Temperature~1" },
	{ id: "C10", what: "g: label with a trailing space", key: "g:GPU:Temperature " },
	{ id: "C11", what: "g: label with a trailing NBSP U+00A0", key: "g:GPU:Temperature " },
	{ id: "C12", what: "g: label with a trailing U+3000", key: "g:GPU:Temperature　" },
	{ id: "C13", what: "g: label with a trailing TAB", key: "g:GPU:Temperature\t" },
	{ id: "C14", what: "g: label 'Reading 3 ' (trailing space, not the reserved spelling)", key: "g:GPU:Reading 3 " },
	{ id: "C15", what: "g2: colon in the label", key: G2_COLON, annotated: `${G2_COLON}  Hot Spot:Max` },
	{ id: "C16", what: "g2: CRLF in the label (raw CRLF in the document)", key: G2_CRLF, annotated: `${G2_CRLF}  Line\r\nBreak` },
	{ id: "C17", what: "g2: named tuple for the reserved 'Reading 3'", key: G2_NAMED, annotated: `${G2_NAMED}  Reading 3` }
];

describe("bareKey, namedKey and mapReadingKeys as shipped", () => {
	for (const c of IDENTITY_CASES) {
		it(`${c.id} ${c.what} survives export and apply`, () => {
			const { exported, applied } = roundTrip(c.key);
			if (c.annotated !== undefined) assert.equal(exported, c.annotated, "export annotation shape");
			assert.equal(applied, c.key, `identity changed through export and apply: ${show(c.key)} -> ${show(applied)}`);
		});
	}

	it("every key-bearing field is mapped and every other field rides along", () => {
		const doc = {
			readingKey: HEX,
			secondaryReadingKey: HEX_DUP,
			quadReadingKey3: HEX,
			quadReadingKey4: "e0002000:0:5000000",
			detailKeys: [HEX, 42],
			rotationKeys: [HEX_DUP],
			rotationGroups: [{ name: "a", keys: [HEX] }, "junk"],
			rotationNames: { [HEX]: "Custom name" },
			readingColors: { [HEX]: "#ff0000" },
			futureField: { keys: [HEX] }
		};
		const exported = plain(mapReadingKeys(doc, namedKey));
		assert.equal(exported.readingKey, `${HEX}  GPU Temperature`);
		assert.equal(exported.secondaryReadingKey, `${HEX_DUP}  GPU Temperature`);
		assert.equal(exported.quadReadingKey4, "e0002000:0:5000000");
		assert.deepEqual(exported.detailKeys, [`${HEX}  GPU Temperature`, 42]);
		assert.deepEqual(exported.rotationGroups, [{ name: "a", keys: [`${HEX}  GPU Temperature`] }, "junk"]);
		assert.deepEqual(exported.rotationNames, doc.rotationNames);
		assert.deepEqual(exported.readingColors, doc.readingColors);
		assert.deepEqual(exported.futureField, doc.futureField);
		assert.deepEqual(plain(mapReadingKeys(JSON.parse(JSON.stringify(exported)), bareKey)), doc);
	});

	it("a trailing-space Gadget key is kept in every listed field, so its names and colors stay attached", () => {
		const key = "g:GPU:Temperature ";
		const doc = { readingKey: key, secondaryReadingKey: key, quadReadingKey3: key, quadReadingKey4: key, detailKeys: [key], rotationKeys: [key], rotationGroups: [{ name: "a", keys: [key] }], rotationNames: { [key]: "Custom name" }, readingColors: { [key]: "#ff0000" } };
		assert.deepEqual(plain(mapReadingKeys(JSON.parse(JSON.stringify(mapReadingKeys(doc, namedKey))), bareKey)), doc);
	});

	it("annotated hex and g2: keys strip back through two spaces, a TAB, extra spaces, an indent or a name that mentions g:", () => {
		for (const [text, key] of [
			[`${HEX}  GPU Temperature`, HEX],
			[`${HEX}\tGPU Temperature`, HEX],
			[`  ${HEX}   GPU Temperature  `, HEX],
			[`${HEX_DUP}  GPU Temperature`, HEX_DUP],
			[`${HEX} g:looks like a gadget key`, HEX],
			[`${G2_COLON}  Hot Spot:Max`, G2_COLON],
			[`${G2_COLON}\tHot Spot:Max`, G2_COLON],
			[`   ${G2_COLON}   Hot Spot:Max  `, G2_COLON]
		]) {
			assert.equal(bareKey(text), key, show(text));
		}
		assert.equal(namedKey(G2_COLON), `${G2_COLON}  Hot Spot:Max`);
		assert.equal(namedKey("g:GPU:Temperature "), "g:GPU:Temperature ", "a g: key is never named");
	});

	it("a hand indent before a g: key is not identity, but everything after g: is", () => {
		assert.equal(bareKey("  g:GPU:Temperature"), "g:GPU:Temperature");
		assert.equal(bareKey("\tg:GPU:Temperature "), "g:GPU:Temperature ");
		assert.equal(bareKey("g:GPU:Temperature "), "g:GPU:Temperature ");
		assert.equal(bareKey(""), "");
		assert.equal(bareKey("   "), "");
		assert.equal(bareKey(42), 42, "non-strings pass through");
	});

	it("list adoption (value.map(bareKey)) keeps stored Gadget keys byte for byte", () => {
		const stored = ["g:GPU:Temperature ", "g:GPU:Temperature ", HEX];
		assert.deepEqual(stored.map((k) => bareKey(k)), stored);
	});
});
