/**
 * The strip's value scales (src/strip/scale.ts): the kinds, the calm span,
 * the target of every row of the spec's table (40-spec-final.md 3.3), data
 * chosen in the printed unit, the one hold (seeded signals of the spec's
 * check, yscale/final/check.mts, whose counts are upper bounds here), the
 * dial's ladders (5.3), and the migration guards: a scale stored before the
 * unit stamp keeps the reach it had until it is edited.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fixtureCase, makeView } from "../scripts/lib/strip-fixtures";
import { setFaceFont } from "../src/ui/face-font";
import { loadThemes, resolvePalette } from "../src/ui/themes";
import type { Extent } from "../src/strip/graph";
import type { TextPrim } from "../src/strip/prims";
import { autoTarget, calmSpan, dialStops, endText, nextHeldScale, SCALE_NARROW_HOLD_MS, scaleKindOf, scaleTicks, scaleUnitWord, scaleView, stepSpan, toView, widerDigit, type HeldScale, type ScaleAsk, type ScaleDialInfo } from "../src/strip/scale";
import { buildStripScene, stripBandsFor, type PaneScaleOut, type StripSceneInput, type StripSeriesInput } from "../src/strip/scene";
import { stripConfigOf, stripPaneOf } from "../src/strip/settings";

setFaceFont("tahoma");

const askOf = (unit: string, need: Extent, opts: { fahrenheit?: boolean; dataUnits?: "decimal" | "binary"; maxTicks?: number; span?: number } = {}): ScaleAsk => ({ need, view: scaleView(unit, { fahrenheit: opts.fahrenheit === true, dataUnits: opts.dataUnits ?? "decimal" }), kind: scaleKindOf(unit), maxTicks: opts.maxTicks ?? 6, ...(opts.span === undefined ? {} : { span: opts.span }) });
/** A scale as the strip prints it: "34..39 °C", "0..250kbps", "No..Yes". */
const printed = (ask: ScaleAsk, s: Extent): string => {
	const st = scaleTicks(ask.view, s, ask.maxTicks);
	assert.ok(st !== null);
	return `${endText(st.ticks.lo, st, true)}..${endText(st.ticks.hi, st, true)}${scaleUnitWord(ask.view, true)}`;
};
const target = (unit: string, need: Extent, opts: Parameters<typeof askOf>[2] = {}): string => {
	const ask = askOf(unit, need, opts);
	return printed(ask, autoTarget(ask));
};
/** °F readings stored in °C. */
const fromF = (f: number): number => (f - 32) / 1.8;

describe("kinds and the calm span", () => {
	it("Yes/No, percent, zero and float, by unit; a unitless reading floats", () => {
		assert.equal(scaleKindOf("Yes/No"), "yesno");
		assert.equal(scaleKindOf("%"), "percent");
		for (const u of ["W", "kW", "mW", "A", "mA", "RPM", "FPS", "ms", "Wh", "kWh", "MB/s", "KB/s", "Mbps", "GB", "KiB"]) assert.equal(scaleKindOf(u), "zero", u);
		for (const u of ["°C", "°F", "Δ°C", "Δ°F", "V", "mV", "MHz", "GHz", "x", ""]) assert.equal(scaleKindOf(u), "float", u);
	});

	it("calm spans: the unit's table value in the view unit, 2 % of the reading, up the tick ladder", () => {
		assert.equal(calmSpan(scaleView("°C", { fahrenheit: false }), 36, 37), 5);
		// 5 °C shown in °F is 9 °F, up the ladder to 10.
		assert.equal(calmSpan(scaleView("°C", { fahrenheit: true }), 97, 98), 10);
		assert.equal(calmSpan(scaleView("Δ°C", { fahrenheit: true }), 15, 16), 10);
		assert.equal(calmSpan(scaleView("MHz", { fahrenheit: false }), 4450, 4475), 200);
		// The +12 V rail's 2 % (0.242 V) is 0.25 V.
		assert.equal(calmSpan(scaleView("V", { fahrenheit: false }), 12.02, 12.1), 0.25);
		// No table row: 2 % of the reading.
		assert.equal(calmSpan(scaleView("x", { fahrenheit: false }), 40, 45), 2);
		assert.equal(calmSpan(scaleView("", { fahrenheit: false }), 40, 45), 1);
	});
});

