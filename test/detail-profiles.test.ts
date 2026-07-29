// The bundled detail profiles: registry integrity, manifest agreement,
// archive structure, strict baked bindings, byte-for-byte determinism,
// and the absence of anything personal in the shipped artifacts — for
// BOTH structural revisions. Revision 1 (hidden Back slot) is frozen for
// already installed copies and pinned here by content hash; revision 2
// (configurable Sensor Reading Back) is the identity the runtime
// switches to. The generator is imported directly so a drifted committed
// file (or a hand-edited manifest entry) fails here, in CI, not on a
// user's deck.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { buildDetailProfileArchive, DETAIL_PROFILE_DISPLAY_NAMES, DETAIL_SLOT_UUID, PLUGIN_UUID, SENSOR_READING_UUID, unzipStore, type DetailProfileRevision } from "../scripts/lib/detail-profile-archive";
import { detailRoleOf } from "../src/detail/detail-settings";
import { DETAIL_PROFILE_REVISION, DETAIL_PROFILES, detailProfileFor, detailProfileNameFor, readingSlotCapacity } from "../src/detail/managed-profiles";
import { parseSlotBinding } from "../src/detail/slot-bindings";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin");
const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, "manifest.json"), "utf8")) as {
	Actions: Array<{ UUID: string; VisibleInActionsList?: boolean; UserTitleEnabled?: boolean; Controllers?: string[] }>;
	Profiles?: Array<{ Name: string; DeviceType: number; AutoInstall?: boolean; DontAutoSwitchWhenInstalled?: boolean; Readonly?: boolean }>;
};

const REVISIONS: readonly DetailProfileRevision[] = [1, 2];

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

/**
 * Revision 1 shipped in pre-1.5-issue5-1 and installed copies exist in
 * the wild: its bytes may NEVER move again. These hashes were taken from
 * the published pre-release asset (identical to the committed files at
 * that tag); any registry or generator change that would alter them
 * fails here before it can ship.
 */
