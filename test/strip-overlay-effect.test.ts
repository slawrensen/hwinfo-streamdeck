/**
 * The strip panel hides a Show on the graph box exactly when the style draws
 * nothing for it (pi-strip-model.js OVERLAYS_UNUSED). Each box is toggled on
 * the renderer for every style, deck and layout, with the other boxes as a
 * new pane has them, all on and all off: a box the panel shows must change
 * some slice in one of those, and a box it hides must change none in any.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fixtureCase, groupFixture, type FixtureCase } from "../scripts/lib/strip-fixtures";
import { AXES_OVERLAY, OVERLAY_NAMES, stripScaleOf, type StripPaneV1, type StripStyle } from "../src/strip/settings";
import { sliceStrip } from "../src/strip/slicer";
import { loadPanelModels } from "./panel-models";

type Model = { OVERLAYS_UNUSED: Record<string, string[]>; overlayUsed(style: string, overlay: string, view?: string, readout?: string): boolean };
const model = loadPanelModels<Model>().hwStripModel;

const GEOMETRIES = [
	{ encoders: 6, layout: "whole" },
	{ encoders: 6, layout: "split" },
	{ encoders: 4, layout: "whole" },
	{ encoders: 4, layout: "split" }
] as const;

const BOXES: readonly string[] = [...OVERLAY_NAMES, AXES_OVERLAY];
const every = (on: boolean): Record<string, boolean> => Object.fromEntries(BOXES.map((o) => [o, on]));
/** The other boxes around the one toggled: as a new pane has them (none set here), all on, all off. */
const CONTEXTS: readonly Record<string, boolean>[] = [{}, every(true), every(false)];

/** One scene of `style` with `overlays`, readings with limits so every mark can show. */
function scene(style: StripStyle, overlays: Record<string, boolean>, g: (typeof GEOMETRIES)[number], view: "spread" | "tiles" | "now" = "spread"): FixtureCase {
	const { encoders, layout } = g;
	if (style === "group") return groupFixture({ n: 8, view, layout, encoders, overlays, limits: { warn: 85, crit: 95 } });
	const base = fixtureCase({ styles: [style], layout, encoders, background: "glass", accent: false });
	const [p0, p1] = base.input.config.panes;
	const withBoxes = (p: StripPaneV1): StripPaneV1 => ({ ...p, overlays: { ...p.overlays, ...overlays } });
	return { ...base, input: { ...base.input, config: { ...base.input.config, panes: [withBoxes(p0), withBoxes(p1)] } } };
}

const STYLES: readonly StripStyle[] = ["trend", "area", "compare", "lanes", "heat", "group", "meters", "events"];

describe("strip panel: Show on the graph boxes match what each style draws", () => {
	for (const style of STYLES) {
		it(`${style}: a shown box changes the strip, a hidden one does not`, () => {
			for (const overlay of BOXES) {
				let changes = false;
				for (const context of CONTEXTS) {
					for (const g of GEOMETRIES) {
						const draw = (on: boolean): string => sliceStrip(scene(style, { ...context, [overlay]: on }, g).input).slices.join("|");
						if (draw(true) !== draw(false)) changes = true;
					}
				}
				assert.equal(model.overlayUsed(style, overlay), changes, `${style} ${overlay}: panel ${model.overlayUsed(style, overlay) ? "shows" : "hides"} it, renderer ${changes ? "draws" : "ignores"} it`);
			}
		});
	}
});

describe("strip panel: Show on the graph follows Large values only", () => {
	for (const style of ["trend", "area", "compare", "lanes", "heat"] as const) {
		it(`${style}: a shown box changes the strip, a hidden one does not`, () => {
			for (const overlay of BOXES) {
				let changes = false;
				for (const context of CONTEXTS) {
					for (const g of GEOMETRIES) {
						const base = fixtureCase({ styles: [style], layout: g.layout, encoders: g.encoders, background: "glass", accent: false, extras: [{ readout: "only" }, { readout: "only" }] });
						const draw = (on: boolean): string => {
							const [p0, p1] = base.input.config.panes;
							const boxes = (p: StripPaneV1): StripPaneV1 => ({ ...p, overlays: { ...p.overlays, ...context, [overlay]: on } });
							return sliceStrip({ ...base.input, config: { ...base.input.config, panes: [boxes(p0), boxes(p1)] } }).slices.join("|");
						};
						if (draw(true) !== draw(false)) changes = true;
					}
				}
				const shown = model.overlayUsed(style, overlay, undefined, "only");
				assert.equal(shown, changes, `${style} ${overlay}: panel ${shown ? "shows" : "hides"} it, renderer ${changes ? "draws" : "ignores"} it`);
			}
		});
	}
});

describe("strip panel: Show on the graph follows a Group's view", () => {
	type Views = { overlayUsed(style: string, overlay: string, view?: string): boolean };
	for (const view of ["spread", "tiles", "now"] as const) {
		it(`Group ${view}: a shown box changes the strip, a hidden one does not`, () => {
			for (const overlay of BOXES) {
				let changes = false;
				for (const context of CONTEXTS) {
					for (const g of GEOMETRIES) {
						const draw = (on: boolean): string => sliceStrip(scene("group", { ...context, [overlay]: on }, g, view).input).slices.join("|");
						if (draw(true) !== draw(false)) changes = true;
					}
				}
				const shown = (model as unknown as Views).overlayUsed("group", overlay, view);
				assert.equal(shown, changes, `${view} ${overlay}: panel ${shown ? "shows" : "hides"} it, renderer ${changes ? "draws" : "ignores"} it`);
			}
		});
	}
});

describe("strip panel: Scale from and Scale to show exactly where a typed scale changes the strip", () => {
	type ScaleModel = { scaleShown(style: string, readout: string | undefined, units: readonly string[]): string };
	const scaleModel = model as unknown as ScaleModel;
	for (const style of STYLES) {
		it(`${style}: the fields show when a stamped scale changes some slice, and hide when it changes none`, () => {
			let changes = false;
			let units: string[] = [];
			for (const g of GEOMETRIES) {
				const base = scene(style, {}, g);
				units = (base.input.panes[0]?.series ?? []).map((s) => s.unit);
				const unit = units.find((u) => u !== "Yes/No") ?? "";
				const typed = { min: -1000, max: 100000, displayUnit: unit, displayUnitFor: { min: "-1000", max: "100000" } };
				const withScale = (p: StripPaneV1): StripPaneV1 => ({ ...p, scale: stripScaleOf(typed) });
				const [p0, p1] = base.input.config.panes;
				const typedInput = { ...base.input, config: { ...base.input.config, panes: [withScale(p0), withScale(p1)] as const } };
				if (sliceStrip(base.input).slices.join("|") !== sliceStrip(typedInput).slices.join("|")) changes = true;
			}
			const shown = scaleModel.scaleShown(style, undefined, units) !== "none";
			assert.equal(shown, changes, `${style}: panel ${shown ? "shows" : "hides"} the fields, renderer ${changes ? "draws" : "ignores"} a typed scale`);
		});
	}
});