describe("the target (40-spec-final.md 3.3)", () => {
	// [reading, unit, need, 6 ticks, 3 ticks, options]
	const ROWS: [string, string, Extent, string, string, Parameters<typeof askOf>[2]?][] = [
		["GPU temperature idle", "°C", { lo: 36.1, hi: 36.9 }, "34..39 °C", "35..40 °C"],
		["same in °F", "°C", { lo: fromF(97), hi: fromF(98.4) }, "92..102 °F", "95..105 °F", { fahrenheit: true }],
		["GPU temperature gaming", "°C", { lo: 64, hi: 72 }, "64..72 °C", "60..80 °C"],
		["CPU usage idle", "%", { lo: 1.2, hi: 4.8 }, "0..100 %", "0..100 %"],
		["GPU load gaming", "%", { lo: 93, hi: 99 }, "0..100 %", "0..100 %"],
		["Total CPU Utility", "%", { lo: 110, hi: 130 }, "0..150 %", "0..200 %"],
		["GPU power idle", "W", { lo: 14.8, hi: 16.2 }, "0..25 W", "0..40 W"],
		["CPU power idle", "W", { lo: 25.8, hi: 34.1 }, "0..50 W", "0..50 W"],
		["CPU package power", "W", { lo: 88, hi: 142 }, "0..250 W", "0..400 W"],
		["core clock steady", "MHz", { lo: 4450, hi: 4475 }, "4350..4550 MHz", "4400..4600 MHz"],
		["core voltage steady", "V", { lo: 1.2, hi: 1.21 }, "1.18..1.23 V", "1.175..1.225 V"],
		["+12 V rail", "V", { lo: 12.02, hi: 12.1 }, "11.95..12.20 V", "12.0..12.25 V"],
		["CPU fan", "RPM", { lo: 1180, hi: 1220 }, "0..2000 RPM", "0..2000 RPM"],
		["fan stopped", "RPM", { lo: 0, hi: 0 }, "0..100 RPM", "0..100 RPM"],
		["frame time", "ms", { lo: 6.4, hi: 7.9 }, "0..12.5 ms", "0..20 ms"],
		["hot spot delta", "Δ°C", { lo: 8.2, hi: 8.9 }, "6..11 Δ°C", "5..10 Δ°C"],
		["network idle, Decimal", "KB/s", { lo: 0, hi: 20 }, "0..250kbps", "0..400kbps"],
		["network idle, Binary", "KB/s", { lo: 0, hi: 20 }, "0..30KiB/s", "0..40KiB/s", { dataUnits: "binary" }],
		["disk read idle", "MB/s", { lo: 0, hi: 0.4 }, "0..5Mbps", "0..5Mbps"],
		["thermal throttling", "Yes/No", { lo: 0, hi: 0 }, "No..Yes", "No..Yes"],
		["outdoor probe", "°C", { lo: -3.2, hi: -2.9 }, "-6..-1 °C", "-5..0 °C"]
	];
	for (const [name, unit, need, six, three, opts] of ROWS) {
		it(`${name}: ${six} on 6 ticks, ${three} on 3`, () => {
			assert.equal(target(unit, need, { ...opts, maxTicks: 6 }), six);
			assert.equal(target(unit, need, { ...opts, maxTicks: 3 }), three);
		});
	}

	it("a steady zero kind's line sits under the top row: the highest reading at most 70 % up", () => {
		const ask = askOf("RPM", { lo: 1180, hi: 1220 });
		const s = autoTarget(ask);
		assert.ok(1220 / s.hi <= 0.7, `${s.lo}..${s.hi}`);
	});

	it("Binary places HWiNFO's KB to TB as 1024-based, as the values print them (issue #59); rates as before", () => {
		const view = scaleView("MB", { fahrenheit: false, dataUnits: "binary" });
		assert.equal(toView(view, 12100), 12100 * 1024 ** 2);
		assert.equal(toView(scaleView("GB", { fahrenheit: false, dataUnits: "binary" }), 2), 2 * 1024 ** 3);
		assert.equal(toView(scaleView("MB", { fahrenheit: false, dataUnits: "decimal" }), 12100), 12100 * 1e6);
		assert.equal(toView(scaleView("MB/s", { fahrenheit: false, dataUnits: "binary" }), 3), 3e6);
	});

	it("data scales: one tier per scale, and a round top that reaches the next tier's base is redone a tier up", () => {
		// 650 kbps with room above rounds to 1000 kbps: printed in Mbps, with
		// the tick decimals (as 37.0 on 36 to 37).
		assert.equal(target("Kbit/s", { lo: 0, hi: 650 }), "0..1.0Mbps");
		// 950 kbps with room above is past 1 Mbps already: 1.5Mbps.
		assert.equal(target("Kbit/s", { lo: 0, hi: 950 }), "0..1.5Mbps");
		assert.equal(target("MB/s", { lo: 0, hi: 5 }), "0..60Mbps");
		assert.equal(target("GB", { lo: 0, hi: 0.2 }), "0..300MB");
	});

	it("a typed end is kept exactly and the free end follows the readings; both typed are exactly those ends", () => {
		const ask = askOf("°C", { lo: 36.1, hi: 36.9 });
		assert.deepEqual(autoTarget({ ...ask, kept: { lo: 30.5 } }), { lo: 30.5, hi: 38 });
		assert.deepEqual(autoTarget({ ...ask, kept: { hi: 90 } }), { lo: 20, hi: 90 });
		assert.deepEqual(autoTarget({ ...ask, kept: { lo: 30.5, hi: 90 } }), { lo: 30.5, hi: 90 });
		assert.equal(printed(ask, { lo: 30.5, hi: 90 }), "30.5..90 °C");
		// A zero kind with a typed top is from zero.
		assert.deepEqual(autoTarget({ ...askOf("W", { lo: 14.8, hi: 16.2 }), kept: { hi: 130 } }), { lo: 0, hi: 130 });
	});

	it("the reserved slot's next digit", () => {
		assert.equal(widerDigit("39 °C"), "100 °C");
		assert.equal(widerDigit("250kbps"), "1000kbps");
		assert.equal(widerDigit("-6"), "-10");
	});
});

