/**
 * A strip copy written to a dial other than the one it was read from keeps the
 * fields a newer version stored with it. Before this, joining a dial that had
 * no copy, Make independent of copies, and choosing a pasted copy ("this
 * dial") rebuilt the copy from the parsed config alone, so a newer build's
 * fields (screens, for one) were lost or the dial's old ones landed instead;
 * and two copies at the same revision that differed only in such a field read
 * as one authority.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { applyStripEdit, planEditWrites, planJoin, planLeave, planReid, planResolve, type EditBase, type MemberDoc } from "../src/strip/edits";
import { resolveAuthority, type StripMember } from "../src/strip/registry";
import { stripConfigOf, stripGroupOf, type StripGroupCopy } from "../src/strip/settings";
import { stampRewrites } from "./strip-older-build-driver";

const ID = "0123456789abcdef0123456789abcdef";
const NEW_ID = "aaaaaaaaaaaaaaaabbbbbbbbbbbbbbbb";

/** A stored copy as a newer version might write it: unknown fields at the
 * group, config and pane level (screens and screenCycle were such fields
 * until this build knew them; test/strip-screens.test.ts holds those). */
function stored(rev: number, tag: string): Record<string, unknown> {
	return {
		v: 1,
		id: ID,
		rev,
		joined: true,
		future: { group: tag },
		config: {
			layout: "whole",
			encoders: 6,
			futureList: [{ name: `screen ${tag}`, style: "meters", series: [{ key: "f0:0:3" }] }],
			futureValue: tag,
			panes: [{ style: "trend", series: [{ key: "f0:0:1" }], paneFuture: tag }, { style: "trend", series: [] }]
		}
	};
}

const copyOf = (raw: Record<string, unknown>): StripGroupCopy => stripGroupOf(raw) as StripGroupCopy;
const baseOf = (raw: Record<string, unknown>): EditBase => {
	const copy = copyOf(raw);
	return { id: copy.id, rev: copy.rev, config: copy.config };
};
const groupOf = (settings: Record<string, unknown>): Record<string, unknown> => settings.stripGroup as Record<string, unknown>;
const configOf = (settings: Record<string, unknown>): Record<string, unknown> => groupOf(settings).config as Record<string, unknown>;

describe("strip copies keep a newer version's fields on every write path", () => {
	it("a dial with no copy joins and takes the authority's fields", () => {
		const authority = baseOf(stored(4, "A"));
		const fresh: MemberDoc = { context: "fresh", settings: { readingKey: "f0:0:9" } };
		const plan = planJoin(authority, [fresh]);
		const config = configOf(plan.writes[0]?.settings ?? {});
		assert.deepEqual(config.futureList, [{ name: "screen A", style: "meters", series: [{ key: "f0:0:3" }] }]);
		assert.equal(config.futureValue, "A");
		assert.equal((config.panes as Record<string, unknown>[])[0]?.paneFuture, "A");
		assert.equal(plan.writes[0]?.settings.readingKey, "f0:0:9", "the dial's own settings stay");
	});

	it("Make independent of copies keeps the fields under the new id", () => {
		const authority = baseOf(stored(4, "A"));
		const member: MemberDoc = { context: "m", settings: { stripGroup: stored(4, "A") } };
		const plan = planReid(authority, NEW_ID, [member]);
		const group = groupOf(plan.writes[0]?.settings ?? {});
		assert.equal(group.id, NEW_ID);
		assert.equal(group.rev, 1);
		assert.equal((group.config as Record<string, unknown>).futureValue, "A");
		assert.deepEqual(group.future, { group: "A" }, "group-level fields follow the config they came with");
	});

	it("choosing a pasted copy writes the pasted copy's fields, not the dial's old ones", () => {
		const authority = baseOf(stored(4, "A"));
		const dialRaw = stored(4, "A");
		const pastedRaw = { ...stored(2, "B") };
		const dial: MemberDoc = { context: "d", settings: { stripGroup: dialRaw, stripGroupPasted: pastedRaw } };
		const other: MemberDoc = { context: "o", settings: { stripGroup: stored(4, "A") } };
		const plan = planResolve({ use: "thisDial", dial, prior: copyOf(dialRaw), foreign: copyOf(pastedRaw), authority, joined: [other] });
		for (const write of plan.writes) {
			const config = configOf(write.settings);
			assert.equal(config.futureValue, "B", `${write.context}: the pasted copy's field landed`);
			assert.deepEqual(config.futureList, [{ name: "screen B", style: "meters", series: [{ key: "f0:0:3" }] }]);
		}
		assert.equal(plan.writes.find((w) => w.context === "d")?.settings.stripGroupPasted, undefined, "the pasted copy kept apart goes");
	});

	it("an edit keeps the fields, and so does leaving", () => {
		const raw = stored(4, "A");
		const authority = baseOf(raw);
		const result = applyStripEdit(authority, 4, [{ op: "set", path: "window", value: "15m" }]);
		assert.equal(result.ok, true);
		if (!result.ok) return;
		const member: MemberDoc = { context: "m", settings: { stripGroup: raw } };
		const edited = configOf(planEditWrites(result.copy, [member])[0]?.settings ?? {});
		assert.equal(edited.window, "15m");
		assert.equal(edited.futureValue, "A");
		assert.equal((edited.panes as Record<string, unknown>[])[0]?.paneFuture, "A");
		const left = configOf(planLeave(authority, [member])[0]?.settings ?? {});
		assert.equal(left.futureValue, "A");
	});

	it("a copy written by this build and read back is the same copy", () => {
		const authority = baseOf(stored(4, "A"));
		const fresh: MemberDoc = { context: "fresh", settings: {} };
		const written = groupOf(planJoin(authority, [fresh]).writes[0]?.settings ?? {});
		const again = groupOf(planJoin(baseOf(written), [fresh]).writes[0]?.settings ?? {});
		assert.deepEqual(again, written);
	});
});

