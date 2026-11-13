/**
 * Strip input routing: SDK encoder events from one member, in group
 * coordinates, to one strip action. Pure; the gesture state machine is the
 * dial's own (src/gestures.ts), so press timing, pressed rotation and touch
 * hold behave exactly as on an independent dial.
 *
 * - A tap at tapPos x on encoder column c is at group x
 *   c * 200 + clamp(x, 0, 199). The app sends each event to one context, so
 *   every input is routed exactly once.
 * - Rotation and presses belong to the pane of the dial's column; in split
 *   mode each half owns its inputs. The one shared effect is the time
 *   window while the split shares it (sharedWindow, the default).
 * - Rotating changes the window for this session only (no settings write);
 *   the saved default is edited in the settings panel.
 *
 * | Input          | Live                                  | Inspect                   |
 * |----------------|---------------------------------------|---------------------------|
 * | Rotate         | Time window 1/5/15 min                | Move the cursor 1 bucket  |
 * | Pressed rotate | Next/previous series (when it has a choice) | same                |
 * | Short press    | Inspect, cursor at the newest bucket  | Back to live              |
 * | Long press     | Back to live (already live: nothing)  | Back to live              |
 * | Touch tap      | Inspect with the cursor at the tap    | Cursor to the tap         |
 * | Touch hold     | Back to live                          | Back to live              |
 *
 * A graph of one reading (Trend, Area, Heat) with no typed scale
 * end and no Yes/No reading takes the scale dial (StripPaneRouting.scaleDial, reported by the scene): its free
 * gestures step and reset the value scale for this session (src/strip/
 * scale.ts stepSpan), as the plain turn steps the window:
 *
 * | Input          | Live                                  | Inspect                   |
 * |----------------|---------------------------------------|---------------------------|
 * | Pressed rotate | Scale: clockwise wider, one stop a detent | same, on the frozen copy |
 * | Long press     | Automatic scale, fitted now           | Back to live              |
 * | Touch hold     | Automatic scale, fitted now           | Back to live              |
 *
 * Lanes with two lanes: a tap also picks the lane under it (each lane is at
 * least 35 px tall, Elgato's touch target). Three lanes stay on pressed
 * rotation.
 *
 * Group panes (GROUP_TURN_PICKS_READING, src/strip/group.ts) pick a
 * reading first, since with 32 readings choosing one is the main act:
 *
 * | Input          | Live                                  | Inspect                   |
 * |----------------|---------------------------------------|---------------------------|
 * | Rotate         | Highlight the next/previous reading;  | same                      |
 * |                | left past the first is home           |                           |
 * | Pressed rotate | Time window 1/5/15 min                | Move the cursor 1 bucket  |
 * | Short press    | Inspect, cursor at the newest bucket  | Back to live              |
 * | Long press     | Nothing                               | Back to live              |
 * | Touch tap      | Rows: highlight the row under it;     | same, and the cursor to   |
 * |                | Now: the column; Lines, Spread and    | the tap (Rows, Lines,     |
 * |                | Tiles: inspect at the tap; readout:   | Spread, Tiles)            |
 * |                | home                                  |                           |
 * | Touch hold     | Home                                  | Home and back to live     |
 *
 * Strip Screens (a whole strip with two or more screens): the plain turn of
 * the Screens dial (StripRouting.screens, the rightmost present member)
 * moves one screen per detent, clamped at the ends. Every other gesture on
 * every dial, the Screens dial included, and the whole touch surface stay
 * the screen's own, as above.
 */
import { routeGesture, type GestureState } from "../gestures";
import { GROUP_TURN_PICKS_READING, groupColumnAt, groupPlotOf, groupRowAt, type GroupDraw } from "./group";
import { tileColumnAt, tileColumns, tilePlotOf, tilesTimePlot } from "./tiles";
import { bucketsBackAt, laneAtY, laneHeight, ownsLayout, paneExtents, paneOfColumn, paneOfGroupX, panePlotOf, SLICE_H, SLICE_W, type BucketPx, type StripEncoders, type StripLayout } from "./geometry";
import { SERIES_LIMITS, type StripReadout, type StripStyle } from "./settings";

