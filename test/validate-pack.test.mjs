// The packed-archive gate must refuse every way a .streamDeckPlugin can be
// wrong while accepting the one shape the packer produces. Each case builds
// an archive that is wrong in exactly one way over a fixture staging
// directory. The real release archive is held to the real staging directory
// by scripts/qualify.mjs (the archive stage), never by the unit run.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { PLUGIN_ROOT, SHIPPED_MEMBERS } from "../scripts/lib/pack-contract.mjs";
import { validatePack } from "../scripts/lib/pack-validation.mjs";
import { listZip, readZipEntry, writeZip } from "../scripts/lib/zip.mjs";
import { archiveEntries, archiveFor, FIXTURE_VERSION, makeStaging } from "../scripts/lib/pack-fixture.mjs";

describe("packed-archive gate", () => {
	let staging;
	before(() => { staging = makeStaging(); });
	after(() => fs.rmSync(staging, { recursive: true, force: true }));

	const run = (archiveBytes, packageVersion = FIXTURE_VERSION, stagingDir = staging) => validatePack({ archiveBytes, stagingDir, packageVersion });
	const member = (rel) => `${PLUGIN_ROOT}/${rel}`;

	it("accepts the archive the packer produces, manifest re-serialized and all members deflated", () => {
		const result = run(archiveFor(staging));
		assert.deepEqual(result.failures, []);
		assert.equal(result.members, SHIPPED_MEMBERS.length);
		assert.equal(result.payload.size, SHIPPED_MEMBERS.length);
	});

	it("accepts stored members and refuses a compression method this project never ships", () => {
		assert.deepEqual(run(archiveFor(staging, (entries) => entries.map((entry) => ({ ...entry, method: 0 })))).failures, []);
		const failures = run(archiveFor(staging, (entries) => entries.map((entry) => entry.name === member("themes.json") ? { ...entry, method: 12 } : entry))).failures;
		assert.ok(failures.some((line) => /themes\.json.*method 12/.test(line)), failures.join("\n"));
	});

	it("rejects a missing required member", () => {
		const failures = run(archiveFor(staging, (entries) => entries.filter((entry) => entry.name !== member("bin/hwsm.node")))).failures;
		assert.ok(failures.includes('missing member "bin/hwsm.node"'), failures.join("\n"));
	});

	it("rejects forbidden and unlisted extras", () => {
		const extras = ["logs/com.lawrensen.hwinfo.0.log", "bin/hwsm_test.node", "bin/hwsm.pdb", "bin/hwsm.node.staging-123", "README.md", "src/plugin.ts", "ui/extra.js", ".env"];
		const failures = run(archiveFor(staging, (entries) => [...entries, ...extras.map((rel) => ({ name: member(rel), data: Buffer.from("x") }))])).failures;
		for (const rel of extras) assert.ok(failures.some((line) => line.includes(`"${rel}"`)), `${rel}: ${failures.join("\n")}`);
		assert.ok(failures.some((line) => /hwsm_test\.node.*test-only/.test(line)));
		assert.ok(failures.some((line) => /hwsm\.pdb.*debug symbols/.test(line)));
		assert.ok(failures.some((line) => /README\.md.*internal document/.test(line)));
		assert.ok(failures.some((line) => /\.0\.log.*log file/.test(line)));
		assert.ok(failures.some((line) => /"ui\/extra\.js".*unexpected/.test(line) || line === 'unexpected member "ui/extra.js"'));
	});

	it("rejects a payload that does not match the staged build", () => {
		const failures = run(archiveFor(staging, (entries) => entries.map((entry) => entry.name === member("bin/plugin.js") ? { ...entry, data: Buffer.from("console.log('older build');") } : entry))).failures;
		assert.ok(failures.some((line) => /"bin\/plugin\.js" differs from the staged file/.test(line)), failures.join("\n"));
	});

	it("rejects a manifest whose meaning changed, and one whose version disagrees with package.json", () => {
		const changed = archiveFor(staging, (entries) => entries.map((entry) => {
			if (entry.name !== member("manifest.json")) return entry;
			const manifest = JSON.parse(entry.data.toString("utf8"));
			manifest.Actions = manifest.Actions.slice(1);
			return { ...entry, data: Buffer.from(JSON.stringify(manifest)) };
		}));
		assert.ok(run(changed).failures.some((line) => /differs from the staged manifest beyond formatting/.test(line)));
		const failures = run(archiveFor(staging), "9.9.8").failures;
		assert.ok(failures.some((line) => /Version 9\.9\.9\.0 does not match package\.json 9\.9\.8\.0/.test(line)), failures.join("\n"));
	});

	it("rejects an asset the manifest names but the archive lacks", () => {
		const failures = run(archiveFor(staging, (entries) => entries.filter((entry) => !entry.name.includes("imgs/plugin/marketplace")))).failures;
		assert.ok(failures.some((line) => /Icon "imgs\/plugin\/marketplace" names no member/.test(line)), failures.join("\n"));
		const withoutPanel = run(archiveFor(staging, (entries) => entries.filter((entry) => entry.name !== member("ui/sensor-dial.html")))).failures;
		assert.ok(withoutPanel.some((line) => /PropertyInspectorPath "ui\/sensor-dial\.html" is not a member/.test(line)));
		const withoutProfile = run(archiveFor(staging, (entries) => entries.filter((entry) => entry.name !== member("profiles/detail-xl.streamDeckProfile")))).failures;
		assert.ok(withoutProfile.some((line) => /profile "profiles\/detail-xl" names no \.streamDeckProfile member/.test(line)));
	});

	it("rejects unsafe member names wherever they point", () => {
		const bad = ["../evil.txt", "/absolute.txt", "C:/drive.txt", `${PLUGIN_ROOT}/..\\up.txt`, `${PLUGIN_ROOT}/sub/../manifest.json`, "other.sdPlugin/manifest.json", `${PLUGIN_ROOT}/trailing. `, `${PLUGIN_ROOT}/dir/`, `${PLUGIN_ROOT}/con:trol`];
		const failures = run(writeZip([...archiveEntries(staging), ...bad.map((name) => ({ name, data: Buffer.from("x") }))])).failures;
		for (const name of bad) assert.ok(failures.some((line) => line.includes(`"${name}"`)), `${name}: ${failures.join("\n")}`);
		const control = run(writeZip([...archiveEntries(staging), { name: `${PLUGIN_ROOT}/bad\u0001name`, data: Buffer.from("x") }])).failures;
		assert.ok(control.some((line) => /control character/.test(line)));
	});

	it("rejects a member listed twice and a case-insensitive collision", () => {
		const twice = run(archiveFor(staging, (entries) => [...entries, entries.find((entry) => entry.name === member("manifest.json"))])).failures;
		assert.ok(twice.some((line) => /"com\.lawrensen\.hwinfo\.sdPlugin\/manifest\.json" is listed twice/.test(line)), twice.join("\n"));
		const collision = run(archiveFor(staging, (entries) => [...entries, { name: member("Manifest.json"), data: Buffer.from("{}") }])).failures;
		assert.ok(collision.some((line) => /collide on a case-insensitive file system/.test(line)), collision.join("\n"));
	});

	it("rejects damaged and encrypted members and a damaged container", () => {
		const crc = run(archiveFor(staging, undefined, { corrupt: (name, record) => { if (name === member("themes.json")) record.crc ^= 1; } })).failures;
		assert.ok(crc.some((line) => /themes\.json.*CRC-32 mismatch/.test(line)), crc.join("\n"));
		const size = run(archiveFor(staging, undefined, { corrupt: (name, record) => { if (name === member("LICENSE")) record.uncompressedSize += 1; } })).failures;
		assert.ok(size.some((line) => /LICENSE.*inflated to/.test(line)), size.join("\n"));
		const encrypted = run(archiveFor(staging, (entries) => entries.map((entry) => entry.name === member("LICENSE") ? { ...entry, flags: 0x0801 } : entry))).failures;
		assert.ok(encrypted.some((line) => /LICENSE.*encrypted/.test(line)), encrypted.join("\n"));
		const good = archiveFor(staging);
		assert.ok(run(good.subarray(0, good.length - 10)).failures.some((line) => /end-of-central-directory/.test(line)));
		assert.ok(run(Buffer.concat([good, Buffer.from("trailing")])).failures.some((line) => /follow the end-of-central-directory/.test(line)));
		assert.ok(run(Buffer.alloc(0)).failures.length > 0);
	});

	it("reads ZIP64 per-entry sizes the packer writes and refuses a marked size it does not carry", () => {
		const good = archiveFor(staging);
		const { entries } = listZip(good);
		assert.equal(entries.length, SHIPPED_MEMBERS.length);
		for (const entry of entries) assert.doesNotThrow(() => readZipEntry(good, entry));
		// Mark one central-directory size as ZIP64 without the extra field.
		const marked = Buffer.from(good);
		let eocd = -1;
		for (let i = marked.length - 22; i >= 0; i--) if (marked.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
		const directory = marked.readUInt32LE(eocd + 16);
		marked.writeUInt32LE(0xffffffff, directory + 20);
		assert.ok(run(marked).failures.some((line) => /ZIP64 size without carrying it/.test(line)));
	});

	it("rejects staging drift in both directions and a machine-specific path in a text member", () => {
		const drifted = makeStaging("hwinfo-pack-drift-");
		try {
			fs.writeFileSync(path.join(drifted, "ui", "notes.txt"), "x");
			fs.mkdirSync(path.join(drifted, "logs"), { recursive: true });
			fs.writeFileSync(path.join(drifted, "logs", "com.lawrensen.hwinfo.0.log"), "log");
			const failures = run(archiveFor(drifted), FIXTURE_VERSION, drifted).failures;
			assert.ok(failures.some((line) => /staging file "ui\/notes\.txt" is not in the shipping contract/.test(line)), failures.join("\n"));
			assert.ok(!failures.some((line) => line.includes("logs/")), "the log directory is staging-only, never drift");
			fs.rmSync(path.join(drifted, "ui", "notes.txt"));
			fs.rmSync(path.join(drifted, "themes.json"));
			const lacking = run(archiveFor(staging), FIXTURE_VERSION, drifted).failures;
			assert.ok(lacking.some((line) => /staging lacks "themes\.json"/.test(line)), lacking.join("\n"));
			assert.ok(run(archiveFor(staging), FIXTURE_VERSION, path.join(drifted, "nowhere")).failures.some((line) => /does not exist/.test(line)));
		} finally {
			fs.rmSync(drifted, { recursive: true, force: true });
		}
		const leaky = run(archiveFor(staging, (entries) => entries.map((entry) => entry.name === member("ui/pi-control.js") ? { ...entry, data: Buffer.from("const p = 'C:\\\\Users\\\\someone\\\\git';") } : entry))).failures;
		assert.ok(leaky.some((line) => /pi-control\.js" contains a machine-specific user path/.test(line)), leaky.join("\n"));
	});
});
