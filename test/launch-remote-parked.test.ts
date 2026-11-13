/**
 * Launch (a key press that opens Task Manager, an app or a website, the
 * Allow approvals, Find HWiNFO and the hwlaunch addon) and Remote PCs
 * (readings of the PCs HWiNFO's Remote Center monitors) left 1.8 on the
 * owner's word, 2026-11-07, and wait on branch park/1.8-launch-remote.
 * 1.7.1 never had either.
 *
 * These hold what a person and the package meet once it is out: no fold,
 * control, string, script, module, addon, suite or doc line names them.
 * They also hold what sat beside them and stays (every other press choice
 * and Advanced group, the key alerts their suite carried), and how a
 * document a 1.8 candidate stored with them reads now: it degrades, never
 * breaks, and is never rewritten.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { compose } from "../src/actions/sensor-reading";
import { composeDialSvg } from "../src/actions/sensor-dial";
import { pressBehaviorOf } from "../src/detail/detail-settings";
import { keyProducerOf } from "../src/hwinfo/key-namespace";
import { SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";
import { buildPreview } from "../src/pi-protocol";
import { poller, type PollerStatus } from "../src/poller";
import { SessionStatsStore } from "../src/stats";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PLUGIN = path.join(ROOT, "com.lawrensen.hwinfo.sdPlugin");
const UI = path.join(PLUGIN, "ui");
const read = (...parts: string[]): string => readFileSync(path.join(ROOT, ...parts), "utf8");
const ui = (name: string): string => readFileSync(path.join(UI, name), "utf8");

/** Every file under `dir`, with its path from the repo root, forward slashes. */
function filesUnder(dir: string): string[] {
	return readdirSync(path.join(ROOT, dir), { withFileTypes: true, recursive: true })
		.filter((entry) => entry.isFile())
		.map((entry) => path.relative(ROOT, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/"));
}

/** The three press choices a 1.8 candidate could store for a launch. */
const LAUNCH_PRESSES = ["launch", "tap-cycle-hold-launch", "tap-launch-hold-details"] as const;
/** A launch target as the 1.8 candidate's panel wrote it. */
const LAUNCH_TARGET = { kind: "url", url: "https://example.com/status", stamp: "c3RhbXA" };
/** A remote PC's reading key as the 1.8 candidate minted it: rm: and the
 * base64url of ["DESKTOP-7Q2", "f0000501", 0, "1000000"]. */
const REMOTE_KEY = "rm:WyJERVNLVE9QLTdRMiIsImYwMDAwNTAxIiwwLCIxMDAwMDAwIl0";
/** Words a remote PC's own faces drew: none may show now. */
const REMOTE_WORDS = /DESKTOP-7Q2|Remote|PC offline|PC unclear|On Gadget/;

describe("the panels have no Launch and no Remote PCs", () => {
	for (const file of ["sensor-reading.html", "sensor-dial.html"]) {
		it(`${file} has no launch or Remote PCs fold, control, string or script`, () => {
			assert.doesNotMatch(ui(file), /sec-remote|id="machine-|id="remote-|pi-remote\.js|pi\.remote\.|id="launch-|id="f-launch-|pi\.launch\.|Find HWiNFO|Remote PCs/);
		});

		it(`${file} keeps every other Advanced group, in order`, () => {
			const advanced = ui(file).slice(ui(file).indexOf(`id="sec-advanced"`));
			const groups = [...advanced.matchAll(/<details class="hw-sub" id="([^"]+)"/g)].map((match) => match[1]);
			assert.deepEqual(groups, ["sec-shared", "sec-connection", "sec-links", "sec-calc", "sec-support", "sec-config"]);
		});
	}

	it("a key press keeps every other choice, as 1.7.1 lists them", () => {
		const select = /<select id="f-press"[^>]*>([\s\S]*?)<\/select>/.exec(ui("sensor-reading.html"))?.[1] ?? "";
		const values = [...select.matchAll(/<option value="([^"]*)"/g)].map((match) => match[1]);
		assert.deepEqual(values, ["", "open-details", "tap-cycle-hold-details"]);
	});

	it("no panel file is left behind: no module, no style, no shell hook, no string", () => {
		assert.equal(existsSync(path.join(UI, "pi-remote.js")), false, "ui/pi-remote.js ships");
		assert.doesNotMatch(ui("pi.css"), /launch|remote|machine-/i);
		for (const file of ["pi-shell.js", "pi-common.js", "pi-strip.js", "pi-strip-model.js"]) {
			assert.doesNotMatch(ui(file), /pi-remote|hw\.remote|machineFilter|getRemote|remoteSources|findHwinfo|allowLaunch|patchLaunch|launch-config|"launch"/, file);
		}
		assert.doesNotMatch(ui("pi-model.js"), /LAUNCH_BEHAVIORS|launchBehavior|launchWords|launchTargetText|patchLaunch|remoteWords|remoteMachines|\brm:/);
		assert.doesNotMatch(ui("pi-strings.js"), /"launch":|"remote":|Remote PCs|Find HWiNFO/);
		assert.doesNotMatch(read("src", "i18n-catalog.ts"), /\blaunch: \{|\bremote: \{|remoteO(ff|nGadget|ffline)|remoteAmbiguous|Launcher unavailable/);
	});

	it("the help budget measures neither", () => {
		assert.doesNotMatch(read("scripts", "fixtures", "pi-help-baseline.json"), /sec-remote|launch/);
	});
});

describe("the plugin has no Launch and no Remote PCs code", () => {
	it("src/launch, the key's launch runtime and the remote readers are gone", () => {
		for (const gone of ["src/launch", "src/actions/key-launch.ts", "src/hwinfo/remote.ts", "src/hwinfo/remote-context.ts", "src/hwinfo/remote-identity.ts"]) {
			assert.equal(existsSync(path.join(ROOT, gone)), false, `${gone} is there`);
		}
	});

	it("nothing in src, scripts or test reaches for them", () => {
		const self = "test/launch-remote-parked.test.ts";
		const reaches = [...filesUnder("src"), ...filesUnder("scripts"), ...filesUnder("test")]
			.filter((file) => /\.(ts|mjs)$/.test(file) && file !== self)
			.filter((file) => /launch\/(args|dry-run|hwlaunch|launcher|panel|press|setup|stamp|target)|key-launch|hwlaunch|HWLAUNCH|HWINFO_LAUNCH_DRY_RUN|hwinfo\/remote|openRemote|RemoteSourceSet|remoteKeyScreen|remoteKeyDialText|setRemoteOptions|HWINFO_SM2_REMOTE_PREFIX|fake-hwinfo-remote/.test(read(file)));
		assert.deepEqual(reaches, []);
	});

	it("a saved rm: key belongs to no producer", () => {
		assert.equal(keyProducerOf(REMOTE_KEY), "unknown");
	});
});

describe("the package and the suites have no Launch and no Remote PCs", () => {
	it("no hwlaunch addon is built, vendored, packed, checked or signed", () => {
		assert.equal(existsSync(path.join(ROOT, "native", "hwlaunch")), false, "native/hwlaunch is there");
		const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;
		assert.doesNotMatch(scripts["build:native"] ?? "", /hwlaunch/);
		for (const file of ["scripts/lib/native-binaries.mjs", "scripts/lib/pack-contract.mjs", "scripts/copy-hwsm.mjs", "scripts/validate-native.mjs", "scripts/native-manifest.mjs", "scripts/native-source-id.mjs", "scripts/abi-check.mjs", "scripts/qualify.mjs", ".github/workflows/ci.yml", ".github/workflows/release.yml", ".gitignore"]) {
			assert.doesNotMatch(read(file), /hwlaunch|HWLAUNCH/, file);
		}
	});

	it("no suite runs them", () => {
		const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;
		for (const name of ["e2e:launch", "e2e:remote", "e2e:pi-remote"]) assert.equal(scripts[name], undefined, `package.json has ${name}`);
		assert.doesNotMatch(`${scripts.test ?? ""} ${scripts["test:native"] ?? ""}`, /test\/(launch-(?!remote-parked\.)|launcher|hwlaunch|key-launch|native-hwlaunch|remote-|poller-remote|native-remote)/);
		for (const gone of ["scripts/e2e-launch.mjs", "scripts/e2e-remote.mjs", "scripts/e2e-pi-remote.mjs", "scripts/fake-hwinfo-remote.mjs", "scripts/fixtures/launch-probe.mjs"]) {
			assert.equal(existsSync(path.join(ROOT, gone)), false, `${gone} is there`);
		}
		assert.doesNotMatch(read("scripts", "hygiene.mjs"), /e2e:launch|e2e:remote|e2e:pi-remote/);
		assert.doesNotMatch(read("AGENTS.md"), /e2e:launch|e2e:remote|e2e:pi-remote|hwlaunch|Remote PCs|pi-remote/);
	});

	it("the key alert legs the launch suite carried run in their own suite", () => {
		const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;
		assert.equal(scripts["e2e:key-alerts"], "node scripts/e2e-key-alerts.mjs");
		const suite = read("scripts", "e2e-key-alerts.mjs");
		for (const leg of ["a reading past Warn recolors the key", "the opted-in tap snoozes: the theme returns and the band shows", "the next tap cycles the stat as usual", "Alert after holds the level back at first", "and shows it once it lasted", "a second reading's own limit recolors a dual key, and the other row gives way", "without alertRules a dual key alerts on reading 1 alone, as before"]) {
			assert.ok(suite.includes(`"${leg}"`), `scripts/e2e-key-alerts.mjs has no leg "${leg}"`);
		}
		assert.doesNotMatch(suite, /launch|HWINFO_LAUNCH/i);
	});
});

describe("the docs name neither", () => {
	// docs/legacy is the 1.7 site as it shipped and stays as it is. The
	// Stream Deck app's own launch, a debug launch and Windows Task Manager
	// ending a process are other things.
	const pages = readdirSync(path.join(ROOT, "docs"), { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "changelog.md").map((entry) => `docs/${entry.name}`);
	// The plugin folder's NOTICE.md is the build's copy of NOTICE.md
	// (scripts/copy-hwsm.mjs), absent from a fresh checkout before a build.
	for (const file of ["README.md", "SECURITY.md", "NOTICE.md", ...pages]) {
		it(`${file} never names them`, () => {
			assert.doesNotMatch(read(file), /Remote PCs?\b|remote PCs?\b|Remote Center|HWiNFO Remote|hwlaunch|Find HWiNFO|app or website|Review in settings|Launcher unavailable|PC offline|\*\*Allow\*\*|Rebind|a-press-can-open|\*\*PC\*\* filter/);
		});
	}

	it("the manifest Description says what a key press opens now, and stays long enough", () => {
		const description = (JSON.parse(read("com.lawrensen.hwinfo.sdPlugin", "manifest.json")) as { Description: string }).Description;
		assert.doesNotMatch(description, /Task Manager|app or website|you allow/);
		assert.match(description, /A key press can open a detail page of related readings\./);
		assert.match(description, /REALiX/);
		assert.ok(description.length >= 250, `the Description is ${description.length} characters`);
	});

	it("the 1.8 changelog entry never names them", () => {
		const changelog = read("CHANGELOG.md").replace(/\r\n/g, "\n");
		const start = changelog.indexOf("## 1.8.0.0 - ");
		const end = changelog.indexOf("\n## 1.7.1.0 - ", start);
		assert.ok(start >= 0 && end > start, "the CHANGELOG has its 1.8.0.0 and 1.7.1.0 entries");
		assert.doesNotMatch(changelog.slice(start, end), /launch|hwlaunch|Remote|remote PC|remote readings|app or website|\*\*Allow\*\*|Find HWiNFO/);
	});
});

describe("a stored document degrades, never breaks, and is never rewritten", () => {
	const reading: Reading = { key: "f0000501:0:1000000", type: SensorType.Temperature, sensorIndex: 0, id: 0x1000000, label: "CPU (Tctl/Tdie)", unit: "°C", value: 52, valueMin: 40, valueMax: 70, valueAvg: 50 };
	const snapshot: SensorSnapshot = { pollTime: 1, valueRevision: 1, version: 1, revision: 1, sensors: [{ index: 0, id: 0xf0000501, instance: 0, name: "CPU" }], readings: [reading], byKey: new Map([[reading.key, reading]]) };
	const status: PollerStatus = { state: "ok", snapshot, source: "shared-memory" };
	/** A Shared Memory key this snapshot does not publish: the plain missing state. */
	const LOST = "f0000501:0:2000000";

	for (const press of LAUNCH_PRESSES) {
		it(`a key stored with press "${press}" presses as the default, and its panel shows the default`, () => {
			const stored = { readingKey: reading.key, pressBehavior: press, launch: LAUNCH_TARGET };
			assert.equal(pressBehaviorOf(stored), "cycle-stat");
			const preview = buildPreview(status, stored, true, { context: "ctx", kind: "key" }) as { effective: { press: { behavior: string }; launch?: unknown } };
			assert.equal(preview.effective.press.behavior, "cycle-stat");
			assert.equal(Object.hasOwn(preview.effective, "launch"), false);
			assert.equal(compose(stored, status), compose({ readingKey: reading.key }, status), "the face is the one without the launch fields");
			assert.deepEqual(stored, { readingKey: reading.key, pressBehavior: press, launch: LAUNCH_TARGET }, "nothing touched the document");
		});
	}

	it("a key saved on a remote PC's reading draws the plain missing state", () => {
		const face = compose({ readingKey: REMOTE_KEY }, status);
		assert.equal(face, compose({ readingKey: LOST }, status));
		assert.match(face, /Sensor missing/);
		assert.doesNotMatch(face, REMOTE_WORDS);
		const preview = buildPreview(status, { readingKey: REMOTE_KEY }, true, { context: "ctx", kind: "key" }) as { missing?: boolean; remote?: unknown };
		assert.equal(preview.missing, true);
		assert.equal(Object.hasOwn(preview, "remote"), false);
	});

	it("a dial saved on a remote PC's reading draws the plain missing state", () => {
		const draw = (readingKey: string): string => composeDialSvg({ settings: { readingKey }, stats: new SessionStatsStore(), statMode: "current", overlay: null, cyclePaused: false, pinned: false }, status);
		const face = draw(REMOTE_KEY);
		assert.equal(face, draw(LOST));
		assert.match(face, /Sensor missing/);
		assert.doesNotMatch(face, REMOTE_WORDS);
	});

	it("shared settings naming Remote PCs or launch approvals are read by nothing", () => {
		assert.equal(Object.hasOwn(Object.getPrototypeOf(poller) as object, "setRemoteOptions"), false);
		assert.equal(Object.hasOwn(Object.getPrototypeOf(poller) as object, "remoteOverview"), false);
		assert.doesNotMatch(read("src", "plugin.ts"), /remoteSources|remoteMachines|launchKey/);
	});
});
