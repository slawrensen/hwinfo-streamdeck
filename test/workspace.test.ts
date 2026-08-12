// The bundled workspace profiles (issue #5 follow-up, spike): registry
// derivation from the detail table, resolution delegation, the
// append-only settings additions (open-workspace, workspacePage) with a
// no-drift proof against the frozen legacy parser, four-page archive
// structure and byte determinism, manifest agreement plus the
// detail/workspace PARTITION of the Profiles list and the profiles
// directory, the navigator's workspace entry (always-explicit page,
// refusals, debounces, stateless Back), and the settings panel's
// agreement with the registry.
//
// NOTE ON FREEZING: the workspace family has no revision scheme, so once
// a bundle SHIPS its bytes must be pinned here by content hash exactly
// like the detail revisions are in detail-profiles.test.ts. The spike
// deliberately stops at determinism + committed-file agreement; add the
// hash pins at first ship.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { buildDetailProfileArchive, SENSOR_READING_UUID, unzipStore, type DetailProfileRevision } from "../scripts/lib/detail-profile-archive";
import { buildWorkspaceProfileArchive, WORKSPACE_PROFILE_DISPLAY_NAME } from "../scripts/lib/workspace-profile-archive";
import { detailDensityOf, detailModeOf, detailRoleOf, isWorkspaceBack, pressBehaviorOf, WORKSPACE_PAGE_COUNT, workspacePageOf } from "../src/detail/detail-settings";
import { DETAIL_PROFILES, detailProfileFor } from "../src/detail/managed-profiles";
import { DetailNavigator } from "../src/detail/navigation";
import { WORKSPACE_PROFILES, workspaceProfileFor, workspaceProfileName } from "../src/detail/workspace-profiles";
import { SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = path.join(repoRoot, "com.lawrensen.hwinfo.sdPlugin");
const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, "manifest.json"), "utf8")) as {
	Profiles?: Array<{ Name: string; DeviceType: number; AutoInstall?: boolean; DontAutoSwitchWhenInstalled?: boolean; Readonly?: boolean }>;
};

describe("workspace registry", () => {
	it("derives one workspace per detail bundle: same keys, devices, models, guests", () => {
		assert.equal(WORKSPACE_PROFILES.length, DETAIL_PROFILES.length);
		for (const detail of DETAIL_PROFILES) {
			const ws = WORKSPACE_PROFILES.find((p) => p.key === detail.key);
			assert.notEqual(ws, undefined, detail.key);
			assert.equal(ws?.name, `profiles/workspace-${detail.key}`, detail.key);
			assert.equal(ws?.name, workspaceProfileName(detail.key), detail.key);
			assert.equal(ws?.deviceType, detail.deviceType, detail.key);
			assert.equal(ws?.deviceModel, detail.deviceModel, detail.key);
			assert.equal(ws?.modelVerified, detail.modelVerified, detail.key);
			assert.equal(ws?.encoders, detail.encoders, detail.key);
			assert.deepEqual(ws?.guestDeviceTypes, detail.guestDeviceTypes, detail.key);
			assert.equal(ws?.columns, detail.layout.columns, detail.key);
			assert.equal(ws?.rows, detail.layout.rows, detail.key);
			// The baked Back sits exactly where the detail profile puts its
			// own (top-left on every shipped class).
			assert.deepEqual(ws?.backCell, detail.layout.nav.back, detail.key);
		}
	});

	it("ships four pages per bundle, a fixed frozen count", () => {
		assert.equal(WORKSPACE_PAGE_COUNT, 4);
	});

	it("resolution delegates to the detail table: identical support matrix", () => {
		const cases: Array<{ type: number | undefined; grid?: { columns: number; rows: number } }> = [
			{ type: 0 },
			{ type: 1 },
			{ type: 2 },
			{ type: 7 },
			{ type: 9 },
			{ type: 13 },
			{ type: 11, grid: { columns: 10, rows: 10 } },
			{ type: 11, grid: { columns: 9, rows: 4 } },
			{ type: 11, grid: { columns: 8, rows: 4 } },
			{ type: 11, grid: { columns: 5, rows: 3 } },
			{ type: 11, grid: { columns: 4, rows: 2 } },
			{ type: 11, grid: { columns: 3, rows: 2 } },
			{ type: 11, grid: { columns: 2, rows: 2 } },
			{ type: 11 },
			{ type: 3 },
			{ type: 5 },
			{ type: 10 },
			{ type: 12 },
			{ type: 99 },
			{ type: undefined }
		];
		for (const c of cases) {
			const detail = detailProfileFor(c.type, c.grid);
			const ws = workspaceProfileFor(c.type, c.grid);
			assert.equal(ws?.key, detail?.key, `type ${c.type ?? "undefined"} grid ${JSON.stringify(c.grid)}`);
		}
		assert.equal(workspaceProfileFor(0)?.name, "profiles/workspace-standard");
		assert.equal(workspaceProfileFor(13)?.name, "profiles/workspace-plus-xl");
	});
});

