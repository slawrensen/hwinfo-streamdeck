// Classifies how each shipped native binary moved between two releases,
// from their release-native-manifest.json files (and, for a previous
// release whose manifest predates the toolchain record, the previous
// binaries themselves). Pure; scripts/native-drift.mjs is the command.
//
// Classes, per binary:
// - identical          same bytes (the unsigned identity when one is recorded)
// - new-binary         the previous release did not ship it
// - source-changed     the native source id moved: different bytes expected
// - toolchain-changed  same source, different recorded inputs: the record
//                      names every input that moved (a library, a tool, the
//                      SDK servicing build, the Node headers, a command line)
// - unexplained        same source, same recorded inputs, different bytes:
//                      the record missed an input, or the build is not
//                      deterministic. This is the one class that fails.
// - legacy-previous    same source, different bytes, and the previous
//                      manifest carries no toolchain record (1.7.1 and
//                      earlier): explained as far as the binaries allow
//                      (which sections and import hints moved)
// - unrecorded         same source, different bytes, and this build carries
//                      no toolchain record to compare
//
// A previous release that carried a binary forward (its record has
// `reproducibility.carriedFrom`) recorded the toolchain of its rebuild, not
// of the shipped bytes, so the comparison for that binary is against the
// rebuild (`reproducibility.rebuiltSha256`): equal is identical, and the
// toolchain classes above apply to the rebuild.
import { parsePe } from "./pe.mjs";

/** The per-binary records of a manifest: `binaries` of a version 2
 * manifest, or the version 1 top level, which describes hwsm.node. */
export function binariesOf(manifest) {
	if (Array.isArray(manifest?.binaries)) return manifest.binaries;
	if (typeof manifest?.sha256 === "string") return [{ ...manifest, file: typeof manifest.file === "string" ? manifest.file : "hwsm.node" }];
	return [];
}

const identityOf = (record) => record.unsignedSha256 ?? record.sha256;
const short = (hex) => (typeof hex === "string" ? hex.slice(0, 12) : String(hex));

/** What moved between two PE fact sets ({ sections, importHints,
 * headersNeutralSha256 }, from a manifest record or parsePe()). */
export function peDelta(previous, current) {
	const before = new Map((previous.sections ?? []).map((s) => [s.name, s.sha256]));
	const after = new Map((current.sections ?? []).map((s) => [s.name, s.sha256]));
	const sections = { equal: [], differ: [], added: [], removed: [] };
	for (const [name, hash] of after) {
		if (!before.has(name)) sections.added.push(name);
		else if (before.get(name) === hash) sections.equal.push(name);
		else sections.differ.push(name);
	}
	for (const name of before.keys()) if (!after.has(name)) sections.removed.push(name);
	const imports = [];
	const dlls = new Set([...Object.keys(previous.importHints ?? {}), ...Object.keys(current.importHints ?? {})]);
	for (const dll of dlls) {
		const a = previous.importHints?.[dll] ?? {};
		const b = current.importHints?.[dll] ?? {};
		const added = Object.keys(b).filter((name) => !(name in a));
		const removed = Object.keys(a).filter((name) => !(name in b));
		const shifts = Object.keys(a).filter((name) => name in b && a[name] !== null && b[name] !== null).map((name) => b[name] - a[name]);
		const moved = shifts.filter((delta) => delta !== 0).length;
		const uniform = shifts.length > 0 && shifts.every((delta) => delta === shifts[0]) ? shifts[0] : null;
		imports.push({ dll, names: Object.keys(b).length, moved, uniformShift: uniform, added, removed });
	}
	const headers = previous.headersNeutralSha256 && current.headersNeutralSha256 ? (previous.headersNeutralSha256 === current.headersNeutralSha256 ? "equal" : "differ") : "unknown";
	return { sections, imports, headers };
}

/** One line for a PE delta. */
export function describePeDelta(delta) {
	const parts = [];
	if (delta.sections.differ.length > 0) parts.push(`sections ${delta.sections.differ.join(", ")} differ (${delta.sections.equal.join(", ") || "none"} equal)`);
	else parts.push("every section equal");
	if (delta.sections.added.length > 0) parts.push(`sections added: ${delta.sections.added.join(", ")}`);
	if (delta.sections.removed.length > 0) parts.push(`sections removed: ${delta.sections.removed.join(", ")}`);
	for (const entry of delta.imports) {
		if (entry.moved > 0) parts.push(`${entry.dll} import hints ${entry.uniformShift !== null ? `shifted ${entry.uniformShift > 0 ? "+" : ""}${entry.uniformShift}` : "changed"} (${entry.moved} of ${entry.names} names)`);
		if (entry.added.length > 0) parts.push(`${entry.dll} imports added: ${entry.added.join(", ")}`);
		if (entry.removed.length > 0) parts.push(`${entry.dll} imports removed: ${entry.removed.join(", ")}`);
	}
	if (delta.imports.every((entry) => entry.moved === 0 && entry.added.length === 0 && entry.removed.length === 0)) parts.push("import hints unchanged");
	parts.push(`headers ${delta.headers}`);
	return parts.join("; ");
}

