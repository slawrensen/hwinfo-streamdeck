/**
 * Cycle-exact CPU of another process on Windows (QueryProcessCycleTime),
 * for the perf harness. GetProcessTimes (process.cpuUsage, Get-Process
 * TotalProcessorTime) charges CPU in 15.6 ms clock ticks, which at the
 * plugin's 0.1 to 1 % of a core is a handful of ticks per minute and
 * mostly noise; the cycle counter counts every cycle the process's
 * threads ran. The reference rate is calibrated against this thread's own
 * cycle counter over a timed spin, so cycles convert to seconds of one
 * core.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const koffi = require("koffi");
const k32 = koffi.load("kernel32.dll");
const OpenProcess = k32.func("__stdcall", "OpenProcess", "void*", ["uint32", "int32", "uint32"]);
const QueryProcessCycleTime = k32.func("__stdcall", "QueryProcessCycleTime", "int32", ["void*", koffi.out(koffi.pointer("uint64"))]);
const QueryThreadCycleTime = k32.func("__stdcall", "QueryThreadCycleTime", "int32", ["void*", koffi.out(koffi.pointer("uint64"))]);
const GetCurrentThread = k32.func("__stdcall", "GetCurrentThread", "void*", []);
const CloseHandle = k32.func("__stdcall", "CloseHandle", "int32", ["void*"]);
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

function threadCycles() {
	const out = [0n];
	QueryThreadCycleTime(GetCurrentThread(), out);
	return BigInt(out[0]);
}

/** Cycles per second of the counter: the best of three 250 ms spins
 * (a preempted spin under-counts, never over-counts). */
export function calibrateCycleHz() {
	let best = 0;
	for (let i = 0; i < 3; i++) {
		const t0 = process.hrtime.bigint();
		const c0 = threadCycles();
		while (process.hrtime.bigint() - t0 < 250_000_000n) {
			// spin
		}
		const c1 = threadCycles();
		const t1 = process.hrtime.bigint();
		best = Math.max(best, Number(c1 - c0) / (Number(t1 - t0) / 1e9));
	}
	return best;
}

/** A reader for one PID: read() returns the cumulative cycle count, or
 * null once the process is gone; close() releases the handle. */
export function openCycleReader(pid) {
	const handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
	if (handle === null) return null;
	return {
		read() {
			const out = [0n];
			return QueryProcessCycleTime(handle, out) === 0 ? null : Number(out[0]);
		},
		close() {
			CloseHandle(handle);
		}
	};
}
