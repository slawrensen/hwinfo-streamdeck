/**
 * The single-writer edit protocol: stale bases are refused, only whitelisted
 * paths with exact values apply, one bad operation refuses the whole patch,
 * success is a complete copy at rev + 1, and every planner returns complete
 * per-context documents that never touch a dial's individual fields.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sortedJson } from "../src/sorted-json";
import { applyStripEdit, MAX_EDIT_OPS, planCreate, planEditWrites, planJoin, planLeave, planLooksReset, planReid, planResolve, planRestore, withStripGroup, type EditBase, type MemberDoc } from "../src/strip/edits";
import { stripConfigOf, stripGroupOf, stripGroupToJson, type StripGroupCopy } from "../src/strip/settings";

const ID = "0123456789abcdef0123456789abcdef";
const NEW_ID = "aaaaaaaaaaaaaaaabbbbbbbbbbbbbbbb";
const base = (rev = 3): EditBase => ({ id: ID, rev, config: stripConfigOf({ layout: "split", encoders: 6, panes: [{ style: "trend", series: [{ key: "a" }] }, { style: "heat", series: [{ key: "b" }] }] }) });
const set = (path: string, value: unknown): { op: "set"; path: string; value: unknown } => ({ op: "set", path, value });

const INDIVIDUAL = { readingKey: "31:0:1", rotationKeys: ["31:0:1", "31:0:2"], dialBackground: "glass", dialAccentWords: true, label: "Mine", theme: "ember", controlPreset: "elite" };

describe("applyStripEdit", () => {
	it("a stale base is refused with the current revision and config", () => {
		const r = applyStripEdit(base(3), 2, [set("window", "1m")]);
		assert.equal(r.ok, false);
		assert.ok(!r.ok && r.reason === "stale" && r.rev === 3 && r.config?.window === "5m");
		assert.equal(applyStripEdit(base(3), "3", [set("window", "1m")]).ok, false);
	});

	it("no group: refused", () => {
		const r = applyStripEdit(null, 0, [set("window", "1m")]);
		assert.ok(!r.ok && r.reason === "no-group");
	});

	it("a valid edit is a complete copy at rev + 1", () => {
		const r = applyStripEdit(base(3), 3, [set("window", "15m"), set("panes.1.style", "area"), set("background", "outline"), set("panes.0.overlays.minmax", true), set("panes.0.scale.min", "20")]);
		assert.ok(r.ok);
		assert.equal(r.copy.rev, 4);
		assert.equal(r.copy.id, ID);
		assert.equal(r.copy.joined, true);
		assert.equal(r.copy.config.window, "15m");
		assert.equal(r.copy.config.panes[1].style, "area");
		assert.equal(r.copy.config.background, "outline");
		assert.equal(r.copy.config.panes[0].overlays.minmax, true);
		assert.deepEqual(r.copy.config.panes[0].scale, { min: 20 });
		// Untouched fields stay as they were.
		assert.deepEqual(r.copy.config.panes[0].series, [{ key: "a" }]);
		assert.equal(r.copy.config.layout, "split");
	});

	it("one invalid operation refuses the whole patch (never partial)", () => {
		const b = base(3);
		const before = sortedJson(b.config);
		const bad: unknown[][] = [
			[set("window", "15m"), set("window", "10m")],
			[set("window", "15m"), set("layout", "Split")],
			[set("window", "15m"), set("background", "Glass")],
			[set("window", "15m"), set("panes.2.style", "area")],
			[set("window", "15m"), set("panes.0.style", "line")],
			[set("window", "15m"), set("rotationKeys", [])],
			[set("window", "15m"), set("readingKey", "x")],
			[set("window", "15m"), set("id", NEW_ID)],
			[set("window", "15m"), set("rev", 99)],
			[set("window", "15m"), set("panes.0.series", [{ key: "a", color: "blue" }])],
			[set("window", "15m"), set("panes.0.series", [{ key: "a" }, { key: "a" }])],
			[set("window", "15m"), set("panes.0.series", [{ key: "a", extra: 1 }])],
			[set("window", "15m"), set("panes.0.overlays.sparkle", true)],
			[set("window", "15m"), set("panes.0.overlays.minmax", "yes")],
			[set("window", "15m"), set("panes.0.scale.min", "abc")],
			[set("window", "15m"), set("panes.0.bands", [{ key: "a" }])],
			[set("window", "15m"), set("accentWords", "true")],
			[set("window", "15m"), set("textColor", "#12345")],
			[set("window", "15m"), { op: "remove", path: "window" }],
			[set("window", "15m"), "window=1m"],
			[set("window", "15m"), set("encoders", 4)]
		];
		for (const patch of bad) {
			const r = applyStripEdit(b, 3, patch, { deviceEncoders: 6 });
			assert.ok(!r.ok && r.reason === "invalid", JSON.stringify(patch[1]));
		}
		assert.equal(sortedJson(b.config), before, "the authority object is never mutated");
	});

	it("whole-edit consistency: at most six readings, bands name a pane reading, a range is a range", () => {
		const b = base(3);
		// A style that draws fewer keeps the rest: they are not drawn, never cut.
		const heat = applyStripEdit(b, 3, [set("panes.0.style", "heat"), set("panes.0.series", [{ key: "a" }, { key: "c" }])]);
		assert.ok(heat.ok && heat.copy.config.panes[0].series.length === 2);
		assert.ok(applyStripEdit(b, 3, [set("panes.0.series", ["a", "b", "c", "d", "e", "f"].map((key) => ({ key })))]).ok, "six readings (Meters on a + XL)");
		assert.ok(!applyStripEdit(b, 3, [set("panes.0.series", ["a", "b", "c", "d", "e", "f", "g"].map((key) => ({ key })))]).ok, "seven readings are refused");
		assert.ok(!applyStripEdit(b, 3, [set("panes.0.bands", [{ key: "zzz", warn: 1 }])]).ok);
		assert.ok(applyStripEdit(b, 3, [set("panes.0.bands", [{ key: "a", warn: 80, crit: "90" }])]).ok);
		// Removing a reading must remove its band in the same edit.
		const withBand = applyStripEdit(b, 3, [set("panes.0.bands", [{ key: "a", warn: 80 }])]);
		assert.ok(withBand.ok);
		const next: EditBase = { id: ID, rev: withBand.copy.rev, config: withBand.copy.config };
		assert.ok(!applyStripEdit(next, 4, [set("panes.0.series", [{ key: "c" }])]).ok);
		assert.ok(applyStripEdit(next, 4, [set("panes.0.series", [{ key: "c" }]), set("panes.0.bands", [])]).ok);
		assert.ok(!applyStripEdit(b, 3, [set("panes.0.scale.min", 90), set("panes.0.scale.max", 10)]).ok);
	});

	it("four readings in a two-reading style are kept across edits and style switches", () => {
		const four = ["a", "b", "c", "d"].map((key) => ({ key }));
		let b: EditBase = { id: ID, rev: 1, config: stripConfigOf({ layout: "whole", encoders: 4, panes: [{ style: "compare", series: four }, {}] }) };
		const steps: unknown[][] = [[set("panes.0.style", "lanes")], [set("window", "15m")], [set("panes.0.style", "heat")], [set("panes.0.overlays.minmax", true)], [set("panes.0.style", "trend")], [set("panes.0.style", "compare")]];
		for (const patch of steps) {
			const r = applyStripEdit(b, b.rev, patch, { deviceEncoders: 4 });
			assert.ok(r.ok, JSON.stringify(patch));
			// What a member reads back after the write (a reload) is what it holds.
			const reloaded = stripGroupOf(stripGroupToJson(r.copy));
			assert.deepEqual(reloaded?.config.panes[0].series, four, JSON.stringify(patch));
			b = { id: ID, rev: r.copy.rev, config: reloaded?.config ?? r.copy.config };
		}
	});

	it("operation count is bounded", () => {
		assert.ok(!applyStripEdit(base(3), 3, []).ok);
		assert.ok(!applyStripEdit(base(3), 3, Array.from({ length: MAX_EDIT_OPS + 1 }, () => set("window", "1m"))).ok);
		assert.ok(applyStripEdit(base(3), 3, Array.from({ length: MAX_EDIT_OPS }, () => set("window", "1m"))).ok);
		assert.ok(!applyStripEdit(base(3), 3, { op: "set", path: "window", value: "1m" }).ok);
	});

	it("clearing: an empty string returns a look field to the deck default", () => {
		const b: EditBase = { id: ID, rev: 1, config: stripConfigOf({ encoders: 6, theme: "ember", textMode: "dim", linkId: "x" }) };
		const r = applyStripEdit(b, 1, [set("theme", ""), set("textMode", ""), set("linkId", "  ")]);
		assert.ok(r.ok);
		assert.equal(r.copy.config.theme, undefined);
		assert.equal(r.copy.config.textMode, undefined);
		assert.equal(r.copy.config.linkId, undefined);
	});

	it("Background \"\" and Words null go back to Default (the shared ones); junk is still refused", () => {
		const b: EditBase = { id: ID, rev: 1, config: stripConfigOf({ encoders: 6, background: "clear", accentWords: false, looksGen: 2 }) };
		const r = applyStripEdit(b, 1, [set("background", ""), set("accentWords", null)]);
		assert.ok(r.ok);
		assert.equal(r.copy.config.background, undefined);
		assert.equal(r.copy.config.accentWords, undefined);
		for (const junk of [[set("background", null)], [set("background", "Clear")], [set("accentWords", "")], [set("accentWords", 0)]]) assert.equal(applyStripEdit(b, 1, junk).ok, false, JSON.stringify(junk));
	});

	it("a Background or Words picked after a \"Use it everywhere\" carries that generation; Default and other edits stamp nothing", () => {
		const b: EditBase = { id: ID, rev: 1, config: stripConfigOf({ encoders: 6 }) };
		const own = applyStripEdit(b, 1, [set("background", "clear")], { looksGen: 3 });
		assert.ok(own.ok && own.copy.config.looksGen === 3 && own.copy.config.background === "clear");
		const words = applyStripEdit(b, 1, [set("accentWords", true)], { looksGen: 3 });
		assert.ok(words.ok && words.copy.config.looksGen === 3);
		const back = applyStripEdit(b, 1, [set("background", ""), set("accentWords", null)], { looksGen: 3 });
		assert.ok(back.ok && back.copy.config.looksGen === undefined);
		const other = applyStripEdit(b, 1, [set("window", "1m")], { looksGen: 3 });
		assert.ok(other.ok && other.copy.config.looksGen === undefined);
		const never = applyStripEdit(b, 1, [set("background", "clear")], { looksGen: 0 });
		assert.ok(never.ok && never.copy.config.looksGen === undefined, "no reset ever made: nothing added");
	});

	it("Stars and Sky color take only their exact names (All, Few, Off; five tones), \"\" goes back to Default, some and a combined Sky are refused, and a pick after a reset carries the generation", () => {
		const b: EditBase = { id: ID, rev: 1, config: stripConfigOf({ encoders: 6 }) };
		for (const stars of ["all", "few", "off"]) {
			for (const tone of ["theme", "deep", "warm", "cool", "mono"]) {
				const r = applyStripEdit(b, 1, [set("stars", stars), set("skyColor", tone)]);
				assert.ok(r.ok);
				assert.deepEqual([r.copy.config.stars, r.copy.config.skyColor], [stars, tone]);
				const back = applyStripEdit({ id: ID, rev: 2, config: r.copy.config }, 2, [set("stars", ""), set("skyColor", "")]);
				assert.ok(back.ok);
				assert.deepEqual([back.copy.config.stars, back.copy.config.skyColor], [undefined, undefined]);
			}
		}
		for (const junk of [[set("stars", "Some")], [set("stars", "some")], [set("stars", "none")], [set("stars", null)], [set("skyColor", "teal")], [set("skyColor", "Cool")], [set("skyColor", "warmer")], [set("sky", "deep")], [set("sky", "")]]) assert.equal(applyStripEdit(b, 1, junk).ok, false, JSON.stringify(junk));
		const own = applyStripEdit({ id: ID, rev: 1, config: stripConfigOf({ encoders: 6 }) }, 1, [set("skyColor", "mono")], { looksGen: 4 });
		assert.ok(own.ok && own.copy.config.looksGen === 4);
		const dflt = applyStripEdit({ id: ID, rev: 1, config: stripConfigOf({ encoders: 6 }) }, 1, [set("stars", "")], { looksGen: 4 });
		assert.ok(dflt.ok && dflt.copy.config.looksGen === undefined);
	});

	it("a mismatched group can only be edited by re-targeting it to this deck", () => {
		const xlGroup = base(2);
		const onPlus = applyStripEdit(xlGroup, 2, [set("window", "1m")], { deviceEncoders: 4 });
		assert.ok(!onPlus.ok && onPlus.reason === "mismatch");
		const retarget = applyStripEdit(xlGroup, 2, [set("encoders", 4), set("window", "1m")], { deviceEncoders: 4 });
		assert.ok(retarget.ok);
		assert.equal(retarget.copy.config.encoders, 4);
	});
});

describe("the strip's start: the reading it was made with, kept until a person changes those readings", () => {
	const made = (patch?: unknown[]): StripGroupCopy => {
		const plan = planCreate({ id: ID, layout: "split", encoders: 6, seedFrom: { readingKey: "31:0:1" }, members: [{ context: "a", settings: { readingKey: "31:0:1" } }], ...(patch === undefined ? {} : { patch }) });
		assert.ok(plan.ok);
		return plan.copy;
	};
	const stored = (copy: StripGroupCopy) => (stripGroupToJson(copy) as { config: { panes: Record<string, unknown>[]; screens?: Record<string, unknown>[] } }).config;

	it("a new strip stores its creating dial's reading beside its first pane, and reads it back", () => {
		const copy = made();
		assert.equal(copy.config.panes[0].seed, "31:0:1");
		assert.equal(stored(copy).panes[0]?.seed, "31:0:1");
		assert.equal(stored(copy).panes[1]?.seed, undefined);
		assert.equal(stripGroupOf(stripGroupToJson(copy))?.config.panes[0].seed, "31:0:1", "written and read back as it was");
		assert.equal(stripConfigOf({ layout: "whole", encoders: 6, panes: [{ style: "trend", series: [{ key: "a" }], seed: 5 }] }).panes[0].seed, undefined, "a seed that is not a reading key reads as none");
	});

	it("an edit of the first pane's readings drops it; an edit of anything else, or of the other half, keeps it", () => {
		const copy = made();
		const base0: EditBase = { id: copy.id, rev: copy.rev, config: copy.config };
		const kept = applyStripEdit(base0, 1, [set("window", "15m"), set("panes.0.style", "area"), set("panes.1.series", [{ key: "b" }])], { deviceEncoders: 6 });
		assert.ok(kept.ok);
		assert.equal(kept.copy.config.panes[0].seed, "31:0:1");
		const picked = applyStripEdit(base0, 1, [set("panes.0.series", [{ key: "31:0:1" }])], { deviceEncoders: 6 });
		assert.ok(picked.ok);
		assert.equal(picked.copy.config.panes[0].seed, undefined, "even the same reading chosen again is a person's choice");
		assert.equal(made([set("panes.0.series", [{ key: "x" }])]).config.panes[0].seed, undefined, "a create whose own patch sets the first readings keeps no start");
	});

	it("a copied screen takes no seed", () => {
		const copy = made();
		const whole = applyStripEdit({ id: copy.id, rev: copy.rev, config: copy.config }, 1, [set("layout", "whole"), { op: "addScreen", at: 1, from: "copy" }], { deviceEncoders: 6 });
		assert.ok(whole.ok);
		assert.equal(whole.copy.config.panes[0].seed, "31:0:1");
		assert.equal(whole.copy.config.screens?.[0]?.seed, undefined);
	});
});

describe("planners: complete documents, individual fields untouched", () => {
	const members: MemberDoc[] = [
		{ context: "a", settings: { ...INDIVIDUAL } },
		{ context: "b", settings: { readingKey: "31:0:9", dialView: "tworow" } }
	];

	it("create: rev 1, the creating dial's theme copied once, its Background and Words not (Default), readings seeded, every chosen dial written", () => {
		const plan = planCreate({ id: ID, layout: "whole", encoders: 6, seedFrom: INDIVIDUAL, members });
		assert.ok(plan.ok);
		assert.equal(plan.copy.rev, 1);
		assert.equal(plan.copy.config.background, undefined);
		assert.equal(plan.copy.config.accentWords, undefined);
		assert.equal(plan.copy.config.theme, "ember");
		assert.deepEqual(plan.copy.config.panes[0].series, [{ key: "31:0:1" }]);
		assert.equal(plan.writes.length, 2);
		for (const w of plan.writes) {
			const before = members.find((m) => m.context === w.context)?.settings as Record<string, unknown>;
			const { stripGroup, ...rest } = w.settings;
			assert.deepEqual(rest, before, "individual fields byte for byte");
			assert.equal(sortedJson(stripGroupOf(stripGroup)), sortedJson(plan.copy));
		}
	});

	it("create with a patch applies it in the same step, or refuses entirely", () => {
		const plan = planCreate({ id: ID, layout: "split", encoders: 4, seedFrom: {}, members, patch: [set("panes.1.style", "compare"), set("panes.1.series", [{ key: "x" }, { key: "y" }])] });
		assert.ok(plan.ok && plan.copy.config.panes[1].style === "compare");
		const bad = planCreate({ id: ID, layout: "split", encoders: 4, seedFrom: {}, members, patch: [set("panes.1.style", "nope")] });
		assert.equal(bad.ok, false);
		assert.equal(planCreate({ id: ID, layout: "whole", encoders: 4, seedFrom: {}, members: [] }).ok, false);
	});

	it("edit writes go to every visible joined member, complete", () => {
		const r = applyStripEdit(base(3), 3, [set("window", "1m")]);
		assert.ok(r.ok);
		const writes = planEditWrites(r.copy, members);
		assert.equal(writes.length, 2);
		for (const w of writes) assert.equal(stripGroupOf(w.settings.stripGroup)?.rev, 4);
	});

	it("leave keeps a dormant copy and the dial's own fields; restore brings it back", () => {
		const b = base(5);
		const joined = planJoin(b, members).writes;
		const leaving = planLeave(b, [{ context: "a", settings: joined[0]?.settings ?? {} }]);
		const left = leaving[0]?.settings ?? {};
		const dormant = stripGroupOf(left.stripGroup);
		assert.equal(dormant?.joined, false);
		assert.equal(dormant?.rev, 5);
		const { stripGroup: _ignored, ...individual } = left;
		void _ignored;
		assert.deepEqual(individual, INDIVIDUAL, "leaving restores the saved individual configuration");
		// Restore with a live authority takes it; without one, the newest dormant copy.
		const restored = planRestore(ID, { ...b, rev: 6 }, [{ context: "a", settings: left }]);
		assert.equal(restored?.copy.rev, 6);
		assert.equal(restored?.copy.joined, true);
		const offline = planRestore(ID, null, [{ context: "a", settings: left }]);
		assert.equal(offline?.copy.rev, 5);
		assert.equal(planRestore(ID, null, members), undefined);
	});

	it("restore and join never lower the revision: a newer left copy comes back above the live one", () => {
		const live = base(1);
		const newer = { ...base(2), config: stripConfigOf({ encoders: 6, window: "15m" }) };
		const left = planLeave(newer, [{ context: "a", settings: INDIVIDUAL }])[0]?.settings ?? {};
		const hidden = planEditWrites({ v: 1, id: ID, rev: 1, joined: true, config: live.config }, [{ context: "b", settings: INDIVIDUAL }])[0]?.settings ?? {};
		const restored = planRestore(ID, live, [{ context: "a", settings: left }], [{ context: "b", settings: hidden }]);
		assert.equal(restored?.copy.rev, 3, "above both revisions");
		assert.equal(restored?.copy.config.window, "15m", "the newer setup");
		assert.deepEqual(
			restored?.writes.map((w) => [w.context, stripGroupOf(w.settings.stripGroup)?.rev, stripGroupOf(w.settings.stripGroup)?.joined]),
			[
				["b", 3, true],
				["a", 3, true]
			],
			"the live member takes the newer setup too"
		);
		// The live authority newer than the left copy: taken as it is.
		const older = planLeave(base(1), [{ context: "a", settings: INDIVIDUAL }])[0]?.settings ?? {};
		const kept = planRestore(ID, base(4), [{ context: "a", settings: older }], [{ context: "b", settings: hidden }]);
		assert.equal(kept?.copy.rev, 4);
		assert.deepEqual(kept?.writes.map((w) => w.context), ["a"], "only the left dial is written");
		// Joining with a newer left copy brings it back the same way.
		const join = planJoin(live, [{ context: "a", settings: left }], [{ context: "b", settings: hidden }]);
		assert.equal(join.copy.rev, 3);
		assert.equal(join.copy.config.window, "15m");
		assert.deepEqual(join.writes.map((w) => w.context), ["b", "a"]);
		const plain = planJoin(base(4), [{ context: "a", settings: older }], [{ context: "b", settings: hidden }]);
		assert.equal(plain.copy.rev, 4);
		assert.deepEqual(plain.writes.map((w) => w.context), ["a"]);
	});

	it("resolve: keep the group, or adopt this dial's copy above both revisions", () => {
		const b = base(4);
		const prior: StripGroupCopy = { v: 1, id: ID, rev: 4, joined: true, config: b.config };
		const foreign: StripGroupCopy = { v: 1, id: ID, rev: 9, joined: true, config: stripConfigOf({ encoders: 6, window: "1m" }) };
		const dial: MemberDoc = { context: "b", settings: withStripGroup(members[1]?.settings ?? {}, foreign) };
		const keep = planResolve({ use: "group", dial, prior, foreign, authority: b, joined: members });
		assert.equal(keep.writes.length, 1);
		assert.equal(stripGroupOf(keep.writes[0]?.settings.stripGroup)?.rev, 4);
		const adopt = planResolve({ use: "thisDial", dial, prior, foreign, authority: b, joined: [members[0] as MemberDoc] });
		assert.equal(adopt.copy?.rev, 10);
		assert.equal(adopt.copy?.config.window, "1m");
		assert.deepEqual(adopt.writes.map((w) => w.context).sort(), ["a", "b"]);
		// A dial that never had a group goes back to having none.
		const solo = planResolve({ use: "group", dial, prior: undefined, foreign, authority: null, joined: [] });
		assert.equal("stripGroup" in (solo.writes[0]?.settings ?? {}), false);
	});

	it("Use it everywhere: the strip's own Background and Words go at rev + 1, one write per member, with the dial's own looks dropped by `own` and every other field kept", () => {
		const b: EditBase = { id: ID, rev: 5, config: stripConfigOf({ encoders: 6, background: "clear", accentWords: false, looksGen: 1, window: "15m", future: { x: 1 } }) };
		const own = (s: Record<string, unknown>): Record<string, unknown> => {
			const { dialBackground: _b, dialAccentWords: _w, ...rest } = s;
			void _b;
			void _w;
			return rest;
		};
		const plan = planLooksReset(b, members, own);
		assert.equal(plan.copy.rev, 6);
		assert.equal(plan.copy.config.background, undefined);
		assert.equal(plan.copy.config.accentWords, undefined);
		assert.equal(plan.copy.config.looksGen, undefined);
		assert.equal(plan.copy.config.window, "15m");
		assert.deepEqual((stripGroupToJson(plan.copy).config as Record<string, unknown>).future, { x: 1 }, "an unknown config field rides along");
		assert.deepEqual(plan.writes.map((w) => w.context), ["a", "b"]);
		const a = plan.writes[0]?.settings ?? {};
		assert.equal(a.dialBackground, undefined);
		assert.equal(a.dialAccentWords, undefined);
		assert.equal(a.label, "Mine");
		assert.equal(a.theme, "ember", "only Background and Words go");
		assert.equal(stripGroupOf(a.stripGroup)?.rev, 6);
	});

	it("re-id mints a new identity at rev 1 for the visible members", () => {
		const plan = planReid(base(7), NEW_ID, members);
		assert.equal(plan.copy.id, NEW_ID);
		assert.equal(plan.copy.rev, 1);
		assert.ok(plan.writes.every((w) => stripGroupOf(w.settings.stripGroup)?.id === NEW_ID));
	});

	it("a rewrite keeps unknown fields of the same group's stored copy", () => {
		const stored = { ...stripGroupToJson({ v: 1, id: ID, rev: 1, joined: true, config: base().config }), future: 1 };
		const next = withStripGroup({ stripGroup: stored }, { v: 1, id: ID, rev: 2, joined: true, config: base().config });
		assert.equal((next.stripGroup as Record<string, unknown>).future, 1);
		const other = withStripGroup({ stripGroup: stored }, { v: 1, id: NEW_ID, rev: 1, joined: true, config: base().config });
		assert.equal((other.stripGroup as Record<string, unknown>).future, undefined);
	});

	it("an edit elsewhere keeps the unknown fields of series, scale and band entries", () => {
		const stored = { v: 1, id: ID, rev: 4, joined: true, config: { encoders: 4, panes: [{ style: "trend", series: [{ key: "a:0:1", stat: "avg" }], scale: { min: 0, log: true }, bands: [{ key: "a:0:1", warn: 80, dwellMs: 5000 }] }] } };
		const authority = stripGroupOf(stored);
		assert.ok(authority);
		const r = applyStripEdit(authority, 4, [set("window", "1m")]);
		assert.ok(r.ok);
		const next = withStripGroup({ stripGroup: stored }, r.copy).stripGroup as { config: { window: string; panes: Record<string, unknown>[] } };
		assert.equal(next.config.window, "1m");
		const pane = next.config.panes[0] as Record<string, unknown>;
		assert.deepEqual(pane.series, [{ stat: "avg", key: "a:0:1" }]);
		assert.deepEqual(pane.scale, { log: true, min: 0 });
		assert.deepEqual(pane.bands, [{ dwellMs: 5000, key: "a:0:1", warn: 80, below: false }]);
	});
});

describe("the unit stamp on a strip scale and band (40-spec-final.md section 4.2)", () => {
	it("32. the scale's displayUnit and displayUnitFor apply, and a band carrying both passes as one exact band", () => {
		const r = applyStripEdit(base(3), 3, [set("panes.0.scale.min", 30), set("panes.0.scale.displayUnit", "°C"), set("panes.0.scale.displayUnitFor", { min: "30" })]);
		assert.ok(r.ok, JSON.stringify(r));
		assert.deepEqual(r.copy.config.panes[0].scale, { min: 30, displayUnit: "°C" });
		const b = applyStripEdit(base(3), 3, [set("panes.0.bands", [{ key: "a", warn: 80, below: false, unit: "°C", displayUnit: "°C", displayUnitFor: { warn: "80" } }])]);
		assert.ok(b.ok, JSON.stringify(b));
		assert.equal(b.copy.config.panes[0].bands[0]?.displayUnit, "°C");
	});

	it("ends typed for a reading with no unit carry the empty stamp; only null clears it", () => {
		const r = applyStripEdit(base(3), 3, [set("panes.0.scale.max", 2), set("panes.0.scale.displayUnit", ""), set("panes.0.scale.displayUnitFor", { max: "2" })]);
		assert.ok(r.ok, JSON.stringify(r));
		assert.deepEqual(r.copy.config.panes[0].scale, { max: 2, displayUnit: "" });
		const cleared = applyStripEdit({ id: ID, rev: 4, config: r.copy.config }, 4, [set("panes.0.scale.displayUnit", null)]);
		assert.ok(cleared.ok, JSON.stringify(cleared));
		assert.deepEqual(cleared.copy.config.panes[0].scale, { max: 2 });
		const b = applyStripEdit(base(3), 3, [set("panes.0.bands", [{ key: "a", warn: 0.8, below: false, unit: "", displayUnit: "", displayUnitFor: { warn: "0.8" } }])]);
		assert.ok(b.ok, JSON.stringify(b));
		assert.equal(b.copy.config.panes[0].bands[0]?.displayUnit, "");
	});
});
