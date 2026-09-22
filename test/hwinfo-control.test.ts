// Exit hygiene for the control key's success badge: the app socket must
// stay the only thing keeping the plugin process alive (see poller.start),
// so the 700 ms badge revert has to be unref'd like every other timer in
// src/. Locked at unit level because e2e-socket-close's 15 s budget cannot
// see a 700 ms straggler. The badge's way out is locked here too: a key that
// leaves the screen inside the window gets its manifest icon back.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { KeyAction, WillAppearEvent, WillDisappearEvent } from "@elgato/streamdeck";

import { HwinfoControlAction, type ControlActionSettings } from "../src/actions/hwinfo-control";

/** The private seam under test: the badge arm path and its timer store. */
type BadgeSeam = {
	showSuccess(keyAction: KeyAction<ControlActionSettings>): void;
	badgeTimers: Map<string, NodeJS.Timeout>;
};

function fakeKey(id: string): KeyAction<ControlActionSettings> {
	return { id, setImage: () => Promise.resolve(), showOk: () => Promise.resolve() } as unknown as KeyAction<ControlActionSettings>;
}

/** A key that records every setImage: "badge" for an image, "restore" for
 * the argument-less call that puts the manifest icon back. */
function recordingKey(id: string): { key: KeyAction<ControlActionSettings>; images: string[] } {
	const images: string[] = [];
	const key = {
		id,
		device: { id: "device-a", name: "Test deck" },
		setImage: (image?: string) => {
			images.push(image === undefined ? "restore" : "badge");
			return Promise.resolve();
		},
		showOk: () => Promise.resolve()
	} as unknown as KeyAction<ControlActionSettings>;
	return { key, images };
}

const appear = (action: HwinfoControlAction, key: KeyAction<ControlActionSettings>): void => action.onWillAppear({ action: key, payload: { settings: {} } } as unknown as WillAppearEvent<ControlActionSettings>);
// willDisappear hands the action an ActionContext: an id and a device, no setImage.
const disappear = (action: HwinfoControlAction, key: KeyAction<ControlActionSettings>): void =>
	action.onWillDisappear({ action: { id: key.id, device: key.device }, payload: { settings: {} } } as unknown as WillDisappearEvent<ControlActionSettings>);

describe("HwinfoControlAction success badge", () => {
	it("arms the revert timer unref'd so it can never hold the process open", () => {
		const action = new HwinfoControlAction() as unknown as BadgeSeam;
		action.showSuccess(fakeKey("ctx-badge"));
		const timer = action.badgeTimers.get("ctx-badge");
		assert.ok(timer !== undefined, "no timer armed: the key icon asset did not resolve, so the stock-tick fallback ran instead of the badge");
		assert.equal(timer.hasRef(), false, "the badge revert timer must be unref'd (exit hygiene)");
		clearTimeout(timer);
	});

	// A Multi Action of [HWiNFO Control] + [Switch Profile], or a press and a
	// swipe: the key leaves inside the 700 ms window. The app replays each
	// key's last image per profile, so an abandoned badge came back for good.
	it("a key that leaves inside the badge window gets its manifest icon back on the way out", () => {
		const action = new HwinfoControlAction();
		const seam = action as unknown as BadgeSeam;
		const { key, images } = recordingKey("ctx-leaves");
		appear(action, key);
		seam.showSuccess(key);
		assert.deepEqual(images, ["badge"]);
		disappear(action, key);
		assert.deepEqual(images, ["badge", "restore"], "willDisappear must restore through the press's own key handle");
		assert.equal(seam.badgeTimers.has("ctx-leaves"), false, "the revert timer is spent, not left to fire at a hidden key");
	});

	it("repaints the manifest icon on the next appear while a restore is owed, exactly once", () => {
		const action = new HwinfoControlAction();
		const { key, images } = recordingKey("ctx-returns");
		appear(action, key);
		(action as unknown as BadgeSeam).showSuccess(key);
		disappear(action, key);
		appear(action, key);
		assert.deepEqual(images, ["badge", "restore", "restore"], "the app can drop the frame sent across the switch, so the appear sends it again");
		appear(action, key);
		assert.deepEqual(images, ["badge", "restore", "restore"], "nothing is owed after the repaint");
	});

	it("a key with no badge pending owes nothing, and a replayed willAppear leaves a live badge alone", () => {
		const action = new HwinfoControlAction();
		const seam = action as unknown as BadgeSeam;
		const idle = recordingKey("ctx-idle");
		appear(action, idle.key);
		disappear(action, idle.key);
		appear(action, idle.key);
		assert.deepEqual(idle.images, []);

		const live = recordingKey("ctx-live");
		appear(action, live.key);
		seam.showSuccess(live.key);
		appear(action, live.key); // Stream Deck can replay willAppear without a disappear
		assert.deepEqual(live.images, ["badge"]);
		clearTimeout(seam.badgeTimers.get("ctx-live"));
	});
});