describe("the authority check sees a newer version's fields", () => {
	const member = (context: string, column: number, raw: Record<string, unknown>): StripMember => ({ context, deviceId: "dev", column, epoch: 1, copy: copyOf(raw), foreign: undefined, known: "" });

	it("two copies at the same revision that differ only in an unknown field are a tie", () => {
		const { tie } = resolveAuthority([member("a", 0, stored(4, "A")), member("b", 1, stored(4, "B"))]);
		assert.deepEqual(tie.sort(), ["a", "b"]);
	});

	it("equal copies agree, and the leftmost is the source", () => {
		const { authority, tie } = resolveAuthority([member("b", 1, stored(4, "A")), member("a", 0, stored(4, "A"))]);
		assert.deepEqual(tie, []);
		assert.equal(authority?.from, "a");
	});
});

describe("the unit stamp through a build that does not know it", () => {
	const older = JSON.parse(readFileSync(new URL("./golden/strip-older-build-stamp.json", import.meta.url), "utf8")) as { window: Record<string, unknown>; numbers: Record<string, unknown> };
	const scaleOf = (doc: Record<string, unknown>): Record<string, unknown> => ((doc.panes as Record<string, unknown>[])[0]?.scale ?? {}) as Record<string, unknown>;
	const bandOf = (doc: Record<string, unknown>): Record<string, unknown> => ((doc.panes as Record<string, unknown>[])[0]?.bands as Record<string, unknown>[])[0] ?? {};
	const limitsOf = (doc: Record<string, unknown>): Record<string, unknown> => (((doc.panes as Record<string, unknown>[])[1]?.group as Record<string, unknown>).limits ?? {}) as Record<string, unknown>;

	it("an older build's rewrite keeps displayUnit and displayUnitFor on the scale, a band and Group limits, and they still count here", () => {
		for (const pick of [scaleOf, bandOf, limitsOf]) {
			assert.equal(pick(older.window).displayUnit, "°C");
			assert.ok(typeof pick(older.window).displayUnitFor === "object");
		}
		const config = stripConfigOf(older.window);
		assert.equal(config.panes[0].scale.displayUnit, "°C");
		assert.equal(config.panes[0].bands[0]?.displayUnit, "°C");
		assert.equal(config.panes[1].group?.limits?.displayUnit, "°C");
	});

	it("after an older build changes a number, this build reads that scale and those limits as stored before the stamp", () => {
		const config = stripConfigOf(older.numbers);
		assert.deepEqual(config.panes[0].scale, { min: 30, max: 91 }, "the record says 90: legacy");
		assert.equal(config.panes[1].group?.limits?.displayUnit, undefined, "the record says 85: legacy");
		assert.equal(config.panes[0].bands[0]?.displayUnit, "°C", "the band it left alone still counts");
	});

	it("this build's own rewrite recomputes the record from the numbers it writes", () => {
		const own = stampRewrites();
		const window = own.window as Record<string, unknown>;
		assert.deepEqual(scaleOf(window), { min: 30, max: 90, displayUnit: "°C", displayUnitFor: { min: "30", max: "90" } });
		// A number changed without a stamp: the stamp no longer counts and is dropped.
		assert.deepEqual(scaleOf(own.numbers as Record<string, unknown>), { min: 30, max: 91 });
	});
});
