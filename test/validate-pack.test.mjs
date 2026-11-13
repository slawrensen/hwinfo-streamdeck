// The packed-archive gate must refuse every way a .streamDeckPlugin can be
// wrong while accepting the one shape the packer produces. Each case builds
// an archive that is wrong in exactly one way over a fixture staging
// directory. The real release archive is held to the real staging directory
// by scripts/qualify.mjs (the archive stage), never by the unit run.
import assert from "node:assert/strict";
import { constants as bufferConstants } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { PLUGIN_ROOT, SHIPPED_MEMBERS } from "../scripts/lib/pack-contract.mjs";
import { nativeExpectationsFromManifest, validatePack } from "../scripts/lib/pack-validation.mjs";
import { buildPe, fakeSign } from "../scripts/lib/pe-fixture.mjs";
import { listZip, readZipEntry, writeZip } from "../scripts/lib/zip.mjs";
import { archiveEntries, archiveFor, FIXTURE_VERSION, makeStaging } from "../scripts/lib/pack-fixture.mjs";

describe("packed-archive gate", () => {
	let staging;
	before(() => { staging = makeStaging(); });
	after(() => fs.rmSync(staging, { recursive: true, force: true }));

	const run = (archiveBytes, packageVersion = FIXTURE_VERSION, stagingDir = staging, expectedNative = new Map()) => validatePack({ archiveBytes, stagingDir, packageVersion, expectedNative });
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

	it("rejects a missing required member, the native binary included", () => {
		for (const rel of ["bin/hwsm.node"]) {
			const failures = run(archiveFor(staging, (entries) => entries.filter((entry) => entry.name !== member(rel)))).failures;
			assert.ok(failures.includes(`missing member "${rel}"`), failures.join("\n"));
		}
	});

	it("rejects forbidden and unlisted extras", () => {
		const extras = ["logs/com.lawrensen.hwinfo.0.log", "bin/hwsm_test.node", "bin/hwsm_protomm.node", "bin/hwsm.pdb", "bin/hwsm.node.staging-123", "bin/stale.node", "README.md", "src/plugin.ts", "ui/extra.js", ".env"];
		const failures = run(archiveFor(staging, (entries) => [...entries, ...extras.map((rel) => ({ name: member(rel), data: Buffer.from("x") }))])).failures;
		for (const rel of extras) assert.ok(failures.some((line) => line.includes(`"${rel}"`)), `${rel}: ${failures.join("\n")}`);
		assert.ok(failures.some((line) => /hwsm_test\.node.*test-only/.test(line)));
		assert.ok(failures.some((line) => /hwsm_protomm\.node.*test-only/.test(line)));
		assert.ok(failures.some((line) => /hwsm\.pdb.*debug symbols/.test(line)));
		assert.ok(failures.some((line) => /README\.md.*internal document/.test(line)));
		assert.ok(failures.some((line) => /\.0\.log.*log file/.test(line)));
		assert.ok(failures.some((line) => /"ui\/extra\.js".*unexpected/.test(line) || line === 'unexpected member "ui/extra.js"'));
	});

	it("holds every native member to the PE checks: PE32+, x64, nothing after the last section", () => {
		const replaced = (rel, data) => archiveFor(staging, (entries) => entries.map((entry) => entry.name === member(rel) ? { ...entry, data } : entry));
		for (const rel of ["bin/hwsm.node"]) {
			const junk = run(replaced(rel, Buffer.concat([Buffer.from("MZ"), Buffer.alloc(200, 7)]))).failures;
			assert.ok(junk.some((line) => line.startsWith(`${rel} is not a PE image`)), junk.join("\n"));
			const arm = buildPe({ pdb: "x.pdb" });
			arm.writeUInt16LE(0xaa64, arm.readUInt32LE(0x3c) + 4);
			assert.ok(run(replaced(rel, arm)).failures.some((line) => line === `${rel} is a arm64 image, not x64`));
			const overlay = run(replaced(rel, buildPe({ pdb: "x.pdb", overlay: Buffer.from("tail") }))).failures;
			assert.ok(overlay.some((line) => line === `${rel} carries 4 bytes after its last section and no certificate table`), overlay.join("\n"));
		}
	});

	it("refuses a native member that carries a test-only hook, whatever its name says", () => {
		const replaced = (rel, data) => archiveFor(staging, (entries) => entries.map((entry) => entry.name === member(rel) ? { ...entry, data } : entry));
		for (const [rel, hook] of [["bin/hwsm.node", "_testControl"], ["bin/hwsm.node", "_testHookOfAnotherBuild"]]) {
			const failures = run(replaced(rel, buildPe({ pdb: "x.pdb", code: Buffer.from(`\u0000${hook}\u0000`) }))).failures;
			assert.ok(failures.includes(`${rel} carries the test-only hook ${hook} (a test build under the shipped name)`), failures.join("\n"));
			const clean = run(replaced(rel, buildPe({ pdb: "x.pdb", code: Buffer.from("\u0000_testing lower case\u0000") }))).failures;
			assert.ok(!clean.some((line) => line.includes("test-only hook")), clean.join("\n"));
		}
	});

	it("passes a signed native member and refuses data after its certificate table", () => {
		// The staging copy must hold the same bytes, or the payload check
		// (not the PE check) would be what fails.
		const signedStaging = makeStaging("hwinfo-pack-signed-");
		try {
			const file = path.join(signedStaging, "bin", "hwsm.node");
			const signed = fakeSign(fs.readFileSync(file), { digestHex: "22".repeat(32) });
			fs.writeFileSync(file, signed);
			assert.deepEqual(run(archiveFor(signedStaging), FIXTURE_VERSION, signedStaging).failures, []);
			const trailing = Buffer.concat([signed, Buffer.alloc(8)]);
			fs.writeFileSync(file, trailing);
			const failures = run(archiveFor(signedStaging), FIXTURE_VERSION, signedStaging).failures;
			assert.ok(failures.includes("bin/hwsm.node carries a certificate table signing would not produce: 8 bytes follow the certificate table; it must end the file"), failures.join("\n"));
		} finally {
			fs.rmSync(signedStaging, { recursive: true, force: true });
		}
	});

	it("holds the native members to the hashes a native manifest records", () => {
		const archive = archiveFor(staging);
		const payload = run(archive).payload;
		const recorded = new Map([["bin/hwsm.node", payload.get("bin/hwsm.node")]]);
		assert.deepEqual(run(archive, FIXTURE_VERSION, staging, recorded).failures, []);
		const wrong = run(archive, FIXTURE_VERSION, staging, new Map([["bin/hwsm.node", "0".repeat(64)]])).failures;
		assert.ok(wrong.some((line) => /^bin\/hwsm\.node in the archive \([0-9a-f]{12}\) is not the binary the native manifest records \(000000000000\)/.test(line)), wrong.join("\n"));
		// A manifest of other binaries describes nothing this pack carries.
		const partial = run(archive, FIXTURE_VERSION, staging, new Map([["bin/next.node", "1".repeat(64)]])).failures;
		assert.ok(partial.includes("the native manifest does not describe bin/hwsm.node; regenerate it with node scripts/native-manifest.mjs"), partial.join("\n"));
	});

	it("reads native expectations from version 2 and version 1 manifests", () => {
		assert.deepEqual([...nativeExpectationsFromManifest({ sha256: "a", binaries: [{ file: "hwsm.node", sha256: "a" }, { file: "next.node", sha256: "b" }] })], [["bin/hwsm.node", "a"], ["bin/next.node", "b"]]);
		assert.deepEqual([...nativeExpectationsFromManifest({ file: "hwsm.node", sha256: "a" })], [["bin/hwsm.node", "a"]]);
		assert.deepEqual([...nativeExpectationsFromManifest({})], []);
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
		assert.ok(failures.some((line) => /Version 9\.9\.9\.0 does not match package\.json 9\.9\.8$/.test(line)), failures.join("\n"));
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

	it("reads a ZIP64 member that expands past the size of the whole archive", () => {
		// Compression can make the archive smaller than one member: the
		// expanded size is bounded by what a Buffer holds, not by the archive
		// (external review AX54). Offsets and compressed sizes stay bounded.
		for (const length of [1000, 1_000_000]) {
			const data = Buffer.alloc(length, 32);
			const zip = writeZip([{ name: "compressible.js", data, zip64: true }]);
			assert.ok(zip.length < length, `the ${length}-byte member packs smaller than itself`);
			const { entries, problems } = listZip(zip);
			assert.deepEqual(problems, []);
			assert.equal(entries.length, 1);
			assert.ok(readZipEntry(zip, entries[0]).equals(data));
		}
	});

	// Each ZIP64 size has its own bound: an expanded size what a Buffer
	// can hold, a compressed size the archive itself. A claim past its
	// bound is refused and named (external review AX54).
	it("refuses a ZIP64 size past its bound and names the bound", () => {
		const zip = writeZip([{ name: "a.js", data: Buffer.from("x"), zip64: true }]);
		const field = zip.lastIndexOf(Buffer.from([0x01, 0x00, 0x10, 0x00]));
		const claim = (offset, value) => {
			const bytes = Buffer.from(zip);
			bytes.writeBigUInt64LE(value, field + 4 + offset);
			return listZip(bytes).problems;
		};
		const huge = BigInt(bufferConstants.MAX_LENGTH) + 1n;
		assert.ok(claim(0, huge).includes(`central directory entry 0 claims uncompressedSize ${huge} beyond what a Buffer can hold`), claim(0, huge).join("\n"));
		const past = BigInt(zip.length) + 1n;
		assert.ok(claim(8, past).includes(`central directory entry 0 claims compressedSize ${past} beyond the archive`), claim(8, past).join("\n"));
	});

	it("reads ZIP64 per-entry sizes the packer writes and refuses a marked size it does not carry", () => {
		// Sizes marked 0xFFFFFFFF and carried in the 0x0001 field, as the CLI
		// writes them: the field is parsed, the sizes come out right, every
		// member inflates, and the archive passes whole.
		const zip64 = archiveFor(staging, (entries) => entries.map((entry) => ({ ...entry, zip64: true })));
		assert.ok(zip64.includes(Buffer.from([0x01, 0x00, 0x10, 0x00])), "the fixture carries a ZIP64 extended information field");
		const wide = listZip(zip64);
		assert.deepEqual(wide.problems, []);
		assert.equal(wide.entries.length, SHIPPED_MEMBERS.length);
		for (const entry of wide.entries) {
			assert.ok(entry.uncompressedSize < 0xffffffff && entry.compressedSize < 0xffffffff, `${entry.name}: sizes read from the field`);
			assert.equal(readZipEntry(zip64, entry).length, entry.uncompressedSize);
		}
		assert.deepEqual(run(zip64).failures, []);
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
