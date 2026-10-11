/**
 * The deck-wide Text font. Tahoma is the default because every release
 * through 1.6.0 drew Tahoma Bold on the device (the app's QtSvg read the old
 * "Segoe UI, Arial, sans-serif" list as one unknown family and fell back to
 * it); Segoe UI is the option. These tests hold what a person sees: the
 * family each face names, the 1.6.0 title sizes, labels kept clear of their
 * values, and a stored choice that only the exact value can change.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { composeDialSvg, type InstanceState } from "../src/actions/sensor-dial";
import { IDLE_GESTURE } from "../src/gestures";
import type { Reading, SensorSnapshot } from "../src/hwinfo/types";
import { SessionStatsStore } from "../src/stats";
import { faceFont, parseFaceFont, setFaceFont } from "../src/ui/face-font";
import { estimateFooterWidth, estimateKeyTextWidth, fitFooter } from "../src/ui/format";
import { renderDial, renderDialOverview, renderDialTwoRow } from "../src/ui/dial-renderer";
import { renderDetailTitleKey } from "../src/ui/detail-renderer";
import { inKeyLens, renderDualKey, renderQuadKey, renderReadingKey, renderStatusKey, renderTripleKey, type TripleKeyRow } from "../src/ui/key-renderer";
import { applyGlobalThemeSettings, onThemeChange } from "../src/ui/theme-store";
import { loadThemes, resolvePalette } from "../src/ui/themes";

const VOID = resolvePalette(loadThemes(), "void", null, "normal");

function single(label: string): string {
	return renderReadingKey({ label, valueText: "56.3", unitText: "°C", statBadge: "", palette: VOID });
}

function attr(element: string, name: string): string {
	const m = new RegExp(` ${name}="([^"]*)"`).exec(element);
	assert.ok(m, `no ${name} on ${element}`);
	return m[1] as string;
}

describe("the stored Text font", () => {
	it("is Tahoma unless the document holds exactly segoe-ui, so an upgrade writes nothing", () => {
		for (const raw of [undefined, null, "", "tahoma", "Tahoma", "segoe", "Segoe UI", "SEGOE-UI", 1, true, {}]) {
			assert.equal(parseFaceFont(raw), "tahoma", JSON.stringify(raw));
		}
		assert.equal(parseFaceFont("segoe-ui"), "segoe-ui");
	});

	it("starts as Tahoma before any settings arrive", () => {
		assert.equal(faceFont().id, "tahoma");
	});

	it("follows the deck settings and repaints only when it changes", () => {
		let repaints = 0;
		onThemeChange(() => repaints++);
		applyGlobalThemeSettings({ theme: "void" });
		const settled = repaints;
		applyGlobalThemeSettings({ theme: "void", textFont: "segoe-ui" });
		assert.equal(faceFont().id, "segoe-ui");
		assert.equal(repaints, settled + 1);
		applyGlobalThemeSettings({ theme: "void", textFont: "segoe-ui" });
		assert.equal(repaints, settled + 1, "an unchanged choice does not repaint");
		applyGlobalThemeSettings({ theme: "void" });
		assert.equal(faceFont().id, "tahoma", "removing the choice returns to Tahoma");
	});
});

describe("Tahoma, the default face", () => {
	it("every text names Tahoma alone, never a family list", () => {
		setFaceFont("tahoma");
		const svg = single("CPU Package") + renderStatusKey({ icon: "power", accent: "#4cc2ff", lines: ["Start HWiNFO", "not detected"] });
		const families = [...svg.matchAll(/font-family="([^"]*)"/g)].map((m) => m[1]);
		assert.ok(families.length >= 4);
		assert.deepEqual([...new Set(families)], ["Tahoma"]);
	});

	it("keeps the 1.6.0 title sizes: CPU Package at 20 px, Total CPU Usage whole at 16", () => {
		setFaceFont("tahoma");
		const title = (label: string): string => (single(label).match(/<text x="72" y="32"[^>]*>[^<]*<\/text>/) as RegExpMatchArray)[0];
		assert.equal(attr(title("CPU Package"), "font-size"), "20");
		assert.match(title("CPU Package"), />CPU Package</);
		assert.equal(attr(title("Total CPU Usage"), "font-size"), "16");
		assert.match(title("Total CPU Usage"), />Total CPU Usage</);
	});

	it("prices Tahoma Bold no narrower than the app draws it", () => {
		// QtSvg 6.9.3 (the app's own renderer) drew this string 373 px wide at
		// 30 px in Tahoma Bold, 2026-10-02. Under-pricing is what put labels
		// into values; a few px over is the safe side.
		setFaceFont("tahoma");
		const estimate = estimateKeyTextWidth("CPU Package 56.3 °C Wo", 30);
		assert.ok(estimate >= 373 && estimate <= 380, `estimate ${estimate}`);
	});

	it("three-row labels stop before their value on the rows that collided on hardware", () => {
		setFaceFont("tahoma");
		const rows: TripleKeyRow[][] = [
			[{ label: "CPU Package", valueText: "56.3", unitText: "°C" }, { label: "CPU Fan", valueText: "1785", unitText: "RPM" }, { label: "GPU Power", valueText: "316", unitText: "W" }],
			[{ label: "GPU Memory Junction Temperature", valueText: "92.4", unitText: "°C" }, { label: "Core 0 Effective Clock", valueText: "5462", unitText: "MHz" }, { label: "+12V", valueText: "12.1", unitText: "V" }],
			[{ label: "CPU Package", valueText: "111.1", unitText: "°C" }, { label: "Battery", valueText: "100", unitText: "%" }, { label: "-12V", valueText: "-11.9", unitText: "V" }]
		];
		for (const set of rows) {
			const svg = renderTripleKey({ rows: set, palette: VOID });
			// Each label is followed by the opaque mask that starts its value chunk.
			const pairs = [...svg.matchAll(/(<text x="12"[^>]*>([^<]*)<\/text>)<rect x="([\d.]+)"/g)];
			assert.equal(pairs.length, 3, svg);
			for (const [, element, text, maskX] of pairs) {
				const right = 12 + estimateKeyTextWidth(text as string, Number(attr(element as string, "font-size")));
				assert.ok(right <= Number(maskX), `"${text}" ends at ${right.toFixed(1)}, its value chunk starts at ${maskX}`);
			}
		}
	});

	it("long status headlines step down until the lens shows them whole instead of running off its edges", () => {
		setFaceFont("tahoma");
		for (const headline of ["Sensor missing", "Shared Memory", "Start HWiNFO", "Access denied"]) {
			const svg = renderStatusKey({ icon: "warning", accent: "#E8940D", lines: [headline, "pick again"] });
			const element = (svg.match(new RegExp(`<text[^>]*>${headline}</text>`)) as RegExpMatchArray)[0];
			const size = Number(attr(element, "font-size"));
			assert.ok(inKeyLens([{ text: headline, fontSize: size }]), `${headline} at ${size}`);
			assert.ok(size >= 15, `${headline} stays large (${size})`);
		}
	});

	it("two-reading keys keep a common unit whole, giving the value at most two size steps", () => {
		// The unit tells 1785 RPM from 1785 MHz; a review render cut it to "R…".
		// Its gap is a word space, or none when the space would cost a value a
		// size step; either way the drawn row fits the band.
		setFaceFont("tahoma");
		for (const [value, unit] of [["1023", "MiB/s"], ["4850.5", "MHz"], ["1785.0", "RPM"], ["987.65", "Mbps"], ["56.3", "°C"]] as const) {
			const row = { label: "CPU", valueText: value, unitText: unit, statBadge: "" };
			const svg = renderDualKey({ top: row, bottom: { ...row, label: "GPU" }, palette: VOID });
			const m = /<text x="72" y="56"[^>]*font-size="(\d+)"[^>]*>([^<]*)<tspan[^>]*>([^<]*)<\/tspan>/.exec(svg);
			assert.ok(m, `${value} ${unit}: ${svg}`);
			assert.equal(m[2], value);
			assert.equal((m[3] as string).trim(), unit, `${value} keeps ${unit} whole`);
			const size = Number(m[1]);
			assert.ok(inKeyLens([{ text: value, fontSize: size, fontWeight: 700 }, { text: m[3] as string, fontSize: 14 }]), `${value} ${unit} at ${size} stays inside the lens`);
		}
	});

	it("three-row dials keep labels 1.6.0 drew whole (the Committed regression)", () => {
		setFaceFont("tahoma");
		const row = (label: string, valueText: string, unitText: string, selected = false) => ({ label, valueText, unitText, selected, valueColor: "#FFFFFF" });
		const svg = renderDialOverview({
			rows: [row("Committed", "63.5K", "MB", true), row("Available", "11.1K", "MB"), row("Load", "85.1", "%")],
			contextText: "session",
			statsText: "▼42.0 ▲78.5",
			palette: VOID
		});
		for (const label of ["COMMITTED", "AVAILABLE", "LOAD"]) assert.match(svg, new RegExp(`>${label}<`));
		assert.doesNotMatch(svg, /…/);
	});

	it("a three-row key draws the hardware photo's Core Max whole at 12 px, its unit against the value", () => {
		setFaceFont("tahoma");
		const rows = (third: string): TripleKeyRow[] => [{ label: "CCD1", valueText: "66.9", unitText: "°C" }, { label: "CCD2", valueText: "64.1", unitText: "°C" }, { label: third, valueText: "71.4", unitText: "°C" }];
		const labels = (svg: string): string[] => [...svg.matchAll(/<text x="12"[^>]*font-size="(\d+)"[^>]*>([^<]*)<\/text>/g)].map((m) => `${m[2]}@${m[1]}`);
		const svg = renderTripleKey({ rows: rows("Core Max"), palette: VOID });
		assert.deepEqual(labels(svg), ["CCD1@15", "CCD2@15", "Core Max@13"]);
		assert.match(svg, />71\.4<tspan[^>]*>°C<\/tspan>/, "no gap before the unit, as 1.6.0 drew it on the device");
		// One step longer still draws whole at the floor, and caps its peers.
		assert.deepEqual(labels(renderTripleKey({ rows: rows("CPU Temp"), palette: VOID })), ["CCD1@14", "CCD2@14", "CPU Temp@12"]);
	});

	it("11 px only ever draws a whole three-row label, never a cut one or one that fits larger", () => {
		setFaceFont("tahoma");
		for (const label of ["Max", "Core", "GPU Power", "CPU Package", "Total Host Writes", "GPU Memory Junction Temperature"]) {
			const svg = renderTripleKey({ rows: [0, 1, 2].map(() => ({ label, valueText: "71.4", unitText: "°C" })), palette: VOID });
			for (const [, size, text] of svg.matchAll(/<text x="12"[^>]*font-size="(\d+)"[^>]*>([^<]*)<\/text>/g)) {
				if (size === "11") assert.equal(text, label, `${label}: 11 px draws only a whole label`);
				if (text !== label) assert.equal(size, "12", `${label}: a cut label stays at the 12 px floor`);
			}
		}
	});

	it("a two-reading key spaces its units with one word space where the values keep their size", () => {
		setFaceFont("tahoma");
		const r = (label: string, valueText: string, unitText: string) => ({ label, valueText, unitText, statBadge: "" });
		const values = (svg: string): string[] => [...svg.matchAll(/font-size="(\d+)" font-weight="700"[^>]*>([^<]*)<tspan[^>]*>([^<]*)</g)].map((m) => `${m[2]}@${m[1]}|${m[3]}`);
		assert.deepEqual(values(renderDualKey({ top: r("CPU", "56.3", "°C"), bottom: r("GPU", "2745", "MHz"), palette: VOID })), ["56.3@32| °C", "2745@32| MHz"]);
	});

	it("a two-reading key draws both units tight when a space would cost either value a size step, as 1.6.0 did", () => {
		setFaceFont("tahoma");
		const r = (label: string, valueText: string, unitText: string) => ({ label, valueText, unitText, statBadge: "" });
		const values = (svg: string): string[] => [...svg.matchAll(/font-size="(\d+)" font-weight="700"[^>]*>([^<]*)<tspan[^>]*>([^<]*)</g)].map((m) => `${m[2]}@${m[1]}|${m[3]}`);
		// The spaced line would step 1011 MiB/s to 30 px; 1.6.0 drew it tight at 32.
		assert.deepEqual(values(renderDualKey({ top: r("Read", "1011", "MiB/s"), bottom: r("CPU", "56.3", "°C"), palette: VOID })), ["1011@32|MiB/s", "56.3@32|°C"]);
	});

	it("a row badge keeps its en space: it is the next word, not a unit", () => {
		setFaceFont("tahoma");
		const svg = renderDualKey({ top: { label: "CPU Package", valueText: "90.8", unitText: "W", statBadge: "MAX" }, bottom: { label: "CPU Die", valueText: "56.3", unitText: "°C", statBadge: "" }, palette: VOID });
		assert.match(svg, />\u2002MAX<\/tspan>/);
	});

	it("dial titles and stats lines 1.6.0 drew whole stay whole: CPU Package Power, Needs x64 Windows, a spaced session line", () => {
		setFaceFont("tahoma");
		for (const title of ["CPU Package Power", "Needs x64 Windows"]) {
			const svg = renderDial({ title, valueText: "90.8", unitText: "W", statsText: "▼ 20.0GB   ▲ 32.4GB   session", fraction: 0.5, palette: VOID, barColor: VOID.accent });
			assert.match(svg, new RegExp(`>${title}</text>`));
			// SVG draws the space runs as one; the line keeps its own bytes.
			assert.match(svg, />▼ 20\.0GB {3}▲ 32\.4GB {3}session<\/text>/);
		}
	});

	it("a dial's stats line keeps every word: whole at 12 px where 1.6.0 drew it, else whole at 11", () => {
		for (const font of ["tahoma", "segoe-ui"] as const) {
			setFaceFont(font);
			const stats = (statsText: string): { size: string; text: string } => {
				const svg = renderDial({ title: "Current DL rate", valueText: "450", unitText: "Mbps", statsText, fraction: 0.5, palette: VOID, barColor: VOID.accent });
				const m = /<text x="12" y="78"[^>]*font-size="(\d+)"[^>]*>([^<]*)<\/text>/.exec(svg);
				return { size: m?.[1] ?? "", text: m?.[2] ?? "" };
			};
			for (const line of ["▼419Mbps ▲481Mbps session", "▼419Mbps ▲481Mbps pinned", "▼0.00bps ▲33.6Mbps session", "▼12.3MB/s ▲98.7MB/s session", "▼12.3MiB/s ▲98.7MiB/s session", "▼ 1540   ▲ 2238   cycle paused", "▼ 12,450   ▲ 12,503   cycle paused"]) {
				const drawn = stats(line);
				assert.equal(drawn.text, line, `${font}: ${line}`);
				assert.ok(drawn.size === "12" || drawn.size === "11", `${font}: ${line} at ${drawn.size}`);
			}
		}
		setFaceFont("tahoma");
	});

	it("1.6.0's whole stats lines keep their 12 px on Tahoma", () => {
		setFaceFont("tahoma");
		for (const line of ["▼419Mbps ▲481Mbps session", "▼ 1540   ▲ 2238   cycle paused", "▼ 45.0   ▲ 81.0   session"]) {
			const svg = renderDial({ title: "Pump", valueText: "1793", unitText: "RPM", statsText: line, fraction: 0.5, palette: VOID, barColor: VOID.accent });
			assert.match(svg, /<text x="12" y="78"[^>]*font-size="12"/, line);
		}
	});

	it("a paused dial composes its whole cycle paused tag, which 1.6.0 cut at 28 characters", () => {
		setFaceFont("tahoma");
		const pump: Reading = { key: "f0001234:0:3000001", sensorIndex: 0, id: 1, label: "Pump", type: 3, unit: "RPM", value: 1793, valueMin: 1540, valueMax: 2238, valueAvg: 1800 };
		const snap: SensorSnapshot = { pollTime: 1, valueRevision: 1, version: 1, revision: 0, sensors: [{ index: 0, id: 1, instance: 0, name: "Board" }], readings: [pump], byKey: new Map([[pump.key, pump]]) };
		const stats = new SessionStatsStore();
		stats.sample(pump.key, 1540);
		stats.sample(pump.key, 2238);
		const state: InstanceState = {
			settings: { readingKey: pump.key, rotationKeys: [pump.key], autoCycleMs: "5000", theme: "void" },
			stats, statMode: "current", lastFeedback: "", nextCycleAt: null, cyclePaused: true, pinned: false, gesture: IDLE_GESTURE, overlay: null, overlayTimer: null, deviceId: "test", pendingAlertUnitStamp: false
		};
		const svg = composeDialSvg(state, { state: "ok", source: "shared-memory", snapshot: snap }, () => undefined);
		assert.match(svg, /<text x="12" y="78"[^>]*>▼ 1540 {3}▲ 2238 {3}cycle paused<\/text>/);
	});

	it("a cut stats line ends inside its budget, Tahoma's wider ellipsis included", () => {
		setFaceFont("tahoma");
		for (const a of ["1,234", "4,800", "12.3", "999.9", "2100"]) {
			for (const unit of ["RPM", "MHz", "W", "MB/s"]) {
				for (const tag of ["cycle paused", "pinned", "session"]) {
					const cut = fitFooter(`▼ ${a} ${unit} ▲ ${a}9 ${unit} ${tag}`, 182);
					assert.ok(estimateFooterWidth(cut) <= 182, `${cut} prices ${estimateFooterWidth(cut)}`);
				}
			}
		}
	});

	it("a row badge costs its label only its own width: MAX beside Total Activity and Pump Speed", () => {
		setFaceFont("tahoma");
		const svg = renderDualKey({ top: { label: "Total Activity", valueText: "45", unitText: "%", statBadge: "MAX" }, bottom: { label: "Pump Speed", valueText: "2100", unitText: "RPM", statBadge: "MAX" }, palette: VOID });
		assert.match(svg, /font-size="15"[^>]*>Total Activity</);
		assert.match(svg, /font-size="16"[^>]*>Pump Speed</);
	});

	it("a single key's value keeps its 1.6.0 size while its ink stays inside the lens span", () => {
		setFaceFont("tahoma");
		const size = (valueText: string): number => Number(attr((renderReadingKey({ label: "Used", valueText, unitText: "", statBadge: "", palette: VOID }).match(/<text x="72" y="94"[^>]*>/) as RegExpMatchArray)[0], "font-size"));
		assert.equal(size("98.8M"), 40, "1.6.0 drew it at 40, ink at x=11..131");
		assert.equal(size("5462.4"), 34, "at 36 its ink would cross x=133");
	});

	it("no face writes letter-spacing, which the app's QtSvg never draws", () => {
		for (const font of ["tahoma", "segoe-ui"] as const) {
			setFaceFont(font);
			const row = { label: "CPU", valueText: "56.3", unitText: "°C", statBadge: "MAX" };
			const cell = { label: "CPU", valueText: "56.3", unitText: "°C", color: "#4CC2FF" };
			const faces = [
				renderReadingKey({ ...row, palette: VOID }),
				renderDualKey({ top: row, bottom: { ...row, statBadge: "" }, palette: VOID }),
				renderQuadKey({ cells: [cell, cell, cell, cell], labels: true, sharedBadge: "MAX", palette: VOID } as never),
				renderDialOverview({ rows: [{ ...row, selected: true, valueColor: "#FFF" }], contextText: "session", statsText: "▼1 ▲2", palette: VOID })
			];
			for (const svg of faces) assert.doesNotMatch(svg, /letter-spacing/, `${font}: ${svg.slice(0, 120)}`);
		}
		setFaceFont("tahoma");
	});

	it("Greek and Cyrillic labels are priced at their measured widths, not the unknown-glyph rate", () => {
		const letters = Array.from("АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюяΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩαβγδεζηθικλμνξοπρστυφχψω—–");
		for (const font of ["tahoma", "segoe-ui"] as const) {
			setFaceFont(font);
			for (const g of letters) assert.ok(Object.hasOwn(faceFont().advance12, g), `${font} measures ${g}`);
		}
		setFaceFont("tahoma");
		// The widest Cyrillic capital ran past the 12.35 unknown rate, so a label
		// of them could reach its value.
		assert.ok((faceFont().advance12["Щ"] as number) > faceFont().unmapped12);
	});

	it("a two-row dial's wrapped second line ends before the value's mask", () => {
		setFaceFont("tahoma");
		const r = (label: string, valueText: string, unitText: string, selected = false) => ({ label, valueText, unitText, selected, valueColor: "#FFFFFF" });
		for (const [label, value] of [["Core 0 Effective Clock Average", "4850"], ["GPU Memory Junction Temperature", "10.5k"], ["CPU Package", "56.3"]] as const) {
			const svg = renderDialTwoRow({ rows: [r(label, value, "MHz", true), r("GPU Temp", "123.4", "MB/s")], footerText: "", palette: VOID });
			// Row 1 sits at y=4: its wrapped second label line shares baseline 40 with the value.
			const second = /<text x="12" y="40"[^>]*font-size="13"[^>]*>([^<]*)<\/text>/.exec(svg);
			const mask = /<rect x="([\d.]+)" y="22"/.exec(svg);
			if (second === null || mask === null) continue; // one line: the trend takes line 2
			assert.ok(12 + estimateKeyTextWidth(second[1] as string, 13) <= Number(mask[1]), `"${second[1]}" runs under the mask at ${mask[1]}`);
		}
	});

	it("every renderer names Tahoma alone", () => {
		setFaceFont("tahoma");
		const row = { label: "CPU", valueText: "56.3", unitText: "°C", statBadge: "" };
		const cell = { label: "CPU", valueText: "56.3", unitText: "°C", color: "#4CC2FF" };
		const faces = [
			renderDualKey({ top: row, bottom: row, palette: VOID }),
			renderTripleKey({ rows: [row, row, row], palette: VOID }),
			renderQuadKey({ cells: [cell, cell, cell, cell], palette: VOID } as never),
			renderDialOverview({ rows: [{ ...row, selected: true, valueColor: "#FFF" }], contextText: "", statsText: "", palette: VOID }),
			renderDialTwoRow({ rows: [{ ...row, selected: true, valueColor: "#FFF" }], footerText: "x", palette: VOID }),
			renderDetailTitleKey({ title: "CPU [#0]: AMD Ryzen 9 9950X3D2", rangeText: "1-11 / 71", palette: VOID, text: { label: "#FFF", unit: "#AAA" } } as never)
		];
		for (const svg of faces) assert.deepEqual([...new Set([...svg.matchAll(/font-family="([^"]*)"/g)].map((m) => m[1]))], ["Tahoma"], svg.slice(0, 160));
	});

	it("the action icons the app draws itself name Tahoma, like the faces", () => {
		for (const icon of ["control/key.svg", "reading/key.svg", "dial/dial.svg"]) {
			const svg = readFileSync(new URL(`../com.lawrensen.hwinfo.sdPlugin/imgs/actions/${icon}`, import.meta.url), "utf8");
			assert.deepEqual([...new Set([...svg.matchAll(/font-family="([^"]*)"/g)].map((m) => m[1]))], ["Tahoma"], icon);
		}
	});
});

describe("Segoe UI, the option", () => {
	it("names Segoe UI alone", () => {
		setFaceFont("segoe-ui");
		assert.deepEqual([...new Set([...single("CPU Package").matchAll(/font-family="([^"]*)"/g)].map((m) => m[1]))], ["Segoe UI"]);
	});

	it("prices a bold 1 like any other digit, since Segoe UI Bold draws them all one width", () => {
		// Before: "111.1" priced 6 px narrow and a three-row label ran into it.
		setFaceFont("segoe-ui");
		const ones = estimateKeyTextWidth("1111", 20, { fontWeight: 700 });
		const eights = estimateKeyTextWidth("8888", 20, { fontWeight: 700 });
		assert.ok(Math.abs(ones - eights) < 0.5, `${ones} vs ${eights}`);
	});
});
