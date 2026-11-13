// Carry-forward of unchanged native binaries. When a binary's native source
// id is the one the previous public release recorded for it, the release
// ships that release's exact unsigned binary instead of this run's
// rebuild. The toolset inside the pinned runner image moves with image
// updates, so unchanged source has rebuilt to different bytes before
// (1.5.1, 1.6.0, 1.7.1); keeping the shipped bytes keeps the hash that
// users, antivirus vendors and earlier false-positive reports already know.
// The rebuild still runs, passes every gate in the build job and stays as
// evidence: the manifest records its hash next to the carried one, and the
// drift check classifies it.
//
// A carried binary must be the one the previous release published: the
// member of its pack (which the workflow holds to the digest GitHub records
// for the asset) must hash to the previous manifest's sha256 and, with any
// signature taken off, to its unsigned build. It ships with the previous
// release's PDB, which must be the program database its CodeView record
// names. Anything short of that is a refusal, never a silent fallback to
// the rebuild: NATIVE_CARRY_FORWARD=off is the deliberate way to ship the
// rebuild instead.
//
// Pure, builtins only. scripts/native-carry-forward.mjs is the command.
import { createHash } from "node:crypto";
import { authenticodeNeutral, authenticodeStructureProblem, peLayout } from "./authenticode.mjs";
import { nativeBinary } from "./native-binaries.mjs";
import { binariesOf } from "./native-drift.mjs";
import { parsePe } from "./pe.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const short = (hex) => (typeof hex === "string" ? hex.slice(0, 12) : String(hex));
const MSF_MAGIC = Buffer.from("Microsoft C/C++ MSF 7.00\r\n\x1aDS\0\0\0", "latin1");
const PDB_INFO_VERSION_VC70 = 20000404;
/** The previous release's assets a carry rests on, besides the PDB. */
export const PREVIOUS_MANIFEST_ASSET = "release-native-manifest.json";
export const PREVIOUS_PACK_ASSET = "com.lawrensen.hwinfo.streamDeckPlugin";

/**
 * The NATIVE_CARRY_FORWARD repository variable: unset, empty or "on"
 * carries forward; "off" ships every rebuild. Anything else is null, so a
 * typo fails the run instead of silently picking a side.
 */
export function carryForwardMode(value) {
	if (value === undefined || value === null || value === "" || value === "on") return "on";
	if (value === "off") return "off";
	return null;
}

/** A CodeView GUID's in-memory (little-endian) bytes from the string form
 * scripts/lib/pe.mjs reports. */
export function guidBytes(text) {
	const hex = String(text).replaceAll("-", "");
	if (!/^[0-9A-Fa-f]{32}$/.test(hex)) throw new Error(`${JSON.stringify(text)} is not a GUID`);
	const b = Buffer.from(hex, "hex");
	return Buffer.concat([Buffer.from(b.subarray(0, 4)).reverse(), Buffer.from(b.subarray(4, 6)).reverse(), Buffer.from(b.subarray(6, 8)).reverse(), b.subarray(8, 16)]);
}

/**
 * Whether `pdb` is the program database a binary's CodeView record names:
 * an MSF 7.00 file whose PDB info stream (version 20000404, signature, age,
 * GUID) carries the record's GUID and age.
 */
export function pdbMatches(pdb, codeView) {
	if (codeView === null || codeView === undefined || pdb.length < MSF_MAGIC.length || !pdb.subarray(0, MSF_MAGIC.length).equals(MSF_MAGIC)) return false;
	const guid = guidBytes(codeView.guid);
	for (let at = pdb.indexOf(guid); at >= 0; at = pdb.indexOf(guid, at + 1)) {
		if (at >= 12 && pdb.readUInt32LE(at - 12) === PDB_INFO_VERSION_VC70 && pdb.readUInt32LE(at - 4) === codeView.age) return true;
	}
	return false;
}