/** Every recorded input of `file` that moved between two toolchain records,
 * one readable line each. */
export function toolchainChanges(previous, current, file) {
	const lines = [];
	const field = (label, a, b) => {
		if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) lines.push(`${label} ${JSON.stringify(a ?? null)} -> ${JSON.stringify(b ?? null)}`);
	};
	field("runner image", previous.runnerImage?.version, current.runnerImage?.version);
	field("Visual Studio", previous.vsInstance?.version, current.vsInstance?.version);
	field("MSVC tools", previous.msvc?.toolsVersion, current.msvc?.toolsVersion);
	field("cl.exe", previous.msvc?.clFileVersion, current.msvc?.clFileVersion);
	field("link.exe", previous.msvc?.linkFileVersion, current.msvc?.linkFileVersion);
	field("Windows SDK", previous.windowsSdk?.targetPlatformVersion, current.windowsSdk?.targetPlatformVersion);
	field("Windows SDK servicing build", previous.windowsSdk?.servicingVersion, current.windowsSdk?.servicingVersion);
	field("Node headers", previous.nodeHeaders?.version, current.nodeHeaders?.version);
	field("node.lib", short(previous.nodeHeaders?.nodeLibSha256), short(current.nodeHeaders?.nodeLibSha256));
	field("Node header tree", short(previous.nodeHeaders?.headersDigest), short(current.nodeHeaders?.headersDigest));
	field("common.gypi", short(previous.nodeHeaders?.commonGypiSha256), short(current.nodeHeaders?.commonGypiSha256));
	field("node-gyp", previous.nodeGyp?.version, current.nodeGyp?.version);
	field("node-gyp addon.gypi", short(previous.nodeGyp?.addonGypiSha256), short(current.nodeGyp?.addonGypiSha256));
	field("node-gyp delay-load hook", short(previous.nodeGyp?.delayLoadHookSha256), short(current.nodeGyp?.delayLoadHookSha256));
	field("compiler environment", previous.env, current.env);
	const fileMap = (list) => new Map((list ?? []).map((entry) => [`${entry.root}/${entry.path}`, entry]));
	const compare = (kind, a, b) => {
		for (const [key, entry] of b) {
			const before = a.get(key);
			if (before === undefined) lines.push(`${kind} added: ${key} ${short(entry.sha256)}`);
			else if (before.sha256 !== entry.sha256) lines.push(`${key} ${short(before.sha256)} -> ${short(entry.sha256)}${before.fileVersion !== entry.fileVersion && (before.fileVersion || entry.fileVersion) ? ` (${before.fileVersion ?? "?"} -> ${entry.fileVersion ?? "?"})` : ""}`);
		}
		for (const key of a.keys()) if (!b.has(key)) lines.push(`${kind} removed: ${key}`);
	};
	compare("tool", fileMap(previous.tools), fileMap(current.tools));
	const before = previous.binaries?.[file];
	const after = current.binaries?.[file];
	compare("input", fileMap(before?.inputs), fileMap(after?.inputs));
	if (before?.commandLinesDigest !== after?.commandLinesDigest) {
		for (const tool of ["cl", "link", "rc"]) {
			if (JSON.stringify(before?.commandLines?.[tool] ?? []) !== JSON.stringify(after?.commandLines?.[tool] ?? [])) lines.push(`${tool} command line changed`);
		}
		if (!lines.some((line) => line.endsWith("command line changed"))) lines.push("command lines changed");
	}
	return lines;
}

/**
 * Classifies every binary the current manifest describes against the
 * previous manifest. `previousPe` maps a file name to PE facts of the
 * previous binary (parsePe() output) for a previous manifest that records
 * none. Returns { results: [{ file, class, reasons, pe }], failed }.
 */