// ---- the hold -------------------------------------------------------------------------

/** The spec's seeded generators (yscale/final/check.mts), one value a second. */
function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
function gauss(rand: () => number): () => number {
	return () => {
		const u = Math.max(1e-12, rand());
		const v = rand();
		return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
	};
}
const q = (v: number, step: number): number => Math.round(v / step) * step;
const r1 = (v: number): number => Number(v.toFixed(1));
function table(seed: number, fn: (t: number, g: () => number) => number): Map<number, number> {
	const g = gauss(mulberry32(seed));
	const out = new Map<number, number>();
	for (let t = -900; t <= 1200; t++) out.set(t, fn(t, g));
	return out;
}
const IDLE = table(11, (t, g) => r1(q(36.5 + 0.15 * Math.sin((2 * Math.PI * t) / 420) + 0.12 * g(), 0.1)));
const burstRand = mulberry32(14);
const BURSTS: { at: number; len: number; level: number }[] = [];
for (let at = 30; at < 270; at += 40 + Math.floor(burstRand() * 50)) BURSTS.push({ at, len: 2 + Math.floor(burstRand() * 7), level: 140 + burstRand() * 15 });
const POWER = table(15, (t, g) => {
	const b = BURSTS.find((x) => t >= x.at && t < x.at + x.len);
	return r1(q(b === undefined ? 30 + 1.5 * g() : b.level + 3 * g(), 0.1));
});
const FAN_STEPS = [
	{ at: -900, to: 800 },
	{ at: 240, to: 1200 },
	{ at: 480, to: 1650 },
	{ at: 720, to: 1100 },
	{ at: 960, to: 850 }
];
const FAN = table(16, (t, g) => {
	let level = 800;
	for (let i = 1; i < FAN_STEPS.length; i++) {
		const s = FAN_STEPS[i] as { at: number; to: number };
		const prev = (FAN_STEPS[i - 1] as { to: number }).to;
		if (t >= s.at + 6) level = s.to;
		else if (t >= s.at) level = prev + ((s.to - prev) * (t - s.at)) / 6;
	}
	return Math.round(level + 6 * g());
});

