/**
 * The panels' Trend window controls: each writes exactly the values the
 * plugin parses (Recent samples writes ""), shows only where a trend is
 * drawn, keeps its help to two sentences, and the folded summaries name
 * the window the face draws.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { parseHistoryWindow } from "../src/history/window";

describe("panel controls write the exact window values", () => {
	const ui = (name: string): string => readFileSync(new URL(`../com.lawrensen.hwinfo.sdPlugin/ui/${name}`, import.meta.url), "utf8");
	for (const [panel, setting] of [["sensor-reading.html", "historyWindow"], ["sensor-dial.html", "dialHistoryWindow"]] as const) {
		it(`${panel}: Trend window saves ${setting}, Recent samples by default`, () => {
			const html = ui(panel);
			const select = /<select id="f-trend-window"([^>]*)>([\s\S]*?)<\/select>/.exec(html);
			assert.ok(select);
			assert.match(select[1] as string, new RegExp(`\\bdata-setting="${setting}"`));
			assert.match(select[1] as string, /\bdata-default=""/);
			const options = [...(select[2] as string).matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)].map((m) => [m[1], m[2]]);
			assert.deepEqual(options, [["", "Recent samples"], ["1m", "1 minute"], ["5m", "5 minutes"], ["15m", "15 minutes"]]);
			for (const [value] of options.slice(1)) assert.equal(parseHistoryWindow(value), value, "the plugin reads every offered value as itself");
			assert.equal(parseHistoryWindow(""), undefined, "the default is the recent-samples line");
			assert.match(html, /<div class="hw-field" id="trend-window-item" hidden>/, "hidden until the view that draws a trend is chosen");
			// The label and its options say it; the docs page has the rules.
			assert.doesNotMatch(html, /id="trend-window-help"/, "no help line under Trend window");
		});
	}

	it("the panel shows the select only where the plugin draws a trend", () => {
		const js = ui("pi-common.js");
		assert.match(js, /trendWindowEl\.hidden = mode !== "sparkline"/);
		assert.match(js, /trendWindowEl\.hidden = value !== "tworow"/);
	});

	it("folded summaries name the window the face draws", () => {
		const scope: { hwModel?: { displaySummary(kind: string, settings: Record<string, unknown>, globals: Record<string, unknown>, preview: unknown): string } } = {};
		new Function("self", ui("pi-model.js"))(scope);
		const model = scope.hwModel!;
		assert.equal(model.displaySummary("key", { displayMode: "sparkline", historyWindow: "5m" }, {}, null), "Current value · auto decimals · shared text · 5 min sparkline");
		assert.equal(model.displaySummary("key", { displayMode: "sparkline", historyWindow: "5M" }, {}, null), "Current value · auto decimals · shared text · sparkline");
		assert.equal(model.displaySummary("key", { displayMode: "bar", historyWindow: "5m" }, {}, null), "Current value · auto decimals · shared text · bar");
		assert.match(model.displaySummary("dial", { dialView: "tworow", dialHistoryWindow: "15m" }, {}, null), /^Overview, two rows, 15 min trend · /);
		assert.match(model.displaySummary("dial", { dialView: "overview", dialHistoryWindow: "15m" }, {}, null), /^Overview, three rows · /);
	});
});