/** The PDB file name a shipped binary links against (hwsm.node -> hwsm.pdb). */
export function pdbNameOf(file) {
	return `${nativeBinary(file)?.target ?? file.replace(/\.node$/, "")}.pdb`;
}

/**
 * Decides, for every binary this run built, whether the release ships the
 * previous release's binary.
 *
 *   current          this run's unsigned build manifest (version 2)
 *   rebuilt          Map file -> Buffer: this run's builds, which `current` describes
 *   previous         the previous release's manifest (version 1 or 2), or null
 *   previousLabel    its tag
 *   previousMembers  Map file -> Buffer: the native members of its pack
 *   previousPdbs     Map PDB file name -> Buffer: its PDB assets
 *   previousVerified Set of its asset names whose bytes matched the digest
 *                    GitHub records (the release step passes it; null skips
 *                    the check, for callers that verified otherwise)
 *   mode             "on" or "off" (carryForwardMode)
 *
 * Returns { problems, decisions, previous }. Each decision is { file,
 * decision: "carried" | "rebuilt", reason, bytes, pdb, record }: `bytes`
 * is the unsigned binary the release ships, `pdb` the previous release's
 * PDB for a carried binary (null: this run's), `record` what
 * carry-forward.json keeps. `previous` holds the previous release's
 * compiler and SDK facts, which describe a carried hwsm.node.
 */
