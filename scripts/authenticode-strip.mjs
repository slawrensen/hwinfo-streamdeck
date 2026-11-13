// The Authenticode-neutral identity of a native binary (scripts/lib/authenticode.mjs):
// the SHA-256 of the file with its certificate table removed, the
// certificate-table data directory zeroed and the PE CheckSum zeroed. A
// signed hwsm.node and the unsigned build it was made from
// share it, which is how the release proves the signed file is the
// reproduced unsigned build plus a signature and nothing else.
//
//   node scripts/authenticode-strip.mjs neutral <file> [--out <stripped copy>]
//        prints the neutral SHA-256 (and writes the neutral bytes)
//   node scripts/authenticode-strip.mjs compare <signed> <unsigned>
//        exit 0 only when the signed file minus its signature is the
//        unsigned build and the digest the signature commits to is the
//        Authenticode image digest of both
//   node scripts/authenticode-strip.mjs expect <file>
//        exit 0 only when the file's SHA-256 equals EXPECT_SHA (64 hex
//        digits, from the environment, never from the command line)
//
// Reads bytes only: no signtool, no certificate store, no network.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authenticodeNeutral, compareSignedToUnsigned } from "./lib/authenticode.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Runs one command; returns { code, out: string[], err: string[] }. */
export function run(argv, env = process.env) {
	const out = [];
	const err = [];
	const [command, ...rest] = argv;
	const outAt = rest.indexOf("--out");
	const outPath = outAt >= 0 ? rest[outAt + 1] : undefined;
	const files = rest.filter((_, i) => outAt < 0 || (i !== outAt && i !== outAt + 1));
	const read = (file) => {
		if (file === undefined || !fs.existsSync(file)) throw new Error(`${file ?? "a file argument"} not found`);
		return fs.readFileSync(file);
	};
	try {
		if (command === "neutral" && files.length === 1) {
			const neutral = authenticodeNeutral(read(files[0]));
			if (outPath !== undefined) fs.writeFileSync(outPath, neutral);
			out.push(`${sha256(neutral)}  ${path.basename(files[0])} (neutral, ${neutral.length} bytes)`);
			return { code: 0, out, err };
		}
		if (command === "compare" && files.length === 2) {
			const { problems, facts } = compareSignedToUnsigned(read(files[0]), read(files[1]));
			out.push(JSON.stringify(facts));
			if (problems.length > 0) {
				err.push(`AUTHENTICODE COMPARE: ${path.basename(files[0])} is not ${path.basename(files[1])} plus a signature`, ...problems.map((p) => `  ${p}`));
				return { code: 1, out, err };
			}
			out.push(`AUTHENTICODE COMPARE: OK (${path.basename(files[0])} ${facts.signedSha256.slice(0, 12)} = unsigned ${facts.unsignedSha256.slice(0, 12)} plus a ${facts.digestAlgorithm} signature over image digest ${facts.imageDigest.slice(0, 12)})`);
			return { code: 0, out, err };
		}
		if (command === "expect" && files.length === 1) {
			const expected = env.EXPECT_SHA ?? "";
			if (!/^[0-9a-f]{64}$/.test(expected)) {
				err.push("EXPECT_SHA must be 64 lowercase hex digits");
				return { code: 1, out, err };
			}
			const actual = sha256(read(files[0]));
			if (actual !== expected) {
				err.push(`${files[0]} is ${actual}, expected ${expected}`);
				return { code: 1, out, err };
			}
			out.push(`${files[0]} is ${actual} as expected`);
			return { code: 0, out, err };
		}
	} catch (error) {
		err.push(`authenticode-strip: ${error.message}`);
		return { code: 1, out, err };
	}
	err.push("usage: authenticode-strip.mjs neutral <file> [--out <file>] | compare <signed> <unsigned> | expect <file> (EXPECT_SHA in the environment)");
	return { code: 2, out, err };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const result = run(process.argv.slice(2));
	for (const line of result.out) console.log(line);
	for (const line of result.err) console.error(line);
	process.exit(result.code);
}
