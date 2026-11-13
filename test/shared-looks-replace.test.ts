/**
 * "Replace this key's settings" (and "Replace this dial's settings") stamps
 * the pasted document with this PC's looks generation (pi-model.js
 * stampOwnLooks, src/ui/shared-looks.ts), read from the shared settings the
 * panel holds. The panel hears those settings once, at load (pi-shell.js
 * globalsReady); until then it holds an empty document, which reads as "no
 * reset made here" and drops the stamp. A Replace pressed in that window
 * must wait for the shared settings, as "Replace shared settings" does, or
 * a pasted look chosen after this PC's last Use it everywhere is dropped on
 * the action's next appear.
 *
 * The config section is sliced out of the shipped ui/pi-common.js and run
 * in a node vm over stubs, as test/pi-shared-settings.test.mjs does.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import vm from "node:vm";

import { staleLooksReset, type LooksKind } from "../src/ui/shared-looks";

const UI = new URL("../com.lawrensen.hwinfo.sdPlugin/ui/", import.meta.url);
const SOURCE = readFileSync(new URL("pi-common.js", UI), "utf8");
const modelScope: { hwModel?: unknown } = {};
new Function("self", readFileSync(new URL("pi-model.js", UI), "utf8"))(modelScope);

/** Values cross the vm realm; compare by value. */
const plain = (v: unknown): Record<string, unknown> => JSON.parse(JSON.stringify(v)) as Record<string, unknown>;

function slice(start: string, end: string): string {
	const a = SOURCE.indexOf(start);
	const b = SOURCE.indexOf(end, a);
	assert.ok(a >= 0 && b > a, `pi-common.js anchors moved: ${start} / ${end}`);
	return SOURCE.slice(a, b);
}

type Handler = (ev: Record<string, unknown>) => unknown;

class FakeElement {
	value = "";
	hidden = true;
	textContent = "";
	readonly dataset: Record<string, string> = {};
	private readonly handlers = new Map<string, Handler[]>();
	constructor(readonly id: string) {}
	addEventListener(type: string, fn: Handler): void {
		this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
	}
	select(): void {}
	async fire(type: string, ev: Record<string, unknown> = {}): Promise<void> {
		for (const fn of this.handlers.get(type) ?? []) await fn({ type, target: this, ...ev });
	}
}

/** The config wells of a key or dial panel whose shared settings have not
 * arrived yet: `hearGlobals` delivers them the way pi-shell.js does (the
 * shell's copy first, then globalsReady settles). */
function panelBeforeGlobals(kind: LooksKind, settings: Record<string, unknown>) {
	const ids = ["config-key", "config-deck", "config-note", "config-key-copy", "config-key-apply", "config-deck-copy", "config-deck-apply"];
	const els = new Map(ids.map((id) => [id, new FakeElement(id)]));
	const writes: Record<string, unknown>[] = [];
	let heard: () => void = () => {};
	const hw = {
		kind,
		// pi-shell.js holds {} until the first didReceiveGlobalSettings.
		state: { settings, globals: {} as Record<string, unknown> },
		globalsReady: new Promise<void>((resolve) => (heard = resolve)),
		on() {}
	};
	const context = vm.createContext({
		document: { getElementById: (id: string) => els.get(id) ?? null, querySelector: () => null, activeElement: null },
		streamDeckClient: {
			getConnectionInfo: async () => ({}),
			setSettings: (doc: unknown) => {
				writes.push(plain(doc));
				return Promise.resolve();
			},
			setGlobalSettings: () => Promise.resolve()
		},
		hw,
		model: modelScope.hwModel,
		mapReadingKeys: (doc: unknown) => doc,
		namedKey: (v: unknown) => v,
		bareKey: (v: unknown) => v,
		navigator: { clipboard: { writeText: async () => {} } },
		performance: { now: () => 0 },
		setTimeout: () => 0,
		window: { location: { reload() {} } }
	});
	vm.runInContext(slice("\t// --- config export and apply", "\t// --- section summaries"), context);
	const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
	const el = (id: string): FakeElement => {
		const found = els.get(id);
		assert.ok(found !== undefined, `#${id}`);
		return found;
	};
	return {
		writes,
		replace: async (doc: Record<string, unknown>): Promise<void> => {
			el("config-key").value = JSON.stringify(doc);
			await el("config-key").fire("input");
			await el("config-key-apply").fire("click", { detail: 1 });
			await settle();
		},
		hearGlobals: async (globals: Record<string, unknown>): Promise<void> => {
			hw.state.globals = globals;
			heard();
			await settle();
		}
	};
}

describe("Replace pressed before the panel hears the shared settings", () => {
	for (const kind of ["key", "dial"] as const) {
		it(`a ${kind} document copied here after this PC's second press keeps its own look`, async () => {
			const field = kind === "key" ? "keyBackground" : "dialBackground";
			const panel = panelBeforeGlobals(kind, { readingKey: "r1" });
			// Copied on this PC after its second Use it everywhere: stamped 2.
			const pasted = { readingKey: "r1", [field]: "glass", looksGen: 2 };
			await panel.replace(pasted);
			await panel.hearGlobals({ looksResetGen: 2 });
			assert.equal(panel.writes.length, 1, "Replace wrote the document once");
			const written = panel.writes[0] as Record<string, unknown>;
			assert.deepEqual(written, pasted, "written with this PC's generation");
			// The plugin is at generation 2; the action's next appear runs this.
			assert.equal(staleLooksReset(written, kind, 2), undefined, `the next appear keeps the Glass; written ${JSON.stringify(written)}`);
		});
	}

	it("a key document from a PC at generation 5, pasted on a PC at generation 1, still goes at the next press", async () => {
		const panel = panelBeforeGlobals("key", { readingKey: "r1" });
		await panel.replace({ readingKey: "r1", keyBackground: "glass", looksGen: 5 });
		await panel.hearGlobals({ looksResetGen: 1 });
		const written = panel.writes[0] as Record<string, unknown>;
		assert.equal(written.looksGen, 1, "another PC's higher stamp comes down to this PC's generation");
		assert.notEqual(staleLooksReset(written, "key", 2), undefined, "the next press here drops it");
	});
});
