// The bundled detail profiles: registry integrity, manifest agreement,
// archive structure, strict baked bindings, byte-for-byte determinism,
// and the absence of anything personal in the shipped artifacts. The
// generator is imported directly so a drifted committed file (or a
// hand-edited manifest entry) fails here, in CI, not on a user's deck.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { buildDetailProfileArchive, DETAIL_PROFILE_DISPLAY_NAME, DETAIL_SLOT_UUID, PLUGIN_UUID, unzipStore } from "../scripts/lib/detail-profile-archive";
import { DETAIL_PROFILES, detailProfileFor, readingSlotCapacity } from "../src/detail/managed-profiles";
import { parseSlotBinding } from "../src/detail/slot-bindings";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin");
const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, "manifest.json"), "utf8")) as {
	Actions: Array<{ UUID: string; VisibleInActionsList?: boolean; UserTitleEnabled?: boolean; Controllers?: string[] }>;
	Profiles?: Array<{ Name: string; DeviceType: number; AutoInstall?: boolean; DontAutoSwitchWhenInstalled?: boolean; Readonly?: boolean }>;
};

/** Case-exact existence: NTFS existsSync is case-insensitive, so walk. */
function existsExact(relPath: string): boolean {
	let dir = pluginDir;
	for (const part of relPath.split("/")) {
		if (!fs.readdirSync(dir).includes(part)) {
			return false;
		}
		dir = path.join(dir, part);
	}
	return true;
}

const EXPECTED_CAPACITY: Record<string, number> = { mini: 3, standard: 11, neo: 4, plus: 4, xl: 28, "plus-xl": 32 };

describe("managed profile registry", () => {
	it("ships exactly six bundles with unique names, keys and device types", () => {
		assert.equal(DETAIL_PROFILES.length, 6);
		assert.equal(new Set(DETAIL_PROFILES.map((p) => p.name)).size, 6);
		assert.equal(new Set(DETAIL_PROFILES.map((p) => p.key)).size, 6);
		assert.equal(new Set(DETAIL_PROFILES.map((p) => p.deviceType)).size, 6);
		assert.deepEqual(
			DETAIL_PROFILES.map((p) => p.deviceType).sort((a, b) => a - b),
			[0, 1, 2, 7, 9, 13]
		);
	});

	it("holds five unique keypad geometries (Neo and + share 4x2)", () => {
		const plans = new Set(DETAIL_PROFILES.map((p) => JSON.stringify({ c: p.layout.columns, r: p.layout.rows, nav: p.layout.nav, readings: p.layout.readings })));
		assert.equal(plans.size, 5);
	});

	it("covers every cell exactly once, Back always top-left", () => {
		for (const profile of DETAIL_PROFILES) {
			const { layout } = profile;
			assert.deepEqual(layout.nav.back, { column: 0, row: 0 }, profile.key);
			const cells = new Set<string>();
			const add = (c: { column: number; row: number }): void => {
				const key = `${c.column},${c.row}`;
				assert.equal(cells.has(key), false, `${profile.key}: duplicate ${key}`);
				assert.ok(c.column >= 0 && c.column < layout.columns && c.row >= 0 && c.row < layout.rows, `${profile.key}: ${key} out of bounds`);
				cells.add(key);
			};
			for (const cell of Object.values(layout.nav)) {
				if (cell !== null) {
					add(cell);
				}
			}
			for (const cell of layout.readings) {
				add(cell);
			}
			assert.equal(cells.size, layout.columns * layout.rows, `${profile.key}: unmapped cells`);
			assert.equal(readingSlotCapacity(profile), EXPECTED_CAPACITY[profile.key], profile.key);
		}
	});

	it("only the Mini drops the title tile (its six keys have no room)", () => {
		for (const profile of DETAIL_PROFILES) {
			assert.equal(profile.layout.nav.title === null, profile.key === "mini", profile.key);
			assert.notEqual(profile.layout.nav.previous, null, profile.key);
			assert.notEqual(profile.layout.nav.next, null, profile.key);
		}
	});

	it("resolves supported device types and refuses the rest", () => {
		assert.equal(detailProfileFor(0)?.key, "standard");
		assert.equal(detailProfileFor(13)?.key, "plus-xl");
		for (const unsupported of [3, 4, 5, 6, 8, 10, 11, 12, 99, undefined]) {
			assert.equal(detailProfileFor(unsupported), undefined, String(unsupported));
		}
	});

	it("the Virtual Stream Deck resolves by fit: richest keypad-only bundle its grid holds", () => {
		assert.equal(detailProfileFor(11, { columns: 10, rows: 10 })?.key, "xl");
		assert.equal(detailProfileFor(11, { columns: 8, rows: 4 })?.key, "xl");
		assert.equal(detailProfileFor(11, { columns: 5, rows: 3 })?.key, "standard");
		assert.equal(detailProfileFor(11, { columns: 4, rows: 2 })?.key, "neo");
		assert.equal(detailProfileFor(11, { columns: 3, rows: 2 })?.key, "mini");
		assert.equal(detailProfileFor(11, { columns: 2, rows: 2 }), undefined);
		assert.equal(detailProfileFor(11), undefined); // no grid: never guess
		assert.equal(detailProfileFor(11, { columns: 0, rows: 0 }), undefined);
		// A fixed class ignores the grid entirely (an XL stays an XL).
		assert.equal(detailProfileFor(2, { columns: 3, rows: 2 })?.key, "xl");
		// Guest fitting never hands a dial-bearing bundle to a virtual deck.
		assert.equal(detailProfileFor(11, { columns: 9, rows: 4 })?.key, "xl");
	});
});

