import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, it } from "node:test";

import { dialGalleryFixture, renderGalleryDial } from "../scripts/lib/dial-gallery";
import { composeDialSvg, type DialSettings } from "../src/actions/sensor-dial";
import { SensorType, type Reading } from "../src/hwinfo/types";
import { applyReadingLinks } from "../src/hwinfo/reading-links";
import { stepReading } from "../src/rotation";
import { DIM_VALUE_BLEND, mixToward, readableValueColor } from "../src/ui/text-colors";
import { applyGlobalThemeSettings } from "../src/ui/theme-store";
import { alertValueColor, classifyTypeAccent, loadThemes } from "../src/ui/themes";
import { contrast } from "./wcag";

const config = loadThemes();
type Fixture = ReturnType<typeof dialGalleryFixture>;
const compose = ({ state, snapshot, historyOf }: Fixture): string => composeDialSvg(state, { state: "ok", snapshot, source: "shared-memory" }, historyOf);
const values = (svg: string): string[] => [...svg.matchAll(/font-weight="700" fill="([^"]+)">[^<]+<\/text>/g)].map((m) => m[1]!);
const withoutValues = (svg: string): string => svg.replace(/(font-weight="700" fill=")[^"]+/g, "$1VALUE");

it("contrast primitive keeps passing colors exact and quantized corrections above 4.5 on either polarity", () => {
	for (const bg of ["#000000", "#FFFFFF", "#777777", "#2A2F3A", "#CDC9BD"]) {
		for (const color of ["#777777", "#000000", "#FFFFFF", ...Object.values(config.typeAccents)]) {
			const resolved = readableValueColor(color, bg);
			assert.ok(contrast(resolved, bg) >= 4.5, `${resolved} on ${bg}`);
			if (contrast(color, bg) >= 4.5) assert.equal(resolved, color);
		}
	}
});

beforeEach(() => applyGlobalThemeSettings({ theme: "void", typeAccents: "on", textMode: "theme" }));

it("confirmed source links preserve individual colors in curated and uncurated overview rows without changing settings", () => {
	for (const view of ["tworow", "overview"] as const) {
		for (const curated of [false, true]) {
			const fixture = dialGalleryFixture("overview");
			fixture.state.settings.dialView = view;
			fixture.state.settings.readingColors = { "31:0:1": "#4CC2FF", "31:0:2": "#FF7E8E", "31:0:3": "#38CD89" };
			if (!curated) delete fixture.state.settings.rotationKeys;
			const saved = structuredClone(fixture.state.settings);
			const original = fixture.snapshot;
			const expected = values(compose(fixture));
			const links = original.readings.map((r, i) => ({ sharedMemory: r.key, gadget: `g:Sample:Reading${i}`, unit: r.unit, sensorType: r.type }));
			const readings = original.readings.map((r, i) => ({ ...r, key: links[i]!.gadget }));
			fixture.snapshot = applyReadingLinks({ ...original, readings, byKey: new Map(readings.map((r) => [r.key, r])) }, links, 1);
			assert.deepEqual(values(compose(fixture)), expected, `${view}, curated=${curated}`);
			fixture.snapshot = applyReadingLinks(original, links, 1);
			assert.deepEqual(values(compose(fixture)), expected);
			assert.deepEqual(fixture.state.settings, saved);
		}
	}
});

it("unlinked lookalike readings do not inherit colors and an explicit live-key color wins over its linked endpoint", () => {
	const fixture = dialGalleryFixture("overview");
	delete fixture.state.settings.rotationKeys;
	fixture.state.settings.readingColors = { "31:0:2": "#FF7E8E" };
	const original = fixture.snapshot;
	const readings = original.readings.map((r, i) => i === 1 ? { ...r, key: "g:Sample:GPU" } : r);
	fixture.snapshot = { ...original, readings, byKey: new Map(readings.map((r) => [r.key, r])) };
	assert.notEqual(values(compose(fixture))[1], "#FF7E8E");
	fixture.snapshot = applyReadingLinks(fixture.snapshot, [{ sharedMemory: "31:0:2", gadget: "g:Sample:GPU", unit: "°C", sensorType: SensorType.Temperature }], 1);
	assert.equal(values(compose(fixture))[1], "#FF7E8E");
	fixture.state.settings.readingColors["g:Sample:GPU"] = "#4CC2FF";
	assert.equal(values(compose(fixture))[1], "#4CC2FF");
});

for (const view of ["overview", "tworow"] as const) {
	it(`issue #31: production ${view} composition colors values by type`, () => {
		const { state, snapshot, historyOf } = dialGalleryFixture(view, true);
		const svg = composeDialSvg(state, { state: "ok", snapshot, source: "shared-memory" }, historyOf);
		const colors = [...svg.matchAll(/font-weight="700" fill="([^"]+)">[^<]+<\/text>/g)].map((m) => m[1]);
		const accents = loadThemes().typeAccents;
		assert.deepEqual(colors, view === "overview" ? [accents.temperature, accents.temperature, accents.fan] : [accents.power, accents.load]);
	});
}