/** Minimum touch target height (Elgato guidelines). */
export const MIN_TOUCH_PX = 35;

export type StripEncoderEvent =
	| { readonly kind: "dialDown"; readonly column: number; readonly at: number }
	| { readonly kind: "dialUp"; readonly column: number; readonly at: number }
	| { readonly kind: "dialRotate"; readonly column: number; readonly at: number; readonly ticks: number; readonly pressed: boolean }
	| { readonly kind: "touchTap"; readonly column: number; readonly at: number; readonly hold: boolean; readonly tapPos: readonly [number, number] };

export type StripPaneRouting = {
	readonly style: StripStyle;
	/** Series the pane draws (the pressed-rotation choice). */
	readonly seriesCount: number;
	readonly readout?: StripReadout;
	readonly mode: "live" | "paused";
	/** A Group pane: how many readings it draws, how, and whether its
	 * readout slot shows (the graph starts after it); on Tiles, the tiles'
	 * columns per block (src/strip/tiles.ts tileGridFor). */
	readonly group?: { readonly count: number; readonly draw: GroupDraw; readonly current: boolean; readonly grid?: readonly number[] };
	/** The pane takes the scale dial (its last frame said so). */
	readonly scaleDial?: boolean;
};

export type StripRouting = {
	readonly layout: StripLayout;
	readonly encoders: StripEncoders;
	readonly sharedWindow: boolean;
	readonly bucketPx: BucketPx;
	readonly panes: readonly StripPaneRouting[];
	/** Strip Screens: the Screens dial's column, whose plain turn moves
	 * screens; absent with one screen. */
	readonly screens?: { readonly column: number };
};

/** `cursor` and `delta` count buckets at routing.bucketPx, the width of
 * the frame the user saw (StripSlices.bucketPx of the last frame). The
 * pane's view stores the cursor as a time: cursorAgoMs converts. */
export type StripAction =
	| { readonly kind: "window"; readonly pane: 0 | 1; readonly step: number; readonly scope: "shared" | "pane" }
	| { readonly kind: "cursor"; readonly pane: 0 | 1; readonly delta: number }
	| { readonly kind: "series"; readonly pane: 0 | 1; readonly step: number }
	| { readonly kind: "inspect"; readonly pane: 0 | 1; readonly cursor: number; readonly lane?: number }
	| { readonly kind: "cursorTo"; readonly pane: 0 | 1; readonly cursor: number; readonly lane?: number }
	| { readonly kind: "live"; readonly pane: 0 | 1 }
	/** Group: move the highlight `step` readings (clamped; left past the
	 * first is home). */
	| { readonly kind: "groupStep"; readonly pane: 0 | 1; readonly step: number }
	/** Group: highlight reading `index` (0-based); with `cursor`, a paused
	 * pane's cursor goes to the tap too. */
	| { readonly kind: "groupPick"; readonly pane: 0 | 1; readonly index: number; readonly cursor?: number }
	/** Group: back home (no highlight); with `live`, back to live too. */
	| { readonly kind: "groupHome"; readonly pane: 0 | 1; readonly live: boolean }
	/** Strip Screens: move `step` screens (clamped at the ends). */
	| { readonly kind: "screen"; readonly pane: 0; readonly step: number }
	/** The scale dial: `step` stops wider (clockwise) or narrower. */
	| { readonly kind: "scale"; readonly pane: 0 | 1; readonly step: number }
	/** The scale dial: back to the automatic scale, fitted now. */
	| { readonly kind: "scaleAuto"; readonly pane: 0 | 1 };

/** Group x of a tap: the column's offset plus the tap clamped to the slice. */
export function groupXOf(column: number, tapX: number): number {
	const x = Number.isFinite(tapX) ? Math.min(SLICE_W - 1, Math.max(0, Math.floor(tapX))) : 0;
	return column * SLICE_W + x;
}

/** Whether pressed rotation has anything to choose between in this pane. */
export function hasSeriesChoice(pane: StripPaneRouting): boolean {
	if (pane.style === "group") return (pane.group?.count ?? 0) > 0;
	// Ambient has no reading to choose: nothing on it is read on its own.
	if (pane.style === "ambient") return false;
	// Meters show every reading at once: there is nothing to highlight.
	return (pane.style !== "heat" || pane.readout === "only") && pane.style !== "meters" && pane.seriesCount > 1;
}