export function classifyDrift({ previous, current, previousPe = new Map() }) {
	const before = new Map(binariesOf(previous).map((record) => [record.file, record]));
	const results = [];
	for (const record of binariesOf(current)) {
		const prior = before.get(record.file);
		const result = { file: record.file, class: "", reasons: [], pe: null, previousSha256: prior ? identityOf(prior) : null, currentSha256: identityOf(record) };
		results.push(result);
		if (prior === undefined) {
			result.class = "new-binary";
			result.reasons.push("the previous release did not ship it");
			continue;
		}
		if (identityOf(prior) === identityOf(record)) {
			result.class = "identical";
			continue;
		}
		if (prior.nativeSourceId !== record.nativeSourceId || prior.nativeVersion !== record.nativeVersion) {
			result.class = "source-changed";
			result.reasons.push(`native source id ${prior.nativeSourceId} -> ${record.nativeSourceId}${prior.nativeVersion !== record.nativeVersion ? `, native version ${prior.nativeVersion} -> ${record.nativeVersion}` : ""}`);
			continue;
		}
		// The previous release shipped a binary carried forward from an
		// earlier one (scripts/lib/native-carry-forward.mjs): its toolchain
		// record describes that run's rebuild, not the shipped bytes, so the
		// rebuild is what this build is compared with.
		const carried = typeof prior.reproducibility?.rebuiltSha256 === "string" && prior.reproducibility?.carriedFrom ? prior.reproducibility : null;
		if (carried !== null) {
			result.reasons.push(`the previous release shipped ${short(identityOf(prior))}, carried forward from ${carried.carriedFrom.firstShippedIn ?? carried.carriedFrom.release}; compared with that release's rebuild ${short(carried.rebuiltSha256)}`);
			result.previousSha256 = carried.rebuiltSha256;
			if (carried.rebuiltSha256 === identityOf(record)) {
				result.class = "identical";
				continue;
			}
		}
		const priorPe = carried !== null ? null : prior.sections ? prior : previousPe.get(record.file) ?? null;
		if (priorPe && record.sections) result.pe = peDelta(priorPe, record);
		const priorToolchain = previous?.toolchain?.binaries?.[record.file] ? previous.toolchain : null;
		const currentToolchain = current?.toolchain?.binaries?.[record.file] ? current.toolchain : null;
		if (currentToolchain === null) {
			result.class = "unrecorded";
			result.reasons.push("this build carries no toolchain record to explain the move");
		} else if (priorToolchain === null) {
			result.class = "legacy-previous";
			result.reasons.push("the previous manifest carries no toolchain record");
			if (prior.compilerVersion !== undefined || prior.windowsSdkVersion !== undefined) {
				result.reasons.push(`previous compiler ${prior.compilerVersion ?? "unknown"}, SDK ${prior.windowsSdkVersion ?? "unknown"}; this build MSVC ${currentToolchain.msvc?.toolsVersion} (cl ${currentToolchain.msvc?.clFileVersion}), SDK ${currentToolchain.windowsSdk?.targetPlatformVersion} servicing ${currentToolchain.windowsSdk?.servicingVersion ?? "unknown"}`);
			}
			if (result.pe === null) result.reasons.push("no previous binary was available to compare sections and imports");
		} else if (priorToolchain.binaries[record.file].inputsDigest !== currentToolchain.binaries[record.file].inputsDigest) {
			result.class = "toolchain-changed";
			result.reasons.push(...toolchainChanges(priorToolchain, currentToolchain, record.file));
		} else {
			result.class = "unexplained";
			result.reasons.push(`same native source id ${record.nativeSourceId} and the same recorded inputs (inputsDigest ${short(currentToolchain.binaries[record.file].inputsDigest)}), yet the bytes moved: the record misses an input or the build is not deterministic`);
		}
	}
	const removed = [...before.keys()].filter((file) => !binariesOf(current).some((record) => record.file === file));
	return { results, removed, failed: results.some((result) => result.class === "unexplained") };
}

/** PE facts for each native member of a previous binary set. */
export function peFactsOf(buffers) {
	const out = new Map();
	for (const [file, bytes] of buffers) out.set(file, parsePe(bytes));
	return out;
}

/** The markdown summary the release run shows. */
export function renderDriftMarkdown(report, { previousLabel = "previous release", currentLabel = "this build" } = {}) {
	const lines = [`### Native drift: ${currentLabel} against ${previousLabel}`, "", "| Binary | Class | Previous | This build |", "|---|---|---|---|"];
	for (const result of report.results) lines.push(`| ${result.file} | ${result.class} | ${result.previousSha256 ? `\`${short(result.previousSha256)}\`` : "none"} | \`${short(result.currentSha256)}\` |`);
	for (const file of report.removed) lines.push(`| ${file} | removed | | |`);
	for (const result of report.results) {
		if (result.reasons.length === 0 && result.pe === null) continue;
		lines.push("", `**${result.file}** (${result.class})`, "");
		for (const reason of result.reasons) lines.push(`- ${reason}`);
		if (result.pe !== null) lines.push(`- binary: ${describePeDelta(result.pe)}`);
	}
	return `${lines.join("\n")}\n`;
}
