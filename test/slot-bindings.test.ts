// Baked slot bindings parse strictly: the exact vocabulary passes, and
// everything else (junk, future shapes, hostile values) becomes null so
// a profile cell can never throw mid-tick. The slot action itself is held
// at one boundary, an appear with no coordinates (its module loads the SDK).
import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import { DetailSlotAction } from "../src/actions/detail-slot";
import { parseSlotBinding } from "../src/detail/slot-bindings";
import { poller } from "../src/poller";

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

// A multi-action shape appears with no coordinates: the slot registers with
// no cell and still balances its poller reference (external review AX84).
describe("DetailSlotAction without coordinates", () => {
	it("a detail slot with no coordinates still registers and releases its poller reference", () => {
		const retain = mock.method(poller, "retain", () => {});
		const release = mock.method(poller, "release", () => {});
		try {
			const cells: unknown[] = [];
			const unregistered: string[] = [];
			const controller = {
				registerSlot: (_contextId: string, _deviceId: string, _settings: unknown, cell: unknown) => void cells.push(cell),
				unregisterSlot: (contextId: string) => void unregistered.push(contextId),
				slotKeyDown() {}
			} as unknown as ConstructorParameters<typeof DetailSlotAction>[0];
			const action = new DetailSlotAction(controller);
			const event = {
				action: { id: "slot-without-coordinates", device: { id: "device", name: "Desk" }, isKey: () => true, setImage: async () => {} },
				payload: { settings: { slot: "reading", index: 0 } }
			} as unknown as Parameters<DetailSlotAction["onWillAppear"]>[0];
			assert.doesNotThrow(() => action.onWillAppear(event));
			assert.equal(retain.mock.callCount(), 1);
			assert.deepEqual(cells, [null], "one registration, with no cell");
			action.onWillDisappear(event as unknown as Parameters<DetailSlotAction["onWillDisappear"]>[0]);
			assert.deepEqual(unregistered, ["slot-without-coordinates"]);
			assert.equal(release.mock.callCount(), 1);
		} finally {
			retain.mock.restore();
			release.mock.restore();
		}
	});
});
