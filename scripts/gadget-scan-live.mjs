// Read-only scan timing over a Gadget key that something else is writing.
// It times the real provider over the key HWINFO_VSB_KEY names, or HWiNFO's
// own HKCU\Software\HWiNFO64\VSB when that is unset, and prints counts and
// timings only: never a sensor name, a label or a value.
//
// It NEVER writes the registry. The provider opens the key through the
// native bridge with query-only rights, and this script calls no registry
// tool and creates no file. Keep it that way.
//
// Run: node --import tsx scripts/gadget-scan-live.mjs [--scans N] [--spacing MS]
//   --scans N     timed scans (default 120)
//   --spacing MS  pause between scans (default 250, the plugin's fastest poll)
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";

assert.equal(process.platform, "win32");

function option(name, fallback) {
	const at = process.argv.indexOf(name);
	if (at === -1) return fallback;
	const value = Number(process.argv[at + 1]);
	assert.ok(Number.isInteger(value) && value > 0, `${name} needs a positive whole number`);
	return value;
}
const scans = option("--scans", 120);
const spacingMs = option("--spacing", 250);

// The provider freezes the key name at module load; this mirrors its default.
const key = `HKCU\\${process.env.HWINFO_VSB_KEY || "Software\\HWiNFO64\\VSB"}`;
const { GadgetRegistryProvider } = await import("../src/hwinfo/gadget-registry.ts");
const { HwinfoError } = await import("../src/hwinfo/types.ts");

/** A source failure is a result here, not a crash: say which, and stop. */
function unavailable(err) {
	if (!(err instanceof HwinfoError)) throw err;
	return `${err.reason}: ${err.message}`;
}

let provider;
try {
	provider = GadgetRegistryProvider.open();
} catch (err) {
	console.error(`Gadget source unavailable [${unavailable(err)}]`);
	process.exit(2);
}

const times = [];
let skippedScans = 0;
let published = 0;
let withheld = 0;
let contradictory = 0;
let notices = 0;
let stopped;
try {
	for (let n = 0; n < scans; n++) {
		const start = performance.now();
		let snapshot;
		try {
			snapshot = provider.read();
		} catch (err) {
			stopped = unavailable(err);
			break;
		}
		times.push(performance.now() - start);
		if (snapshot === null) {
			skippedScans++;
		} else {
			published = snapshot.readings.length;
			withheld = snapshot.blockedReadingCount ?? 0;
			contradictory = Math.max(contradictory, snapshot.contradictoryReadingCount ?? 0);
		}
		// Drained and counted, never printed: a notice names a sensor.
		notices += provider.notices().length;
		await sleep(spacingMs);
	}
} finally {
	provider.close();
}

times.sort((a, b) => a - b);
const at = (q) => (times.length === 0 ? null : Math.round(times[Math.max(0, Math.ceil(q * times.length) - 1)] * 100) / 100);
process.stdout.write(`${JSON.stringify({ key, node: process.version, scans: times.length, spacingMs, published, withheld, contradictory, notices, skippedScans, p50Ms: at(0.5), p95Ms: at(0.95), maxMs: at(1), ...(stopped === undefined ? {} : { stoppedEarly: stopped }) }, null, "\t")}\n`);
process.exit(stopped === undefined ? 0 : 2);
