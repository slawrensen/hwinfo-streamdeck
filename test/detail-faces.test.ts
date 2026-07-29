// Detail-view faces: the Back tile carries the opener's presentation,
// thresholds and the return mark through every data state; reading slots
// deliberately drop the opener's thresholds; pagers dim at boundaries;
// and the additive returnMark option changes nothing unless asked for.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { composeBackFace, composeIdleFace, composePagerFace, composeReadingFace, composeTitleFace, type DetailFaceContext } from "../src/detail/detail-faces";
import { pageOf } from "../src/detail/detail-group";
import type { DeviceDetailState } from "../src/detail/navigation";
import type { PollerStatus } from "../src/poller";
import { renderReadingKey, renderStatusKey } from "../src/ui/key-renderer";
import { effectiveTextSettings, parseTextSettings } from "../src/ui/text-colors";
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

function stateOf(overrides?: Partial<DeviceDetailState> & { presentation?: DeviceDetailState["presentation"] }): DeviceDetailState {
	return {
		deviceId: "dev1",
		profileName: "profiles/detail-standard",
		pageSize: 11,
		primaryKey: "cpu:0:0",
		groupSettings: { readingKey: "cpu:0:0" },
		presentation: {},
		group: { mode: "source", primaryKey: "cpu:0:0", title: "CPU [#0]", keys: ["cpu:0:1", "cpu:0:2"] },
		offset: 0,
		statModes: new Map(),
		surfaceCount: 1,
		pending: false,
		...overrides
	};
}

const config = loadThemes();
function ctxOf(): DetailFaceContext {
	return {
		config,
		deckThemeId: config.defaultTheme,
		typeAccents: true,
		measure: { decimals: "auto", fahrenheit: false, dataUnits: "decimal" },
		text: effectiveTextSettings(parseTextSettings({}), null)
	};
}

describe("Back tile", () => {
	it("renders the opener's live reading with the return mark", () => {
		const svg = composeBackFace(stateOf(), ok, ctxOf());
		assert.match(svg, />CPU Tctl</);
		assert.match(svg, />55(\.0)?</);
		assert.match(svg, /M33 119/); // the return hook
	});

	it("keeps the opener's thresholds: warn recolors the whole tile", () => {
		const calm = composeBackFace(stateOf(), ok, ctxOf());
		const warned = composeBackFace(stateOf({ presentation: { warnValue: "50" } }), ok, ctxOf());
		assert.notEqual(calm, warned);
		const warnBg = resolvePalette(config, config.defaultTheme, null, "warn").bg;
		assert.ok(warned.includes(warnBg), "warn palette background expected");
	});

	it("stays operable through unavailable data and a missing primary", () => {
		const gone = composeBackFace(stateOf(), down, ctxOf());
		assert.match(gone, /Start HWiNFO/);
		assert.match(gone, /M33 119/);
		const missing = composeBackFace(stateOf({ primaryKey: "vanished:0:0" }), ok, ctxOf());
		assert.match(missing, /Sensor missing/);
		assert.match(missing, /M33 119/);
	});

	it("honors the opener's custom label and theme override", () => {
		const svg = composeBackFace(stateOf({ presentation: { label: "My CPU", theme: "paper" } }), ok, ctxOf());
		assert.match(svg, />My CPU</);
		assert.ok(svg.includes(resolvePalette(config, "paper", null, "normal").bg));
	});
});

describe("reading slots", () => {
	it("renders live value, unit and no badge in current mode", () => {
		const svg = composeReadingFace(stateOf(), "cpu:0:1", "current", ok, ctxOf());
		assert.match(svg, />CPU Power</);
		assert.match(svg, />120(\.0)?</);
		assert.doesNotMatch(svg, />MIN</);
		assert.doesNotMatch(svg, /M33 119/); // no return mark on ordinary slots
	});

	it("stat modes show their value and badge", () => {
		const svg = composeReadingFace(stateOf(), "cpu:0:1", "min", ok, ctxOf());
		assert.match(svg, />110(\.0)?</);
		assert.match(svg, />MIN</);
	});

	it("never inherits the opener's thresholds (power reading vs a 50 degree warn)", () => {
		const state = stateOf({ presentation: { warnValue: "50" } });
		const svg = composeReadingFace(state, "cpu:0:1", "current", ok, ctxOf());
		const warnBg = resolvePalette(config, config.defaultTheme, null, "warn").bg;
		assert.equal(svg.includes(warnBg), false, "slot recolored by the opener's threshold");
	});

	it("a configured-but-missing reading keeps its slot as a placeholder", () => {
		const svg = composeReadingFace(stateOf(), "not-there:0:0", "current", ok, ctxOf());
		assert.match(svg, /Sensor missing/);
		assert.match(svg, />—</);
	});

	it("an empty slot is just the themed face; unavailable shows the status art", () => {
		const empty = composeReadingFace(stateOf(), undefined, "current", ok, ctxOf());
		assert.doesNotMatch(empty, /<text/);
		const gone = composeReadingFace(stateOf(), "cpu:0:1", "current", down, ctxOf());
		assert.match(gone, /Start HWiNFO/);
	});
});

describe("title and pagers", () => {
	it("the title tile shows the group name and range", () => {
		const state = stateOf();
		const svg = composeTitleFace(state, pageOf(state.group.keys, 0, state.pageSize), ctxOf());
		assert.match(svg, />CPU \[#0\]</);
		assert.match(svg, />1-2 \/ 2</);
	});

	it("pagers dim at their boundaries and brighten when a page exists", () => {
		const many = stateOf({ group: { mode: "source", primaryKey: "cpu:0:0", title: "CPU", keys: Array.from({ length: 30 }, (_, i) => `k${i}`) } });
		const first = pageOf(many.group.keys, 0, 11);
		const prevDisabled = composePagerFace("previous", first, many, ctxOf());
		const nextEnabled = composePagerFace("next", first, many, ctxOf());
		assert.notEqual(prevDisabled, nextEnabled.replace("62,48 86,72 62,96", "82,48 58,72 82,96"));
		const second = pageOf(many.group.keys, 11, 11);
		assert.notEqual(composePagerFace("previous", second, many, ctxOf()), prevDisabled);
	});

	it("idle faces say so, and the idle Back stays a back affordance", () => {
		assert.match(composeIdleFace("reading"), /No detail/);
		assert.match(composeIdleFace("back"), />Back</);
	});
});

describe("returnMark stays additive", () => {
	const palette = resolvePalette(config, config.defaultTheme, null, "normal");

	it("renderReadingKey without the option is mark-free", () => {
		const base = { label: "CPU", valueText: "55", unitText: "°C", statBadge: "", palette };
		assert.doesNotMatch(renderReadingKey(base), /M33 119/);
		assert.match(renderReadingKey({ ...base, returnMark: true }), /M33 119/);
	});

	it("renderStatusKey behaves the same way", () => {
		const base = { icon: "power" as const, accent: "#4cc2ff", lines: ["Start HWiNFO"] };
		assert.doesNotMatch(renderStatusKey(base), /M33 119/);
		assert.match(renderStatusKey({ ...base, returnMark: true }), /M33 119/);
	});
});
