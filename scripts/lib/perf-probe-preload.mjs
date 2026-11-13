// In-process sampler the perf harness loads into the plugin under test with
// `node --import <this file> bin/plugin.js ...`. It never touches the
// plugin's code or its socket: once a second it appends one JSON line to
// the file named by HWINFO_PERF_PROBE_OUT with
//
//   at      Date.now() (the harness selects its window by wall clock)
//   cpu     process.cpuUsage() cumulative user/system microseconds
//   mem     process.memoryUsage() (rss, heapTotal, heapUsed, external, arrayBuffers)
//   elu     performance.eventLoopUtilization() cumulative idle/active ms
//   gc      the collections since the previous line from v8.GCProfiler:
//           count, summed cost (microseconds), and the heap used before and
//           after each one, from which the harness estimates allocation
//   heapUsedNow  v8 used heap size at the sample
//
// Its own cost (a timer, one GCProfiler restart and one small append a
// second) is the same for every subject, so it cancels in a comparison.
// Without HWINFO_PERF_PROBE_OUT it does nothing.
import fs from "node:fs";
import { performance } from "node:perf_hooks";
import v8 from "node:v8";

const out = process.env.HWINFO_PERF_PROBE_OUT;
const everyMs = Number(process.env.HWINFO_PERF_PROBE_MS ?? "") || 1000;

if (out) {
	let profiler = typeof v8.GCProfiler === "function" ? new v8.GCProfiler() : null;
	profiler?.start();
	const sample = () => {
		let gcs = [];
		if (profiler !== null) {
			const data = profiler.stop();
			gcs = (data?.statistics ?? []).map((s) => ({
				cost: s.cost,
				before: s.beforeGC?.heapStatistics?.usedHeapSize ?? null,
				after: s.afterGC?.heapStatistics?.usedHeapSize ?? null
			}));
			profiler = new v8.GCProfiler();
			profiler.start();
		}
		const line = {
			at: Date.now(),
			cpu: process.cpuUsage(),
			mem: process.memoryUsage(),
			elu: performance.eventLoopUtilization(),
			heapUsedNow: v8.getHeapStatistics().used_heap_size,
			gc: gcs
		};
		try {
			fs.appendFileSync(out, `${JSON.stringify(line)}\n`);
		} catch {
			// The harness reads what landed; a failed append is a missing line.
		}
	};
	sample();
	setInterval(sample, everyMs).unref();
}
