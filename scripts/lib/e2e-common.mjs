/**
 * The shared e2e harness kit: the check/sleep/frame/decode pieces every
 * mock-app script used to carry as its own copy. Lifted byte-faithful from
 * those copies (the PASS/FAIL line format is part of the suite's output
 * contract), parameterized only where the copies genuinely diverged: the
 * failure sink (an errors array in the big harnesses, a counter in the
 * fault-injection family) and the frames array expectFrame scans.
 */
import { execSync } from "node:child_process";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The one check line. `onFail` is the script's failure sink: pass
 * `(name) => results.errors.push(name)` or `() => { failures += 1; }`. */
export function makeCheck(onFail) {
	return function check(name, ok, detail = "") {
		console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
		if (!ok) {
			onFail(name);
		}
	};
}

/** A setImage payload's SVG text, or null for anything else. */
export function decodeSvg(image) {
	if (typeof image !== "string" || !image.startsWith("data:image/svg+xml,")) {
		return null;
	}
	return decodeURIComponent(image.slice("data:image/svg+xml,".length));
}

/** The newest decoded SVG a context has received. `pick` reads the image
 * string off one entry (default: the { context, svg } shape). */
export function latestSvg(entries, context, pick = (e) => e.svg) {
	return entries.filter((e) => e.context === context).map((e) => decodeSvg(pick(e))).filter((s) => s !== null).at(-1);
}

/**
 * An expectFrame bound to one frames array and one check: waits until a
 * frame arriving from `from` on matches, or times out. `fromStart` scans
 * the whole history (a one-shot startup screen renders exactly once, so a
 * leg asserting on it must not start at the live tail).
 */
export function makeExpectFrame(frames, check) {
	return async function expectFrame(name, predicate, timeoutMs, { fromStart = false } = {}) {
		const start = Date.now();
		let from = fromStart ? 0 : frames.length;
		while (Date.now() - start < timeoutMs) {
			while (from < frames.length) {
				if (predicate(frames[from])) {
					check(name, true, `after ${((Date.now() - start) / 1000).toFixed(1)}s`);
					return;
				}
				from++;
			}
			await sleep(150);
		}
		check(name, false, `no matching frame within ${timeoutMs / 1000}s (last: ${frames.at(-1)?.slice(0, 160) ?? "none"})`);
	};
}

/** The registration info skeleton every script shares; only the device
 * list (and rarely the plugin identity) differs. */
export function buildInfo({ devices, plugin = { uuid: "com.lawrensen.hwinfo", version: "1.0.0.0" } }) {
	return {
		application: { font: "Segoe UI", language: "en", platform: "windows", platformVersion: "10.0.19044", version: "7.4.2.22730" },
		colors: {},
		devicePixelRatio: 1,
		devices,
		plugin
	};
}

/** The argv every script hands the plugin process. */
export function pluginArgv(port, uuid, info) {
	return ["bin/plugin.js", "-port", String(port), "-pluginUUID", uuid, "-registerEvent", "registerPlugin", "-info", JSON.stringify(info)];
}

/** The Gadget-registry write/delete pair the fallback suites publish with. */
export function regSet(regPath, name, value) {
	execSync(`reg add "${regPath}" /v ${name} /t REG_SZ /d "${value}" /f`, { stdio: "ignore" });
}

export function regDeleteKey(regPath) {
	execSync(`reg delete "${regPath}" /f`, { stdio: "ignore" });
}

/**
 * Polls `predicate` until truthy or the deadline, returning whether it was
 * met. Converted fixed sleeps pass their old duration as the deadline, so
 * the worst case is identical to before and the usual case returns as soon
 * as the observable effect lands. Exactly-N and nothing-happened assertions
 * must NOT convert: they need the full window by definition.
 */
export async function waitUntil(predicate, timeoutMs, stepMs = 25) {
	const start = Date.now();
	for (;;) {
		if (predicate()) {
			return true;
		}
		if (Date.now() - start >= timeoutMs) {
			return false;
		}
		await sleep(stepMs);
	}
}
