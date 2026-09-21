// Isolated Windows publisher for the scaling harness. Fork with IPC and piped
// stdin, argv[2] = 16..8192 readings, and two unique Local\ object names in
// HWINFO_SM2_NAME / HWINFO_SM2_MUTEX_NAME. Importing this module loads no FFI.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Stable classic-layout identity, shared with the parent workload. */
export function readingKey(index) {
	if (!Number.isInteger(index) || index < 0 || index >= 8192) throw new RangeError("Reading index must be 0..8191");
	return `${(0xf0000001 + Math.floor(index / 32)).toString(16)}:0:${(0x1000001 + index).toString(16)}`;
}

function main() {
	let api;
	let mapping = null;
	let mutex = null;
	let view = null;
	let held = false;
	let stopping = false;

	function cleanup() {
		const failures = [];
		const attempt = (operation, fn, handle) => {
			try {
				if (!fn(handle)) failures.push(`${operation}: Win32 ${api.GetLastError()}`);
			} catch (error) { failures.push(`${operation}: ${String(error)}`); }
		};
		if (held) { attempt("ReleaseMutex", api.ReleaseMutex, mutex); held = false; }
		if (view !== null) { attempt("UnmapViewOfFile", api.UnmapViewOfFile, view); view = null; }
		if (mapping !== null) { attempt("CloseHandle(mapping)", api.CloseHandle, mapping); mapping = null; }
		if (mutex !== null) { attempt("CloseHandle(mutex)", api.CloseHandle, mutex); mutex = null; }
		return failures;
	}

	function finish(code, error) {
		if (stopping) return;
		stopping = true;
		const failures = cleanup();
		if (failures.length > 0) code = 1;
		const message = [error === undefined ? "" : String(error), ...failures].filter(Boolean).join("; ");
		if (code !== 0) console.error(message);
		const exit = () => process.exit(code);
		if (!process.connected || typeof process.send !== "function") { exit(); return; }
		// Only IPC shutdown is timed; publishing is entirely parent-driven.
		const deadline = setTimeout(exit, 2000);
		try {
			process.send(code === 0 ? { type: "stopped" } : { type: "error", message }, () => { clearTimeout(deadline); exit(); });
		} catch { clearTimeout(deadline); exit(); }
	}

	function send(message) {
		if (!process.connected) { finish(0); return; }
		try { process.send(message, (error) => { if (error) finish(1, error); }); }
		catch (error) { finish(1, error); }
	}

	process.on("disconnect", () => finish(0));
	process.stdin.on("end", () => finish(0));
	process.stdin.on("error", (error) => finish(1, error));
	process.on("uncaughtException", (error) => finish(1, error));
	process.on("unhandledRejection", (error) => finish(1, error));
	process.on("SIGINT", () => finish(1, "Publisher interrupted"));
	process.on("SIGTERM", () => finish(1, "Publisher terminated"));

	try {
		if (process.platform !== "win32") throw new Error("The scaling publisher requires Windows");
		if (typeof process.send !== "function" || !process.connected) throw new Error("The scaling publisher requires fork IPC");
		const count = Number(process.argv[2]);
		if (!Number.isInteger(count) || count < 16 || count > 8192) throw new RangeError("Inventory count must be 16..8192");
		const names = [process.env.HWINFO_SM2_NAME, process.env.HWINFO_SM2_MUTEX_NAME];
		for (const name of names) {
			if (typeof name !== "string" || !/^Local\\[A-Za-z0-9_.-]{1,200}$/.test(name) || /^Local\\HWiNFO_(?:SENS_SM2|SM2_MUTEX)$/i.test(name)) {
				throw new Error("Supply distinct unique Local\\ benchmark mapping and mutex names; production names are refused");
			}
		}
		if (names[0].toLowerCase() === names[1].toLowerCase()) throw new Error("Mapping and mutex names must differ");

		const koffi = createRequire(import.meta.url)("koffi");
		const kernel = koffi.load("kernel32.dll");
		const bind = (name, result, args) => kernel.func("__stdcall", name, result, args);
		api = {
			CreateFileMappingW: bind("CreateFileMappingW", "void*", ["int64", "void*", "uint32", "uint32", "uint32", "str16"]),
			CreateMutexW: bind("CreateMutexW", "void*", ["void*", "int32", "str16"]),
			MapViewOfFile: bind("MapViewOfFile", "void*", ["void*", "uint32", "uint32", "uint32", "size_t"]),
			UnmapViewOfFile: bind("UnmapViewOfFile", "int32", ["void*"]),
			CloseHandle: bind("CloseHandle", "int32", ["void*"]),
			WaitForSingleObject: bind("WaitForSingleObject", "uint32", ["void*", "uint32"]),
			ReleaseMutex: bind("ReleaseMutex", "int32", ["void*"]),
			RtlMoveMemory: bind("RtlMoveMemory", "void", ["void*", "uint8*", "size_t"]),
			GetLastError: bind("GetLastError", "uint32", []),
			SetLastError: bind("SetLastError", "void", ["uint32"])
		};
		const sensors = Math.ceil(count / 32);
		const entriesOffset = 44 + sensors * 264;
		const bytes = Buffer.alloc(entriesOffset + count * 316);
		for (const [offset, value] of [[0, 0x53695748], [4, 2], [8, 0], [20, 44], [24, 264], [28, sensors], [32, entriesOffset], [36, 316], [40, count]]) bytes.writeUInt32LE(value, offset);
		for (let i = 0; i < sensors; i++) {
			const offset = 44 + i * 264;
			bytes.writeUInt32LE(0xf0000001 + i, offset);
			bytes.write(`Scaling ${i}`, offset + 8, 127, "ascii");
			bytes.write(`Scaling ${i}`, offset + 136, 127, "ascii");
		}
		for (let i = 0; i < count; i++) {
			const offset = entriesOffset + i * 316;
			bytes.writeUInt32LE(3, offset); // SensorType.Fan
			bytes.writeUInt32LE(Math.floor(i / 32), offset + 4);
			bytes.writeUInt32LE(0x1000001 + i, offset + 8);
			bytes.write(`R${i}`, offset + 12, 127, "ascii");
			bytes.write(`R${i}`, offset + 140, 127, "ascii");
			bytes.write("RPM", offset + 268, 15, "ascii");
		}

		api.SetLastError(0);
		mutex = api.CreateMutexW(null, 0, names[1]);
		const mutexError = api.GetLastError();
		if (mutex === null || mutexError === 183) throw new Error(`Exclusive CreateMutexW failed: Win32 ${mutexError}`);
		api.SetLastError(0);
		mapping = api.CreateFileMappingW(-1n, null, 0x04, 0, bytes.length, names[0]);
		const mappingError = api.GetLastError();
		if (mapping === null || mappingError === 183) throw new Error(`Exclusive CreateFileMappingW failed: Win32 ${mappingError}`);
		view = api.MapViewOfFile(mapping, 0x0002, 0, 0, bytes.length);
		if (view === null) throw new Error(`MapViewOfFile failed: Win32 ${api.GetLastError()}`);

		function publish(generation) {
			const started = performance.now();
			for (let i = 0; i < count; i++) {
				const offset = entriesOffset + i * 316;
				for (const field of [284, 292, 300, 308]) bytes.writeDoubleLE(1000 + generation, offset + field);
			}
			const waitResult = api.WaitForSingleObject(mutex, 2000);
			if (waitResult !== 0 && waitResult !== 0x80) throw new Error(`WaitForSingleObject failed: result ${waitResult}, Win32 ${api.GetLastError()}`);
			held = true; // WAIT_ABANDONED also grants ownership; report it.
			bytes.writeBigInt64LE(BigInt(Math.floor(Date.now() / 1000)), 12);
			api.RtlMoveMemory(view, bytes, bytes.length);
			// Stamp after the copy while ownership still prevents any reader
			// observing it. writeMs also includes the subsequent mutex release.
			const publishedAt = Number(process.hrtime.bigint()) / 1e6;
			if (!api.ReleaseMutex(mutex)) throw new Error(`ReleaseMutex failed: Win32 ${api.GetLastError()}`);
			held = false;
			const finished = performance.now();
			return { generation, publishedAt, writeMs: finished - started, waitResult, abandoned: waitResult === 0x80 };
		}

		const initial = publish(0);
		process.on("message", (message) => {
			if (stopping) return;
			try {
				if (message?.type === "stop") { finish(0); return; }
				if (message?.type !== "publish" || !Number.isInteger(message.generation) || message.generation < 1 || message.generation > 8999) throw new Error("Expected stop or publish with generation 1..8999");
				send({ type: "published", ...publish(message.generation) });
			} catch (error) { finish(1, error); }
		});
		process.stdin.resume();
		send({ type: "ready", count, sensors, regionBytes: bytes.length, ...initial });
	} catch (error) { finish(1, error); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