describe("workspace settings", () => {
	it("the exact open-workspace marker parses; everything else is UNCHANGED from the legacy parser", () => {
		// The pre-workspace parser, frozen verbatim: the one deliberate
		// append is the exact "open-workspace" marker, and every other
		// input (junk, case variants, whitespace, future values) must parse
		// exactly as it did before this spike.
		const legacyPressBehaviorOf = (settings: { pressBehavior?: unknown }): string => {
			const raw = settings.pressBehavior;
			return raw === "open-details" || raw === "tap-cycle-hold-details" ? raw : "cycle-stat";
		};
		const values: unknown[] = [
			undefined,
			"",
			"cycle-stat",
			"open-details",
			"tap-cycle-hold-details",
			"workspace",
			"Open-Workspace",
			"OPEN-WORKSPACE",
			" open-workspace",
			"open-workspace ",
			"open-workspace\n",
			42,
			null,
			true,
			{},
			[],
			["open-workspace"],
			"future-mode"
		];
		for (const value of values) {
			const settings = { pressBehavior: value } as { pressBehavior?: unknown };
			assert.equal(pressBehaviorOf(settings), legacyPressBehaviorOf(settings), JSON.stringify(value));
			assert.equal(settings.pressBehavior, value, "parser mutated its input");
		}
		assert.equal(pressBehaviorOf({}), "cycle-stat");
		assert.equal(pressBehaviorOf({ pressBehavior: "open-workspace" }), "open-workspace");
		assert.equal(legacyPressBehaviorOf({ pressBehavior: "open-workspace" }), "cycle-stat");
	});

	it("a workspacePage field never perturbs the other parsers (append-only)", () => {
		const carrier = { workspacePage: "3", pressBehavior: undefined, detailMode: undefined, detailDensity: undefined } as { workspacePage?: unknown; pressBehavior?: unknown; detailMode?: unknown; detailDensity?: unknown };
		assert.equal(pressBehaviorOf(carrier), "cycle-stat");
		assert.equal(detailModeOf(carrier), "source");
		assert.equal(detailDensityOf(carrier), 1);
		assert.equal(detailRoleOf(carrier as { detailRole?: unknown }), undefined);
	});

	it("workspacePage: panel strings and bare integers land in range", () => {
		assert.equal(workspacePageOf({}), 0);
		assert.equal(workspacePageOf({ workspacePage: undefined }), 0);
		for (let page = 0; page < WORKSPACE_PAGE_COUNT; page++) {
			assert.equal(workspacePageOf({ workspacePage: page }), page);
			assert.equal(workspacePageOf({ workspacePage: String(page) }), page);
		}
		// "01" round-trips to the integer 1: integer-string salvage, not
		// exact-marker matching (the clamp policy wants nearest-page).
		assert.equal(workspacePageOf({ workspacePage: "01" }), 1);
	});

	it("workspacePage: well-formed integers outside the range CLAMP to the nearest page", () => {
		assert.equal(workspacePageOf({ workspacePage: WORKSPACE_PAGE_COUNT }), WORKSPACE_PAGE_COUNT - 1);
		assert.equal(workspacePageOf({ workspacePage: String(WORKSPACE_PAGE_COUNT) }), WORKSPACE_PAGE_COUNT - 1);
		assert.equal(workspacePageOf({ workspacePage: 99 }), WORKSPACE_PAGE_COUNT - 1);
		assert.equal(workspacePageOf({ workspacePage: "999" }), WORKSPACE_PAGE_COUNT - 1);
		assert.equal(workspacePageOf({ workspacePage: -1 }), 0);
		assert.equal(workspacePageOf({ workspacePage: "-5" }), 0);
	});

	it("workspacePage: everything malformed degrades to page 0 and is never rewritten", () => {
		const junk: unknown[] = [1.5, "1.5", "2.0", " 1", "1 ", "+1", "", "one", "page-2", null, true, false, {}, [], [1], NaN, Infinity, -Infinity, 1e21, "9".repeat(400)];
		for (const value of junk) {
			const settings = { workspacePage: value } as { workspacePage?: unknown };
			assert.equal(workspacePageOf(settings), 0, JSON.stringify(value) ?? String(value));
			assert.equal(Object.is(settings.workspacePage, value), true, "parser mutated its input");
		}
	});
});

