// Synthetic native-registry cost measurement. No live HWiNFO keys are used:
// the fixture is a throwaway HKCU subkey, deleted when the run ends.
// Run: node --import tsx scripts/gadget-scan-benchmark.mjs [--rows N] [--samples N]
//   (default)    39 sparse rows, every second slot, four fields a row: the
//                fixture PERF.md's 2026-09-07 numbers were taken on
//   --rows N     N dense rows (1 to 1024) shaped like the ones HWiNFO 8.48
//                writes: five REG_SZ fields a row, source names with a colon,
//                thousands separators, a Yes/No word, a unitless value
//   --samples N  measured scans (default 500), after 50 warmup scans
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

assert.equal(process.platform, "win32");

function option(name) {
	const at = process.argv.indexOf(name);
	if (at === -1) return undefined;
	const value = Number(process.argv[at + 1]);
	assert.ok(Number.isInteger(value) && value > 0, `${name} needs a positive whole number`);
	return value;
}
const denseRows = option("--rows");
assert.ok(denseRows === undefined || denseRows <= 1024, "--rows cannot exceed the provider's 1,024-slot scan bound");
const samples = option("--samples") ?? 500;

const token = `${process.pid}_${randomUUID()}`;
const subkey = `Software\\HwinfoGadgetBenchmark_${token}`;
const registryPath = `HKCU\\${subkey}`;
const registryFile = join(tmpdir(), `hwinfo-gadget-benchmark-${token}.reg`);
process.env.HWINFO_VSB_KEY = subkey;
const { GadgetRegistryProvider } = await import("../src/hwinfo/gadget-registry.ts");
let provider;
try {
	const rows = denseRows ?? 39;
	const lines = ["Windows Registry Editor Version 5.00", "", `[HKEY_CURRENT_USER\\${subkey}]`];
	if (denseRows === undefined) {
		for (let i = 0; i < rows; i++) {
			lines.push(`"Sensor${i * 2}"="Fixture CPU"`, `"Label${i * 2}"="Temperature ${i}"`, `"Value${i * 2}"="40 C"`, `"ValueRaw${i * 2}"="40"`);
		}
	} else {
		// Value and ValueRaw pairs as captured from HWiNFO 8.48.
		const shapes = [["55.2 °C", "55.2"], ["3,798.4 MHz", "3798.4"], ["42,085 MB", "42085"], ["50.6 %", "50.6"], ["No", "No"], ["60.713 W", "60.713"], ["0 RPM", "0"], ["2.6 ", "2.6"]];
		for (let i = 0; i < rows; i++) {
			const [value, raw] = shapes[i % shapes.length];
			lines.push(`"Sensor${i}"="Device [#${i % 12}]: Example Source ${i % 12}"`, `"Label${i}"="Reading ${String.fromCharCode(65 + (i % 26))}${i}"`, `"Value${i}"="${value}"`, `"ValueRaw${i}"="${raw}"`, `"Color${i}"="ff0000"`);
		}
	}
	writeFileSync(registryFile, `\uFEFF${lines.join("\r\n")}\r\n`, "utf16le");
	execFileSync("reg", ["import", registryFile], { stdio: "ignore" });
	provider = GadgetRegistryProvider.open();
	const nativeKey = Reflect.get(provider, "key");
	let queries = 0;
	Reflect.set(provider, "key", { queryString(name) { queries++; return nativeKey.queryString(name); }, close: () => nativeKey.close() });
	for (let i = 0; i < 50; i++) provider.read();
	queries = 0;
	const times = [];
	for (let i = 0; i < samples; i++) {
		const start = performance.now();
		const snapshot = provider.read();
		times.push(performance.now() - start);
		assert.equal(snapshot?.readings.length, rows);
	}
	times.sort((a, b) => a - b);
	// Rank ceil(q * n): with the default 500 samples these are times[249] and times[474].
	const at = (q) => times[Math.max(0, Math.ceil(q * times.length) - 1)];
	process.stdout.write(`${JSON.stringify({ fixture: denseRows === undefined ? "39 sparse synthetic Gadget rows" : `${rows} dense Gadget rows in the shapes HWiNFO 8.48 writes`, rows, node: process.version, samples: times.length, queriesPerScan: queries / times.length, p50Ms: at(0.5), p95Ms: at(0.95), maxMs: times.at(-1), meanMs: times.reduce((sum, value) => sum + value, 0) / times.length, host: "native Windows registry, current machine; not host CPU or physical-device evidence" }, null, "\t")}\n`);
} finally {
	provider?.close();
	try { execFileSync("reg", ["delete", registryPath, "/f"], { stdio: "ignore" }); } catch { /* absent if setup failed */ }
	rmSync(registryFile, { force: true });
}
