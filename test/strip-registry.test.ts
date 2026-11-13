/**
 * Strip membership and authority: groups are device id + group id, the
 * authority is the highest revision among visible joined members, ties and
 * foreign copies are conflicts that are never written back, geometry comes
 * from src/devices.ts, and stale or out-of-order lifecycle events never move
 * a member.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deriveCapabilities, type DeviceCapabilities } from "../src/devices";
import { StripRegistry, stripGroupKey, VIEW_LINEAGE_TTL_MS } from "../src/strip/registry";
import { stripGroupToJson, stripConfigOf, type StripGroupCopy } from "../src/strip/settings";

const ID = "0123456789abcdef0123456789abcdef";
const OTHER = "fedcba9876543210fedcba9876543210";
const DEVICES: Record<string, DeviceCapabilities> = {
	plus: deriveCapabilities({ type: 7, columns: 4, rows: 2 }),
	xl: deriveCapabilities({ type: 13, columns: 9, rows: 4 }),
	xl2: deriveCapabilities({ type: 13, columns: 9, rows: 4 }),
	mk2: deriveCapabilities({ type: 0, columns: 5, rows: 3 })
};
const caps = { get: (id: string): DeviceCapabilities => DEVICES[id] ?? deriveCapabilities({}) };

function copy(rev: number, opts: { id?: string; joined?: boolean; encoders?: number; layout?: string; window?: string } = {}): StripGroupCopy {
	return { v: 1, id: opts.id ?? ID, rev, joined: opts.joined ?? true, config: stripConfigOf({ layout: opts.layout ?? "whole", encoders: opts.encoders ?? 6, window: opts.window ?? "5m" }) };
}
const doc = (c: StripGroupCopy | undefined, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ readingKey: "a:0:1", ...extra, ...(c === undefined ? {} : { stripGroup: stripGroupToJson(c) }) });

function registryWith(members: { ctx: string; device?: string; column: number; copy?: StripGroupCopy }[]): StripRegistry {
	const r = new StripRegistry(caps);
	for (const m of members) r.appear({ context: m.ctx, deviceId: m.device ?? "xl", column: m.column, settings: doc(m.copy) });
	return r;
}

describe("authority", () => {
	it("the highest revision among visible joined members wins, sourced from its column", () => {
		const r = registryWith([
			{ ctx: "a", column: 0, copy: copy(2) },
			{ ctx: "b", column: 1, copy: copy(5, { window: "15m" }) },
			{ ctx: "c", column: 2, copy: copy(3) }
		]);
		const g = r.group(stripGroupKey("xl", ID));
		assert.equal(g?.authority?.rev, 5);
		assert.equal(g?.authority?.from, "b");
		assert.equal(g?.authority?.config.window, "15m");
		assert.equal(g?.conflict, null);
	});

	it("an equal-revision tie with equal content is no conflict (leftmost source)", () => {
		const r = registryWith([
			{ ctx: "b", column: 3, copy: copy(4) },
			{ ctx: "a", column: 1, copy: copy(4) }
		]);
		const g = r.group(stripGroupKey("xl", ID));
		assert.equal(g?.conflict, null);
		assert.equal(g?.authority?.from, "a");
	});

	it("an equal-revision tie with different content is a tie conflict drawn from the leftmost copy", () => {
		const r = registryWith([
			{ ctx: "right", column: 4, copy: copy(4, { window: "1m" }) },
			{ ctx: "left", column: 2, copy: copy(4, { window: "15m" }) },
			{ ctx: "old", column: 0, copy: copy(1) }
		]);
		const g = r.group(stripGroupKey("xl", ID));
		assert.deepEqual(g?.conflict, { kind: "tie", contexts: ["left", "right"] });
		assert.equal(g?.authority?.from, "left");
		assert.equal(g?.authority?.config.window, "15m");
	});

	it("dormant copies never take part in the authority", () => {
		const r = registryWith([
			{ ctx: "a", column: 0, copy: copy(2) },
			{ ctx: "b", column: 1, copy: copy(9, { joined: false, window: "1m" }) }
		]);
		const g = r.group(stripGroupKey("xl", ID));
		assert.equal(g?.authority?.rev, 2);
		assert.deepEqual(g?.dormant.map((m) => m.context), ["b"]);
		assert.equal(r.claims("b"), false);
		assert.equal(r.memberStatus("b"), "dormant");
	});

	it("a copy with rev 0 (malformed) never outranks a valid copy", () => {
		const r = registryWith([{ ctx: "a", column: 0, copy: copy(1) }]);
		r.appear({ context: "z", deviceId: "xl", column: 1, settings: { stripGroup: { ...stripGroupToJson(copy(1, { window: "1m" })), rev: "99" } } });
		assert.equal(r.group(stripGroupKey("xl", ID))?.authority?.from, "a");
	});
});

describe("device scoping and geometry", () => {
	it("the same group id on two decks is two groups", () => {
		const r = registryWith([
			{ ctx: "a", device: "xl", column: 0, copy: copy(1) },
			{ ctx: "b", device: "xl2", column: 0, copy: copy(7, { window: "1m" }) }
		]);
		assert.equal(r.group(stripGroupKey("xl", ID))?.authority?.rev, 1);
		assert.equal(r.group(stripGroupKey("xl2", ID))?.authority?.rev, 7);
		assert.equal(r.groups().length, 2);
	});

	it("slots: pane and group offset from the encoder column (+ XL split)", () => {
		const r = registryWith([0, 1, 2, 3, 4, 5].map((column) => ({ ctx: `c${column}`, column, copy: copy(1, { layout: "split" }) })));
		assert.deepEqual([0, 1, 2, 3, 4, 5].map((c) => r.slotOf(`c${c}`)?.pane), [0, 0, 0, 1, 1, 1]);
		assert.deepEqual([0, 1, 2, 3, 4, 5].map((c) => r.slotOf(`c${c}`)?.offsetX), [0, 200, 400, 600, 800, 1000]);
	});

	it("a config designed for another encoder count is a mismatch (no slot, no stretching)", () => {
		const r = registryWith([{ ctx: "a", device: "plus", column: 0, copy: copy(1, { encoders: 6 }) }]);
		assert.equal(r.group(stripGroupKey("plus", ID))?.health, "mismatch");
		assert.equal(r.memberStatus("a"), "mismatch");
		assert.equal(r.claims("a"), true);
		assert.equal(r.slotOf("a"), undefined);
		const absent = registryWith([{ ctx: "b", device: "plus", column: 0, copy: { ...copy(1), config: stripConfigOf({}) } }]);
		assert.equal(absent.memberStatus("b"), "mismatch");
	});

	it("a device with no touch strip is the unknown-device state", () => {
		const r = registryWith([
			{ ctx: "a", device: "mk2", column: 0, copy: copy(1, { encoders: 4 }) },
			{ ctx: "b", device: "never-seen", column: 0, copy: copy(1, { encoders: 4 }) }
		]);
		assert.equal(r.memberStatus("a"), "unknown-device");
		assert.equal(r.memberStatus("b"), "unknown-device");
		assert.equal(r.slotOf("a"), undefined);
	});

	it("a column outside the device's encoders is outside, not a slot", () => {
		const r = registryWith([
			{ ctx: "a", device: "plus", column: 0, copy: copy(1, { encoders: 4 }) },
			{ ctx: "b", device: "plus", column: 5, copy: copy(1, { encoders: 4 }) }
		]);
		assert.equal(r.memberStatus("b"), "outside");
		assert.deepEqual(r.group(stripGroupKey("plus", ID))?.outside.map((m) => m.context), ["b"]);
	});
});

describe("epochs and lifecycle order", () => {
	it("every appear gets a new epoch; replays included", () => {
		const r = new StripRegistry(caps);
		const first = r.appear({ context: "a", deviceId: "xl", column: 0, settings: doc(copy(1)) }).epoch;
		const replay = r.appear({ context: "a", deviceId: "xl", column: 0, settings: doc(copy(1)) }).epoch;
		assert.ok(replay > first);
		assert.equal(r.isCurrent("a", first), false);
		assert.equal(r.isCurrent("a", replay), true);
	});

	it("a disappear whose column does not match the live record is ignored", () => {
		const r = registryWith([{ ctx: "a", column: 2, copy: copy(1) }]);
		assert.deepEqual(r.disappear("a", 3).groups, []);
		assert.ok(r.member("a"));
		assert.deepEqual(r.disappear("a", 2).groups, [stripGroupKey("xl", ID)]);
		assert.equal(r.member("a"), undefined);
		assert.deepEqual(r.disappear("a", 2).groups, []);
	});

	it("an appear on a new column before the old column's disappear: the late disappear changes nothing", () => {
		const r = new StripRegistry(caps);
		const one = r.appear({ context: "a", deviceId: "xl", column: 1, settings: doc(copy(1)) }).epoch;
		const two = r.appear({ context: "a", deviceId: "xl", column: 4, settings: doc(copy(1)) }).epoch;
		r.disappear("a", 1);
		assert.equal(r.member("a")?.column, 4);
		assert.equal(r.isCurrent("a", one), false);
		assert.equal(r.isCurrent("a", two), true);
		assert.equal(r.slotOf("a")?.offsetX, 800);
	});

	it("two contexts in one column: the later appear owns the slot, the other is outside", () => {
		const r = registryWith([
			{ ctx: "first", column: 1, copy: copy(1) },
			{ ctx: "second", column: 1, copy: copy(1) }
		]);
		assert.equal(r.slotOf("second")?.column, 1);
		assert.equal(r.slotOf("first"), undefined);
		assert.equal(r.memberStatus("first"), "outside");
	});

	it("deviceGone drops every member on that device only", () => {
		const r = registryWith([
			{ ctx: "a", device: "xl", column: 0, copy: copy(1) },
			{ ctx: "b", device: "xl", column: 1, copy: copy(1) },
			{ ctx: "c", device: "xl2", column: 0, copy: copy(1) }
		]);
		assert.deepEqual(r.deviceGone("xl").groups, [stripGroupKey("xl", ID)]);
		assert.equal(r.member("a"), undefined);
		assert.equal(r.member("b"), undefined);
		assert.ok(r.member("c"));
	});

	it("a group with no visible members is gone; its copies come back with their dials", () => {
		const r = registryWith([{ ctx: "a", column: 0, copy: copy(3) }]);
		r.disappear("a", 0);
		assert.equal(r.group(stripGroupKey("xl", ID)), undefined);
		r.appear({ context: "a", deviceId: "xl", column: 0, settings: doc(copy(3)) });
		assert.equal(r.group(stripGroupKey("xl", ID))?.authority?.rev, 3);
	});
});

describe("settings from outside the plugin", () => {
	it("an unchanged stripGroup in a new document is not a strip change", () => {
		const c = copy(2);
		const r = registryWith([{ ctx: "a", column: 0, copy: c }]);
		// The app reorders keys; the canonical comparison ignores that.
		const reordered = { label: "new", stripGroup: JSON.parse(JSON.stringify({ config: stripGroupToJson(c).config, joined: true, rev: 2, id: ID, v: 1 })) as unknown };
		assert.equal(r.settingsChanged("a", reordered).settings, "unrelated");
	});

	it("a stale whole document (same id, not newer) keeps the group and asks for a re-stamp", () => {
		const r = registryWith([
			{ ctx: "a", column: 0, copy: copy(4, { window: "15m" }) },
			{ ctx: "b", column: 1, copy: copy(4, { window: "15m" }) }
		]);
		const change = r.settingsChanged("a", doc(copy(3, { window: "1m" })));
		assert.equal(change.settings, "stale");
		assert.equal(change.restamp?.context, "a");
		assert.equal(change.restamp?.copy.rev, 4);
		assert.equal(change.restamp?.copy.config.window, "15m");
		assert.equal(r.group(stripGroupKey("xl", ID))?.authority?.config.window, "15m");
		assert.equal(r.group(stripGroupKey("xl", ID))?.conflict, null);
	});

	it("a document that lost its stripGroup (written from before the join) is stale too", () => {
		const r = registryWith([{ ctx: "a", column: 0, copy: copy(2) }]);
		const change = r.settingsChanged("a", { readingKey: "a:0:1" });
		assert.equal(change.settings, "stale");
		assert.equal(change.restamp?.copy.rev, 2);
		assert.equal(r.claims("a"), true);
	});

	it("a newer or different copy is foreign: shown as a conflict, never adopted", () => {
		const r = registryWith([
			{ ctx: "a", column: 0, copy: copy(2) },
			{ ctx: "b", column: 1, copy: copy(2) }
		]);
		const pasted = copy(9, { window: "1m" });
		const change = r.settingsChanged("b", doc(pasted));
		assert.equal(change.settings, "foreign");
		const g = r.group(stripGroupKey("xl", ID));
		assert.equal(g?.authority?.rev, 2);
		assert.equal(g?.authority?.config.window, "5m");
		assert.deepEqual(g?.conflict, { kind: "foreign", contexts: ["b"] });
		assert.equal(r.member("b")?.foreign?.rev, 9);
	});

	it("a pending foreign copy survives a page swipe instead of winning on max revision", () => {
		const r = registryWith([
			{ ctx: "a", column: 0, copy: copy(2) },
			{ ctx: "b", column: 1, copy: copy(2) }
		]);
		const pasted = doc(copy(9, { window: "1m" }));
		r.settingsChanged("b", pasted);
		r.disappear("a", 0);
		r.disappear("b", 1);
		r.appear({ context: "a", deviceId: "xl", column: 0, settings: doc(copy(2)) });
		r.appear({ context: "b", deviceId: "xl", column: 1, settings: pasted });
		const g = r.group(stripGroupKey("xl", ID));
		assert.equal(g?.authority?.rev, 2);
		assert.equal(g?.conflict?.kind, "foreign");
	});

	it("a foreign copy on an independent dial does not make it a member", () => {
		const r = registryWith([{ ctx: "solo", column: 0 }]);
		assert.equal(r.settingsChanged("solo", doc(copy(1, { id: OTHER }))).settings, "foreign");
		assert.equal(r.claims("solo"), false);
		assert.equal(r.group(stripGroupKey("xl", OTHER))?.conflict?.kind, "foreign");
	});

	it("the plugin's own write ends a conflict and becomes the accepted copy", () => {
		const r = registryWith([{ ctx: "a", column: 0, copy: copy(2) }]);
		r.settingsChanged("a", doc(copy(9, { window: "1m" })));
		r.noteWritten("a", doc(copy(10, { window: "1m" })));
		const g = r.group(stripGroupKey("xl", ID));
		assert.equal(g?.conflict, null);
		assert.equal(g?.authority?.rev, 10);
	});

	it("settings for a context that is not visible are untracked", () => {
		assert.equal(new StripRegistry(caps).settingsChanged("ghost", {}).settings, "untracked");
	});
});

describe("independent dials", () => {
	it("absent stripGroup: independent, never claimed, no group", () => {
		const r = registryWith([{ ctx: "a", column: 0 }]);
		assert.equal(r.claims("a"), false);
		assert.equal(r.memberStatus("a"), "independent");
		assert.equal(r.groupOf("a"), undefined);
		assert.deepEqual(r.groups(), []);
	});
});

describe("view lineage across page swipes and same-device copies", () => {
	const KEY = stripGroupKey("xl", ID);
	function clocked(): { r: StripRegistry; at: (ms: number) => void } {
		let t = 0;
		return { r: new StripRegistry(caps, () => t), at: (ms) => (t = ms) };
	}
	const show = (r: StripRegistry, ctx: string, column: number, c: StripGroupCopy = copy(3)) => r.appear({ context: ctx, deviceId: "xl", column, settings: doc(c) }).change.shown;

	it("a new group comes into view fresh; members that follow it do not show it again", () => {
		const { r } = clocked();
		assert.deepEqual(show(r, "a0", 0), [{ key: KEY, restoreView: false }]);
		assert.equal(show(r, "a1", 1), undefined);
		assert.deepEqual(r.lineageOf(KEY), ["a0", "a1"]);
	});

	it("back from a page swipe within the TTL, the group's own members restore its view", () => {
		const { r, at } = clocked();
		show(r, "a0", 0);
		show(r, "a1", 1);
		at(1000);
		r.disappear("a0", 0);
		r.disappear("a1", 1);
		at(1000 + VIEW_LINEAGE_TTL_MS);
		assert.deepEqual(show(r, "a1", 1), [{ key: KEY, restoreView: true }]);
		assert.equal(show(r, "a0", 0), undefined);
	});

	it("past the TTL the view starts fresh", () => {
		const { r, at } = clocked();
		show(r, "a0", 0);
		at(1000);
		r.disappear("a0", 0);
		at(1001 + VIEW_LINEAGE_TTL_MS);
		assert.deepEqual(show(r, "a0", 0), [{ key: KEY, restoreView: false }]);
	});

	it("a same-device profile copy (same device id, same group id, other contexts) never inherits the paused view", () => {
		const { r, at } = clocked();
		show(r, "a0", 0);
		show(r, "a1", 1);
		r.disappear("a0", 0);
		r.disappear("a1", 1);
		at(5000);
		assert.deepEqual(show(r, "b0", 0), [{ key: KEY, restoreView: false }], "the copy starts live");
		show(r, "b1", 1);
		assert.deepEqual(r.lineageOf(KEY), ["b0", "b1"]);
		r.disappear("b0", 0);
		r.disappear("b1", 1);
		at(6000);
		// The copy's view does not leak back to the first profile either.
		assert.deepEqual(show(r, "a0", 0), [{ key: KEY, restoreView: false }]);
	});

	it("a dial that joins a visible group (a plugin write) is in the lineage after it", () => {
		const { r } = clocked();
		show(r, "a0", 0);
		r.appear({ context: "c", deviceId: "xl", column: 2, settings: doc(undefined) });
		assert.equal(r.noteWritten("c", doc(copy(3))).shown, undefined, "the group was already in view");
		r.disappear("a0", 0);
		r.disappear("c", 2);
		assert.deepEqual(show(r, "c", 2), [{ key: KEY, restoreView: true }]);
	});

	it("leaving and a device disconnect hide the group; another device's group is its own", () => {
		const { r } = clocked();
		show(r, "a0", 0);
		assert.equal(r.noteWritten("a0", doc(copy(3, { joined: false }))).shown, undefined);
		assert.deepEqual(r.noteWritten("a0", doc(copy(3))).shown, [{ key: KEY, restoreView: true }], "restore after leave is the same member");
		r.appear({ context: "x0", deviceId: "xl2", column: 0, settings: doc(copy(3)) });
		r.deviceGone("xl");
		assert.deepEqual(r.appear({ context: "a0", deviceId: "xl2", column: 1, settings: doc(copy(3)) }).change.shown, undefined, "xl2's group is already in view, and a0 was never its member");
		assert.deepEqual(r.lineageOf(stripGroupKey("xl2", ID)), ["x0", "a0"]);
		assert.deepEqual(show(r, "a0", 0), [{ key: KEY, restoreView: true }]);
	});

	it("lineages of hidden groups are bounded", () => {
		const { r, at } = clocked();
		for (let i = 0; i < 100; i++) {
			const id = i.toString(16).padStart(32, "0");
			at(i);
			r.appear({ context: `g${i}`, deviceId: "xl", column: 0, settings: doc(copy(1, { id })) });
			r.disappear(`g${i}`, 0);
		}
		at(200);
		show(r, "a0", 0);
		const kept = Array.from({ length: 100 }, (_, i) => r.lineageOf(stripGroupKey("xl", i.toString(16).padStart(32, "0"))).length > 0).filter(Boolean).length;
		assert.ok(kept <= 64, String(kept));
		assert.ok(r.lineageOf(stripGroupKey("xl", (99).toString(16).padStart(32, "0"))).length > 0, "the most recently hidden are kept");
	});
});

describe("public sources", () => {
	it("cite no private design records", async () => {
		const { readdirSync, readFileSync } = await import("node:fs");
		const files = [...readdirSync("src/strip").map((f) => `src/strip/${f}`), "scripts/lib/strip-fixtures.ts", "scripts/strip-boards.mjs", ...readdirSync("test").filter((f) => f.startsWith("strip-")).map((f) => `test/${f}`)];
		for (const file of files) {
			const text = readFileSync(file, "utf8");
			// Spelled in pieces so this file does not match itself.
			for (const banned of [["council", "wave"].join("-"), ["next", "release"].join("-"), ["design", ""].join("/"), ["ledger", '"'].join(" ")]) {
				assert.ok(!text.includes(banned), `${file} cites ${banned}`);
			}
		}
	});
});