/** Scale changes over 20 minutes after a 15 minute pre-roll. */
function changes(values: Map<number, number>, unit: string, windowS: number): number {
	let held: HeldScale | undefined;
	let n = 0;
	for (let t = 0; t <= 1200; t++) {
		let lo = Number.POSITIVE_INFINITY;
		let hi = Number.NEGATIVE_INFINITY;
		for (let u = t - windowS + 1; u <= t; u++) {
			const v = values.get(u) as number;
			lo = Math.min(lo, v);
			hi = Math.max(hi, v);
		}
		const next = nextHeldScale(held, askOf(unit, { lo, hi }), t * 1000);
		if (held !== undefined && (next.lo !== held.lo || next.hi !== held.hi)) n++;
		held = next;
	}
	return n;
}

describe("the hold", () => {
	it("the seeded signals change their scale no more than the spec's check counts", () => {
		for (const w of [60, 300, 900]) assert.equal(changes(IDLE, "°C", w), 0, `idle GPU, ${w} s window`);
		assert.ok(changes(FAN, "RPM", 60) <= 1, "fan steps, 1 min");
		assert.ok(changes(POWER, "W", 60) <= 4, "CPU power bursts, 1 min");
	});

	it("a reading outside the scale grows it at once on its side; the other side is kept", () => {
		const prev = { lo: 34, hi: 39, since: null };
		const grown = nextHeldScale(prev, askOf("°C", { lo: 36, hi: 41 }), 1000);
		assert.equal(grown.lo, 34);
		assert.ok(grown.hi >= 41 && grown.since === null, `${grown.lo}..${grown.hi}`);
	});

	it("narrowing waits until the target has fit in half the scale for 10 s, then takes one step to it", () => {
		const ask = askOf("W", { lo: 25.8, hi: 34.1 });
		let held: HeldScale = { lo: 0, hi: 250, since: null };
		const trail: string[] = [];
		for (let t = 0; t <= 14_000; t += 1000) {
			held = nextHeldScale(held, ask, t);
			trail.push(`${held.lo}..${held.hi}`);
		}
		const first = trail.indexOf("0..50");
		assert.equal(first, SCALE_NARROW_HOLD_MS / 1000, trail.join(" "));
		assert.deepEqual([...new Set(trail)], ["0..250", "0..50"], "one step");
	});

	it("the 10 s clock starts over whenever the readings stop fitting in half", () => {
		const fits = askOf("W", { lo: 25.8, hi: 34.1 });
		const wide = askOf("W", { lo: 25.8, hi: 140 });
		let held: HeldScale = { lo: 0, hi: 250, since: null };
		held = nextHeldScale(held, fits, 0);
		held = nextHeldScale(held, fits, 6000);
		held = nextHeldScale(held, wide, 7000);
		assert.equal(held.since, null, "the condition broke");
		held = nextHeldScale(held, fits, 8000);
		held = nextHeldScale(held, fits, 17_000);
		assert.deepEqual([held.lo, held.hi], [0, 250], "9 s since it fit again");
		held = nextHeldScale(held, fits, 18_000);
		assert.deepEqual([held.lo, held.hi], [0, 50]);
	});

	it("idempotent at one moment: the same frame time judges the same", () => {
		const ask = askOf("W", { lo: 25.8, hi: 34.1 });
		const prev = { lo: 0, hi: 250, since: 0 };
		const once = nextHeldScale(prev, ask, 4000);
		assert.deepEqual(nextHeldScale(prev, ask, 4000), once);
		const settled = nextHeldScale({ lo: 34, hi: 39, since: null }, askOf("°C", { lo: 36.1, hi: 36.9 }), 4000);
		assert.deepEqual(nextHeldScale(settled, askOf("°C", { lo: 36.1, hi: 36.9 }), 4000), settled);
	});

	it("a percentage past 100 grows to a round top and comes back to 0 to 100 after the hold", () => {
		let held = nextHeldScale(undefined, askOf("%", { lo: 90, hi: 130 }), 0);
		assert.deepEqual([held.lo, held.hi], [0, 150]);
		for (let t = 1000; t <= 11_000; t += 1000) held = nextHeldScale(held, askOf("%", { lo: 90, hi: 99 }), t);
		assert.deepEqual([held.lo, held.hi], [0, 100]);
	});

	it("both ends typed: no hold, exactly those ends", () => {
		const ask = { ...askOf("°C", { lo: 36, hi: 37 }), kept: { lo: 30, hi: 90 } };
		assert.deepEqual(nextHeldScale({ lo: 0, hi: 1, since: 5 }, ask, 100), { lo: 30, hi: 90, since: null });
	});
});

