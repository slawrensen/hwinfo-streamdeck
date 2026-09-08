// Controlled U1 investigation, not a HWiNFO producer reproduction.
// Run: node --import tsx scripts/gadget-interleaving.mjs
// A child registry writer replaces one isolated row between two real native
// queries. No production hook or real HWiNFO registry path is modified.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

assert.equal(process.platform, "win32", "this investigation requires Windows");
const token = `${process.pid}_${randomUUID()}`;
const subkey = `Software\\HwinfoGadgetInterleaving_${token}`;
const registryPath = `HKCU\\${subkey}`;
const identityFile = join(tmpdir(), `hwinfo-gadget-interleaving-${token}.jsonl`);
process.env.HWINFO_VSB_KEY = subkey;
process.env.HWINFO_GADGET_IDENTITY_FILE = identityFile;
const { GadgetRegistryProvider } = await import("../src/hwinfo/gadget-registry.ts");
const generations = [
	{ Sensor0: "Fixture GPU A", Label0: "Temperature A", Value0: "40 °C", ValueRaw0: "40" },
	{ Sensor0: "Fixture GPU B", Label0: "Temperature B", Value0: "80 °C", ValueRaw0: "80" }
];
const write = (values) => {
	for (const [name, value] of Object.entries(values)) execFileSync("reg", ["add", registryPath, "/v", name, "/t", "REG_SZ", "/d", value, "/f"], { stdio: "ignore" });
};
let provider;
try {
	write(generations[0]);
	provider = GadgetRegistryProvider.open();
	const before = provider.read()?.readings[0];
	// This is a test seam over the real capability object. The writer runs
	// after the first field was queried but before the next field is queried.
	const nativeKey = Reflect.get(provider, "key");
	let swapped = false;
	Reflect.set(provider, "key", {
		queryString(name) {
			const value = nativeKey.queryString(name);
			if (!swapped && name === "Sensor0") {
				swapped = true;
				write(generations[1]);
			}
			return value;
		},
		close: () => nativeKey.close()
	});
	const observation = provider.read();
	const interleaved = observation?.readings[0];
	const after = provider.read()?.readings[0];
	assert.ok(swapped, "the native-query barrier must actually execute");
	assert.equal(before?.value, 40);
	assert.equal(after?.value, 80);
	const mixedObserved = interleaved !== undefined && interleaved.key !== before?.key && interleaved.key !== after?.key;
	if (process.argv.includes("--expect-contained")) assert.equal(observation, null, "observable interleaving must withhold the whole scan");
	// A writer can pause between updating the formatted unit and raw value.
	// Two identical observations cannot detect that stable intermediate row.
	write({ Value0: "176 °F" });
	const pausedObservation = provider.read();
	const pausedIntermediate = pausedObservation?.readings[0] ?? null;
	if (process.argv.includes("--expect-consistent")) assert.equal(pausedObservation, null, "contradictory formatted and raw numbers must withhold the scan");
	write({ ValueRaw0: "176" });
	const completedUnitChange = provider.read()?.readings[0];
	// Numerically consistent fields still cannot reveal a paused owner
	// replacement. The new owner's numbers can appear under the old name.
	write({ Value0: "50 °F", ValueRaw0: "50" });
	const pausedOwnerReplacement = provider.read()?.readings[0];
	write({ Sensor0: "Fixture GPU C" });
	const completedOwnerReplacement = provider.read()?.readings[0];
	process.stdout.write(`${JSON.stringify({
		fixture: "U1-controlled-registry-interleaving-v1",
		method: "real native queries; child reg.exe writer at a deterministic field boundary",
		before, interleaved: interleaved ?? null, after, mixedObserved, scanWithheld: observation === null,
		pausedIntermediate, completedUnitChange, pausedOwnerReplacement, completedOwnerReplacement,
		limitation: "Proves an allowed registry interleaving, not that HWiNFO uses this write order or timing. The interface supplies no transaction or producer sequence."
	}, null, "\t")}\n`);
} finally {
	provider?.close();
	try { execFileSync("reg", ["delete", registryPath, "/f"], { stdio: "ignore" }); } catch { /* absent if setup failed */ }
	rmSync(identityFile, { force: true });
}