it("absent/off/junk settings preserve the 1.7 readability baseline, including every single dial", () => {
	const golden = JSON.parse(readFileSync(new URL("./golden/dial-color-baseline.json", import.meta.url), "utf8")) as Record<string, string>;
	for (const [key, expected] of Object.entries(golden)) {
		const [view, theme, textMode] = key.split("/");
		const fixture = dialGalleryFixture(view === "overview" ? "overview" : "tworow");
		fixture.state.settings = { ...fixture.state.settings, dialView: view, theme, textMode, textColor: "#123abc" };
		for (const raw of [undefined, false, null, "true", "on", 1, {}, [], ...(view === "single" ? [true] : [])]) {
			fixture.state.settings = { ...fixture.state.settings, sensorValueColors: raw } as DialSettings;
			assert.equal(createHash("sha256").update(compose(fixture)).digest("hex"), expected, `${key}, ${JSON.stringify(raw)}`);
		}
	}
});

it("only numbers change; labels, units, footer, graphs and selection retain their bytes", () => {
	for (const view of ["tworow", "overview"] as const) {
		for (const textMode of ["theme", "dim", "custom"]) {
			const fixture = dialGalleryFixture(view);
			fixture.state.settings.textMode = textMode;
			fixture.state.settings.textColor = "#123abc";
			const off = compose(fixture);
			fixture.state.settings.sensorValueColors = true;
			assert.equal(withoutValues(compose(fixture)), withoutValues(off));
			if (textMode === "custom") assert.equal(compose(fixture), off);
		}
	}
});

it("rotation, selection and reordering follow reading category, never row position", () => {
	for (const view of ["tworow", "overview"] as const) {
		const fixture = dialGalleryFixture("overview", true);
		fixture.state.settings.dialView = view;
		const { readings } = fixture.snapshot;
		for (const order of [readings, [...readings].reverse()]) {
			fixture.state.settings.rotationKeys = order.map((r) => r.key);
			for (let i = 0; i < order.length; i++) {
				fixture.state.settings.readingKey = stepReading(order, fixture.state.settings.readingKey, 1)?.key;
				const svg = compose(fixture);
				for (const r of readings) {
					const color = config.typeAccents[classifyTypeAccent(r.type, r.unit, r.label)!];
					const value = r.value.toString();
					if (svg.includes(`>${value}</text>`)) assert.ok(svg.includes(`fill="${color}">${value}</text>`), `${view}: ${r.key}`);
				}
			}
		}
	}
});

it("theme and Dim use the actual selected-row background and the shared contrast primitive", () => {
	for (const theme of Object.keys(config.themes)) {
		if (config.typeAccentsDisabledOn.includes(theme)) continue;
		for (const view of ["tworow", "overview"] as const) {
			for (const textMode of ["theme", "dim"]) {
				const fixture = dialGalleryFixture(view, true);
				Object.assign(fixture.state.settings, { theme, textMode });
				const palette = config.themes[theme]!;
				values(compose(fixture)).forEach((color, index) => {
					const bg = view === "tworow" && index === 0 ? palette.track : palette.bg;
					const r = fixture.snapshot.readings[index]!;
					const accent = config.typeAccents[classifyTypeAccent(r.type, r.unit, r.label)!];
					const dimmed = textMode === "dim" ? mixToward(accent, bg, DIM_VALUE_BLEND) : accent;
					assert.equal(color, readableValueColor(dimmed, bg));
					assert.ok(contrast(color, bg) >= 4.5, `${theme}/${view}/${textMode}/${index}: ${color} on ${bg}`);
				});
			}
		}
	}
});

it("Custom is exact, invalid Custom becomes Theme, and deck settings inherit without writes", () => {
	const fixture = dialGalleryFixture("tworow", true);
	delete fixture.state.settings.textMode;
	delete fixture.state.settings.theme;
	const saved = structuredClone(fixture.state.settings);
	applyGlobalThemeSettings({ theme: "graphite", textMode: "custom", textColor: "#123abc" });
	assert.deepEqual(values(compose(fixture)), ["#123abc", "#123abc"]);
	assert.deepEqual(fixture.state.settings, saved);
	fixture.state.settings.textMode = "theme";
	const themed = compose(fixture);
	fixture.state.settings.textMode = "custom";
	fixture.state.settings.textColor = "invalid";
	assert.equal(compose(fixture), themed);
	fixture.state.settings.textColor = "#000001";
	assert.deepEqual(values(compose(fixture)), ["#000001", "#000001"]);
	delete fixture.state.settings.textMode;
	applyGlobalThemeSettings({ theme: "graphite", textMode: "dim" });
	const inherited = compose(fixture);
	Object.assign(fixture.state.settings, { theme: "graphite", textMode: "dim" });
	assert.equal(compose(fixture), inherited);
});

