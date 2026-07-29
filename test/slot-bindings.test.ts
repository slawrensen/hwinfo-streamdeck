// Baked slot bindings parse strictly: the exact vocabulary passes, and
// everything else (junk, future shapes, hostile values) becomes null so
// a profile cell can never throw mid-tick.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseSlotBinding } from "../src/detail/slot-bindings";

describe("parseSlotBinding", () => {
	it("accepts the exact role vocabulary", () => {
		assert.deepEqual(parseSlotBinding({ slot: "back" }), { slot: "back" });
		assert.deepEqual(parseSlotBinding({ slot: "title" }), { slot: "title" });
		assert.deepEqual(parseSlotBinding({ slot: "previous" }), { slot: "previous" });
		assert.deepEqual(parseSlotBinding({ slot: "next" }), { slot: "next" });
		assert.deepEqual(parseSlotBinding({ slot: "reading", index: 0 }), { slot: "reading", index: 0 });
		assert.deepEqual(parseSlotBinding({ slot: "reading", index: 31 }), { slot: "reading", index: 31 });
	});

	it("rejects malformed and future shapes as null, never throwing", () => {
		for (const junk of [null, undefined, 42, "back", [], { slot: "reading" }, { slot: "reading", index: -1 }, { slot: "reading", index: 1.5 }, { slot: "reading", index: "0" }, { slot: "reading", index: 9999 }, { slot: "teleport" }, { slot: 7 }, {}]) {
			assert.equal(parseSlotBinding(junk), null, JSON.stringify(junk));
		}
	});

	it("ignores extra fields a future version might add", () => {
		assert.deepEqual(parseSlotBinding({ slot: "back", futureFlag: true }), { slot: "back" });
	});
});
