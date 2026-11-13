/**
 * What a strip build does with an Ambient and a Fleet pane: how it reads
 * the stored copy, what it draws, and what it writes back after an
 * unrelated edit. test/golden/strip-older-build.json was written by running
 * this same module against the 1.8 sources before Ambient and Fleet
 * existed (lane9's Group build, 4a5d47d), so the test can hold an older
 * 1.8 build's behavior next to this one's.
 */
import { applyStripEdit } from "../src/strip/edits";
import { stripLookOf } from "../src/strip/frame";
import { buildStripScene, type StripSceneInput } from "../src/strip/scene";
import { stripConfigOf, stripConfigToJson } from "../src/strip/settings";

/** The stored copies: an Ambient pane (Silk, every reading in °C) beside a
 * Fleet pane (a filter rule with limits), as a 1.8 preview stored them. */
export const OLDER_BUILD_DOCS: Readonly<Record<string, Record<string, unknown>>> = {
	ambient: { layout: "whole", encoders: 6, window: "15m", panes: [{ style: "ambient", series: [], ambient: { look: "silk" }, group: { from: "unit", unit: "°C", keys: [], view: "auto" } }, {}] },
	fleet: { layout: "split", encoders: 6, window: "5m", panes: [{ style: "fleet", series: [{ key: "f0:0:1" }], group: { from: "filter", filter: "*core*", keys: [], view: "auto", limits: { warn: 85, crit: 95, below: false, unit: "°C" } } }, { style: "trend", series: [{ key: "f0:0:2" }] }] }
};

export type OlderBuildRecord = {
	/** The first pane as read: the style it draws and the one it keeps. */
	readonly style: string;
	readonly storedStyle: string | null;
	/** Every word the first pane draws with no readings. */
	readonly words: readonly string[];
	/** The copy written back after an edit of the window only. */
	readonly rewritten: unknown;
};

export function olderBuildRecord(doc: Record<string, unknown>): OlderBuildRecord {
	const config = stripConfigOf(doc);
	const look = stripLookOf(config);
	const input: StripSceneInput = {
		config,
		encoders: 6,
		palette: look.palette,
		text: look.text,
		alertColors: look.alertColors,
		dataUnits: "decimal",
		panes: [
			{ series: [], bands: [], view: { mode: "live" }, highlight: 0 },
			{ series: [], bands: [], view: { mode: "live" }, highlight: 0 }
		]
	};
	const scene = buildStripScene(input);
	const words = scene.prims.flatMap((p) => (p.k === "text" && p.x < (config.layout === "split" ? 600 : 1200) ? [p.text] : []));
	const edited = applyStripEdit({ id: "0".repeat(32), rev: 4, config }, 4, [{ op: "set", path: "window", value: "1m" }]);
	if (!edited.ok) throw new Error("the window edit was refused");
	const pane = config.panes[0] as { style: string; storedStyle?: string };
	return { style: pane.style, storedStyle: pane.storedStyle ?? null, words, rewritten: stripConfigToJson(edited.copy.config, doc) };
}

/** A copy whose Scale from / Scale to, band and Group limits carry the unit
 * stamp (src/strip/settings.ts StripScale.displayUnit). */
export const STAMPED_DOC: Record<string, unknown> = {
	layout: "split",
	encoders: 6,
	window: "5m",
	panes: [
		{ style: "trend", series: [{ key: "f0:0:1" }], scale: { min: 30, max: 90, displayUnit: "°C", displayUnitFor: { min: "30", max: "90" } }, bands: [{ key: "f0:0:1", warn: 80, crit: 90, below: false, unit: "°C", displayUnit: "°C", displayUnitFor: { warn: "80", crit: "90" } }] },
		{ style: "group", series: [], group: { from: "filter", filter: "*core*", keys: [], view: "auto", limits: { warn: 85, crit: 95, below: false, unit: "°C", displayUnit: "°C", displayUnitFor: { warn: "85", crit: "95" } } } }
	]
};

/**
 * What a build writes back for STAMPED_DOC after an edit of the window
 * only, and after edits of a scale end and a Group limit as a panel that
 * does not know the stamp sends them (numbers only).
 * test/golden/strip-older-build-stamp.json holds this run against the 1.8
 * sources before the stamp (lane26/integration d9c534a, 2026-10-28).
 */
export function stampRewrites(): { window: unknown; numbers: unknown } {
	const base = { id: "0123456789abcdef0123456789abcdef", rev: 1, config: stripConfigOf(STAMPED_DOC) };
	const rewrite = (patch: unknown[]): unknown => {
		const r = applyStripEdit(base, 1, patch);
		if (!r.ok) throw new Error(JSON.stringify(r));
		return stripConfigToJson(r.copy.config);
	};
	return {
		window: rewrite([{ op: "set", path: "window", value: "15m" }]),
		numbers: rewrite([
			{ op: "set", path: "panes.0.scale.max", value: 91 },
			{ op: "set", path: "panes.1.group", value: { from: "filter", filter: "*core*", keys: [], view: "auto", limits: { warn: 86, crit: 95, below: false, unit: "°C" } } }
		])
	};
}
