/**
 * Strip input routing: taps land at group x = column * 200 + clamp(x, 0,
 * 199), each input is routed once to the pane that owns it, split halves own
 * their inputs, pressed rotation consumes the press, and the binding table
 * and trigger texts match the design.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { IDLE_GESTURE, type GestureState } from "../src/gestures";
import { bucketsBackAt, laneHeight, LANES_BOTTOM, LANES_TOP, paneExtents, paneOfColumn, panePlot, plotFor, stripWidth } from "../src/strip/geometry";
import { groupXOf, routeStripInput, screensTriggerDescriptions, stepWindow, stripTriggerDescriptions, type StripEncoderEvent, type StripRouting } from "../src/strip/input";

const routing = (over: Partial<StripRouting> = {}): StripRouting => ({
	layout: "whole",
	encoders: 4,
	sharedWindow: true,
	bucketPx: 2,
	panes: [
		{ style: "trend", seriesCount: 2, mode: "live" },
		{ style: "heat", seriesCount: 1, mode: "live" }
	],
	...over
});
const tap = (column: number, x: number, y = 50, hold = false): StripEncoderEvent => ({ kind: "touchTap", column, at: 0, hold, tapPos: [x, y] });

describe("group coordinates", () => {
	it("tapPos at 0, 199 and 200 on every column", () => {
		for (let column = 0; column < 6; column++) {
			assert.equal(groupXOf(column, 0), column * 200);
			assert.equal(groupXOf(column, 199), column * 200 + 199);
			assert.equal(groupXOf(column, 200), column * 200 + 199, "x 200 is outside the slot and clamps to 199");
			assert.equal(groupXOf(column, -5), column * 200);
			assert.equal(groupXOf(column, Number.NaN), column * 200);
		}
		assert.equal(groupXOf(1, 0) - groupXOf(0, 199), 1, "the seam between slots is one pixel, no gap, no overlap");
	});

	it("split boundaries: a tap belongs to the pane of its own column on both decks", () => {
		for (const encoders of [4, 6] as const) {
			const r = routing({ layout: "split", encoders });
			const mid = encoders / 2;
			const left = routeStripInput(r, IDLE_GESTURE, tap(mid - 1, 199));
			const right = routeStripInput(r, IDLE_GESTURE, tap(mid, 0));
			assert.equal(left.action?.pane, 0);
			assert.equal(right.action?.pane, 1);
			assert.equal(right.groupX, stripWidth(encoders) / 2);
			for (let c = 0; c < encoders; c++) {
				for (const x of [0, 100, 199, 200]) assert.equal(routeStripInput(r, IDLE_GESTURE, tap(c, x)).action?.pane, paneOfColumn("split", encoders, c));
			}
		}
	});

	it("a tap's cursor counts buckets back from the newest, clamped to the plot", () => {
		const r = routing();
		const newest = routeStripInput(r, IDLE_GESTURE, tap(3, 199));
		assert.deepEqual(newest.action, { kind: "inspect", pane: 0, cursor: 0 });
		const oldest = routeStripInput(r, IDLE_GESTURE, tap(0, 0));
		const plot = panePlot(paneExtents("whole", 4)[0] as { x0: number; x1: number }, 2);
		assert.deepEqual(oldest.action, { kind: "inspect", pane: 0, cursor: plot.buckets - 1 });
		const atSeam = routeStripInput(r, IDLE_GESTURE, tap(1, 0));
		assert.equal(atSeam.action?.kind === "inspect" ? atSeam.action.cursor : -1, bucketsBackAt(plot, 200));
		// Heat panes count their own 8 px cells.
		const heat = routeStripInput(routing({ layout: "split" }), IDLE_GESTURE, tap(2, 0));
		const heatPlot = plotFor("heat", paneExtents("split", 4)[1] as { x0: number; x1: number }, 2);
		assert.equal(heat.action?.kind === "inspect" ? heat.action.cursor : -1, bucketsBackAt(heatPlot, 400));
	});
});

describe("bindings", () => {
	it("live: rotate changes the window, shared unless a split says otherwise", () => {
		assert.deepEqual(routeStripInput(routing(), IDLE_GESTURE, { kind: "dialRotate", column: 2, at: 0, ticks: 1, pressed: false }).action, { kind: "window", pane: 0, step: 1, scope: "shared" });
		assert.deepEqual(routeStripInput(routing({ layout: "split", sharedWindow: false }), IDLE_GESTURE, { kind: "dialRotate", column: 3, at: 0, ticks: -2, pressed: false }).action, { kind: "window", pane: 1, step: -2, scope: "pane" });
		assert.equal((routeStripInput(routing({ layout: "split" }), IDLE_GESTURE, { kind: "dialRotate", column: 3, at: 0, ticks: 1, pressed: false }).action as { scope: string }).scope, "shared");
	});

	it("inspect: rotate moves the cursor; taps move it to the tap", () => {
		const r = routing({ panes: [{ style: "trend", seriesCount: 1, mode: "paused" }] });
		assert.deepEqual(routeStripInput(r, IDLE_GESTURE, { kind: "dialRotate", column: 0, at: 0, ticks: 3, pressed: false }).action, { kind: "cursor", pane: 0, delta: 3 });
		assert.equal(routeStripInput(r, IDLE_GESTURE, tap(1, 10)).action?.kind, "cursorTo");
	});

	it("pressed rotation picks the series where there is a choice, and consumes the press", () => {
		const r = routing();
		let state: GestureState = routeStripInput(r, IDLE_GESTURE, { kind: "dialDown", column: 0, at: 0 }).state;
		const turned = routeStripInput(r, state, { kind: "dialRotate", column: 0, at: 50, ticks: 1, pressed: true });
		assert.deepEqual(turned.action, { kind: "series", pane: 0, step: 1 });
		state = turned.state;
		const released = routeStripInput(r, state, { kind: "dialUp", column: 0, at: 120 });
		assert.equal(released.action, null, "a press that turned emits nothing on release");
		// No choice: single series, and Heat.
		const single = routing({ panes: [{ style: "area", seriesCount: 1, mode: "live" }] });
		assert.equal(routeStripInput(single, { downAt: 0, rotatedWhileDown: false }, { kind: "dialRotate", column: 0, at: 1, ticks: 1, pressed: true }).action, null);
		const heat = routing({ layout: "split" });
		assert.equal(routeStripInput(heat, { downAt: 0, rotatedWhileDown: false }, { kind: "dialRotate", column: 3, at: 1, ticks: 1, pressed: true }).action, null);
	});

	it("short press toggles inspect; long press and touch hold go live", () => {
		const live = routing();
		const down = routeStripInput(live, IDLE_GESTURE, { kind: "dialDown", column: 1, at: 0 }).state;
		assert.deepEqual(routeStripInput(live, down, { kind: "dialUp", column: 1, at: 200 }).action, { kind: "inspect", pane: 0, cursor: 0 });
		assert.equal(routeStripInput(live, down, { kind: "dialUp", column: 1, at: 600 }).action, null, "long press while live: nothing to do");
		const paused = routing({ panes: [{ style: "trend", seriesCount: 2, mode: "paused" }] });
		assert.deepEqual(routeStripInput(paused, down, { kind: "dialUp", column: 1, at: 200 }).action, { kind: "live", pane: 0 });
		assert.deepEqual(routeStripInput(paused, down, { kind: "dialUp", column: 1, at: 600 }).action, { kind: "live", pane: 0 });
		assert.deepEqual(routeStripInput(live, IDLE_GESTURE, tap(2, 40, 50, true)).action, { kind: "live", pane: 0 });
	});

	it("lanes: a tap picks the lane only when each lane is a full touch target", () => {
		const two = routing({ panes: [{ style: "lanes", seriesCount: 2, mode: "live" }] });
		assert.equal((routeStripInput(two, IDLE_GESTURE, tap(0, 10, 10)).action as { lane?: number }).lane, 0);
		assert.equal((routeStripInput(two, IDLE_GESTURE, tap(0, 10, 90)).action as { lane?: number }).lane, 1);
		const three = routing({ panes: [{ style: "lanes", seriesCount: 3, mode: "live" }] });
		assert.equal((routeStripInput(three, IDLE_GESTURE, tap(0, 10, 90)).action as { lane?: number }).lane, undefined);
	});

	it("lanes: the tap's lane is the lane drawn under it, right up to the separator", () => {
		const two = routing({ panes: [{ style: "lanes", seriesCount: 2, mode: "live" }] });
		const laneOf = (y: number): number | undefined => (routeStripInput(two, IDLE_GESTURE, tap(1, 50, y)).action as { lane?: number }).lane;
		// The scene draws the separator at LANES_TOP + laneHeight(2) (y 49).
		const separator = LANES_TOP + laneHeight(2);
		assert.equal(separator, 49);
		for (const y of [0, LANES_TOP, separator - 1]) assert.equal(laneOf(y), 0, `y ${y}`);
		for (const y of [separator, separator + 2, separator + 5, 50, LANES_BOTTOM, 99]) assert.equal(laneOf(y), 1, `y ${y}`);
		assert.ok(laneHeight(2) >= 35, "each of two lanes is a full touch target");
	});

	it("every event yields at most one action", () => {
		const r = routing({ layout: "split" });
		const events: StripEncoderEvent[] = [tap(0, 5), tap(3, 199, 99, true), { kind: "dialRotate", column: 2, at: 0, ticks: 5, pressed: false }, { kind: "dialDown", column: 1, at: 0 }, { kind: "dialUp", column: 1, at: 10 }];
		for (const e of events) {
			const out = routeStripInput(r, IDLE_GESTURE, e);
			assert.ok(out.action === null || typeof out.action === "object");
		}
	});

	it("the window steps clamp at the ends", () => {
		const w = ["1m", "5m", "15m"] as const;
		assert.equal(stepWindow(w, "5m", 1), "15m");
		assert.equal(stepWindow(w, "15m", 4), "15m");
		assert.equal(stepWindow(w, "5m", -9), "1m");
		assert.equal(stepWindow(w, "1m", 0), "1m");
	});
});

describe("trigger descriptions", () => {
	it("live and inspect texts, with the shared-split wording", () => {
		assert.deepEqual(stripTriggerDescriptions({ layout: "whole", sharedWindow: true, mode: "live", seriesChoice: true }), { rotate: "Time window · pressed: series", push: "Inspect", touch: "Inspect here", longTouch: "Back to live" });
		assert.equal(stripTriggerDescriptions({ layout: "split", sharedWindow: true, mode: "live", seriesChoice: false }).rotate, "Window, both halves");
		assert.equal(stripTriggerDescriptions({ layout: "split", sharedWindow: false, mode: "live", seriesChoice: false }).rotate, "Time window");
		assert.deepEqual(stripTriggerDescriptions({ layout: "whole", sharedWindow: true, mode: "paused", seriesChoice: true }), { rotate: "Move cursor · pressed: series", push: "Back to live", touch: "Move cursor here", longTouch: "Back to live" });
	});

	it("no em dashes in any hint", () => {
		for (const mode of ["live", "paused"] as const) for (const layout of ["whole", "split"] as const) {
			for (const text of Object.values(stripTriggerDescriptions({ layout, sharedWindow: true, mode, seriesChoice: true }))) assert.ok(!text.includes("\u2014"));
		}
	});
});

// ---- the Y scale on the dial (40-spec-final.md sections 5.2 and 5.5) ---------------

describe("the scale dial", () => {
	const down = { downAt: 0, rotatedWhileDown: false };
	const pressedTurn = (r: StripRouting, ticks = 1) => routeStripInput(r, down, { kind: "dialRotate", column: 0, at: 1, ticks, pressed: true }).action;
	const longPush = (r: StripRouting) => routeStripInput(r, down, { kind: "dialUp", column: 0, at: 600 }).action;
	const longTouch = (r: StripRouting) => routeStripInput(r, IDLE_GESTURE, tap(1, 40, 50, true)).action;
	const one = (pane: Partial<StripRouting["panes"][number]>): StripRouting => routing({ panes: [{ style: "trend", seriesCount: 1, mode: "live", ...pane }] });

	it("24. a pressed turn on a pane that takes the dial steps its scale; panes that do not take it stay as they are", () => {
		assert.deepEqual(pressedTurn(one({ scaleDial: true })), { kind: "scale", pane: 0, step: 1 });
		assert.deepEqual(pressedTurn(one({ style: "heat", scaleDial: true }), -2), { kind: "scale", pane: 0, step: -2 });
		// A Yes/No reading and a typed end: the scene reports no dial.
		for (const style of ["heat", "trend"] as const) assert.equal(pressedTurn(one({ style, scaleDial: false })), null, style);
		assert.equal(pressedTurn(one({})), null);
	});

	it("25. live, a long push and a long touch go back to the automatic scale", () => {
		assert.deepEqual(longPush(one({ scaleDial: true })), { kind: "scaleAuto", pane: 0 });
		assert.deepEqual(longTouch(one({ scaleDial: true })), { kind: "scaleAuto", pane: 0 });
		assert.equal(longPush(one({})), null);
		assert.deepEqual(longTouch(one({})), { kind: "live", pane: 0 });
	});

	it("26. paused, a pressed turn steps the frozen copy's scale; a long push and a long touch go back to live", () => {
		const paused = one({ mode: "paused", scaleDial: true });
		assert.deepEqual(pressedTurn(paused), { kind: "scale", pane: 0, step: 1 });
		assert.deepEqual(longPush(paused), { kind: "live", pane: 0 });
		assert.deepEqual(longTouch(paused), { kind: "live", pane: 0 });
	});

	it("27. the app's hints name the scale on a pane that takes the dial, and nothing changes elsewhere", () => {
		assert.deepEqual(stripTriggerDescriptions({ layout: "whole", sharedWindow: true, mode: "live", seriesChoice: false, scaleDial: true }), { rotate: "Time window · pressed: scale", push: "Inspect", touch: "Inspect here", longTouch: "Auto scale" });
		assert.deepEqual(stripTriggerDescriptions({ layout: "whole", sharedWindow: true, mode: "paused", seriesChoice: false, scaleDial: true }), { rotate: "Move cursor · pressed: scale", push: "Back to live", touch: "Move cursor here", longTouch: "Back to live" });
		const both = stripTriggerDescriptions({ layout: "split", sharedWindow: true, mode: "live", seriesChoice: false, scaleDial: true });
		assert.equal(both.rotate, "Window, both halves · pressed: scale");
		assert.equal(both.longTouch, "Auto scale");
		assert.equal(screensTriggerDescriptions(stripTriggerDescriptions({ layout: "whole", sharedWindow: true, mode: "live", seriesChoice: false, scaleDial: true })).rotate, "Screen · pressed: scale");
		assert.deepEqual(stripTriggerDescriptions({ layout: "whole", sharedWindow: true, mode: "live", seriesChoice: false }), { rotate: "Time window", push: "Inspect", touch: "Inspect here", longTouch: "Back to live" });
		assert.deepEqual(stripTriggerDescriptions({ layout: "whole", sharedWindow: true, mode: "live", seriesChoice: true }), { rotate: "Time window · pressed: series", push: "Inspect", touch: "Inspect here", longTouch: "Back to live" });
	});
});