describe("manifest agreement", () => {
	it("registers each bundle for its owner and its guests, nothing else, with the intended install flags", () => {
		const entries = manifest.Profiles ?? [];
		const expected: Array<{ name: string; deviceType: number }> = [];
		for (const profile of DETAIL_PROFILES) {
			expected.push({ name: profile.name, deviceType: profile.deviceType });
			for (const guest of profile.guestDeviceTypes) {
				expected.push({ name: profile.name, deviceType: guest });
			}
		}
		assert.equal(entries.length, expected.length);
		for (const want of expected) {
			const entry = entries.find((e) => e.Name === want.name && e.DeviceType === want.deviceType);
			assert.notEqual(entry, undefined, `${want.name} for DeviceType ${want.deviceType}`);
			// Install on first use only; first accepted prompt continues into
			// the view; the slot grammar is not user-editable.
			assert.equal(entry?.AutoInstall, false, want.name);
			assert.equal(entry?.DontAutoSwitchWhenInstalled, false, want.name);
			assert.equal(entry?.Readonly, true, want.name);
		}
	});

	it("only keypad-only bundles host guests, and only the Virtual Stream Deck is one", () => {
		for (const profile of DETAIL_PROFILES) {
			if (profile.guestDeviceTypes.length > 0) {
				assert.equal(profile.encoders, 0, `${profile.key}: a dial-bearing bundle must not host guests`);
				assert.deepEqual([...profile.guestDeviceTypes], [11], profile.key);
			}
		}
		assert.deepEqual(
			DETAIL_PROFILES.filter((p) => p.guestDeviceTypes.length > 0).map((p) => p.key),
			["mini", "standard", "neo", "xl"]
		);
	});

	it("every entry's file exists with exact casing; no unregistered profile ships", () => {
		for (const profile of DETAIL_PROFILES) {
			assert.equal(existsExact(`${profile.name}.streamDeckProfile`), true, profile.name);
		}
		const shipped = fs.readdirSync(path.join(pluginDir, "profiles")).filter((f) => f.endsWith(".streamDeckProfile"));
		assert.deepEqual(shipped.sort(), DETAIL_PROFILES.map((p) => `${path.basename(p.name)}.streamDeckProfile`).sort());
	});

	it("the hidden slot action is declared hidden and title-locked", () => {
		const slot = manifest.Actions.find((a) => a.UUID === DETAIL_SLOT_UUID);
		assert.notEqual(slot, undefined);
		assert.equal(slot?.VisibleInActionsList, false);
		assert.equal(slot?.UserTitleEnabled, false);
		assert.deepEqual(slot?.Controllers, ["Keypad"]);
	});
});

