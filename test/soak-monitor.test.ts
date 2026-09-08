import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/soak-monitor.mjs", import.meta.url));
const LEGACY = "tsIso,tsMs,pid,matches,rssB,privateB,handles,threads,cpuS,sdAppPid,hwinfoCount,logWarnDelta,logErrorDelta,note";
const HEADER = `${LEGACY},sdRssB,sdPrivateB,sdHandles,sdThreads,sdCpuS`;

function summary(header: string, rows: readonly (readonly (string | number)[])[]): string {
	const root = mkdtempSync(join(tmpdir(), "hwinfo-soak-summary-"));
	try {
		const csv = join(root, "fixture.csv");
		writeFileSync(csv, `${header}\n${rows.map((r) => r.join(",")).join("\n")}\n`);
		const result = spawnSync(process.execPath, [SCRIPT, "--summary", csv], { encoding: "utf8" });
		assert.equal(result.status, 0, result.stderr);
		return result.stdout;
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

it("computes plugin and host CPU on their independent PID segments", () => {
	const rows = [
		["2026-09-07T00:00:00Z", 0, 10, 1, 104857600, 104857600, 30, 4, 10, 20, 1, 0, 0, "", 209715200, 209715200, 50, 9, 100],
		["2026-09-07T00:01:00Z", 60000, 10, 1, 104857600, 104857600, 30, 4, 16, 20, 1, 0, 0, "", 209715200, 209715200, 50, 9, 103],
		["2026-09-07T00:02:00Z", 120000, 11, 1, 104857600, 104857600, 30, 4, 0, 20, 1, 0, 0, "", 209715200, 209715200, 50, 9, 106],
		["2026-09-07T00:03:00Z", 180000, 11, 1, 104857600, 104857600, 30, 4, 12, 21, 1, 0, 0, "", 157286400, 157286400, 40, 9, 1]
	];
	const output = summary(HEADER, rows);
	assert.match(output, /Avg CPU, same run \| 10\.00%/);
	assert.match(output, /Host avg CPU, same host PID \| 5\.00%/);
	assert.match(output, /Host RSS slope, host PID 20 \(3 samples\)/);
	assert.match(output, /Stream Deck host RSS \| 200\.0 to 150\.0 MB/);
});

it("reads historical monitor CSVs without inventing missing host metrics", () => {
	const output = summary(LEGACY, [
		["2026-09-07T00:00:00Z", 0, 10, 1, 104857600, 104857600, 30, 4, 10, 20, 1, 0, 0, ""],
		["2026-09-07T00:01:00Z", 60000, 10, 1, 104857600, 104857600, 30, 4, 16, 20, 1, 0, 0, ""]
	]);
	assert.match(output, /Host avg CPU, same host PID \| n\/a/);
	assert.match(output, /Stream Deck host RSS \| n\/a to n\/a MB/);
});

it("splits reused PIDs and decreasing CPU counters before computing slopes", () => {
	const first = ["2026-09-07T00:00:00Z", 0, 10, 1, 104857600, 104857600, 30, 4, 10, 20, 1, 0, 0, "", 209715200, 209715200, 50, 9, 100];
	const last = ["2026-09-07T00:01:00Z", 60000, 10, 1, 104857600, 104857600, 30, 4, 11, 20, 1, 0, 0, "", 157286400, 157286400, 40, 9, 1];
	const output = summary(HEADER, [first, last]);
	assert.match(output, /Host avg CPU, same host PID \| n\/a/);
	assert.match(output, /Host RSS slope, host PID 20 \(1 samples\) \| n\/a/);
	// A reused PID can accumulate MORE CPU before the next sample. The
	// creation timestamp, rather than the counter alone, separates lifetimes.
	last[18] = 200;
	const lifetime = summary(`${HEADER},pluginStartedMs,sdStartedMs,sdMatches`, [
		[...first, 1000, 1000, 1], [...last, 1000, 2000, 1]
	]);
	assert.match(lifetime, /Host avg CPU, same host PID \| n\/a/);
});
