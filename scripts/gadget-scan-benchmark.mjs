// Synthetic native-registry cost measurement. No live HWiNFO keys are used.
// Run: node --import tsx scripts/gadget-scan-benchmark.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

assert.equal(process.platform, "win32");
const token = `${process.pid}_${randomUUID()}`;
const subkey = `Software\\HwinfoGadgetBenchmark_${token}`;
const registryPath = `HKCU\\${subkey}`;
const identityFile = join(tmpdir(), `hwinfo-gadget-benchmark-${token}.jsonl`);
const registryFile = join(tmpdir(), `hwinfo-gadget-benchmark-${token}.reg`);
process.env.HWINFO_VSB_KEY = subkey;
process.env.HWINFO_GADGET_IDENTITY_FILE = identityFile;
const { GadgetRegistryProvider } = await import("../src/hwinfo/gadget-registry.ts");
let provider;
try {
	const rows = 39;
	const lines = ["Windows Registry Editor Version 5.00", "", `[HKEY_CURRENT_USER\\${subkey}]`];
	for (let i = 0; i < rows; i++) {
		lines.push(`"Sensor${i * 2}"="Fixture CPU"`, `"Label${i * 2}"="Temperature ${i}"`, `"Value${i * 2}"="40 C"`, `"ValueRaw${i * 2}"="40"`);
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
	for (let i = 0; i < 500; i++) {
		const start = performance.now();
		const snapshot = provider.read();
		times.push(performance.now() - start);
		assert.equal(snapshot?.readings.length, rows);
	}
	times.sort((a, b) => a - b);
	process.stdout.write(`${JSON.stringify({ fixture: "39 sparse synthetic Gadget rows", node: process.version, samples: times.length, queriesPerScan: queries / times.length, p50Ms: times[249], p95Ms: times[474], meanMs: times.reduce((sum, value) => sum + value, 0) / times.length, host: "native Windows registry, current machine; not host CPU or physical-device evidence" }, null, "\t")}\n`);
} finally {
	provider?.close();
	try { execFileSync("reg", ["delete", registryPath, "/f"], { stdio: "ignore" }); } catch { /* absent if setup failed */ }
	rmSync(identityFile, { force: true });
	rmSync(registryFile, { force: true });
}