export function planCarryForward({ current, rebuilt, previous = null, previousLabel = "the previous release", previousMembers = new Map(), previousPdbs = new Map(), previousVerified = null, mode }) {
	const problems = [];
	const decisions = [];
	if (mode !== "on" && mode !== "off") throw new Error(`carry-forward mode must be "on" or "off", not ${JSON.stringify(mode)}`);
	const records = binariesOf(current);
	if (!Array.isArray(current?.binaries) || records.length === 0) problems.push("this run's native manifest is not a version 2 manifest describing its binaries");
	const priors = new Map(binariesOf(previous).map((record) => [record.file, record]));
	for (const record of records) {
		const file = record.file;
		const built = rebuilt.get(file);
		if (built === undefined) {
			problems.push(`this run's ${file} is missing`);
			continue;
		}
		if (sha256(built) !== record.sha256) {
			problems.push(`this run's ${file} is ${short(sha256(built))}, its manifest records ${short(record.sha256)}`);
			continue;
		}
		const rebuild = (reason) => decisions.push({ file, decision: "rebuilt", reason, bytes: built, pdb: null, record: { decision: "rebuilt", reason, sha256: record.sha256 } });
		const prior = priors.get(file);
		if (mode === "off") {
			rebuild("NATIVE_CARRY_FORWARD is off");
			continue;
		}
		if (previous === null) {
			rebuild("there is no previous release to carry from");
			continue;
		}
		if (prior === undefined) {
			rebuild(`${previousLabel} did not ship it`);
			continue;
		}
		if (typeof prior.nativeSourceId !== "string" || typeof record.nativeSourceId !== "string") {
			rebuild(`${typeof prior.nativeSourceId !== "string" ? previousLabel : "this build"} records no native source id for it`);
			continue;
		}
		if (prior.nativeSourceId !== record.nativeSourceId) {
			rebuild(`its native source changed since ${previousLabel} (${prior.nativeSourceId} -> ${record.nativeSourceId})`);
			continue;
		}
		if (prior.nativeVersion !== record.nativeVersion) {
			rebuild(`its native version changed since ${previousLabel} (${prior.nativeVersion} -> ${record.nativeVersion})`);
			continue;
		}

		// Same source: ship the previous release's binary, or refuse.
		const before = problems.length;
		const member = previousMembers.get(file);
		if (member === undefined) {
			problems.push(`${previousLabel} shipped ${file} from native source ${record.nativeSourceId}, the source this build has, but its pack was not read or carries no bin/${file}`);
			continue;
		}
		const shipped = sha256(member);
		if (shipped !== prior.sha256) problems.push(`bin/${file} in ${previousLabel}'s pack is ${short(shipped)}, its manifest records ${short(prior.sha256)}`);
		const layout = authenticodeStructureProblem(member);
		if (layout !== null) problems.push(`bin/${file} in ${previousLabel}'s pack: ${layout}`);
		if (problems.length > before) continue;
		const signed = peLayout(member).certificateTable !== null;
		const unsigned = signed ? authenticodeNeutral(member) : member;
		const identity = prior.unsignedSha256 ?? prior.sha256;
		if (sha256(unsigned) !== identity) {
			problems.push(`${file} from ${previousLabel}${signed ? " without its signature" : ""} is ${short(sha256(unsigned))}, its manifest records the unsigned build as ${short(identity)}`);
			continue;
		}
		let codeView;
		try {
			codeView = parsePe(unsigned).codeView;
		} catch (err) {
			problems.push(`${file} from ${previousLabel} could not be parsed: ${err.message}`);
			continue;
		}
		const pdbName = pdbNameOf(file);
		const pdb = previousPdbs.get(pdbName) ?? null;
		if (pdb === null) problems.push(`${previousLabel} attaches no readable ${pdbName}, and a carried ${file} ships with the program database it was linked with`);
		else if (!pdbMatches(pdb, codeView)) problems.push(`${pdbName} from ${previousLabel} is not the program database of its ${file} (CodeView ${codeView?.guid ?? "none"} age ${codeView?.age ?? "none"})`);
		// Every file the carry rests on must be the bytes GitHub recorded
		// for the asset, not merely consistent with the others.
		if (previousVerified !== null) {
			for (const asset of [PREVIOUS_MANIFEST_ASSET, PREVIOUS_PACK_ASSET, pdbName]) {
				if (!previousVerified.has(asset)) problems.push(`GitHub records no digest the downloaded ${asset} of ${previousLabel} was checked against, so a carried ${file} cannot rest on it`);
			}
		}
		if (problems.length > before) continue;
		const firstShippedIn = typeof prior.reproducibility?.carriedFrom?.firstShippedIn === "string" ? prior.reproducibility.carriedFrom.firstShippedIn : previousLabel;
		const reason = `its native source ${record.nativeSourceId} is unchanged since ${previousLabel}`;
		decisions.push({
			file,
			decision: "carried",
			reason,
			bytes: unsigned,
			pdb,
			record: { decision: "carried", reason, sha256: sha256(unsigned), rebuiltSha256: record.sha256, carriedFrom: { release: previousLabel, firstShippedIn, sha256: shipped, unsignedSha256: identity } }
		});
	}
	const previousFacts = previous === null ? null : { release: previousLabel, compilerVersion: previous.compilerVersion ?? null, windowsSdkVersion: previous.windowsSdkVersion ?? null };
	return { problems, decisions, previous: previousFacts };
}

/** carry-forward.json: what native-manifest.mjs --carry-forward reads. */
export function carryForwardRecord(plan, mode) {
	return { mode, previous: plan.previous, binaries: Object.fromEntries(plan.decisions.map((decision) => [decision.file, decision.record])) };
}

/** The markdown summary the release run shows. */
export function renderCarryForwardMarkdown(plan, mode) {
	const lines = [`### Native carry-forward (${mode})`, "", "| Binary | Ships | Rebuild in this run | Why |", "|---|---|---|---|"];
	for (const decision of plan.decisions) {
		const ships = decision.decision === "carried" ? `\`${short(decision.record.sha256)}\` from ${decision.record.carriedFrom.firstShippedIn}` : `\`${short(decision.record.sha256)}\` (this run)`;
		const rebuiltSha = decision.decision === "carried" ? decision.record.rebuiltSha256 : decision.record.sha256;
		lines.push(`| ${decision.file} | ${ships} | \`${short(rebuiltSha)}\` | ${decision.reason} |`);
	}
	return `${lines.join("\n")}\n`;
}