/** The lane under a tap, for two-lane panes only (each lane >= 35 px). */
function laneAt(pane: StripPaneRouting, tapY: number): number | undefined {
	if (pane.style !== "lanes" || pane.readout === "only") return undefined;
	const lanes = Math.min(pane.seriesCount, SERIES_LIMITS.lanes.max);
	if (lanes < 2 || laneHeight(lanes) < MIN_TOUCH_PX) return undefined;
	// The lane the scene draws under the tap, from the same geometry.
	return laneAtY(lanes, Number.isFinite(tapY) ? Math.min(SLICE_H - 1, Math.max(0, tapY)) : 0);
}

/**
 * Routes one event. `state` is the member's gesture state (kept per member
 * by the caller, dropped on disappear or membership change).
 */
export function routeStripInput(routing: StripRouting, state: GestureState, event: StripEncoderEvent): { state: GestureState; action: StripAction | null; groupX?: number } {
	const columnPane = paneOfColumn(routing.layout, routing.encoders, event.column);
	if (event.kind === "touchTap") {
		const groupX = groupXOf(event.column, event.tapPos[0]);
		const paneIndex = paneOfGroupX(routing.layout, routing.encoders, groupX);
		const pane = routing.panes[paneIndex];
		const routed = routeGesture(state, { kind: "touchTap", at: event.at, hold: event.hold, x: groupX, canvasWidth: 0 }, "off");
		if (pane === undefined) return { state: routed.state, action: null, groupX };
		if (pane.style === "group") return { state: routed.state, action: groupTap(routing, pane, paneIndex, groupX, event.tapPos[1], routed.gesture?.kind === "touchHold"), groupX };
		// Ambient has no inspect cursor: a tap does nothing.
		if (pane.style === "ambient") return { state: routed.state, action: null, groupX };
		// A long touch undoes the newest thing: paused, back to live; live on a
		// scale pane, back to the automatic scale.
		if (routed.gesture?.kind === "touchHold") return { state: routed.state, action: pane.mode === "live" && pane.scaleDial === true ? { kind: "scaleAuto", pane: paneIndex } : { kind: "live", pane: paneIndex }, groupX };
		const extent = paneExtents(routing.layout, routing.encoders)[paneIndex];
		const plot = extent === undefined ? undefined : panePlotOf(pane, extent, routing.bucketPx);
		// A tap on the large values (left of the graph), on a meter or on an
		// Events legend inspects the newest moment.
		const onValues = (pane.readout === "only" && !ownsLayout(pane.style)) || pane.style === "meters" || ((pane.readout === "left" || pane.style === "events") && plot !== undefined && groupX < plot.x0);
		const cursor = plot === undefined || onValues ? 0 : bucketsBackAt(plot, groupX);
		const lane = laneAt(pane, event.tapPos[1]);
		const kind = pane.mode === "live" ? "inspect" : "cursorTo";
		return { state: routed.state, action: { kind, pane: paneIndex, cursor, ...(lane === undefined ? {} : { lane }) }, groupX };
	}
	const pane = routing.panes[columnPane];
	const routed = routeGesture(state, event.kind === "dialRotate" ? { kind: "dialRotate", at: event.at, ticks: event.ticks, pressed: event.pressed } : { kind: event.kind, at: event.at }, "off");
	const gesture = routed.gesture;
	if (gesture === null || pane === undefined) return { state: routed.state, action: null };
	if (gesture.kind === "rotate" && routing.screens !== undefined && event.column === routing.screens.column) return { state: routed.state, action: { kind: "screen", pane: 0, step: gesture.ticks } };
	if (pane.style === "group" && (gesture.kind === "rotate" || gesture.kind === "pressedRotate")) {
		// The reading on one kind of turn, time on the other (the switch is
		// GROUP_TURN_PICKS_READING).
		const picks = (gesture.kind === "rotate") === GROUP_TURN_PICKS_READING;
		if (picks) return { state: routed.state, action: (pane.group?.count ?? 0) > 0 ? { kind: "groupStep", pane: columnPane, step: gesture.ticks } : null };
		if (pane.mode === "paused") return { state: routed.state, action: { kind: "cursor", pane: columnPane, delta: gesture.ticks } };
		return { state: routed.state, action: { kind: "window", pane: columnPane, step: gesture.ticks, scope: routing.layout === "split" && !routing.sharedWindow ? "pane" : "shared" } };
	}
	if (pane.style === "group" && gesture.kind === "longPress") return { state: routed.state, action: pane.mode === "paused" ? { kind: "live", pane: columnPane } : null };
	if (pane.style === "ambient" && gesture.kind !== "rotate") {
		// A turn changes the window as on every strip; a pressed turn and a
		// push do nothing (no inspect cursor).
		if (gesture.kind === "longPress") return { state: routed.state, action: pane.mode === "paused" ? { kind: "live", pane: columnPane } : null };
		return { state: routed.state, action: null };
	}
	switch (gesture.kind) {
		case "rotate":
			if (pane.mode === "paused") return { state: routed.state, action: { kind: "cursor", pane: columnPane, delta: gesture.ticks } };
			return { state: routed.state, action: { kind: "window", pane: columnPane, step: gesture.ticks, scope: routing.layout === "split" && !routing.sharedWindow ? "pane" : "shared" } };
		case "pressedRotate":
			return { state: routed.state, action: hasSeriesChoice(pane) ? { kind: "series", pane: columnPane, step: gesture.ticks } : pane.scaleDial === true ? { kind: "scale", pane: columnPane, step: gesture.ticks } : null };
		case "shortPress":
			return { state: routed.state, action: pane.mode === "live" ? { kind: "inspect", pane: columnPane, cursor: 0 } : { kind: "live", pane: columnPane } };
		case "longPress":
			return { state: routed.state, action: pane.mode === "paused" ? { kind: "live", pane: columnPane } : pane.scaleDial === true ? { kind: "scaleAuto", pane: columnPane } : null };
		default:
			return { state: routed.state, action: null };
	}
}