describe("workspace archives", () => {
	it("committed artifacts are byte-identical to a fresh deterministic build", () => {
		for (const profile of WORKSPACE_PROFILES) {
			const built = buildWorkspaceProfileArchive(profile);
			const again = buildWorkspaceProfileArchive(profile);
			assert.equal(built.equals(again), true, `${profile.key}: generator not deterministic`);
			const committed = fs.readFileSync(path.join(pluginDir, `${profile.name}.streamDeckProfile`));
			assert.equal(committed.equals(built), true, `${profile.key}: committed file drifted from the registry (run npm run profiles:detail)`);
		}
	});

	it("each archive holds package.json, the umbrella, and one folder per page in umbrella order", () => {
		for (const profile of WORKSPACE_PROFILES) {
			const files = unzipStore(buildWorkspaceProfileArchive(profile));
			const names = [...files.keys()];
			assert.equal(names.length, 2 + WORKSPACE_PAGE_COUNT, profile.key);
			assert.equal(names[0], "package.json");
			assert.match(names[1] as string, /^Profiles\/[0-9A-F-]{36}\.sdProfile\/manifest\.json$/);
			const umbrella = JSON.parse((files.get(names[1] as string) as Buffer).toString("utf8")) as { Device: { Model: string; UUID: string }; Name: string; Pages: { Current: string; Default: string; Pages: string[] }; Version: string };
			assert.equal(umbrella.Version, "3.0");
			assert.equal(umbrella.Name, WORKSPACE_PROFILE_DISPLAY_NAME, profile.key);
			assert.equal(umbrella.Device.Model, profile.deviceModel, profile.key);
			// Every page including the default must be listed (an empty list
			// makes the app reject the import as corrupted), the default is
			// the FIRST page, and the page folders follow that exact order.
			assert.equal(umbrella.Pages.Current, "00000000-0000-0000-0000-000000000000");
			assert.equal(umbrella.Pages.Pages.length, WORKSPACE_PAGE_COUNT, profile.key);
			assert.equal(new Set(umbrella.Pages.Pages).size, WORKSPACE_PAGE_COUNT, profile.key);
			assert.equal(umbrella.Pages.Default, umbrella.Pages.Pages[0], profile.key);
			umbrella.Pages.Pages.forEach((page, index) => {
				assert.match(page, /^[0-9a-f-]{36}$/);
				assert.equal(names[2 + index], `Profiles/${umbrella.Device.UUID.toUpperCase()}.sdProfile/Profiles/${page.toUpperCase()}/manifest.json`, `${profile.key} page ${index}`);
			});
		}
	});

	it("every page bakes exactly the canonical Back at the detail Back cell and nothing else", () => {
		for (const profile of WORKSPACE_PROFILES) {
			const files = unzipStore(buildWorkspaceProfileArchive(profile));
			const names = [...files.keys()];
			const actionIds = new Set<string>();
			for (let index = 0; index < WORKSPACE_PAGE_COUNT; index++) {
				const page = JSON.parse((files.get(names[2 + index] as string) as Buffer).toString("utf8")) as { Controllers: Array<{ Actions: Record<string, { ActionID: string; UUID: string; Name: string; Settings: unknown }> | null; Type: string }>; Icon: string; Name: string };
				assert.equal(page.Icon, "");
				assert.equal(page.Name, "");
				const keypad = page.Controllers.find((c) => c.Type === "Keypad");
				assert.notEqual(keypad, undefined, profile.key);
				const actions = keypad?.Actions ?? {};
				// ONE cell only: the workspace is the user's canvas; the plugin
				// bakes the way out and nothing more.
				assert.deepEqual(Object.keys(actions), [`${profile.backCell.column},${profile.backCell.row}`], `${profile.key} page ${index}`);
				const back = actions[`${profile.backCell.column},${profile.backCell.row}`] as { ActionID: string; UUID: string; Name: string; Settings: unknown };
				assert.equal(back.UUID, SENSOR_READING_UUID, profile.key);
				assert.equal(back.Name, "Sensor Reading", profile.key);
				// The role marker the detail Back bakes, plus the family
				// marker that tells the two apart at runtime: no sensor
				// identity, no layout, no user data.
				assert.deepEqual(back.Settings, { detailRole: "back", workspaceBack: true }, profile.key);
				assert.equal(detailRoleOf(back.Settings as { detailRole?: unknown }), "back", profile.key);
				assert.equal(isWorkspaceBack(back.Settings as { workspaceBack?: unknown }), true, profile.key);
				actionIds.add(back.ActionID);
				// Encoder-bearing classes carry an explicitly empty dial bank,
				// like the detail pages (a dial-less virtual guest borrows the
				// bundle safely).
				const encoder = page.Controllers.find((c) => c.Type === "Encoder");
				assert.equal(encoder !== undefined, profile.encoders > 0, profile.key);
				if (encoder !== undefined) {
					assert.equal(encoder.Actions, null, profile.key);
				}
			}
			assert.equal(actionIds.size, WORKSPACE_PAGE_COUNT, `${profile.key}: Back ActionIDs must differ per page`);
		}
	});

	it("shares no GUID with any detail revision of the same class", () => {
		const guidsOf = (archive: Buffer): Set<string> => {
			const guids = new Set<string>();
			for (const [, data] of unzipStore(archive)) {
				const doc = JSON.parse(data.toString("utf8")) as { Device?: { UUID: string }; Pages?: { Pages: string[] }; Controllers?: Array<{ Actions: Record<string, { ActionID: string }> | null }> };
				if (doc.Device !== undefined) {
					guids.add(doc.Device.UUID);
					for (const page of (doc.Pages as { Pages: string[] }).Pages) {
						guids.add(page);
					}
				}
				for (const controller of doc.Controllers ?? []) {
					for (const action of Object.values(controller.Actions ?? {})) {
						guids.add(action.ActionID);
					}
				}
			}
			return guids;
		};
		for (const profile of WORKSPACE_PROFILES) {
			const workspaceGuids = guidsOf(buildWorkspaceProfileArchive(profile));
			assert.ok(workspaceGuids.size >= 1 + 2 * WORKSPACE_PAGE_COUNT, profile.key);
			const detail = DETAIL_PROFILES.find((p) => p.key === profile.key);
			assert.notEqual(detail, undefined, profile.key);
			for (const revision of [1, 2, 3] as DetailProfileRevision[]) {
				const detailGuids = guidsOf(buildDetailProfileArchive(detail as (typeof DETAIL_PROFILES)[number], revision));
				for (const guid of workspaceGuids) {
					assert.equal(detailGuids.has(guid), false, `${profile.key}: GUID ${guid} collides with detail r${revision}`);
				}
			}
		}
	});

	it("no archive carries sensor identities, machine paths or device ids", () => {
		for (const profile of WORKSPACE_PROFILES) {
			for (const [name, data] of unzipStore(buildWorkspaceProfileArchive(profile))) {
				const text = data.toString("utf8");
				assert.doesNotMatch(text, /[0-9a-f]{4,}:\d+:\d+/i, `${profile.key} ${name}: reading-key-shaped string`);
				assert.doesNotMatch(text, /[A-Z]:\\|Users[\\/]/, `${profile.key} ${name}: machine path`);
				assert.doesNotMatch(text, /@\(\d+\)\[/, `${profile.key} ${name}: physical device id`);
			}
		}
	});
});

describe("manifest agreement (workspace)", () => {
	it("registers each workspace for its owner and guests with the intended flags", () => {
		const entries = (manifest.Profiles ?? []).filter((e) => e.Name.startsWith("profiles/workspace-"));
		const expected: Array<{ name: string; deviceType: number }> = [];
		for (const profile of WORKSPACE_PROFILES) {
			expected.push({ name: profile.name, deviceType: profile.deviceType });
			for (const guest of profile.guestDeviceTypes) {
				expected.push({ name: profile.name, deviceType: guest });
			}
		}
		assert.equal(entries.length, expected.length);
		for (const want of expected) {
			const entry = entries.find((e) => e.Name === want.name && e.DeviceType === want.deviceType);
			assert.notEqual(entry, undefined, `${want.name} for DeviceType ${want.deviceType}`);
			// Install on first use only, continue into the page, and stay
			// editable forever: the workspace IS the user's canvas.
			assert.equal(entry?.AutoInstall, false, want.name);
			assert.equal(entry?.DontAutoSwitchWhenInstalled, false, want.name);
			assert.equal(entry?.Readonly, false, want.name);
		}
	});

	it("detail and workspace entries PARTITION the manifest's Profiles list", () => {
		// detail-profiles.test.ts scopes itself to profiles/detail-*; this
		// closes the partition so no registration can escape both tests.
		const entries = manifest.Profiles ?? [];
		const strays = entries.filter((e) => !e.Name.startsWith("profiles/detail-") && !e.Name.startsWith("profiles/workspace-"));
		assert.deepEqual(strays, []);
	});

	it("every workspace file ships with exact registration and no stray file escapes both families", () => {
		const shipped = fs.readdirSync(path.join(pluginDir, "profiles")).filter((f) => f.endsWith(".streamDeckProfile"));
		const workspaceShipped = shipped.filter((f) => f.startsWith("workspace-"));
		const expected = WORKSPACE_PROFILES.map((p) => `${path.basename(p.name)}.streamDeckProfile`);
		assert.deepEqual(workspaceShipped.sort(), expected.sort());
		// Partition of the directory: detail-profiles.test.ts pins the
		// detail-* files; together the two families must cover everything.
		const strays = shipped.filter((f) => !f.startsWith("detail-") && !f.startsWith("workspace-"));
		assert.deepEqual(strays, []);
	});
});

// --- navigation ----------------------------------------------------------

function reading(key: string, sensorIndex: number, label = key): Reading {
	return { key, type: SensorType.Temperature, sensorIndex, id: 0, label, unit: "°C", value: 50, valueMin: 40, valueMax: 60, valueAvg: 50 };
}

function snapshotOf(readings: Reading[], sensorNames: string[]): SensorSnapshot {
	return {
		pollTime: 1,
		version: 1,
		revision: 1,
		sensors: sensorNames.map((name, index) => ({ index, id: index, instance: 0, name })),
		readings,
		byKey: new Map(readings.map((r) => [r.key, r]))
	};
}

const snapshot = snapshotOf(
	[reading("cpu:0:0", 0, "CPU Temp"), reading("cpu:0:1", 0, "CPU Load"), reading("gpu:0:1", 1)],
	["CPU [#0]", "GPU"]
);
const opener = { readingKey: "cpu:0:0" };

type Switch = { deviceId: string; profileName?: string; page?: number };

function bed(overrides?: { failSwitch?: boolean; deferSwitch?: boolean }): {
	nav: DetailNavigator;
	switches: Switch[];
	advance: (ms: number) => void;
	settleSwitch: (fail?: boolean) => void;
} {
	const switches: Switch[] = [];
	let clock = 1_000_000;
	let pendingSettle: { resolve: () => void; reject: (err: Error) => void } | null = null;
	const nav = new DetailNavigator({
		switchProfile: (deviceId, profileName, page) => {
			switches.push({ deviceId, profileName, page });
			if (overrides?.deferSwitch === true) {
				return new Promise<void>((resolve, reject) => {
					pendingSettle = { resolve, reject };
				});
			}
			return overrides?.failSwitch === true ? Promise.reject(new Error("app said no")) : Promise.resolve();
		},
		setTimer: () => 0 as unknown as ReturnType<typeof setTimeout>,
		clearTimer: () => undefined,
		now: () => clock
	});
	return {
		nav,
		switches,
		advance: (ms: number): void => {
			clock += ms;
		},
		settleSwitch: (fail = false): void => {
			if (pendingSettle !== null) {
				const settle = pendingSettle;
				pendingSettle = null;
				if (fail) {
					settle.reject(new Error("late no"));
				} else {
					settle.resolve();
				}
			}
		}
	};
}

describe("workspace navigation", () => {
	it("switches a supported device to its workspace with an ALWAYS-EXPLICIT page index", async () => {
		const { nav, switches, advance } = bed();
		assert.equal(await nav.enterWorkspace({ deviceId: "dev1", deviceType: 0, page: 0 }), "entered");
		// Page 0 is still passed explicitly: an omitted page would restore
		// whatever page was last visible, not the configured one.
		assert.deepEqual(switches, [{ deviceId: "dev1", profileName: "profiles/workspace-standard", page: 0 }]);
		advance(2_000);
		assert.equal(await nav.enterWorkspace({ deviceId: "dev1", deviceType: 0, page: WORKSPACE_PAGE_COUNT - 1 }), "entered");
		assert.deepEqual(switches[1], { deviceId: "dev1", profileName: "profiles/workspace-standard", page: WORKSPACE_PAGE_COUNT - 1 });
	});

	it("holds no session state: entry leaves the detail map untouched", async () => {
		const { nav } = bed();
		await nav.enterWorkspace({ deviceId: "dev1", deviceType: 0, page: 1 });
		assert.equal(nav.stateFor("dev1"), undefined);
		assert.deepEqual(nav.activeDeviceIds(), []);
	});

	it("clamps out-of-range and junk page indices before dispatch", async () => {
		const { nav, switches, advance } = bed();
		await nav.enterWorkspace({ deviceId: "dev1", deviceType: 0, page: 99 });
		assert.equal(switches[0]?.page, WORKSPACE_PAGE_COUNT - 1);
		advance(2_000);
		await nav.enterWorkspace({ deviceId: "dev1", deviceType: 0, page: -3 });
		assert.equal(switches[1]?.page, 0);
		advance(2_000);
		await nav.enterWorkspace({ deviceId: "dev1", deviceType: 0, page: Number.NaN });
		assert.equal(switches[2]?.page, 0);
		advance(2_000);
		await nav.enterWorkspace({ deviceId: "dev1", deviceType: 0, page: 2.5 });
		assert.equal(switches[3]?.page, 0);
	});

	it("detail entry is untouched: it still omits the page index entirely", async () => {
		const { nav, switches } = bed();
		assert.equal(await nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot }), "entered");
		assert.equal(switches.length, 1);
		assert.equal(switches[0]?.profileName, "profiles/detail-r3-standard");
		assert.equal(switches[0]?.page, undefined);
	});

	it("refuses unsupported devices honestly, without switching", async () => {
		const { nav, switches } = bed();
		assert.equal(await nav.enterWorkspace({ deviceId: "ped", deviceType: 5, page: 0 }), "unsupported");
		assert.equal(await nav.enterWorkspace({ deviceId: "unk", deviceType: undefined, page: 0 }), "unsupported");
		assert.equal(await nav.enterWorkspace({ deviceId: "vsd", deviceType: 11, grid: { columns: 2, rows: 2 }, page: 0 }), "unsupported");
		assert.equal(await nav.enterWorkspace({ deviceId: "vsd2", deviceType: 11, page: 0 }), "unsupported");
		assert.equal(switches.length, 0);
	});

	it("a Virtual Stream Deck enters the workspace its grid fits, like detail", async () => {
		const { nav, switches } = bed();
		assert.equal(await nav.enterWorkspace({ deviceId: "vsd", deviceType: 11, grid: { columns: 10, rows: 10 }, page: 2 }), "entered");
		assert.deepEqual(switches, [{ deviceId: "vsd", profileName: "profiles/workspace-plus-xl", page: 2 }]);
	});

	it("a double-tapped opener inside the switch beat is one dispatch, retryable after it", async () => {
		const { nav, switches, advance } = bed();
		assert.equal(await nav.enterWorkspace({ deviceId: "dev1", deviceType: 0, page: 0 }), "entered");
		assert.equal(await nav.enterWorkspace({ deviceId: "dev1", deviceType: 0, page: 0 }), "already-active");
		assert.equal(switches.length, 1);
		advance(1_600);
		assert.equal(await nav.enterWorkspace({ deviceId: "dev1", deviceType: 0, page: 0 }), "entered");
		assert.equal(switches.length, 2);
	});

	it("a switch still in flight past the beat refuses a second dispatch", async () => {
		const { nav, switches, advance, settleSwitch } = bed({ deferSwitch: true });
		const first = nav.enterWorkspace({ deviceId: "dev1", deviceType: 0, page: 0 });
		advance(1_600); // past the debounce; only the in-flight guard is left
		assert.equal(await nav.enterWorkspace({ deviceId: "dev1", deviceType: 0, page: 1 }), "already-active");
		assert.equal(switches.length, 1);
		settleSwitch(false);
		assert.equal(await first, "entered");
	});

	it("a failed switch reports honestly and does not hold the debounce against a retry", async () => {
		const { nav, switches } = bed({ failSwitch: true });
		assert.equal(await nav.enterWorkspace({ deviceId: "dev1", deviceType: 0, page: 0 }), "switch-failed");
		// Same tick, no advance: the failed dispatch cleared its own stamp.
		assert.equal(await nav.enterWorkspace({ deviceId: "dev1", deviceType: 0, page: 0 }), "switch-failed");
		assert.equal(switches.length, 2);
	});

	it("refuses while a detail surface is live on the device (no cross-stacking)", async () => {
		const { nav, switches, advance } = bed();
		await nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot });
		nav.surfaceSeen("dev1");
		advance(2_000); // well past the detail dispatch beat: the SURFACE is the reason
		assert.equal(await nav.enterWorkspace({ deviceId: "dev1", deviceType: 0, page: 0 }), "already-active");
		assert.equal(switches.length, 1);
	});

	it("refuses inside a detail dispatch beat, allows once the beat has passed", async () => {
		const { nav, switches, advance } = bed();
		await nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot });
		assert.equal(await nav.enterWorkspace({ deviceId: "dev1", deviceType: 0, page: 0 }), "already-active");
		assert.equal(switches.length, 1);
		advance(1_600); // detail still pending (install prompt open), but past its beat
		assert.equal(await nav.enterWorkspace({ deviceId: "dev1", deviceType: 0, page: 0 }), "entered");
		assert.equal(switches.length, 2);
	});

	it("Back after a workspace entry is the one stateless previous-profile hop", async () => {
		const { nav, switches, advance } = bed();
		await nav.enterWorkspace({ deviceId: "dev1", deviceType: 0, page: 1 });
		advance(100);
		await nav.leave("dev1");
		assert.equal(switches.length, 2);
		assert.deepEqual(switches[1], { deviceId: "dev1", profileName: undefined, page: undefined });
	});

	it("entry invalidates the last-leave debounce so Back works immediately on the new page", async () => {
		const { nav, switches } = bed();
		await nav.leave("dev1"); // stateless leave stamps the debounce
		assert.equal(await nav.enterWorkspace({ deviceId: "dev1", deviceType: 0, page: 0 }), "entered");
		await nav.leave("dev1"); // same tick: without the invalidation this would be swallowed
		assert.equal(switches.length, 3);
		assert.equal(switches[2]?.profileName, undefined);
	});

	it("device disconnect clears the workspace debounce stamp", async () => {
		const { nav, switches } = bed();
		await nav.enterWorkspace({ deviceId: "dev1", deviceType: 0, page: 0 });
		nav.deviceDisconnected("dev1");
		// Same tick: a reconnected device must not inherit the old stamp.
		assert.equal(await nav.enterWorkspace({ deviceId: "dev1", deviceType: 0, page: 0 }), "entered");
		assert.equal(switches.length, 2);
	});

	it("devices are isolated: two decks enter their own workspaces at once", async () => {
		const { nav, switches } = bed();
		assert.equal(await nav.enterWorkspace({ deviceId: "dev1", deviceType: 0, page: 0 }), "entered");
		assert.equal(await nav.enterWorkspace({ deviceId: "dev2", deviceType: 2, page: 3 }), "entered");
		assert.deepEqual(switches[1], { deviceId: "dev2", profileName: "profiles/workspace-xl", page: 3 });
	});

	it("Back releases the workspace dispatch stamp so the opener works again at once", async () => {
		const { nav, switches } = bed();
		await nav.enterWorkspace({ deviceId: "dev1", deviceType: 0, page: 1 });
		await nav.leave("dev1");
		// Same tick: Back, then the opener again. The stamp guarded exactly
		// the switch Back has now undone, so holding it refuses a press the
		// user is entitled to, and the key answers with the refusal cue.
		assert.equal(await nav.enterWorkspace({ deviceId: "dev1", deviceType: 0, page: 1 }), "entered");
		assert.equal(switches.filter((s) => s.profileName === "profiles/workspace-standard").length, 2);
	});

	it("workspace entry leaves a pending detail session to expire on its own timer", async () => {
		const { nav, advance } = bed();
		await nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot });
		assert.notEqual(nav.stateFor("dev1"), undefined);
		advance(2_000);
		assert.equal(await nav.enterWorkspace({ deviceId: "dev1", deviceType: 0, page: 1 }), "entered");
		// Dropping it here would look tidy and strand the user: the expiry
		// timer is what writes the tombstone surfaceSeen needs, so a late
		// accept of the detail install would land on a page no session owns
		// and nothing backs out of. The wrong-face symptom is fixed on the
		// Back tile's face instead, not by deleting session state.
		assert.notEqual(nav.stateFor("dev1"), undefined);
	});

	it("detail entry refuses inside the workspace switch beat (one managed hop at a time)", async () => {
		const { nav, switches } = bed();
		await nav.enterWorkspace({ deviceId: "dev1", deviceType: 0, page: 1 });
		// The mirror of the rule workspace entry already applies to a detail
		// beat: stacking a second managed profile onto a switch still
		// landing chains the app's SINGLE-level previous register, and the
		// true origin is what falls off the end.
		assert.equal(await nav.enter({ deviceId: "dev1", deviceType: 0, settings: opener, snapshot }), "already-active");
		assert.equal(switches.length, 1);
	});
});

