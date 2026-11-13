// Synthetic large-catalog HWiNFO Shared Memory producer for the perf
// harness (scripts/perf-plugin.mjs): a REAL named file mapping + mutex in
// the classic 264/316 layout carrying the catalog of
// scripts/lib/perf-catalog.mjs (default 25 sensors x 24 readings = 600),
// republished every --period ms with a new poll stamp and deterministic
// values (every fifth reading holds still).
//
//   env  HWINFO_SM2_NAME / HWINFO_SM2_MUTEX_NAME   mapping and mutex names
//   argv --sensors <n> --per-sensor <m> --period <ms>
//
// stdin: "exit" unmaps, closes the handles and quits.
// Prints "READY <mappingName> <readings>" once the mapping exists.
// Synthetic: it proves the plugin's side under a fixed load, not HWiNFO.
import { createRequire } from "node:module";
import readline from "node:readline";
import { catalogMappingSize, catalogReadings, composeCatalog } from "./lib/perf-catalog.mjs";

const require = createRequire(import.meta.url);
const koffi = require("koffi");

const arg = (flag, fallback) => {
	const i = process.argv.indexOf(flag);
	return i === -1 ? fallback : Number(process.argv[i + 1]);
};
const MAPPING_NAME = process.env.HWINFO_SM2_NAME ?? `Local\\HwinfoPerfCatalog_${process.pid}`;
const MUTEX_NAME = process.env.HWINFO_SM2_MUTEX_NAME ?? `${MAPPING_NAME}_MUTEX`;
const readings = catalogReadings({ sensors: arg("--sensors", 25), perSensor: arg("--per-sensor", 24) });
const PERIOD_MS = arg("--period", 1000);
const SIZE = catalogMappingSize(readings);

const k32 = koffi.load("kernel32.dll");
const CreateFileMappingW = k32.func("__stdcall", "CreateFileMappingW", "void*", ["int64", "void*", "uint32", "uint32", "uint32", "str16"]);
// bInitialOwner is a Win32 BOOL: int32 with an explicit 0 (see fake-hwinfo.mjs).
const CreateMutexW = k32.func("__stdcall", "CreateMutexW", "void*", ["void*", "int32", "str16"]);
const MapViewOfFile = k32.func("__stdcall", "MapViewOfFile", "void*", ["void*", "uint32", "uint32", "uint32", "size_t"]);
const UnmapViewOfFile = k32.func("__stdcall", "UnmapViewOfFile", "bool", ["void*"]);
const CloseHandle = k32.func("__stdcall", "CloseHandle", "bool", ["void*"]);
const WaitForSingleObject = k32.func("__stdcall", "WaitForSingleObject", "uint32", ["void*", "uint32"]);
const ReleaseMutex = k32.func("__stdcall", "ReleaseMutex", "bool", ["void*"]);
const RtlMoveMemory = k32.func("__stdcall", "RtlMoveMemory", "void", ["void*", "uint8*", "size_t"]);

const hMap = CreateFileMappingW(-1n, null, 0x04, 0, SIZE, MAPPING_NAME);
if (hMap === null) {
	console.error("fake-hwinfo-catalog: CreateFileMappingW failed");
	process.exit(1);
}
const hMutex = CreateMutexW(null, 0, MUTEX_NAME);
const view = MapViewOfFile(hMap, 0x0002, 0, 0, 0);
if (view === null) {
	console.error("fake-hwinfo-catalog: MapViewOfFile failed");
	process.exit(1);
}

const buf = Buffer.alloc(SIZE);
let tick = 0;
let pollTimeS = Math.floor(Date.now() / 1000);

function publish() {
	composeCatalog(buf, readings, tick, pollTimeS);
	WaitForSingleObject(hMutex, 1000);
	try {
		RtlMoveMemory(view, buf, SIZE);
	} finally {
		ReleaseMutex(hMutex);
	}
}

publish();
console.log(`READY ${MAPPING_NAME} ${readings.length}`);

const timer = setInterval(() => {
	tick += 1;
	// A stamp that always moves forward, even at sub-second periods.
	pollTimeS = Math.max(pollTimeS + 1, Math.floor(Date.now() / 1000));
	publish();
}, PERIOD_MS);

readline.createInterface({ input: process.stdin }).on("line", (line) => {
	if (line.trim() === "exit") {
		clearInterval(timer);
		UnmapViewOfFile(view);
		CloseHandle(hMap);
		CloseHandle(hMutex);
		console.log("CLOSED");
		process.exit(0);
	}
});
