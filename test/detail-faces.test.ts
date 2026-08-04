// Detail-view faces: the Back tile carries the opener's presentation,
// thresholds and the return mark through every data state; reading slots
// deliberately drop the opener's thresholds; pagers dim at boundaries;
// and the additive returnMark option changes nothing unless asked for.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createHash } from "node:crypto";

import { chunkMicroLabels, composeBackFace, composeChunkFace, composeIdleFace, composePagerFace, composeReadingFace, composeTitleFace, type DetailFaceContext } from "../src/detail/detail-faces";
import { pageOf } from "../src/detail/detail-group";
import type { DeviceDetailState } from "../src/detail/navigation";
import type { PollerStatus } from "../src/poller";
import { QUAD_DEFAULT_COLORS, renderReadingKey, renderStatusKey } from "../src/ui/key-renderer";
import { effectiveTextSettings, parseTextSettings } from "../src/ui/text-colors";
import { loadThemes, resolvePalette } from "../src/ui/themes";
import { SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";

function reading(key: string, value: number, unit = "°C", label = key): Reading {
	return { key, type: unit === "W" ? SensorType.Power : SensorType.Temperature, sensorIndex: 0, id: 0, label, unit, value, valueMin: value - 10, valueMax: value + 10, valueAvg: value };
}

const snapshot: SensorSnapshot = (() => {
	const readings = [
		reading("cpu:0:0", 55, "°C", "CPU Tctl"),
		reading("cpu:0:1", 120, "W", "CPU Power"),
		reading("cpu:0:2", 42, "°C", "CPU CCD1"),
		// The live dGPU labels this machine publishes, the group that
		// collapses the quad micro-labels to "GPU" four times under the
		// first-word rule (the Thermal Limit constant then poses as a live
		// temperature).
		reading("gpu:0:1", 38, "°C", "GPU Memory Junction Temperature"),
		reading("gpu:0:2", 44, "°C", "GPU Hot Spot Temperature"),
		reading("gpu:0:3", 84, "°C", "GPU Thermal Limit"),
		reading("gpu:0:4", 0.88, "V", "GPU Core Voltage")
	];
	return { pollTime: 1, version: 1, revision: 1, sensors: [{ index: 0, id: 0, instance: 0, name: "CPU [#0]" }], readings, byKey: new Map(readings.map((r) => [r.key, r])) };
})();

const ok: PollerStatus = { state: "ok", snapshot, source: "shared-memory" };
const down: PollerStatus = { state: "unavailable", reason: "not-running", message: "gone" };

function stateOf(overrides?: Partial<DeviceDetailState> & { presentation?: DeviceDetailState["presentation"] }): DeviceDetailState {
	return {
		deviceId: "dev1",
		profileName: "profiles/detail-standard",
		pageSize: 11,
		density: 1,
		tilePlan: [],
		primaryKey: "cpu:0:0",
		groupSettings: { readingKey: "cpu:0:0" },
		presentation: {},
		group: { mode: "source", primaryKey: "cpu:0:0", title: "CPU [#0]", keys: ["cpu:0:1", "cpu:0:2"] },
		offset: 0,
		statModes: new Map(),
		surfaceCount: 1,
		pending: false,
		dispatchedAt: 0,
		openerCell: null,
		mirrorSlotIndex: null,
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

describe("dense reading tiles (composeChunkFace)", () => {
	it("a one-reading chunk is BYTE-IDENTICAL to the single face; an empty tile to the blank", () => {
		for (const status of [ok, down]) {
			for (const mode of ["current", "min"] as const) {
				assert.equal(composeChunkFace(stateOf(), ["cpu:0:1"], mode, status, ctxOf()), composeReadingFace(stateOf(), "cpu:0:1", mode, status, ctxOf()));
				assert.equal(composeChunkFace(stateOf(), ["not-there:0:0"], mode, status, ctxOf()), composeReadingFace(stateOf(), "not-there:0:0", mode, status, ctxOf()));
				assert.equal(composeChunkFace(stateOf(), [], mode, status, ctxOf()), composeReadingFace(stateOf(), undefined, mode, status, ctxOf()));
			}
		}
	});

	it("two readings: the dual face with full labels, stat values and ONE shared badge", () => {
		const svg = composeChunkFace(stateOf(), ["cpu:0:1", "cpu:0:2"], "min", ok, ctxOf());
		assert.match(svg, />CPU Power</);
		assert.match(svg, />CPU CCD1</);
		assert.match(svg, />110(\.0)?</); // 120 W at MIN
		assert.match(svg, />32(\.0)?</); // 42 °C at MIN
		assert.equal((svg.match(/>MIN</g) ?? []).length, 1, "exactly one shared badge");
		const live = composeChunkFace(stateOf(), ["cpu:0:1", "cpu:0:2"], "current", ok, ctxOf());
		assert.doesNotMatch(live, />MIN</);
		assert.match(live, />120(\.0)?</);
	});

	it("three readings: rows, with a missing reading holding its row as the placeholder", () => {
		const svg = composeChunkFace(stateOf(), ["cpu:0:1", "not-there:0:0", "cpu:0:2"], "current", ok, ctxOf());
		assert.match(svg, />CPU Power</);
		assert.match(svg, /Sensor missing/);
		assert.match(svg, />—</);
		assert.match(svg, />CPU CCD1</);
	});

	it("four readings: the labeled quad with shared-token-stripped micro-labels", () => {
		const svg = composeChunkFace(stateOf(), ["gpu:0:1", "gpu:0:2", "gpu:0:3", "gpu:0:4"], "current", ok, ctxOf());
		for (const micro of [">MEMO<", ">HOT<", ">THER<", ">CORE<"]) {
			assert.ok(svg.includes(micro), `expected micro-label ${micro}`);
		}
		assert.ok(!svg.includes(">GPU<"), "the shared GPU token must not survive");
		assert.match(svg, />84(\.0)?</); // the Thermal Limit constant, now labeled THER
		assert.match(svg, />0\.88</);
		assert.match(svg, />°C</);
		assert.match(svg, />V</);
	});

	it("micro-labels fall back to first words when the chunk shares no leading token", () => {
		const svg = composeChunkFace(stateOf(), ["cpu:0:1", "gpu:0:1", "cpu:0:2", "gpu:0:2"], "current", ok, ctxOf());
		assert.match(svg, />CPU</);
		assert.match(svg, />GPU</);
	});

	it("the tile's type accent follows its FIRST reading", () => {
		const config = loadThemes();
		const powerFirst = composeChunkFace(stateOf(), ["cpu:0:1", "cpu:0:2"], "current", ok, ctxOf());
		const tempFirst = composeChunkFace(stateOf(), ["cpu:0:2", "cpu:0:1"], "current", ok, ctxOf());
		assert.notEqual(powerFirst, tempFirst);
		const powerAccentBg = resolvePalette(config, config.defaultTheme, "power", "normal").bg;
		assert.ok(powerFirst.includes(powerAccentBg), "power accent expected from the first reading");
	});

	it("never inherits the opener's thresholds at any density", () => {
		const state = stateOf({ presentation: { warnValue: "50" } });
		const config = loadThemes();
		const warnBg = resolvePalette(config, config.defaultTheme, null, "warn").bg;
		for (const chunk of [["cpu:0:1", "cpu:0:2"], ["cpu:0:1", "cpu:0:2", "gpu:0:1"], ["gpu:0:1", "gpu:0:2", "gpu:0:3", "gpu:0:4"]]) {
			const svg = composeChunkFace(state, chunk, "current", ok, ctxOf());
			assert.equal(svg.includes(warnBg), false, `chunk of ${chunk.length} recolored by the opener's threshold`);
		}
	});

	it("status screens ride every density", () => {
		const svg = composeChunkFace(stateOf(), ["cpu:0:1", "cpu:0:2", "gpu:0:1"], "current", down, ctxOf());
		assert.match(svg, /Start HWiNFO/);
	});
});

describe("hand-grouped tile specs (composeChunkFace + spec)", () => {
	const spec = (size: 1 | 2 | 3 | 4, extra: Partial<import("../src/detail/detail-settings").DetailTileSpec> = {}): import("../src/detail/detail-settings").DetailTileSpec => ({
		size,
		labels: Array.from({ length: size }, () => ""),
		colors: Array.from({ length: size }, () => null),
		cellLabels: true,
		...extra
	});

	it("no spec means byte-identical uniform faces at every size", () => {
		for (const chunk of [["cpu:0:1"], ["cpu:0:1", "cpu:0:2"], ["gpu:0:1", "gpu:0:2", "gpu:0:3", "gpu:0:4"]]) {
			assert.equal(composeChunkFace(stateOf(), chunk, "current", ok, ctxOf(), undefined), composeChunkFace(stateOf(), chunk, "current", ok, ctxOf()));
		}
	});

	it("per-cell labels override at every size, missing cells included", () => {
		const single = composeChunkFace(stateOf(), ["cpu:0:1"], "current", ok, ctxOf(), spec(1, { labels: ["Package W"] }));
		assert.match(single, />Package W</);
		assert.doesNotMatch(single, />CPU Power</);
		const dual = composeChunkFace(stateOf(), ["cpu:0:1", "not-there:0:0"], "current", ok, ctxOf(), spec(2, { labels: ["Top", "Gone"] }));
		assert.match(dual, />Top</);
		assert.match(dual, />Gone</); // the placeholder row keeps the custom label
		const quad = composeChunkFace(stateOf(), ["gpu:0:1", "gpu:0:2", "gpu:0:3", "gpu:0:4"], "current", ok, ctxOf(), spec(4, { labels: ["", "SPOT", "", ""] }));
		assert.match(quad, />SPOT</);
		assert.match(quad, />MEMO</); // unlabeled cells keep the stripped fallback
		assert.match(quad, />THER</);
	});

	it("quad identity colors override per cell; junk stays default", () => {
		const dressed = composeChunkFace(stateOf(), ["gpu:0:1", "gpu:0:2", "gpu:0:3", "gpu:0:4"], "current", ok, ctxOf(), spec(4, { colors: ["#ABCDEF", null, null, null] }));
		assert.ok(dressed.includes('fill="#ABCDEF">MEMO<'), "custom color carries the first micro-label");
		assert.ok(dressed.includes(QUAD_DEFAULT_COLORS[1] as string), "unset cells keep the default identity");
	});

	it("cellLabels false renders the color-coded bare-value variant", () => {
		const bare = composeChunkFace(stateOf(), ["gpu:0:1", "gpu:0:2", "gpu:0:3", "gpu:0:4"], "current", ok, ctxOf(), spec(4, { cellLabels: false }));
		assert.doesNotMatch(bare, />MEMO</);
		assert.ok(bare.includes(`fill="${QUAD_DEFAULT_COLORS[0] as string}">38`), "values wear the identity colors");
	});
});

describe("chunk micro-label stripping", () => {
	it("strips the tokens every present label shares, keeping one token minimum", () => {
		assert.deepEqual(chunkMicroLabels(["Core 0 VID", "Core 1 VID", "Core 2 VID", "Core 3 VID"]), ["0", "1", "2", "3"]);
		assert.deepEqual(chunkMicroLabels(["GPU Memory Junction Temperature", "GPU Hot Spot Temperature", "GPU Thermal Limit", "GPU Core Voltage"]), ["Memory", "Hot", "Thermal", "Core"]);
		assert.deepEqual(chunkMicroLabels(["Performance Limit - Power", "Performance Limit - Thermal"]), ["Power", "Thermal"]);
	});

	it("identical labels strip to their last token and stay identical", () => {
		assert.deepEqual(chunkMicroLabels(["GPU Fan1", "GPU Fan1"]), ["Fan1", "Fan1"]);
	});

	it("missing readings sit out; fewer than two present labels strip nothing", () => {
		assert.deepEqual(chunkMicroLabels(["Core 0 VID", undefined, "Core 2 VID", "Core 3 VID"]), ["0", "", "2", "3"]);
		assert.deepEqual(chunkMicroLabels(["GPU Hot Spot Temperature", undefined, undefined, undefined]), ["GPU", "", "", ""]);
		assert.deepEqual(chunkMicroLabels([undefined, undefined]), ["", ""]);
	});

	it("unshared or one-token labels keep their first words (the standalone quad rule)", () => {
		assert.deepEqual(chunkMicroLabels(["Vcore", "VSOC", "VDDIO", "VDD18"]), ["Vcore", "VSOC", "VDDIO", "VDD18"]);
		assert.deepEqual(chunkMicroLabels(["CPU Package", "GPU Power"]), ["CPU", "GPU"]);
	});

	it("a shorter label caps the strip so it never empties", () => {
		assert.deepEqual(chunkMicroLabels(["Core 0", "Core 0 Effective Clock"]), ["0", "0"]);
	});
});

describe("dense tile goldens", () => {
	// Byte-locks for the three new face families, like the archive pins in
	// detail-profiles.test.ts: same fixed snapshot, default theme, default
	// measure. A hash move means the composed bytes changed for everyone;
	// change it ONLY alongside a deliberate face change.
	const golden = (svg: string): string => createHash("sha256").update(svg).digest("hex");

	it("dual chunk", () => {
		const svg = composeChunkFace(stateOf(), ["cpu:0:1", "cpu:0:2"], "current", ok, ctxOf());
		assert.match(svg, />CPU Power</);
		assert.equal(golden(svg), "27c1e1fa909a340aa32d5b16390bb41515c45fdf70e20695aca7a522a1abb017");
	});

	it("triple chunk", () => {
		const svg = composeChunkFace(stateOf(), ["cpu:0:1", "cpu:0:2", "gpu:0:4"], "current", ok, ctxOf());
		assert.match(svg, />GPU Core…</); // the row ladder ellipsizes beside the value chunk
		assert.equal(golden(svg), "c4fb54e77250c41601fe52700b3f05f6529a48900373678d4144314174396d16");
	});

	it("quad chunk with the shared badge", () => {
		const svg = composeChunkFace(stateOf(), ["gpu:0:1", "gpu:0:2", "gpu:0:3", "gpu:0:4"], "max", ok, ctxOf());
		assert.match(svg, />MAX</);
		assert.equal(golden(svg), "150cd08b20b5105d5783e5fec085d6b90c2f8ec35770388d00d18dea12fd0ec2");
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