it("accents off, Paper, unknown categories and nonnumeric values keep normal resolved text", () => {
	for (const view of ["tworow", "overview"] as const) {
		for (const mode of ["accents-off", "paper", "unknown", "nonnumeric"]) {
			const fixture = dialGalleryFixture(view);
			if (mode === "accents-off") applyGlobalThemeSettings({ typeAccents: "off" });
			else applyGlobalThemeSettings({ typeAccents: "on" });
			if (mode === "paper") fixture.state.settings.theme = "paper";
			if (mode === "unknown" || mode === "nonnumeric") {
				const readings = fixture.snapshot.readings.map((r) => ({ ...r, ...(mode === "unknown" ? { type: SensorType.Other } : { value: NaN }) }));
				fixture.snapshot = { ...fixture.snapshot, readings, byKey: new Map(readings.map((r) => [r.key, r])) };
			}
			const normal = compose(fixture);
			fixture.state.settings.sensorValueColors = true;
			assert.equal(compose(fixture), normal, `${view}/${mode}`);
		}
	}
});

it("classification uses native units and source labels, regardless of display aliases", () => {
	const fixture = dialGalleryFixture("tworow", true);
	const readings: Reading[] = fixture.snapshot.readings.map((r, i) => ({ ...r, type: SensorType.Other, unit: i === 0 ? "MB/s" : "MB", label: i === 0 ? "Download" : "GPU Memory" }));
	fixture.snapshot = { ...fixture.snapshot, readings, byKey: new Map(readings.map((r) => [r.key, r])) };
	fixture.state.settings.rotationNames = Object.fromEntries(readings.map((r) => [r.key, "Temperature"]));
	fixture.state.settings.label = "Fan";
	assert.deepEqual(values(compose(fixture)), [config.typeAccents.network, config.typeAccents.memory]);
});

it("alerts keep priority over Custom and sensor colors, with native-unit scoping and recovery", () => {
	for (const view of ["tworow", "overview"] as const) {
		const fixture = dialGalleryFixture("overview", true);
		const warnColor = alertValueColor(config, "warn", view === "tworow" ? config.themes.void!.track : config.themes.void!.bg);
		Object.assign(fixture.state.settings, { dialView: view, warnValue: "70", critValue: "75", alertUnit: "°C", textMode: "custom", textColor: "#123abc" });
		assert.deepEqual(values(compose(fixture)), view === "overview" ? [warnColor, alertValueColor(config, "crit", config.themes.void!.bg), "#123abc"] : [warnColor, alertValueColor(config, "crit", config.themes.void!.bg)]);
		Object.assign(fixture.state.settings, { warnValue: "80", critValue: "90", textMode: "theme" });
		assert.deepEqual(values(compose(fixture)), view === "overview" ? [config.typeAccents.temperature, config.typeAccents.temperature, config.typeAccents.fan] : [config.typeAccents.temperature, config.typeAccents.temperature]);
		fixture.state.settings.fahrenheit = true;
		fixture.state.settings.warnValue = "160";
		fixture.state.settings.critValue = "168";
		assert.deepEqual(values(compose(fixture)), view === "overview" ? [warnColor, alertValueColor(config, "crit", config.themes.void!.bg), config.typeAccents.fan] : [warnColor, alertValueColor(config, "crit", config.themes.void!.bg)]);
	}
});

it("gallery fixtures equal production composition with explicit achievable settings", () => {
	for (const view of ["tworow", "overview"] as const) {
		for (const enabled of [false, true]) assert.equal(renderGalleryDial(view, enabled), compose(dialGalleryFixture(view, enabled)));
		const colors = { "31:0:1": "#4CC2FF", "31:0:2": "#FF7E8E", "31:0:4": "#38CD89" };
		assert.equal(renderGalleryDial(view, false, colors), compose(dialGalleryFixture(view, false, colors)));
	}
});

it("individual reading colors distinguish two temperatures and leave every non-value byte unchanged", () => {
	for (const view of ["tworow", "overview"] as const) {
		const fixture = dialGalleryFixture("overview");
		fixture.state.settings.dialView = view;
		const before = compose(fixture);
		Object.assign(fixture.state.settings, { readingColors: { "31:0:1": "#4CC2FF", "31:0:2": "#FF7E8E", "31:0:3": "#38CD89" } });
		assert.deepEqual(values(compose(fixture)), ["#4CC2FF", "#FF7E8E", "#38CD89"].slice(0, view === "tworow" ? 2 : 3));
		assert.equal(withoutValues(compose(fixture)), withoutValues(before));
	}
});

