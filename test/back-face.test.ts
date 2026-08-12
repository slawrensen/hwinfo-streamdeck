// The configurable Back tile's rendering contract (issue #5 revision 2):
// an unconfigured Back falls back to the opener through the REAL compose
// path and must be byte-equivalent to the hidden slot's composeBackFace
// for every data state; a configured Back renders its own settings (its
// missing sensor shows the configured missing behavior, never the
// opener's); the return hook rides every layout in a placement that
// cannot strike text; and absent/false returnMark changes nothing.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { backFallbackSettings, backTileFace, compose } from "../src/actions/sensor-reading";
import { composeBackFace, type DetailFaceContext } from "../src/detail/detail-faces";
import type { DeviceDetailState } from "../src/detail/navigation";
import type { PollerStatus } from "../src/poller";
import { renderDetailIdleBackKey } from "../src/ui/detail-renderer";
import { renderDualKey, renderQuadKey, renderReadingKey, renderTripleKey } from "../src/ui/key-renderer";
import { applyGlobalThemeSettings, effectiveTextFor, effectiveThemeFor, measureOptionsFrom } from "../src/ui/theme-store";
import { loadThemes, resolvePalette } from "../src/ui/themes";
import { SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";

function reading(key: string, value: number, unit = "°C", label = key): Reading {
	return { key, type: unit === "W" ? SensorType.Power : SensorType.Temperature, sensorIndex: 0, id: 0, label, unit, value, valueMin: value - 10, valueMax: value + 10, valueAvg: value };
}

const snapshot: SensorSnapshot = (() => {
	const readings = [reading("cpu:0:0", 55, "°C", "CPU Tctl"), reading("cpu:0:1", 120, "W", "CPU Power"), reading("cpu:0:2", 42, "°C", "CPU CCD1")];
	return { pollTime: 1, version: 1, revision: 1, sensors: [{ index: 0, id: 0, instance: 0, name: "CPU [#0]" }], readings, byKey: new Map(readings.map((r) => [r.key, r])) };
})();

const ok: PollerStatus = { state: "ok", snapshot, source: "shared-memory" };
const down: PollerStatus = { state: "unavailable", reason: "not-running", message: "gone" };

function stateOf(presentation: DeviceDetailState["presentation"] = {}, primaryKey = "cpu:0:0"): DeviceDetailState {
	return {
		deviceId: "dev1",
		pageSize: 11,
		density: 1,
		tilePlan: [],
		primaryKey,
		groupSettings: { readingKey: primaryKey },
		presentation,
		group: { mode: "source", primaryKey, title: "CPU [#0]", keys: ["cpu:0:1", "cpu:0:2"] },
		offset: 0,
		statModes: new Map(),
		surfaceCount: 1,
		pending: false,
		dispatchedAt: 0,
		openerCell: null,
		mirrorSlotIndex: null
	};
}

const config = loadThemes();

/** The context exactly as DetailController.contextFor builds it, from the
 * same theme-store authorities compose() itself reads, so the two paths
 * are compared under identical deck-wide state. */
function ctxOf(state: DeviceDetailState): DetailFaceContext {
	return {
		config,
		deckThemeId: config.defaultTheme,
		typeAccents: true,
		measure: measureOptionsFrom(state.presentation),
		text: effectiveTextFor(state.presentation)
	};
}

describe("unconfigured Back fallback is byte-equivalent to composeBackFace", () => {
	const cases: Array<[string, DeviceDetailState, PollerStatus]> = [
		["normal", stateOf(), ok],
		["warn threshold recolors", stateOf({ warnValue: "50" }), ok],
		["crit threshold recolors", stateOf({ warnValue: "45", critValue: "50" }), ok],
		["alert-below direction", stateOf({ warnValue: "60", alertBelow: true }), ok],
		["HWiNFO unavailable", stateOf(), down],
		["opener's sensor missing", stateOf({}, "vanished:0:0"), ok],
		["custom label and theme", stateOf({ label: "My CPU", theme: "paper" }), ok],
		["fahrenheit and fixed decimals", stateOf({ fahrenheit: true, decimals: "1" }), ok],
		["custom text color", stateOf({ textMode: "custom", textColor: "#ff8800", textDimSecondary: true }), ok]
	];
	for (const [name, state, status] of cases) {
		it(name, () => {
			assert.equal(compose(backFallbackSettings(state), status, true), composeBackFace(state, status, ctxOf(state)), name);
		});
	}
});

describe("configured Back renders its own settings", () => {
	it("a configured single layout carries the hook and the configured sensor", () => {
		const svg = compose({ readingKey: "cpu:0:1", detailRole: "back" }, ok, true);
		assert.match(svg, />CPU Power</);
		assert.match(svg, /M33 119/);
	});

	it("a configured-but-missing sensor shows the configured missing behavior, not the opener", () => {
		const svg = compose({ readingKey: "gone:0:0", detailRole: "back" }, ok, true);
		assert.match(svg, /Sensor missing/);
		assert.match(svg, /M33 119/);
		assert.doesNotMatch(svg, /CPU Tctl/);
	});

	it("dual, triple and quad layouts each carry a divider-gap hook", () => {
		const dual = compose({ readingKey: "cpu:0:0", keyLayout: "dual", secondaryReadingKey: "cpu:0:1" }, ok, true);
		assert.match(dual, /M33 66/); // hook seated on the divider midline 72
		const triple = compose({ readingKey: "cpu:0:0", keyLayout: "triple", secondaryReadingKey: "cpu:0:1", quadReadingKey3: "cpu:0:2" }, ok, true);
		assert.match(triple, /M33 42/); // first separator midline 48
		const quad = compose({ readingKey: "cpu:0:0", keyLayout: "quad", secondaryReadingKey: "cpu:0:1", quadReadingKey3: "cpu:0:2", quadReadingKey4: "cpu:0:1" }, ok, true);
		assert.match(quad, /M33 66/); // horizontal cross arm midline 72
	});

	it("status screens keep the hook on every layout's degraded face", () => {
		const dualDown = compose({ readingKey: "cpu:0:0", keyLayout: "dual", secondaryReadingKey: "cpu:0:1" }, down, true);
		assert.match(dualDown, /Start HWiNFO/);
		assert.match(dualDown, /M33 119/);
		const allMissing = compose({ readingKey: "a:0:0", keyLayout: "quad", secondaryReadingKey: "b:0:0", quadReadingKey3: "c:0:0", quadReadingKey4: "d:0:0" }, ok, true);
		assert.match(allMissing, /Sensor missing/);
		assert.match(allMissing, /M33 119/);
	});
});

describe("returnMark stays additive on every layout", () => {
	const palette = resolvePalette(config, config.defaultTheme, null, "normal");
	const HOOK = /M\d+ \d+ v5 a3 3 0 0 1 -3 3 h-9/;

	it("compose without the flag never draws a hook, whatever the layout", () => {
		for (const settings of [
			{ readingKey: "cpu:0:0" },
			{ readingKey: "cpu:0:0", keyLayout: "dual", secondaryReadingKey: "cpu:0:1" },
			{ readingKey: "cpu:0:0", keyLayout: "triple", secondaryReadingKey: "cpu:0:1", quadReadingKey3: "cpu:0:2" },
			{ readingKey: "cpu:0:0", keyLayout: "quad", secondaryReadingKey: "cpu:0:1", quadReadingKey3: "cpu:0:2", quadReadingKey4: "cpu:0:1" }
		]) {
			const bare = compose(settings, ok);
			assert.doesNotMatch(bare, HOOK, JSON.stringify(settings));
			// returnMark: false is byte-identical to absent, layout by layout.
			assert.equal(compose(settings, ok, false), bare);
		}
	});

	it("renderDualKey / renderTripleKey / renderQuadKey: false or absent is byte-identical", () => {
		const row = { label: "CPU", valueText: "55", unitText: "°C", statBadge: "" };
		const dualBase = { top: row, bottom: row, palette };
		assert.equal(renderDualKey(dualBase), renderDualKey({ ...dualBase, returnMark: false }));
		assert.doesNotMatch(renderDualKey(dualBase), HOOK);
		const tripleBase = { rows: [{ label: "A", valueText: "1", unitText: "" }, { label: "B", valueText: "2", unitText: "" }, null], palette };
		assert.equal(renderTripleKey(tripleBase), renderTripleKey({ ...tripleBase, returnMark: false }));
		assert.doesNotMatch(renderTripleKey(tripleBase), HOOK);
		const quadBase = { cells: [{ label: "", valueText: "1", unitText: "", color: "#fff" }, { label: "", valueText: "2", unitText: "", color: "#fff" }, null, null], palette };
		assert.equal(renderQuadKey(quadBase), renderQuadKey({ ...quadBase, returnMark: false }));
		assert.doesNotMatch(renderQuadKey(quadBase), HOOK);
	});

	it("the multi-layout hook sits in a bg gap left of the shared badge, never over it", () => {
		const row = { label: "CPU", valueText: "55", unitText: "°C", statBadge: "" };
		const svg = renderDualKey({ top: row, bottom: row, sharedBadge: "MIN", palette, returnMark: true });
		// The gap mask (x 12..40) and the badge gap (x 47..97) are disjoint.
		assert.match(svg, /<rect x="12" y="64" width="28" height="16"/);
		assert.match(svg, /<rect x="47" y="63" width="50" height="14"/);
		assert.match(svg, /M33 66/);
	});

	it("a Bar or sparkline strip gets a left mask under the hook; plain faces do not", () => {
		const base = { label: "CPU", valueText: "55", unitText: "°C", statBadge: "", palette };
		const plain = renderReadingKey({ ...base, returnMark: true });
		assert.doesNotMatch(plain, /<rect x="0" y="116"/);
		const bar = renderReadingKey({ ...base, gauge: { kind: "bar" as const, fraction: 0.5, zones: [] }, returnMark: true });
		assert.match(bar, /<rect x="0" y="116" width="40" height="28"/);
		assert.match(bar, /M33 119/);
		const spark = renderReadingKey({ ...base, history: [1, 2, 3, 4], returnMark: true });
		assert.match(spark, /<rect x="0" y="116" width="40" height="28"/);
		// Without the mark, the strip is untouched.
		assert.doesNotMatch(renderReadingKey({ ...base, history: [1, 2, 3, 4] }), /<rect x="0" y="116"/);
	});
});

describe("the idle Back face", () => {
	it("stays the honest way out when no session exists", () => {
		const svg = renderDetailIdleBackKey();
		assert.match(svg, />Back</);
	});

	it("a workspace Back stays idle even while a detail session sits on the same deck", () => {
		const session = stateOf();
		// Exactly the settings the shipped workspace pages bake.
		const workspaceBack = { detailRole: "back", workspaceBack: true };
		// The detail fallback is keyed on the DEVICE, so an unconfirmed or
		// expired session on this deck would otherwise dress the workspace
		// page's only way out with the abandoned opener's sensor.
		assert.equal(backTileFace(workspaceBack, session, ok), renderDetailIdleBackKey());
		// A DETAIL Back with that same live session still borrows the
		// opener's face: this is not a blanket change to Back tiles.
		assert.equal(backTileFace({ detailRole: "back" }, session, ok), compose(backFallbackSettings(session), ok, true));
		// A workspace Back the user gave a sensor keeps showing that sensor.
		assert.match(backTileFace({ detailRole: "back", workspaceBack: true, readingKey: "cpu:0:1" }, session, ok), />CPU Power</);
	});
});

describe("effectiveThemeFor", () => {
	it("junk follows the DECK default, not the spec default; strings pass through", () => {
		// The deck must sit on a non-default theme or the two fallbacks
		// are indistinguishable.
		applyGlobalThemeSettings({ theme: "paper" });
		try {
			assert.equal(effectiveThemeFor({ theme: 42 }), "paper");
			assert.equal(effectiveThemeFor({ theme: ["paper"] }), "paper");
			assert.equal(effectiveThemeFor({ theme: null }), "paper");
			assert.equal(effectiveThemeFor({ theme: "" }), "paper");
			assert.equal(effectiveThemeFor({}), "paper");
			assert.equal(effectiveThemeFor({ theme: "void" }), "void");
			// Unknown ids pass through; resolvePalette owns that fallback.
			assert.equal(effectiveThemeFor({ theme: "not-a-theme" }), "not-a-theme");
		} finally {
			applyGlobalThemeSettings({ theme: loadThemes().defaultTheme });
		}
	});
});
