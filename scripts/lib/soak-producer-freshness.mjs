// External read-only freshness proof for the real fault driver. Opening a
// provider or logging "shared-memory" never substitutes for advancing data.
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { performance } from "node:perf_hooks";

const require = createRequire(import.meta.url);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const message = (err) => err instanceof Error ? err.message : String(err);

export function candidateNativeContract(repoRoot) {
	const native = path.join(repoRoot, "native", "hwsm");
	const version = fs.readFileSync(path.join(native, "hwsm-version.h"), "utf8");
	const loader = fs.readFileSync(path.join(repoRoot, "src", "hwinfo", "hwsm-loader.ts"), "utf8");
	const protocolVersion = Number(/export const HWSM_PROTOCOL_VERSION = (\d+);/.exec(loader)?.[1]);
	const nativeProtocol = Number(/^#define HWSM_PROTOCOL_VERSION (\d+)$/m.exec(version)?.[1]);
	const nativeVersion = /^#define HWSM_NATIVE_VERSION_STR "([^"]+)"$/m.exec(version)?.[1];
	if (!Number.isSafeInteger(protocolVersion) || protocolVersion < 1 || nativeProtocol !== protocolVersion || !nativeVersion) {
		throw new Error("Candidate native contract cannot be established");
	}
	const hash = createHash("sha256");
	for (const name of ["hwsm.c", "hwsm.rc", "hwsm-version.h", "binding.gyp"]) {
		hash.update(name); hash.update("\0"); hash.update(fs.readFileSync(path.join(native, name))); hash.update("\0");
	}
	return { protocolVersion, napiVersion: 8, architecture: "x64", nativeVersion, nativeSourceId: hash.digest("hex").slice(0, 16) };
}

/** Only this exact installed addon is loaded. The candidate hash and build
 * contract are checked before opening a session, on every proof attempt. */
export function createInstalledProducerCheck({ addonPath, expectedSha256, expectedBuild,
	loadAddon = require, readBytes = fs.readFileSync, ...sampling }) {
	if (!path.isAbsolute(addonPath) || !/^[a-f0-9]{64}$/.test(expectedSha256 ?? "")) throw new Error("Missing exact installed addon identity");
	return async () => {
		if (sha256(readBytes(addonPath)) !== expectedSha256) throw new Error("Installed native addon hash changed; refusing freshness proof");
		const addon = loadAddon(addonPath);
		if (!addon || typeof addon.getBuildInfo !== "function" || typeof addon.openSharedMemory !== "function" || typeof addon.openGadgetKey !== "function") {
			throw new Error("Installed addon is missing the production capability API");
		}
		const buildInfo = addon.getBuildInfo();
		for (const field of ["protocolVersion", "napiVersion", "architecture", "nativeVersion", "nativeSourceId"]) {
			if (buildInfo?.[field] !== expectedBuild[field]) throw new Error(`Installed addon ${field} differs from the candidate contract`);
		}
		const proof = await sampleAdvancingProducer(() => addon.openSharedMemory("Global\\HWiNFO_SENS_SM2", "Global\\HWiNFO_SM2_MUTEX"), sampling);
		return { addonPath, addonSha256: expectedSha256, buildInfo, ...proof };
	};
}

/** Native open/read validate the mapped header under the real producer's
 * consistency mutex. Keep only timestamp evidence, never sensor contents.
 * Busy attempts skip a sample within the same deadline; partial/error reads
 * fail this proof. A busy read never contributes bytes or freshness. */
export async function sampleAdvancingProducer(open, { monotonicNow = () => performance.now(), wallNow = Date.now,
	wait = sleep, timeoutMs = 10_000, intervalMs = 500, maxAgeMs = 15_000 } = {}) {
	if (![timeoutMs, intervalMs, maxAgeMs].every((n) => Number.isFinite(n) && n > 0) || intervalMs > timeoutMs) throw new Error("Invalid freshness timing bounds");
	const began = monotonicNow();
	const deadline = began + timeoutMs;
	const proof = { startedUtc: new Date(wallNow()).toISOString(), samples: [], busySkips: [] };
	let session;
	let failure;
	let failed = false;
	let success;
	const bounded = () => {
		if (monotonicNow() >= deadline) throw new Error("Producer did not advance before the monotonic freshness deadline");
	};
	const recordBusy = (attempt) => proof.busySkips.push({ ...attempt, observedUtc: new Date(wallNow()).toISOString(), elapsedMs: monotonicNow() - began });
	const waitNext = async () => {
		bounded();
		await wait(Math.min(intervalMs, deadline - monotonicNow()));
	};
	try {
		for (;;) {
			bounded();
			try { session = open(); break; }
			catch (err) {
				bounded();
				if (err?.code !== "HWSM_MUTEX_BUSY") throw err;
				recordBusy({ stage: "open", code: err.code });
				await waitNext();
			}
		}
		bounded();
		if (!session || typeof session.readInto !== "function" || typeof session.close !== "function" ||
			!Number.isSafeInteger(session.byteLength) || session.byteLength < 44 || session.byteLength > 64 * 1024 * 1024) throw new Error("Invalid native shared-memory session");
		const bytes = Buffer.alloc(session.byteLength);
		let first = null;
		for (;;) {
			bounded();
			const copied = session.readInto(bytes);
			bounded();
			if (copied === 0) {
				recordBusy({ stage: "read", copied });
				await waitNext();
				continue;
			}
			if (copied !== bytes.length) throw new Error(`Shared-memory read incomplete: ${copied}/${bytes.length}`);
			const rawTime = bytes.readBigInt64LE(12);
			if (rawTime <= 0n || rawTime > BigInt(Math.floor(Number.MAX_SAFE_INTEGER / 1000))) throw new Error("Invalid producer poll timestamp");
			const pollTime = Number(rawTime);
			const now = wallNow();
			const ageMs = now - pollTime * 1000;
			if (ageMs < 0 || ageMs > maxAgeMs) throw new Error(`Producer timestamp is ${ageMs < 0 ? "in the future" : "stale"}: age ${ageMs} ms`);
			proof.samples.push({ observedUtc: new Date(now).toISOString(), pollTime, ageMs, elapsedMs: monotonicNow() - began });
			if (first !== null && pollTime < first) throw new Error("Producer timestamp moved backwards during freshness proof");
			if (first !== null && pollTime > first) {
				bounded();
				success = { ...proof, completedUtc: new Date(wallNow()).toISOString(), elapsedMs: monotonicNow() - began, verdict: "advancing-shared-memory" };
				break;
			}
			first = pollTime;
			await waitNext();
		}
	} catch (err) {
		failure = err;
		failed = true;
	} finally {
		if (typeof session?.close === "function") {
			try { session.close(); }
			catch (err) {
				failure = new Error(`Freshness session close failed: ${message(err)}${failed ? `; prior failure: ${message(failure)}` : ""}`);
				failed = true;
			}
		}
	}
	if (failed) {
		if (failure instanceof Error) failure.freshnessEvidence = proof;
		throw failure;
	}
	return success;
}

/** The production event entry point has mandatory evidence on both sides.
 * A rejected precheck never invokes the fault; a rejected postcheck cannot
 * leave the event PASS, even if all stock-log markers looked healthy. */
export async function runWithAdvancingProducer(runEvent, check) {
	const before = await check();
	let result;
	try { result = await runEvent(); }
	catch (err) { result = { verdict: "FAIL", detail: `Fault failed: ${message(err)}`, lines: [] }; }
	try {
		const after = await check();
		return { ...result, producerFreshness: { before, after } };
	} catch (err) {
		return { ...result, verdict: "FAIL", detail: `After-event producer freshness failed: ${message(err)}`, producerFreshness: { before, afterFailure: { message: message(err), evidence: err?.freshnessEvidence } } };
	}
}
