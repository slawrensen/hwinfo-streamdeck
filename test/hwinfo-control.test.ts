// Exit hygiene for the control key's success badge: the app socket must
// stay the only thing keeping the plugin process alive (see poller.start),
// so the 700 ms badge revert has to be unref'd like every other timer in
// src/. Locked at unit level because e2e-socket-close's 15 s budget cannot
// see a 700 ms straggler.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { KeyAction } from "@elgato/streamdeck";

import { HwinfoControlAction, type ControlActionSettings } from "../src/actions/hwinfo-control";

/** The private seam under test: the badge arm path and its timer store. */
type BadgeSeam = {
	showSuccess(keyAction: KeyAction<ControlActionSettings>): void;
	badgeTimers: Map<string, NodeJS.Timeout>;
};

function fakeKey(id: string): KeyAction<ControlActionSettings> {
	return { id, setImage: () => Promise.resolve(), showOk: () => Promise.resolve() } as unknown as KeyAction<ControlActionSettings>;
}

describe("HwinfoControlAction success badge", () => {
	it("arms the revert timer unref'd so it can never hold the process open", () => {
		const action = new HwinfoControlAction() as unknown as BadgeSeam;
		action.showSuccess(fakeKey("ctx-badge"));
		const timer = action.badgeTimers.get("ctx-badge");
		assert.ok(timer !== undefined, "no timer armed: the key icon asset did not resolve, so the stock-tick fallback ran instead of the badge");
		assert.equal(timer.hasRef(), false, "the badge revert timer must be unref'd (exit hygiene)");
		clearTimeout(timer);
	});
});
