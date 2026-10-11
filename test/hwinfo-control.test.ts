// Exit hygiene for the control key's success badge: the app socket must
// stay the only thing keeping the plugin process alive (see poller.start),
// so the 700 ms badge revert has to be unref'd like every other timer in
// src/. Locked at unit level because e2e-socket-close's 15 s budget cannot
// see a 700 ms straggler. The badge's way out is locked here too: a key that
// leaves the screen inside the window gets its manifest icon back.
import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import streamDeck from "@elgato/streamdeck";
import type { DidReceiveSettingsEvent, KeyAction, KeyDownEvent, KeyUpEvent, SendToPluginEvent, WillAppearEvent, WillDisappearEvent } from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import { HwinfoControlAction, type ControlActionSettings } from "../src/actions/hwinfo-control";
import { registerDialCommandHandler, type DialControlCommand } from "../src/commands";

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

// Commands fire on release. A press begun under one document must not
// release under another: "Next reading" held while the panel switches the
// key to "Reset session stats, every dial" used to reset every dial
// (external review AX46, the Control sibling of AX27).
describe("a held Control key fires under the settings it was pressed with", () => {
	const NEXT = { command: "next", target: "safe", resetScope: "current" };
	const RESET_ALL = { command: "resetStats", target: "safe", resetScope: "all" };
	function control() {
		const sent: DialControlCommand[] = [];
		registerDialCommandHandler((command) => {
			sent.push(command);
			return 1;
		});
		const action = new HwinfoControlAction();
		// Only the badge painter is replaced; the press record, dispatch and
		// every handler are the production ones.
		(action as unknown as { showSuccess(): void }).showSuccess = () => {};
		const key = { id: "control", device: { id: "d", name: "Fake" }, isInMultiAction: () => false, setImage: () => Promise.resolve(), showAlert: () => Promise.resolve(), showOk: () => Promise.resolve() };
		const ev = (settings: ControlActionSettings) => ({ action: key, payload: { settings } }) as unknown;
		return {
			sent,
			appear: (settings: ControlActionSettings) => action.onWillAppear(ev(settings) as WillAppearEvent<ControlActionSettings>),
			disappear: (settings: ControlActionSettings) => action.onWillDisappear({ action: { id: key.id, device: key.device }, payload: { settings } } as unknown as WillDisappearEvent<ControlActionSettings>),
			down: (settings: ControlActionSettings) => action.onKeyDown(ev(settings) as KeyDownEvent<ControlActionSettings>),
			received: (settings: ControlActionSettings) => action.onDidReceiveSettings(ev(settings) as DidReceiveSettingsEvent<ControlActionSettings>),
			up: (settings: ControlActionSettings) => action.onKeyUp(ev(settings) as KeyUpEvent<ControlActionSettings>)
		};
	}

	it("a changed document consumes the press, whatever it is changed to", async () => {
		const c = control();
		c.appear(NEXT);
		c.down(NEXT);
		c.received(RESET_ALL);
		await c.up(RESET_ALL);
		assert.deepEqual(c.sent, [], "the release must not reset every dial");
		c.down(NEXT);
		c.received(RESET_ALL);
		c.received(NEXT);
		await c.up(NEXT);
		assert.deepEqual(c.sent, [], "a document changed and changed back still consumed the press");
		c.down(NEXT);
		await c.up(RESET_ALL);
		assert.deepEqual(c.sent, [], "a release carrying other settings than its press does not fire, even with no settings event between");
	});

	it("a replayed appear or a disappearance consumes the press", async () => {
		const c = control();
		c.appear(NEXT);
		c.down(NEXT);
		c.appear(NEXT);
		await c.up(NEXT);
		c.down(NEXT);
		c.disappear(NEXT);
		await c.up(NEXT);
		assert.deepEqual(c.sent, []);
	});

	it("an unchanged echo, in any key order, keeps the press; the next press fires once", async () => {
		const c = control();
		c.appear(NEXT);
		c.down(NEXT);
		c.received({ resetScope: "current", target: "safe", command: "next" });
		await c.up(NEXT);
		assert.deepEqual(c.sent, [{ command: "next", target: "safe", scope: "current" }]);
		c.down(NEXT);
		c.received(RESET_ALL);
		await c.up(RESET_ALL);
		c.down(RESET_ALL);
		await c.up(RESET_ALL);
		assert.deepEqual(c.sent.at(-1), { command: "resetStats", target: "", scope: "all" }, "a fresh press after a consumed one fires under its own settings");
		assert.equal(c.sent.length, 2);
	});

	// A repeated down (replayed events) is the same press: it keeps the
	// record it finds, so a consumed press stays consumed through its
	// release (external review AX57).
	it("a repeated down keeps the press it repeats, consumed or not", async () => {
		for (const repeats of [1, 2, 100]) {
			for (const boundary of ["settings", "release carries other settings", "replayed appear"] as const) {
				const c = control();
				c.appear(NEXT);
				c.down(NEXT);
				if (boundary === "settings") c.received(RESET_ALL);
				if (boundary === "replayed appear") c.appear(RESET_ALL);
				for (let i = 0; i < repeats; i++) c.down(RESET_ALL);
				await c.up(RESET_ALL);
				assert.deepEqual(c.sent, [], `${boundary}, ${repeats} repeated down(s)`);
				c.down(RESET_ALL);
				await c.up(RESET_ALL);
				assert.deepEqual(c.sent, [{ command: "resetStats", target: "", scope: "all" }], `${boundary}: the next press fires once`);
			}
			const echo = control();
			echo.appear(NEXT);
			echo.down(NEXT);
			for (let i = 0; i < repeats; i++) echo.down(NEXT);
			await echo.up(NEXT);
			assert.equal(echo.sent.length, 1, "a press that nothing consumed, repeated, still fires once");
		}
	});

	// A key that disappears mid-press never gets that release while away:
	// the next down is a new press, as on a dial, and a release that reaches
	// the key after it returns, with no down since, stays consumed.
	it("after a key leaves mid-press, a lone release is consumed and the next press is new", async () => {
		const c = control();
		c.appear(NEXT);
		c.down(NEXT);
		c.disappear(NEXT);
		c.appear(RESET_ALL);
		await c.up(RESET_ALL);
		assert.deepEqual(c.sent, [], "the held press's own release, after the key came back");
		c.down(NEXT);
		c.disappear(NEXT);
		c.appear(NEXT); // released while away: the app never delivers that release
		c.down(NEXT);
		await c.up(NEXT);
		assert.deepEqual(c.sent, [{ command: "next", target: "safe", scope: "current" }], "the first press after the key came back works");
		c.down(NEXT);
		c.disappear(NEXT);
		c.received(RESET_ALL); // edited while away
		c.appear(RESET_ALL);
		c.down(RESET_ALL);
		await c.up(RESET_ALL);
		assert.deepEqual(c.sent.at(-1), { command: "resetStats", target: "", scope: "all" }, "a settings change while away does not swallow the next press");
	});

	it("a release with no press seen fires once, as a Multi Action or Key Logic step delivers it", async () => {
		const c = control();
		c.appear(NEXT);
		await c.up(NEXT);
		await c.up(NEXT);
		assert.equal(c.sent.length, 2, "each lone release is one step");
	});

	// Only a press held on the way out is marked as left: a key that went
	// away with nothing held still fires the lone release a Multi Action or
	// Key Logic step delivers after it returns.
	it("a key that left with no press held fires a lone release after it returns", async () => {
		const c = control();
		c.appear(NEXT);
		c.disappear(NEXT);
		c.appear(NEXT);
		await c.up(NEXT);
		assert.deepEqual(c.sent, [{ command: "next", target: "safe", scope: "current" }]);
	});
});

// The Control panel waits for its remembered folds before it shows its
// sections, like every HWiNFO panel. The action used to answer only the
// support report, so the panel sat empty until its 600 ms fallback and
// never kept a fold.
describe("the Control panel's remembered folds", () => {
	it("answers getPanelFolds with what setPanelFolds stored for the control kind", () => {
		const sent = mock.method(streamDeck.ui, "sendToPropertyInspector", async () => {});
		try {
			const action = new HwinfoControlAction();
			const from = (payload: JsonValue) => ({ payload, action: { id: "ctx" } }) as unknown as SendToPluginEvent<JsonValue, ControlActionSettings>;
			action.onSendToPlugin(from({ event: "setPanelFolds", kind: "control", folds: { "sec-advanced": true } }));
			action.onSendToPlugin(from({ event: "getPanelFolds", kind: "control" }));
			assert.deepEqual(
				sent.mock.calls.map((c) => c.arguments[0]),
				[{ event: "panelFolds", kind: "control", folds: { "sec-advanced": true } }]
			);
		} finally {
			sent.mock.restore();
		}
	});
});