// ---- the dial -------------------------------------------------------------------------

/** One reading's dial at its Auto target, and the ladder each way. */
function ladder(unit: string, need: Extent, dir: 1 | -1, opts: Parameters<typeof askOf>[2] = {}): string[] {
	const ask = askOf(unit, need, opts);
	const auto = autoTarget(ask);
	const start = toView(ask.view, auto.hi) - toView(ask.view, auto.lo);
	const dial: ScaleDialInfo = { key: "k", kind: ask.kind, view: ask.view, need, maxTicks: 6, onScreen: start };
	const out: string[] = [];
	let span = start;
	for (let i = 0; i < 9; i++) {
		const r = stepSpan({ ...dial, onScreen: span }, span, start, dir);
		if (r === null) break;
		span = r === "clear" ? start : r;
		const s = autoTarget({ ...ask, span: r === "clear" ? start : r });
		out.push(r === "clear" ? "Auto" : `${Number(toView(ask.view, s.lo).toPrecision(10))}..${Number(toView(ask.view, s.hi).toPrecision(10))}`);
	}
	return out;
}

describe("the dial (40-spec-final.md 5.3)", () => {
	const LADDERS: [string, string, Extent, string[], string[], Parameters<typeof askOf>[2]?][] = [
		["idle GPU", "°C", { lo: 36.1, hi: 36.9 }, ["35.5..37.5", "36..37"], ["32..42", "25..45", "0..50", "0..100"]],
		["idle GPU in °F", "°C", { lo: fromF(97), hi: fromF(98.4) }, ["95..100", "96.5..98.5"], ["90..110", "70..120", "40..140", "0..200"], { fahrenheit: true }],
		["gaming GPU", "°C", { lo: 64, hi: 72 }, [], ["64..74", "60..80", "40..90", "0..100", "0..200"]],
		["GPU load", "%", { lo: 93, hi: 99 }, ["50..100", "80..100", "90..100"], []],
		["CPU usage", "%", { lo: 1.2, hi: 4.8 }, ["0..50", "0..20", "0..10", "0..5"], []],
		["Total CPU Utility", "%", { lo: 110, hi: 130 }, ["50..150", "100..150", "110..130"], []],
		["GPU power", "W", { lo: 14.8, hi: 16.2 }, ["0..20", "10..20", "13..18", "14.5..16.5"], ["0..50"]],
		["core clock", "MHz", { lo: 4450, hi: 4475 }, ["4420..4520", "4440..4490"], ["4200..4700", "4000..5000", "3500..5500", "2000..7000", "0..10000"]],
		["CPU fan", "RPM", { lo: 1180, hi: 1220 }, ["800..1800", "1000..1500", "1100..1300", "1160..1260", "1180..1230"], ["0..5000"]],
		["network idle (bps)", "KB/s", { lo: 0, hi: 20 }, ["0..200000"], ["0..500000"]]
	];
	for (const [name, unit, need, inward, outward, opts] of LADDERS) {
		it(`${name}: counterclockwise ${inward.join(" > ") || "(stop)"}; clockwise ${outward.join(" > ") || "(stop)"}`, () => {
			assert.deepEqual(ladder(unit, need, -1, opts), inward);
			assert.deepEqual(ladder(unit, need, 1, opts), outward);
		});
	}

	it("out and back lands on Auto: the span on screen when the turn began is a stop, and landing on it ends the turn", () => {
		const ask = askOf("°C", { lo: 36.1, hi: 36.9 });
		const dial: ScaleDialInfo = { key: "u:°C", kind: "float", view: ask.view, need: ask.need, maxTicks: 6, onScreen: 5 };
		const out = stepSpan(dial, 5, 5, 1);
		assert.equal(out, 10);
		assert.equal(stepSpan({ ...dial, onScreen: 10 }, 10, 5, -1), "clear");
		// A held 0..200 W after a burst (target 0..50): in, then out to the start.
		const w = askOf("W", { lo: 25.8, hi: 34.1 });
		const held: ScaleDialInfo = { key: "u:W", kind: "zero", view: w.view, need: w.need, maxTicks: 6, onScreen: 200 };
		assert.deepEqual(dialStops(held, 200), [10, 20, 50, 100, 200]);
		assert.equal(stepSpan(held, 200, 200, 1), null, "the wide end");
		assert.equal(stepSpan(held, 200, 200, -1), 100);
		assert.equal(stepSpan({ ...held, onScreen: 100 }, 100, 200, 1), "clear");
	});

	it("a fast spin moves several stops and stops at the end; five out and five back passes the start and stops where the count lands", () => {
		const ask = askOf("°C", { lo: 36.1, hi: 36.9 });
		const dial: ScaleDialInfo = { key: "u:°C", kind: "float", view: ask.view, need: ask.need, maxTicks: 6, onScreen: 5 };
		assert.equal(stepSpan(dial, 5, 5, 5), 100, "the wide stop");
		assert.equal(stepSpan({ ...dial, onScreen: 100 }, 100, 5, -5), 2, "35.5..37.5");
	});

	it("a Yes/No reading takes no dial", () => {
		const ask = askOf("Yes/No", { lo: 0, hi: 1 });
		assert.deepEqual(dialStops({ key: "u:Yes/No", kind: "yesno", view: ask.view, need: ask.need, maxTicks: 6, onScreen: 1 }, 1), []);
	});
});

