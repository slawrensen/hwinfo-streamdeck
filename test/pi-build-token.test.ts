/**
 * PI cache-token parity gate. The Stream Deck webview caches PI
 * sub-resources across plugin updates, so every panel busts the cache by
 * loading the first-party assets (pi.css and every pi-*.js script) with
 * one shared ?v= token, and pi-common.js stamps the same value into
 * PI_BUILD so a live webview names the code it actually runs. A token
 * that drifts from the stamp (it happened: stamp -13 vs token -14, and
 * nothing checked it) makes the console line vouch for bytes the panel
 * never loaded. This gate reads the shipped files themselves: every
 * *.html under ui/ is enumerated, every first-party reference must carry
 * a token, and every token must equal PI_BUILD. sdpi-components.js is
 * vendored and stays untokened on purpose; it changes only with a vendor
 * bump.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const UI_DIR = fileURLToPath(new URL("../com.lawrensen.hwinfo.sdPlugin/ui/", import.meta.url));
// Every first-party panel asset: pi.css and every pi-*.js the panels load
// (pi-model, pi-shell, pi-common, pi-control, pi-command, pi-slot, and any
// added later). The vendored sdpi-components.js never matches: the name
// must start at the attribute's opening quote.
const FIRST_PARTY = /(?:href|src)="(pi(?:-[\w-]+)?\.(?:css|js))(\?v=([^"]*))?"/g;
// Any spelling of a first-party asset name, however it is quoted or
// prefixed. Matched counts must agree with FIRST_PARTY or the gate is
// being dodged by a ref it cannot parse (single quotes, ./ prefix, a
// case change), which is exactly the silent-skip hole it must not have.
const ANY_MENTION = /(?<![\w-])pi(?:-[\w-]+)?\.(?:css|js)/gi;

function readBuildStamp(): string {
	const source = readFileSync(join(UI_DIR, "pi-common.js"), "utf8");
	const stamps = [...source.matchAll(/const PI_BUILD = "([^"]+)";/g)];
	assert.equal(stamps.length, 1, "pi-common.js must declare exactly one PI_BUILD");
	const stamp = stamps[0]?.[1];
	assert.ok(stamp, "the PI_BUILD capture came back empty");
	return stamp;
}

describe("PI cache tokens agree with PI_BUILD", () => {
	const stamp = readBuildStamp();
	const panels = readdirSync(UI_DIR).filter((name) => name.endsWith(".html"));

	it("enumerates the shipped panels", () => {
		// An empty enumeration would green-light everything below.
		assert.ok(panels.length >= 4, `expected the shipped panels under ui/, found ${panels.length}`);
	});

	for (const panel of panels) {
		it(`${panel} tokens every first-party asset with ${stamp}`, () => {
			const html = readFileSync(join(UI_DIR, panel), "utf8");
			const refs = [...html.matchAll(FIRST_PARTY)];
			for (const [, asset, query, token] of refs) {
				assert.ok(query, `${panel}: ${asset} is referenced without a ?v= token`);
				assert.equal(token, stamp, `${panel}: ${asset} carries ?v=${token} but PI_BUILD is ${stamp}`);
			}
			if (panel !== "control.html" && panel !== "detail-slot.html") {
				// The two sensor panels load the stylesheet and five scripts
				// (model, shell, common, control); a refactor that drops one
				// below this floor deserves a loud look.
				assert.ok(refs.length >= 5, `${panel}: expected the first-party assets, found ${refs.length}`);
			}
			assert.ok(refs.length >= 1, `${panel}: no first-party asset reference found`);
			const mentions = [...html.matchAll(ANY_MENTION)];
			assert.equal(
				mentions.length,
				refs.length,
				`${panel}: ${mentions.length} first-party asset mention(s) but only ${refs.length} parse as tokened refs; a reference is written in a form this gate cannot read`
			);
		});
	}
});
