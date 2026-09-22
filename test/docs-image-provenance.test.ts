// The documentation board docs/assets/img/dial-reading-colors-1.7.png is
// drawn by scripts/docs-v17-images.mjs through the production dial
// composer, and its provenance file records every scenario's inputs and
// the SHA-256 of the SVG the composer returned. Nothing read those records
// back: a renderer change would leave the committed board showing what
// the plugin no longer draws. This re-runs each recorded scenario through
// the same composer over the same fixture and holds the SVG to its
// recorded hash, and holds the committed PNG to its recorded hash, so a
// drift on either side fails here and the board is regenerated with the
// generator, never edited by hand.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { dialGalleryFixture } from "../scripts/lib/dial-gallery";
import { composeDialSvg } from "../src/actions/sensor-dial";
import { applyGlobalThemeSettings } from "../src/ui/theme-store";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const IMG = path.join(ROOT, "docs", "assets", "img");
const sha256 = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");

type Scenario = {
	view: "overview" | "tworow";
	individualColors: boolean;
	settings: Record<string, unknown>;
	readings: readonly Record<string, unknown>[];
	histories: Record<string, readonly number[]>;
	svgSha256: string;
};
type Asset = { file: string; sha256: string; globals?: { theme: string; textMode: string; typeAccents: string }; scenarios?: Scenario[]; source?: string | string[] };
type Provenance = { version: string; command: string; assets: Asset[] };

describe("documentation renderer boards match their recorded provenance", () => {
	const provenance = JSON.parse(fs.readFileSync(path.join(IMG, "renderer-images-1.7.provenance.json"), "utf8")) as Provenance;

	it("every recorded PNG is the committed file", () => {
		for (const asset of provenance.assets) {
			assert.equal(sha256(fs.readFileSync(path.join(IMG, asset.file))), asset.sha256, asset.file);
		}
	});

	it("the dial color board's scenarios still compose to the recorded SVGs", () => {
		const board = provenance.assets.find((asset) => asset.file === "dial-reading-colors-1.7.png");
		assert.ok(board?.scenarios && board.globals, "the board records its scenarios and globals");
		applyGlobalThemeSettings(board.globals);
		assert.equal(board.scenarios.length, 4);
		for (const scenario of board.scenarios) {
			const fixture = dialGalleryFixture(scenario.view);
			// The recorded inputs are what the generator saw: the fixture must
			// still produce them, or the record describes another picture.
			assert.deepEqual(JSON.parse(JSON.stringify(fixture.snapshot.readings)), scenario.readings, `${scenario.view}: fixture readings`);
			assert.deepEqual(Object.fromEntries(fixture.snapshot.readings.map((reading) => [reading.key, fixture.historyOf(reading.key)])), scenario.histories, `${scenario.view}: fixture histories`);
			const svg = composeDialSvg({ ...fixture.state, settings: scenario.settings as typeof fixture.state.settings }, { state: "ok", snapshot: fixture.snapshot, source: "shared-memory" }, fixture.historyOf);
			assert.equal(sha256(svg), scenario.svgSha256, `${scenario.view}${scenario.individualColors ? " with individual colors" : ""}: the composer no longer draws the committed board; regenerate it with ${provenance.command}`);
		}
	});
});
