// The PE reader (scripts/lib/pe.mjs) is what the native manifest records and
// what the drift classifier compares, so its facts are pinned here over
// synthetic PE32+ images (scripts/lib/pe-fixture.mjs): no native build
// needed. The real binaries are covered by test/native-manifest.test.ts.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { parsePe } from "../scripts/lib/pe.mjs";
import { buildPe } from "../scripts/lib/pe-fixture.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

describe("PE reader", () => {
	it("reads machine, linker, hardening, imports with their hints, and the debug records", () => {
		const pe = parsePe(buildPe({ pdb: "hwsm.pdb", imports: { "KERNEL32.dll": { CloseHandle: 137, OpenFileMappingW: 1084 }, "ADVAPI32.dll": { RegOpenKeyExW: 648 } } }));
		assert.equal(pe.machine, "x64");
		assert.equal(pe.linkerVersion, "14.51");
		assert.deepEqual(pe.hardening, { highEntropyVa: true, dynamicBase: true, nxCompat: true, controlFlowGuard: true, cetCompat: true, reproducibleLink: true });
		assert.deepEqual(pe.imports, ["KERNEL32.dll", "ADVAPI32.dll"]);
		assert.deepEqual(pe.importHints, { "KERNEL32.dll": { CloseHandle: 137, OpenFileMappingW: 1084 }, "ADVAPI32.dll": { RegOpenKeyExW: 648 } });
		assert.deepEqual(pe.codeView, { guid: "3044B6D5-904C-E7B5-7537-7C946EEDD599", age: 1, path: "hwsm.pdb" });
		assert.equal(pe.reproHash.slice(0, 32), "d5b644304c90b5e775377c946eedd599", "the REPRO hash starts with the GUID in memory order");
		assert.equal(pe.coffTimestamp, 0x28c8437f);
		assert.equal(pe.peChecksum, 0);
		assert.equal(pe.certificateTable, null);
		assert.equal(pe.overlayBytes, 0);
	});

	it("hashes each section's raw data and nothing else", () => {
		const a = parsePe(buildPe({ code: Buffer.from("same code") }));
		const b = parsePe(buildPe({ code: Buffer.from("same code"), imports: { "KERNEL32.dll": { CloseHandle: 142, OpenFileMappingW: 1089 } } }));
		assert.deepEqual(a.sections.map((s) => s.name), [".text", ".rdata"]);
		assert.equal(a.sections[0].sha256, b.sections[0].sha256, "an import hint shift leaves .text alone");
		assert.notEqual(a.sections[1].sha256, b.sections[1].sha256, "and moves .rdata");
		const raw = buildPe({ code: Buffer.from("same code") });
		const text = a.sections[0];
		assert.equal(text.sha256, sha256(raw.subarray(text.rawPointer, text.rawPointer + text.rawSize)));
	});

	it("reports cleared hardening, a missing REPRO record and a missing CET bit", () => {
		const pe = parsePe(buildPe({ dllCharacteristics: 0x0040 | 0x0100, repro: false, cet: false }));
		assert.deepEqual(pe.hardening, { highEntropyVa: false, dynamicBase: true, nxCompat: true, controlFlowGuard: false, cetCompat: false, reproducibleLink: false });
		assert.equal(pe.reproHash, null);
	});

	it("finds a certificate table by file offset and keeps the header hash blind to it", () => {
		const unsigned = parsePe(buildPe());
		const signed = parsePe(buildPe({ certificate: Buffer.alloc(13, 0x30), checksum: 0x12345 }));
		assert.deepEqual(signed.certificateTable, { offset: 1536, size: 24 });
		assert.equal(signed.overlayBytes, 0);
		assert.equal(signed.peChecksum, 0x12345);
		assert.equal(signed.headersNeutralSha256, unsigned.headersNeutralSha256, "CheckSum and data directory 4 are the only header fields signing rewrites");
		assert.deepEqual(signed.sections, unsigned.sections);
	});

	it("counts bytes after the image as overlay, with or without a certificate table", () => {
		assert.equal(parsePe(buildPe({ overlay: Buffer.from("12345") })).overlayBytes, 5);
		assert.equal(parsePe(buildPe({ certificate: Buffer.alloc(8), overlay: Buffer.from("123") })).overlayBytes, 3);
	});

	it("refuses truncated, foreign and inconsistent files with one sentence", () => {
		const good = buildPe();
		const lfanew = good.readUInt32LE(0x3c);
		const cases = [
			["empty", Buffer.alloc(0), /no MZ header/],
			["text", Buffer.from("not a native module at all, honestly"), /no MZ header/],
			["truncated headers", good.subarray(0, 0x100), /PE headers run past the end/],
			["PE32 magic", (() => { const b = Buffer.from(good); b.writeUInt16LE(0x10b, lfanew + 24); return b; })(), /not PE32\+/],
			["no PE signature", (() => { const b = Buffer.from(good); b.write("XX", lfanew, "latin1"); return b; })(), /not a PE image/],
			["section past the end", good.subarray(0, good.length - 256), /section \.rdata raw data lies outside the file/],
			["certificate past the end", (() => { const b = Buffer.from(good); b.writeUInt32LE(good.length, lfanew + 24 + 112 + 32); b.writeUInt32LE(64, lfanew + 24 + 112 + 36); return b; })(), /certificate table lies outside the file/]
		];
		for (const [name, bytes, expected] of cases) {
			assert.throws(() => parsePe(bytes), (err) => err instanceof Error && !(err instanceof RangeError) && expected.test(err.message), name);
		}
	});
});