const REVISION1_SHA256: Record<string, string> = {
	mini: "24d4b482693cf4474c08712577a909213f8754a0dc0202ad838173ba5975fb54",
	standard: "f329739c8c1b36da5476a4419e03117e5e4b789bfe9d098e6ff32d9d47b0c9ae",
	neo: "7f71e4421f046e8f046d698b71bbe59e7fab728507689f9604a2077078a7b2ea",
	plus: "1f2714b35bceeb4275e98e2a127b4ae587d2c57c5224e90aba69bea3dd4addf8",
	xl: "de219e2c80eac3aba177c92a3bee2330c5bb323e9d86cdb41a92121a59e9f994",
	"plus-xl": "2dc8d5ee845e5d2a07084364edda69f41910bd7cf93c7c1a66d0efe21e6a1e46"
};

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

	it("the active revision is 2 and every runtime name carries it", () => {
		assert.equal(DETAIL_PROFILE_REVISION, 2);
		for (const profile of DETAIL_PROFILES) {
			assert.equal(profile.name, `profiles/detail-r2-${profile.key}`, profile.key);
			assert.equal(profile.name, detailProfileNameFor(profile.key, DETAIL_PROFILE_REVISION), profile.key);
			assert.equal(detailProfileNameFor(profile.key, 1), `profiles/detail-${profile.key}`, profile.key);
		}
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

	it("resolves supported device types to revision-2 names and refuses the rest", () => {
		assert.equal(detailProfileFor(0)?.name, "profiles/detail-r2-standard");
		assert.equal(detailProfileFor(13)?.name, "profiles/detail-r2-plus-xl");
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
	it("registers both revisions for each owner and its guests, nothing else, with the intended flags", () => {
		const entries = manifest.Profiles ?? [];
		const expected: Array<{ name: string; deviceType: number; readonly: boolean }> = [];
		for (const revision of REVISIONS) {
			for (const profile of DETAIL_PROFILES) {
				const name = detailProfileNameFor(profile.key, revision);
				// Revision 1 keeps its shipped Readonly:true registration for
				// installed copies; revision 2 is editable so the Back tile
				// (and the rest of the page) can be configured by the user.
				expected.push({ name, deviceType: profile.deviceType, readonly: revision === 1 });
				for (const guest of profile.guestDeviceTypes) {
					expected.push({ name, deviceType: guest, readonly: revision === 1 });
				}
			}
		}
		assert.equal(entries.length, expected.length);
		for (const want of expected) {
			const entry = entries.find((e) => e.Name === want.name && e.DeviceType === want.deviceType);
			assert.notEqual(entry, undefined, `${want.name} for DeviceType ${want.deviceType}`);
			// Install on first use only; the first accepted prompt continues
			// into the view.
			assert.equal(entry?.AutoInstall, false, want.name);
			assert.equal(entry?.DontAutoSwitchWhenInstalled, false, want.name);
			assert.equal(entry?.Readonly, want.readonly, `${want.name} DeviceType ${want.deviceType}`);
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
		for (const revision of REVISIONS) {
			for (const profile of DETAIL_PROFILES) {
				assert.equal(existsExact(`${detailProfileNameFor(profile.key, revision)}.streamDeckProfile`), true, `${profile.key} r${revision}`);
			}
		}
		const shipped = fs.readdirSync(path.join(pluginDir, "profiles")).filter((f) => f.endsWith(".streamDeckProfile"));
		const expected = REVISIONS.flatMap((revision) => DETAIL_PROFILES.map((p) => `${path.basename(detailProfileNameFor(p.key, revision))}.streamDeckProfile`));
		assert.deepEqual(shipped.sort(), expected.sort());
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
	it("committed artifacts are byte-identical to a fresh deterministic build, both revisions", () => {
		for (const revision of REVISIONS) {
			for (const profile of DETAIL_PROFILES) {
				const built = buildDetailProfileArchive(profile, revision);
				const again = buildDetailProfileArchive(profile, revision);
				assert.equal(built.equals(again), true, `${profile.key} r${revision}: generator not deterministic`);
				const committed = fs.readFileSync(path.join(pluginDir, `${detailProfileNameFor(profile.key, revision)}.streamDeckProfile`));
				assert.equal(committed.equals(built), true, `${profile.key} r${revision}: committed file drifted from the registry (run npm run profiles:detail)`);
			}
		}
	});

	it("revision-1 bytes are frozen at their shipped pre-1.5-issue5-1 hashes", () => {
		for (const profile of DETAIL_PROFILES) {
			const committed = fs.readFileSync(path.join(pluginDir, `${detailProfileNameFor(profile.key, 1)}.streamDeckProfile`));
			assert.equal(createHash("sha256").update(committed).digest("hex"), REVISION1_SHA256[profile.key], `${profile.key}: installed revision-1 copies exist; these bytes may never change`);
		}
	});

	it("each archive holds exactly the v3 trio, in order, GUIDs uppercased in paths", () => {
		for (const revision of REVISIONS) {
			for (const profile of DETAIL_PROFILES) {
				const files = unzipStore(buildDetailProfileArchive(profile, revision));
				const names = [...files.keys()];
				assert.equal(names.length, 3, `${profile.key} r${revision}`);
				assert.equal(names[0], "package.json");
				assert.match(names[1] as string, /^Profiles\/[0-9A-F-]{36}\.sdProfile\/manifest\.json$/);
				assert.match(names[2] as string, /^Profiles\/[0-9A-F-]{36}\.sdProfile\/Profiles\/[0-9A-F-]{36}\/manifest\.json$/);
			}
		}
	});

	it("package metadata targets this plugin and the class's device model", () => {
		for (const revision of REVISIONS) {
			for (const profile of DETAIL_PROFILES) {
				const files = unzipStore(buildDetailProfileArchive(profile, revision));
				const pkg = JSON.parse((files.get("package.json") as Buffer).toString("utf8")) as Record<string, unknown>;
				assert.equal(pkg.DeviceModel, profile.deviceModel, profile.key);
				assert.equal(pkg.FormatVersion, 1);
				assert.equal(pkg.OSType, "Windows");
				assert.deepEqual(pkg.RequiredPlugins, [PLUGIN_UUID]);
			}
		}
	});

	it("the umbrella lists its one page as both Default and a Pages member, named per revision", () => {
		for (const revision of REVISIONS) {
			for (const profile of DETAIL_PROFILES) {
				const files = unzipStore(buildDetailProfileArchive(profile, revision));
				const manifestName = [...files.keys()][1] as string;
				const umbrella = JSON.parse((files.get(manifestName) as Buffer).toString("utf8")) as { Device: { Model: string; UUID: string }; Name: string; Pages: { Current: string; Default: string; Pages: string[] }; Version: string };
				assert.equal(umbrella.Version, "3.0");
				assert.equal(umbrella.Name, DETAIL_PROFILE_DISPLAY_NAMES[revision], `${profile.key} r${revision}`);
				assert.equal(umbrella.Device.Model, profile.deviceModel);
				// One physical page, and the default is IN the list (an empty list
				// makes the app call the import corrupted).
				assert.equal(umbrella.Pages.Pages.length, 1);
				assert.equal(umbrella.Pages.Default, umbrella.Pages.Pages[0]);
				assert.match(umbrella.Pages.Default, /^[0-9a-f-]{36}$/);
			}
		}
	});

	it("the two revisions differ at every identity layer and share no GUID", () => {
		assert.notEqual(DETAIL_PROFILE_DISPLAY_NAMES[1], DETAIL_PROFILE_DISPLAY_NAMES[2]);
		for (const profile of DETAIL_PROFILES) {
			assert.notEqual(detailProfileNameFor(profile.key, 1), detailProfileNameFor(profile.key, 2), profile.key);
			const guidsOf = (revision: DetailProfileRevision): Set<string> => {
				const guids = new Set<string>();
				for (const [, data] of unzipStore(buildDetailProfileArchive(profile, revision))) {
					const doc = JSON.parse(data.toString("utf8")) as { Device?: { UUID: string }; Pages?: { Default: string }; Controllers?: Array<{ Actions: Record<string, { ActionID: string }> | null }> };
					if (doc.Device !== undefined) {
						guids.add(doc.Device.UUID);
						guids.add((doc.Pages as { Default: string }).Default);
					}
					for (const controller of doc.Controllers ?? []) {
						for (const action of Object.values(controller.Actions ?? {})) {
							guids.add(action.ActionID);
						}
					}
				}
				return guids;
			};
			const r1 = guidsOf(1);
			const r2 = guidsOf(2);
			assert.ok(r1.size > 0 && r2.size > 0, profile.key);
			for (const guid of r2) {
				assert.equal(r1.has(guid), false, `${profile.key}: GUID ${guid} collides across revisions`);
			}
		}
	});

	it("revision-1 cells are all the hidden slot action with strictly parsable bindings", () => {
		for (const profile of DETAIL_PROFILES) {
			const files = unzipStore(buildDetailProfileArchive(profile, 1));
			const pageName = [...files.keys()][2] as string;
			const page = JSON.parse((files.get(pageName) as Buffer).toString("utf8")) as { Controllers: Array<{ Actions: Record<string, { UUID: string; Settings: unknown }> | null; Type: string }>; Icon: string; Name: string };
			const keypad = page.Controllers.find((c) => c.Type === "Keypad");
			assert.notEqual(keypad, undefined, profile.key);
			const actions = keypad?.Actions ?? {};
			assert.equal(Object.keys(actions).length, profile.layout.columns * profile.layout.rows, profile.key);
			for (const [coord, entry] of Object.entries(actions)) {
				assert.equal(entry.UUID, DETAIL_SLOT_UUID, `${profile.key} ${coord}`);
				assert.notEqual(parseSlotBinding(entry.Settings), null, `${profile.key} ${coord}: unparsable baked settings`);
			}
		}
	});

	it("revision-2 pages bake exactly one Sensor Reading (the 0,0 Back, marker only) among hidden slots", () => {
		for (const profile of DETAIL_PROFILES) {
			const files = unzipStore(buildDetailProfileArchive(profile, 2));
			const pageName = [...files.keys()][2] as string;
			const page = JSON.parse((files.get(pageName) as Buffer).toString("utf8")) as { Controllers: Array<{ Actions: Record<string, { UUID: string; Name: string; Settings: unknown }> | null; Type: string }>; Icon: string; Name: string };
			const keypad = page.Controllers.find((c) => c.Type === "Keypad");
			assert.notEqual(keypad, undefined, profile.key);
			const actions = keypad?.Actions ?? {};
			assert.equal(Object.keys(actions).length, profile.layout.columns * profile.layout.rows, profile.key);
			const readings = Object.entries(actions).filter(([, entry]) => entry.UUID === SENSOR_READING_UUID);
			assert.equal(readings.length, 1, `${profile.key}: exactly one Sensor Reading cell`);
			const [coord, back] = readings[0] as [string, { UUID: string; Name: string; Settings: unknown }];
			assert.equal(coord, "0,0", profile.key);
			assert.equal(back.Name, "Sensor Reading", profile.key);
			// Exactly the internal role marker: no reading keys, no layout, no
			// labels, no device or user data baked into the shipped page.
			assert.deepEqual(back.Settings, { detailRole: "back" }, profile.key);
			assert.equal(detailRoleOf(back.Settings as { detailRole?: unknown }), "back", profile.key);
			const roles: string[] = [];
			const indices: number[] = [];
			for (const [c, entry] of Object.entries(actions)) {
				assert.match(c, /^\d+,\d+$/);
				if (entry.UUID === SENSOR_READING_UUID) {
					continue;
				}
				assert.equal(entry.UUID, DETAIL_SLOT_UUID, `${profile.key} ${c}`);
				const binding = parseSlotBinding(entry.Settings);
				assert.notEqual(binding, null, `${profile.key} ${c}: unparsable baked settings`);
				if (binding !== null && binding.slot === "reading") {
					indices.push(binding.index);
				} else if (binding !== null) {
					roles.push(binding.slot);
				}
			}
			// The Back role moved onto the reading action; the remaining hidden
			// roles are exactly the pagers (and the title where the grid has room).
			const expectedRoles = profile.key === "mini" ? ["next", "previous"] : ["next", "previous", "title"];
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
		for (const revision of REVISIONS) {
			for (const profile of DETAIL_PROFILES) {
				for (const [name, data] of unzipStore(buildDetailProfileArchive(profile, revision))) {
					const text = data.toString("utf8");
					assert.doesNotMatch(text, /[0-9a-f]{4,}:\d+:\d+/i, `${profile.key} r${revision} ${name}: reading-key-shaped string`);
					assert.doesNotMatch(text, /[A-Z]:\\|Users[\\/]/, `${profile.key} r${revision} ${name}: machine path`);
					assert.doesNotMatch(text, /@\(\d+\)\[/, `${profile.key} r${revision} ${name}: physical device id`);
				}
			}
		}
	});
});
