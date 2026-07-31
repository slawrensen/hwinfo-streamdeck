// The detailRole marker's defensive contract: ONLY the exact string
// "back" activates the fixed Back role; everything else — absent, empty,
// malformed, future values, wrong types — behaves as an ordinary Sensor
// Reading. The parser never normalizes and callers never rewrite, so a
// rolled-back or hand-edited profile can never break, and the role can
// never leak onto a normal key.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { detailMirrorBackOf, detailRoleOf, pressBehaviorOf } from "../src/detail/detail-settings";

describe("detailRoleOf", () => {
	it("activates on the exact marker only", () => {
		assert.equal(detailRoleOf({ detailRole: "back" }), "back");
	});

	it("absent and empty stay ordinary", () => {
		assert.equal(detailRoleOf({}), undefined);
		assert.equal(detailRoleOf({ detailRole: undefined }), undefined);
		assert.equal(detailRoleOf({ detailRole: "" }), undefined);
	});

	it("malformed values stay ordinary and are not normalized", () => {
		const cases: unknown[] = ["Back", "BACK", " back", "back ", "back\n", 1, true, null, {}, [], ["back"], { role: "back" }];
		for (const value of cases) {
			const settings = { detailRole: value } as { detailRole?: unknown };
			assert.equal(detailRoleOf(settings), undefined, JSON.stringify(value));
			// Never rewritten: the parser must not touch the stored value.
			assert.equal(settings.detailRole, value, "parser mutated its input");
		}
	});

	it("unknown future roles act as an ordinary key (forward compatibility)", () => {
		assert.equal(detailRoleOf({ detailRole: "home" }), undefined);
		assert.equal(detailRoleOf({ detailRole: "back-v2" }), undefined);
	});

	it("the mirror Back is opt-in: exactly true and nothing else", () => {
		// Issue #5 feedback: two Back tiles per page beat one movable one for
		// nobody, so the mirror is off unless the key asks for it.
		assert.equal(detailMirrorBackOf({ detailMirrorBack: true }), true);
		for (const value of [undefined, false, "true", 1, null, {}, []] as unknown[]) {
			assert.equal(detailMirrorBackOf({ detailMirrorBack: value } as { detailMirrorBack?: unknown }), false, JSON.stringify(value));
		}
		assert.equal(detailMirrorBackOf({}), false);
	});

	it("the role never affects pressBehavior parsing (separate axes)", () => {
		// A marked tile still carries whatever pressBehavior the profile or
		// a copy brought along; the ACTION checks the role first, but the
		// parsers stay independent so ordinary keys are untouched.
		assert.equal(pressBehaviorOf({ pressBehavior: "open-details", detailRole: "back" } as { pressBehavior?: unknown }), "open-details");
		assert.equal(pressBehaviorOf({ detailRole: "back" } as { pressBehavior?: unknown }), "cycle-stat");
	});
});