/** A tap on a Group pane: long touch goes home (and back to live); a tap
 * on the readout slot goes home; on Rows or Now it highlights the row or
 * column under it (on Rows a paused cursor moves to it too); on Lines and
 * Spread it inspects at the tap like every other style. */
function groupTap(routing: StripRouting, pane: StripPaneRouting, paneIndex: 0 | 1, groupX: number, tapY: number, hold: boolean): StripAction | null {
	if (hold) return { kind: "groupHome", pane: paneIndex, live: true };
	const info = pane.group ?? { count: 0, draw: "lines" as const, current: true };
	const extent = paneExtents(routing.layout, routing.encoders)[paneIndex];
	if (extent === undefined) return null;
	if (info.draw === "tiles") {
		// Tiles: the moment under the tap in the tile under it, the same
		// moment in every tile (they share one time grid).
		const columns = tileColumns(extent, info.grid ?? []);
		const column = columns[tileColumnAt(columns, groupX)];
		if (column === undefined) return null;
		const cursor = bucketsBackAt(tilePlotOf(column, tilesTimePlot(extent, info.grid ?? [], routing.bucketPx).buckets), groupX);
		return pane.mode === "live" ? { kind: "inspect", pane: paneIndex, cursor } : { kind: "cursorTo", pane: paneIndex, cursor };
	}
	const plot = groupPlotOf({ overlays: { current: info.current } }, extent, info.draw, routing.bucketPx);
	if (info.current && groupX < plot.x0 - 6) return { kind: "groupHome", pane: paneIndex, live: false };
	const cursor = bucketsBackAt(plot, groupX);
	const y = Number.isFinite(tapY) ? Math.min(SLICE_H - 1, Math.max(0, tapY)) : 0;
	if (info.count > 0 && info.draw === "rows") return { kind: "groupPick", pane: paneIndex, index: groupRowAt(info.count, y), ...(pane.mode === "paused" ? { cursor } : {}) };
	if (info.count > 0 && info.draw === "now") return { kind: "groupPick", pane: paneIndex, index: groupColumnAt(plot, info.count, groupX) };
	return pane.mode === "live" ? { kind: "inspect", pane: paneIndex, cursor } : { kind: "cursorTo", pane: paneIndex, cursor };
}

