/**
 * A launch key a 1.8 test build stored (it signed the programs and
 * addresses a person allowed keys to open) stays on this machine through
 * the settings panel's Shared settings document: no copy shows it, and
 * Replace keeps the stored one and never takes a pasted one, so the stamps
 * a key still stores mean the same thing when the feature returns.
 *
 * The pure helpers come from ui/pi-model.js; the wells are the shipped
 * config section sliced out of ui/pi-common.js and run in a node vm over
 * stubs for the DOM, the shell and the socket, as pi-detail-cells does.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import vm from "node:vm";

const UI = new URL("../com.lawrensen.hwinfo.sdPlugin/ui/", import.meta.url);
const SOURCE = readFileSync(new URL("pi-common.js", UI), "utf8");
const modelScope = {};
new Function("self", readFileSync(new URL("pi-model.js", UI), "utf8"))(modelScope);
const model = modelScope.hwModel;

const MACHINE_KEY = Buffer.alloc(32, 1).toString("base64");
const FOREIGN_KEY = Buffer.alloc(32, 2).toString("base64");
/** Values cross the vm realm; compare by value. */
const plain = (v) => JSON.parse(JSON.stringify(v));

function slice(start, end) {
	const a = SOURCE.indexOf(start);
	const b = SOURCE.indexOf(end, a);
	assert.ok(a >= 0 && b > a, `pi-common.js anchors moved: ${start} / ${end}`);
	return SOURCE.slice(a, b);
}

class Element {
	constructor(id) {
		this.id = id;
		this.value = "";
		this.hidden = true;
		this.textContent = id.endsWith("-apply") ? "Replace" : "";
		this.dataset = {};
		this.handlers = new Map();
	}
	addEventListener(type, fn) {
		const list = this.handlers.get(type) ?? [];
		list.push(fn);
		this.handlers.set(type, list);
	}
	select() {}
	async fire(type, ev = {}) {
		for (const fn of this.handlers.get(type) ?? []) await fn({ type, target: this, ...ev });
	}
}

/** The config wells over a key document and a shared document. */
function wells(settings, globals) {
	const ids = ["config-key", "config-deck", "config-note", "config-key-copy", "config-key-apply", "config-deck-copy", "config-deck-apply"];
	const els = new Map(ids.map((id) => [id, new Element(id)]));
	const listeners = new Map();
	const sharedWrites = [];
	const keyWrites = [];
	const clipboard = { text: "" };
	let now = 0;
	const hw = {
		kind: "key",
		state: { settings, globals },
		globalsReady: Promise.resolve(),
		on(name, fn) {
			const list = listeners.get(name) ?? [];
			list.push(fn);
			listeners.set(name, list);
		}
	};
	const context = {
		document: { getElementById: (id) => els.get(id) ?? null, querySelector: () => null, activeElement: null },
		streamDeckClient: {
			getConnectionInfo: async () => ({}),
			setSettings: (doc) => {
				keyWrites.push(plain(doc));
				return Promise.resolve();
			},
			setGlobalSettings: (doc) => {
				sharedWrites.push(plain(doc));
				return Promise.resolve();
			}
		},
		hw,
		model,
		mapReadingKeys: (doc) => doc,
		namedKey: (v) => v,
		bareKey: (v) => v,
		navigator: {
			clipboard: {
				writeText: async (text) => {
					clipboard.text = text;
				}
			}
		},
		performance: { now: () => now },
		setTimeout: () => 0,
		window: { location: { reload() {} } }
	};
	vm.createContext(context);
	vm.runInContext(slice("\t// --- config export and apply", "\t// --- section summaries"), context);
	const settle = () => new Promise((resolve) => setImmediate(resolve));
	return {
		el: (id) => els.get(id),
		sharedWrites,
		keyWrites,
		clipboard,
		/** The shared document arriving from the host, as the shell keeps it. */
		deliverGlobals: async (doc) => {
			hw.state.globals = doc;
			for (const fn of listeners.get("globals") ?? []) fn({ origin: "echo" });
			await settle();
		},
		copyShared: async () => {
			await els.get("config-deck-copy").fire("click");
			await settle();
			return els.get("config-deck").value;
		},
		/** Types a document into the shared well and presses Replace twice,
		 * the second press past the double-click window. */
		replaceShared: async (doc) => {
			const well = els.get("config-deck");
			well.value = JSON.stringify(doc);
			await well.fire("input");
			const button = els.get("config-deck-apply");
			now += 1000;
			await button.fire("click", { detail: 1 });
			now += 1000;
			await button.fire("click", { detail: 1 });
			await settle();
		},
		replaceKey: async (doc) => {
			const well = els.get("config-key");
			well.value = JSON.stringify(doc);
			await well.fire("input");
			await els.get("config-key-apply").fire("click", { detail: 1 });
			await settle();
		}
	};
}

