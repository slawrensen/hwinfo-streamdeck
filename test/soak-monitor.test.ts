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
const CURRENT = `${HEADER},pluginStartedMs,sdStartedMs,sdMatches`;

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

function observedRow(minute: number): (string | number)[] {
	return [
		new Date(minute * 60000).toISOString(), minute * 60000,
		10, 1, 104857600, 104857600, 30, 4, minute * 6,
		20, 1, 0, 0, "", 209715200, 209715200, 50, 9, minute * 3,
		1000, 1000, 1
	];
}

it("reports failed snapshots as unknown in current and historical CSVs", () => {
	for (const [header, columns] of [[LEGACY, 14], [HEADER, 19], [CURRENT, 22]] as const) {
		// Old collectors wrote zero counts on failure. The note is the only
		// evidence distinguishing those rows from an observed empty snapshot.
		const failed = [
			new Date(60000).toISOString(), 60000, "", 0, "", "", "", "", "", "",
			0, 0, 0, "snapshot-failed: Access denied (restart)", "", "", "", "", "", "", "", 0
		];
		const output = summary(header, [observedRow(0), failed, observedRow(2)].map((r) => r.slice(0, columns)));
		assert.match(output, /Unknown process snapshots \| 1 \|/);
		assert.match(output, /Plugin restarts \/ HWiNFO-absent samples \| 0 \/ 0 \|/);
		assert.match(output, /observation unknown.*snapshot-failed: Access denied/);
		assert.doesNotMatch(output, /process absent/);
		assert.match(output, /RSS slope, longest same-PID run \(1 samples/);
		assert.match(output, /Avg CPU, same run \| n\/a/);
		assert.match(output, /Host avg CPU, same host PID \| n\/a/);
	}
});

it("preserves confirmed absences without extending them through an unknown snapshot", () => {
	const absent = [new Date(60000).toISOString(), 60000, "", 0, "", "", "", "", "", "", 0, 0, 0, "host-unavailable", "", "", "", "", "", "", "", 0];
	const unknown = [...absent];
	unknown[0] = new Date(120000).toISOString();
	unknown[1] = 120000;
	unknown[10] = "";
	unknown[13] = "snapshot-failed: Timeout";
	const output = summary(CURRENT, [observedRow(0), absent, unknown]);
	assert.match(output, /Plugin restarts \/ HWiNFO-absent samples \| 0 \/ 1 \|/);
	assert.match(output, /Unknown process snapshots \| 1 \|/);
	assert.match(output, /plugin process absent before observation became unknown/);
	assert.doesNotMatch(output, /process absent through the end/);
	assert.match(output, /host-unavailable/);
});

it("emits scoped host restart and unavailable-observation events", () => {
	const reused = observedRow(1);
	reused[20] = 2000;
	const unavailable = observedRow(2);
	unavailable[9] = "";
	unavailable[13] = "host-ambiguous";
	for (let index = 14; index < 22; index++) unavailable[index] = "";
	const output = summary(CURRENT, [observedRow(0), reused, unavailable]);
	assert.match(output, /Stream Deck host PID 20: creation time changed \(restart\)/);
	assert.match(output, /Host restarts \| 1 \|/);
	assert.match(output, /Plugin restarts \/ HWiNFO-absent samples \| 0 \/ 0 \|/);
	assert.match(output, /Stream Deck host observation unavailable through the end/);
	assert.match(output, /host-ambiguous/);
	assert.doesNotMatch(output, /Stream Deck host process absent/);
	assert.equal(output.match(/creation time changed \(restart\)/g)?.length, 1);
});

it("does not bridge resource slopes or CPU averages across a sampling gap", () => {
	const output = summary(CURRENT, [0, 1, 2, 10, 11].map(observedRow));
	assert.match(output, /sampling gap of 480 s/);
	assert.match(output, /RSS slope, longest same-PID run \(3 samples/);
	assert.match(output, /Host RSS slope, host PID 20 \(3 samples\)/);
});