/** The next window id after `step` ticks, clamped at the ends (no wrap, so a
 * fast spin cannot jump from 15 min back to 1 min). */
export function stepWindow<T extends string>(windows: readonly T[], current: T, step: number): T {
	const at = Math.max(0, windows.indexOf(current));
	const next = Math.min(windows.length - 1, Math.max(0, at + Math.sign(step) * Math.min(Math.abs(Math.trunc(step)), windows.length)));
	return windows[next] as T;
}

/** What a member's dial says each gesture does. A gesture left out has no
 * line: the app hides a description it is not sent. */
export type StripHints = { readonly rotate: string; readonly push: string; readonly touch: string; readonly longTouch?: string };

/** The app's gesture hints for a member (setTriggerDescription), sent only
 * when they change (the mode, whether the pane takes the scale dial, or on
 * Tiles whether a tile is highlighted). A long push has no hint slot: the
 * long touch, which it mirrors, carries it. */
export function stripTriggerDescriptions(params: { readonly layout: StripLayout; readonly sharedWindow: boolean; readonly mode: "live" | "paused"; readonly seriesChoice: boolean; readonly group?: boolean; readonly style?: StripStyle; readonly scaleDial?: boolean; readonly tiles?: boolean; readonly highlighted?: boolean }): StripHints {
	if (params.group === true) return groupTriggerDescriptions(params);
	if (params.style === "ambient") return { rotate: params.layout === "split" && params.sharedWindow ? "Window, both halves" : "Time window", push: "No action", touch: "No action", longTouch: "No action" };
	const pressed = params.seriesChoice ? " · pressed: series" : params.scaleDial === true ? " · pressed: scale" : "";
	if (params.mode === "paused") {
		return { rotate: `Move cursor${pressed}`, push: "Back to live", touch: "Move cursor here", longTouch: "Back to live" };
	}
	const window = params.layout === "split" && params.sharedWindow ? "Window, both halves" : "Time window";
	return { rotate: `${window}${pressed}`, push: "Inspect", touch: "Inspect here", longTouch: params.scaleDial === true ? "Auto scale" : "Back to live" };
}

/** The Screens dial's hints: its turn moves screens ("Screen"), its
 * pressed turn, press and touches stay the pane's own. */
export function screensTriggerDescriptions(base: StripHints): StripHints {
	const pressed = base.rotate.indexOf(" · pressed: ");
	return { ...base, rotate: pressed < 0 ? "Screen" : `Screen${base.rotate.slice(pressed)}` };
}

/** The hints on a Group pane's dials; which turn picks the reading follows
 * GROUP_TURN_PICKS_READING. On Tiles a touch inspects, as on every graph,
 * and while a tile is highlighted a long touch says it clears it (no
 * reading leads at home); with none highlighted it has no line. */
function groupTriggerDescriptions(params: { readonly layout: StripLayout; readonly sharedWindow: boolean; readonly mode: "live" | "paused"; readonly tiles?: boolean; readonly highlighted?: boolean }): StripHints {
	const paused = params.mode === "paused";
	const both = params.layout === "split" && params.sharedWindow;
	const time = paused ? "cursor" : both ? "window, both halves" : "window";
	const timeFirst = paused ? "Move cursor" : both ? "Window, both halves" : "Time window";
	const rotate = GROUP_TURN_PICKS_READING ? `Reading · pressed: ${time}` : `${timeFirst} · pressed: reading`;
	if (params.tiles === true) return paused ? { rotate, push: "Back to live", touch: "Move cursor here", longTouch: "Back to live" } : { rotate, push: "Inspect", touch: "Inspect here", ...(params.highlighted === true ? { longTouch: "Clear highlight" } : {}) };
	if (paused) return { rotate, push: "Back to live", touch: "Pick reading here", longTouch: "Back to live" };
	return { rotate, push: "Inspect", touch: "Pick this reading", longTouch: "Top reading" };
}