describe("sharedDocForWell and sharedDocToWrite (pi-model.js)", () => {
	it("the well shows every shared field except the launch key, exactly as stored", () => {
		const globals = { theme: "ember", launchKey: MACHINE_KEY, readingLinks: [{ a: 1 }], future: { keep: true } };
		assert.deepEqual(plain(model.sharedDocForWell(globals)), { theme: "ember", readingLinks: [{ a: 1 }], future: { keep: true } });
		assert.deepEqual(plain(globals), { theme: "ember", launchKey: MACHINE_KEY, readingLinks: [{ a: 1 }], future: { keep: true } }, "input untouched");
		for (const junk of [undefined, null, [], "x", 3]) assert.deepEqual(plain(model.sharedDocForWell(junk)), {});
	});

	it("Replace drops a pasted key and carries this machine's key over", () => {
		assert.deepEqual(plain(model.sharedDocToWrite({ theme: "paper", launchKey: FOREIGN_KEY }, { theme: "ember", launchKey: MACHINE_KEY })), { theme: "paper", launchKey: MACHINE_KEY });
		assert.deepEqual(plain(model.sharedDocToWrite({ theme: "paper" }, { launchKey: MACHINE_KEY })), { theme: "paper", launchKey: MACHINE_KEY });
	});

	it("a machine with no key gets none, whatever the pasted text holds", () => {
		const written = model.sharedDocToWrite({ theme: "paper", launchKey: FOREIGN_KEY }, { theme: "ember" });
		assert.deepEqual(plain(written), { theme: "paper" });
		assert.equal(Object.hasOwn(written, "launchKey"), false);
		assert.deepEqual(plain(model.sharedDocToWrite({ launchKey: FOREIGN_KEY }, undefined)), {});
	});

	it("an inherited or prototype-named field is neither read nor planted", () => {
		const pasted = JSON.parse(`{"__proto__":{"launchKey":"${FOREIGN_KEY}"},"theme":"paper"}`);
		const written = model.sharedDocToWrite(pasted, Object.create({ launchKey: FOREIGN_KEY }));
		assert.equal(written.launchKey, undefined);
		assert.equal(Object.hasOwn(written, "launchKey"), false);
		assert.equal(written.theme, "paper");
	});
});

describe("the Shared settings well as shipped (pi-common.js)", () => {
	it("Copy shows and copies the shared document without the launch key", async () => {
		const w = wells({}, { theme: "ember", launchKey: MACHINE_KEY, future: { keep: 1 } });
		const text = await w.copyShared();
		assert.deepEqual(JSON.parse(text), { future: { keep: 1 }, theme: "ember" });
		assert.equal(w.clipboard.text, text);
		assert.doesNotMatch(text, /launchKey/);
		assert.ok(!text.includes(MACHINE_KEY));
		assert.equal(w.sharedWrites.length, 0, "filling writes nothing");
	});

	it("an untouched well that follows a later document still leaves the key out", async () => {
		const w = wells({}, { theme: "ember" });
		await w.copyShared();
		await w.deliverGlobals({ theme: "paper", launchKey: MACHINE_KEY });
		assert.deepEqual(JSON.parse(w.el("config-deck").value), { theme: "paper" });
	});

	it("Replace with someone else's key keeps this machine's key", async () => {
		const w = wells({}, { theme: "ember", launchKey: MACHINE_KEY });
		await w.replaceShared({ theme: "paper", launchKey: FOREIGN_KEY, future: 2 });
		assert.deepEqual(w.sharedWrites, [{ theme: "paper", future: 2, launchKey: MACHINE_KEY }]);
	});

	it("Replace without a key does not wipe the keys a person allowed here", async () => {
		const w = wells({}, { theme: "ember", launchKey: MACHINE_KEY });
		const copied = JSON.parse(await w.copyShared());
		await w.replaceShared({ ...copied, theme: "paper" });
		assert.deepEqual(w.sharedWrites, [{ theme: "paper", launchKey: MACHINE_KEY }]);
	});

	it("Replace on a machine with no key never plants the pasted one", async () => {
		const w = wells({}, { theme: "ember" });
		await w.replaceShared({ theme: "paper", launchKey: FOREIGN_KEY });
		assert.deepEqual(w.sharedWrites, [{ theme: "paper" }]);
	});

	it("the key's own document is untouched: its stamp is not secret and still copies and replaces whole", async () => {
		const launch = { kind: "app", path: "C:\\Tools\\App.exe", stamp: "s".repeat(43) };
		const w = wells({ launch }, { launchKey: MACHINE_KEY });
		await w.replaceKey({ launch, label: "Mine" });
		assert.deepEqual(w.keyWrites, [{ launch, label: "Mine" }]);
		assert.equal(w.sharedWrites.length, 0);
	});
});