// ---- Lanes -------------------------------------------------------------------------------

describe("a Lanes graph holds its shape: six ticks while it draws none, three with Scale and grid", () => {
	const palette = resolvePalette(loadThemes(), "graphite", null, "normal");
	const flat = (lo: number, hi: number) => (f: number): number => lo + (hi - lo) * f;
	const reading = (key: string, unit: string, value: (f: number) => number): StripSeriesInput => ({ key, name: key.toUpperCase(), unit, state: "ok", history: makeView({ windowMs: 300_000, widthPx: 600, unit, value }), current: value(1) });
	/** The scale each lane holds this frame, handed the last frame's. */
	function held(series: StripSeriesInput[], axes: boolean, prev?: Readonly<Record<string, HeldScale>>): Record<string, HeldScale> {
		const pane = stripPaneOf({ style: "lanes", series: series.map((s) => ({ key: s.key })), overlays: { axes } });
		const config = { ...stripConfigOf({ encoders: 6, background: "theme" }), panes: [pane, pane] as const };
		const input: StripSceneInput = { config, encoders: 6, palette, text: { mode: "theme", color: undefined, dimSecondary: false }, alertColors: { warn: "#FFB000", crit: "#FF3B30" }, dataUnits: "decimal", panes: [{ series, bands: [], view: { mode: "live" }, highlight: 0, scale: { at: 1000, ...(prev === undefined ? {} : { prev }) } }] };
		return (buildStripScene(input).scales[0] as PaneScaleOut).held;
	}
	const ends = (s: HeldScale | undefined): string => `${s?.lo}..${s?.hi}`;

	it("a CPU touching 84 °C goes from 40..80 to 40..90, not to 0..100", () => {
		const first = held([reading("cpu", "°C", flat(40, 78)), reading("w", "W", flat(40, 168))], false);
		assert.equal(ends(first["l:cpu"]), "40..80");
		const next = held([reading("cpu", "°C", flat(40, 84)), reading("w", "W", flat(40, 168))], false, first);
		assert.equal(ends(next["l:cpu"]), "40..90");
	});

	it("power and fans sit on a tighter scale", () => {
		const scales = held([reading("w", "W", flat(40, 168)), reading("rpm", "RPM", flat(800, 1540))], false);
		assert.equal(ends(scales["l:w"]), "0..250");
		assert.equal(ends(scales["l:rpm"]), "0..2500");
	});

	it("with Scale and grid on, the lane keeps the three ticks it draws", () => {
		const scales = held([reading("w", "W", flat(40, 168)), reading("rpm", "RPM", flat(800, 1540))], true);
		assert.equal(ends(scales["l:w"]), "0..400");
		assert.equal(ends(scales["l:rpm"]), "0..4000");
	});
});