describe("panel agreement", () => {
	it("the Press select offers the exact open-workspace marker and the page select matches the shipped page count", () => {
		const html = fs.readFileSync(path.join(pluginDir, "ui", "sensor-reading.html"), "utf8");
		assert.match(html, /<option value="open-workspace">/);
		const select = /<sdpi-select setting="workspacePage" default="0">([\s\S]*?)<\/sdpi-select>/.exec(html);
		assert.notEqual(select, null, "workspacePage select missing");
		const values = [...((select as RegExpExecArray)[1] as string).matchAll(/<option value="(-?\d+)">/g)].map((m) => Number(m[1]));
		// Exactly the shipped pages, zero-indexed on the wire, in order.
		assert.deepEqual(values, Array.from({ length: WORKSPACE_PAGE_COUNT }, (_, i) => i));
	});

	it("every panel asset busts its cache on the same token, and the build stamp says that token", () => {
		const uiDir = path.join(pluginDir, "ui");
		const tokens = new Set<string>();
		for (const file of fs.readdirSync(uiDir).filter((f) => f.endsWith(".html"))) {
			const html = fs.readFileSync(path.join(uiDir, file), "utf8");
			for (const m of html.matchAll(/\?v=([0-9][^"']*)/g)) {
				tokens.add(m[1] as string);
			}
		}
		// One token across every panel: a file left behind keeps serving the
		// browser's cached copy of code the rest of the panel has moved past.
		assert.equal(tokens.size, 1, `mixed cache tokens: ${[...tokens].join(", ")}`);
		const piCommon = fs.readFileSync(path.join(uiDir, "pi-common.js"), "utf8");
		const stamp = /const PI_BUILD = "([^"]+)"/.exec(piCommon);
		assert.notEqual(stamp, null, "PI_BUILD stamp missing");
		// The stamp is the only thing a user can read back when a stale
		// panel is suspected, so a stamp that disagrees with the token it
		// shipped under is worse than no stamp at all.
		assert.equal((stamp as RegExpExecArray)[1], [...tokens][0]);
	});
});