it("individual colors salvage per entry, keep exact chosen hues and never rewrite settings", () => {
	for (const view of ["tworow", "overview"] as const) {
		const fixture = dialGalleryFixture(view, true);
		const [first, second] = fixture.snapshot.readings;
		const automatic = compose(fixture);
		for (const readingColors of [undefined, null, true, "#123456", [], { [first!.key]: "bad", [second!.key]: 123 }, Object.create({ [first!.key]: "#123456" })]) {
			Object.assign(fixture.state.settings, { readingColors });
			assert.equal(compose(fixture), automatic);
		}
		Object.assign(fixture.state.settings, { readingColors: { [first!.key]: "#012aBc", [second!.key]: "bad", future: { keep: true } } });
		const saved = structuredClone(fixture.state.settings);
		assert.equal(values(compose(fixture))[0], "#012aBc", "explicit choices bypass automatic contrast adjustment");
		assert.equal(values(compose(fixture))[1], values(automatic)[1]);
		assert.deepEqual(fixture.state.settings, saved);
		fixture.state.settings.dialView = "single";
		const single = compose(fixture);
		delete fixture.state.settings.readingColors;
		assert.equal(compose(fixture), single);
	}
});

it("individual colors survive rotation, selection, reordered groups, removal and re-adding", () => {
	const fixture = dialGalleryFixture("overview");
	const colors = { "31:0:1": "#4CC2FF", "31:0:2": "#FF7E8E", "31:0:3": "#38CD89" };
	fixture.state.settings.readingColors = colors;
	const readings = fixture.snapshot.readings;
	for (const view of ["tworow", "overview"] as const) {
		fixture.state.settings.dialView = view;
		for (const order of [readings, [...readings].reverse(), [readings[1]!, readings[2]!], readings]) {
			fixture.state.settings.rotationKeys = order.map((r) => r.key);
			for (const groups of [undefined, [{ keys: [order[0]!.key] }, { keys: order.slice(1).map((r) => r.key) }]]) {
				fixture.state.settings.rotationGroups = groups;
				for (const reading of order) {
					fixture.state.settings.readingKey = reading.key;
					const svg = compose(fixture);
					for (const r of order) {
						if (svg.includes(`>${r.value}</text>`)) assert.ok(svg.includes(`fill="${colors[r.key as keyof typeof colors]}">${r.value}</text>`));
					}
				}
			}
		}
	}
	assert.deepEqual(fixture.state.settings.readingColors, colors);
});

it("individual colors work with accents off and Paper, follow Dim and inherited Custom, and preserve alert scoping", () => {
	const fixture = dialGalleryFixture("overview");
	fixture.state.settings.readingColors = { "31:0:1": "#4CC2FF", "31:0:2": "#FF7E8E", "31:0:3": "#38CD89" };
	for (const theme of Object.keys(config.themes)) {
		for (const view of ["tworow", "overview"] as const) {
			applyGlobalThemeSettings({ theme, typeAccents: "off", textMode: "theme" });
			Object.assign(fixture.state.settings, { theme, dialView: view, textMode: "theme" });
			const chosen = ["#4CC2FF", "#FF7E8E", "#38CD89"].slice(0, view === "tworow" ? 2 : 3);
			assert.deepEqual(values(compose(fixture)), chosen);
			fixture.state.settings.textMode = "dim";
			assert.deepEqual(values(compose(fixture)), chosen.map((color, i) => mixToward(color, view === "tworow" && i === 0 ? config.themes[theme]!.track : config.themes[theme]!.bg, DIM_VALUE_BLEND)));
			delete fixture.state.settings.textMode;
			applyGlobalThemeSettings({ textMode: "custom", textColor: "#123abc" });
			assert.deepEqual(values(compose(fixture)), chosen.map(() => "#123abc"));
			fixture.state.settings.textMode = "custom";
			fixture.state.settings.textColor = "invalid";
			assert.deepEqual(values(compose(fixture)), chosen);
		}
	}
	Object.assign(fixture.state.settings, { theme: "void", dialView: "overview", textMode: "theme", warnValue: "70", critValue: "75", alertUnit: "°C" });
	assert.deepEqual(values(compose(fixture)), [alertValueColor(config, "warn", config.themes.void!.bg), alertValueColor(config, "crit", config.themes.void!.bg), "#38CD89"]);
	Object.assign(fixture.state.settings, { warnValue: "80", critValue: "90" });
	assert.deepEqual(values(compose(fixture)), ["#4CC2FF", "#FF7E8E", "#38CD89"]);
	const readings = fixture.snapshot.readings.map((r) => ({ ...r, type: SensorType.Other, value: NaN }));
	fixture.snapshot = { ...fixture.snapshot, readings, byKey: new Map(readings.map((r) => [r.key, r])) };
	const missing = compose(fixture);
	delete fixture.state.settings.readingColors;
	assert.equal(compose(fixture), missing);
});