// ---- migration guards ------------------------------------------------------------------

describe("a scale stored before the unit stamp keeps its reach until it is edited", () => {
	const palette = resolvePalette(loadThemes(), "graphite", null, "normal");
	const reading = (key: string, unit: string, value: (f: number) => number): StripSeriesInput => ({ key, name: key.toUpperCase(), unit, state: "ok", history: makeView({ windowMs: 300_000, widthPx: 600, unit, value }), current: value(1) });
	function scene(style: string, series: StripSeriesInput[], scale: Record<string, unknown>): ReturnType<typeof buildStripScene> {
		const pane = stripPaneOf({ style, series: series.map((s) => ({ key: s.key })), scale });
		const config = { ...stripConfigOf({ encoders: 6, background: "theme" }), panes: [pane, pane] as const };
		const input: StripSceneInput = { config, encoders: 6, palette, text: { mode: "theme", color: undefined, dimSecondary: false }, alertColors: { warn: "#FFB000", crit: "#FF3B30" }, dataUnits: "decimal", panes: [{ series, bands: stripBandsFor(pane, series, { fahrenheit: false, decimals: "auto" }), view: { mode: "live" }, highlight: 0 }] };
		return buildStripScene(input);
	}
	const ends = (prims: ReturnType<typeof buildStripScene>["prims"]): string[] => prims.filter((p): p is TextPrim => p.k === "text" && p.layer === "rows" && p.size === 11 && Math.abs(p.x - 3) < 0.6).sort((a, b) => a.y - b.y).map((p) => p.text);
	const temp = reading("gpu", "°C", (f) => 36.1 + 0.8 * f);
	const power = reading("pwr", "W", (f) => 14.8 + 1.4 * f);

	it("an unstamped 0 to 300 on a °C and W Trend applies to band 1, as before", () => {
		assert.deepEqual(ends(scene("trend", [temp, power], { min: 0, max: 300 }).prims).slice(0, 2), ["300 °C", "0"]);
	});

	it("an unstamped scale on Meters applies to every meter, as before", () => {
		const meters = scene("meters", [temp, power], { min: 30, max: 90 }).prims.filter((p): p is TextPrim => p.k === "text" && p.size === 12 && p.y === 94 && /^\d+$/.test(p.text));
		const at = (x0: number): string[] => meters.filter((p) => p.x >= x0 && p.x < x0 + 600).sort((a, b) => a.x - b.x).map((p) => p.text);
		assert.deepEqual(at(0), ["30", "90"]);
		assert.deepEqual(at(600), ["30", "90"]);
	});

	it("a stamp whose record no longer matches its numbers reads as unstamped (an older build rewrote one)", () => {
		const broken = { min: 0, max: 300, displayUnit: "W", displayUnitFor: { min: "0", max: "301" } };
		assert.deepEqual(stripPaneOf({ scale: broken }).scale, { min: 0, max: 300 });
		assert.deepEqual(ends(scene("trend", [temp, power], broken).prims).slice(0, 2), ["300 °C", "0"], "legacy reach: band 1");
	});

	it("a counting stamp reaches the band in its unit instead", () => {
		const stamped = { min: 0, max: 300, displayUnit: "W", displayUnitFor: { min: "0", max: "300" } };
		assert.deepEqual(ends(scene("trend", [temp, power], stamped).prims).slice(2), ["300 W", "0"]);
	});

	it("the fixtures' Trend pane draws its ends through the new scale (a smoke check of the boards' input)", () => {
		const c = fixtureCase({ styles: ["trend"], layout: "whole", encoders: 6, background: "theme", accent: false });
		assert.ok(buildStripScene(c.input).scales[0] !== null);
	});
});