describe("archives", () => {
	it("committed artifacts are byte-identical to a fresh deterministic build", () => {
		for (const profile of DETAIL_PROFILES) {
			const built = buildDetailProfileArchive(profile);
			const again = buildDetailProfileArchive(profile);
			assert.equal(built.equals(again), true, `${profile.key}: generator not deterministic`);
			const committed = fs.readFileSync(path.join(pluginDir, `${profile.name}.streamDeckProfile`));
			assert.equal(committed.equals(built), true, `${profile.key}: committed file drifted from the registry (run npm run profiles:detail)`);
		}
	});

	it("each archive holds exactly the v3 trio, in order, GUIDs uppercased in paths", () => {
		for (const profile of DETAIL_PROFILES) {
			const files = unzipStore(buildDetailProfileArchive(profile));
			const names = [...files.keys()];
			assert.equal(names.length, 3, profile.key);
			assert.equal(names[0], "package.json");
			assert.match(names[1] as string, /^Profiles\/[0-9A-F-]{36}\.sdProfile\/manifest\.json$/);
			assert.match(names[2] as string, /^Profiles\/[0-9A-F-]{36}\.sdProfile\/Profiles\/[0-9A-F-]{36}\/manifest\.json$/);
		}
	});

	it("package metadata targets this plugin and the class's device model", () => {
		for (const profile of DETAIL_PROFILES) {
			const files = unzipStore(buildDetailProfileArchive(profile));
			const pkg = JSON.parse((files.get("package.json") as Buffer).toString("utf8")) as Record<string, unknown>;
			assert.equal(pkg.DeviceModel, profile.deviceModel, profile.key);
			assert.equal(pkg.FormatVersion, 1);
			assert.equal(pkg.OSType, "Windows");
			assert.deepEqual(pkg.RequiredPlugins, [PLUGIN_UUID]);
		}
	});

	it("the umbrella lists its one page as both Default and a Pages member", () => {
		for (const profile of DETAIL_PROFILES) {
			const files = unzipStore(buildDetailProfileArchive(profile));
			const manifestName = [...files.keys()][1] as string;
			const umbrella = JSON.parse((files.get(manifestName) as Buffer).toString("utf8")) as { Device: { Model: string; UUID: string }; Name: string; Pages: { Current: string; Default: string; Pages: string[] }; Version: string };
			assert.equal(umbrella.Version, "3.0");
			assert.equal(umbrella.Name, DETAIL_PROFILE_DISPLAY_NAME);
			assert.equal(umbrella.Device.Model, profile.deviceModel);
			// One physical page, and the default is IN the list (an empty list
			// makes the app call the import corrupted).
			assert.equal(umbrella.Pages.Pages.length, 1);
			assert.equal(umbrella.Pages.Default, umbrella.Pages.Pages[0]);
			assert.match(umbrella.Pages.Default, /^[0-9a-f-]{36}$/);
		}
	});

	it("every cell is the hidden slot action with a strictly parsable binding", () => {
		for (const profile of DETAIL_PROFILES) {
			const files = unzipStore(buildDetailProfileArchive(profile));
			const pageName = [...files.keys()][2] as string;
			const page = JSON.parse((files.get(pageName) as Buffer).toString("utf8")) as { Controllers: Array<{ Actions: Record<string, { UUID: string; Settings: unknown }> | null; Type: string }>; Icon: string; Name: string };
			const keypad = page.Controllers.find((c) => c.Type === "Keypad");
			assert.notEqual(keypad, undefined, profile.key);
			const actions = keypad?.Actions ?? {};
			assert.equal(Object.keys(actions).length, profile.layout.columns * profile.layout.rows, profile.key);
			const roles: string[] = [];
			const indices: number[] = [];
			for (const [coord, entry] of Object.entries(actions)) {
				assert.match(coord, /^\d+,\d+$/);
				assert.equal(entry.UUID, DETAIL_SLOT_UUID, `${profile.key} ${coord}`);
				const binding = parseSlotBinding(entry.Settings);
				assert.notEqual(binding, null, `${profile.key} ${coord}: unparsable baked settings`);
				if (binding !== null && binding.slot === "reading") {
					indices.push(binding.index);
				} else if (binding !== null) {
					roles.push(binding.slot);
				}
			}
			const expectedRoles = profile.key === "mini" ? ["back", "next", "previous"] : ["back", "next", "previous", "title"];
			assert.deepEqual(roles.sort(), expectedRoles, profile.key);
			assert.deepEqual(
				indices.sort((a, b) => a - b),
				Array.from({ length: readingSlotCapacity(profile) }, (_, i) => i),
				profile.key
			);
			// Encoder-bearing classes carry an explicitly empty dial bank.
			const encoder = page.Controllers.find((c) => c.Type === "Encoder");
			assert.equal(encoder !== undefined, profile.encoders > 0, profile.key);
			if (encoder !== undefined) {
				assert.equal(encoder.Actions, null, profile.key);
			}
		}
	});

	it("no archive carries sensor identities, machine paths or device ids", () => {
		for (const profile of DETAIL_PROFILES) {
			for (const [name, data] of unzipStore(buildDetailProfileArchive(profile))) {
				const text = data.toString("utf8");
				assert.doesNotMatch(text, /[0-9a-f]{4,}:\d+:\d+/i, `${profile.key} ${name}: reading-key-shaped string`);
				assert.doesNotMatch(text, /[A-Z]:\\|Users[\\/]/, `${profile.key} ${name}: machine path`);
				assert.doesNotMatch(text, /@\(\d+\)\[/, `${profile.key} ${name}: physical device id`);
			}
		}
	});
});
