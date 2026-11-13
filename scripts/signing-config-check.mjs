// Checks the release's signing configuration before anything uses it, so a
// missing or mistyped value fails with its name instead of surfacing as an
// opaque login or signing error. Values are never printed.
//
//   node scripts/signing-config-check.mjs --mode
//        the build job: SIGNING_MODE must be unset, empty, "off" or
//        "required"; anything else (a typo such as "Required") fails the
//        release rather than quietly shipping unsigned
//   node scripts/signing-config-check.mjs
//        the sign job: the OIDC identity (AZURE_CLIENT_ID, AZURE_TENANT_ID,
//        AZURE_SUBSCRIPTION_ID, environment secrets of release-signing) and
//        the Artifact Signing target (ARTIFACT_SIGNING_ENDPOINT,
//        ARTIFACT_SIGNING_ACCOUNT, ARTIFACT_SIGNING_PROFILE, repository
//        variables) must all be present and well formed;
//        ARTIFACT_SIGNING_EXPECTED_SUBJECT is optional until the first
//        signing shows the subject, then pins it
import path from "node:path";
import { fileURLToPath } from "node:url";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME = /^[A-Za-z][A-Za-z0-9-]{1,98}[A-Za-z0-9]$/;

/** The rules, by environment name: [test, what a valid value looks like]. */
export const SIGNING_CONFIG = Object.freeze({
	AZURE_CLIENT_ID: [(v) => GUID.test(v), "the client (application) id of the Entra app registration, a GUID"],
	AZURE_TENANT_ID: [(v) => GUID.test(v), "the Entra tenant id, a GUID"],
	AZURE_SUBSCRIPTION_ID: [(v) => GUID.test(v), "the Azure subscription id that holds the Artifact Signing account, a GUID"],
	ARTIFACT_SIGNING_ENDPOINT: [(v) => /^https:\/\/[a-z0-9]+\.codesigning\.azure\.net\/?$/.test(v), "the account's regional endpoint, https://<region>.codesigning.azure.net/"],
	ARTIFACT_SIGNING_ACCOUNT: [(v) => NAME.test(v) && v.length <= 24, "the Artifact Signing account name (3 to 24 letters, digits and hyphens)"],
	ARTIFACT_SIGNING_PROFILE: [(v) => NAME.test(v), "the Public Trust certificate profile name (letters, digits and hyphens)"]
});

/** One sentence per configuration problem; empty when the sign job can run. */
export function signingConfigProblems(env) {
	const problems = [];
	for (const [name, [valid, shape]] of Object.entries(SIGNING_CONFIG)) {
		const value = env[name] ?? "";
		if (value === "") problems.push(`${name} is not set: ${shape}`);
		else if (!valid(value)) problems.push(`${name} is set but is not ${shape}`);
	}
	const subject = env.ARTIFACT_SIGNING_EXPECTED_SUBJECT ?? "";
	if (subject !== "" && !/^CN=[^\r\n]+$/.test(subject)) problems.push("ARTIFACT_SIGNING_EXPECTED_SUBJECT is set but is not a certificate subject (CN=...)");
	return problems;
}

/** Why SIGNING_MODE is not a value the release understands, or null. */
export function signingModeProblem(value) {
	if (value === undefined || value === "" || value === "off" || value === "required") return null;
	return `SIGNING_MODE is ${JSON.stringify(value)}; it must be unset, "off" (ship unsigned) or "required" (sign, or fail the release)`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	if (process.argv.includes("--mode")) {
		const problem = signingModeProblem(process.env.SIGNING_MODE);
		if (problem !== null) {
			console.error(`SIGNING MODE: ${problem}`);
			process.exit(1);
		}
		console.log(`SIGNING MODE: ${process.env.SIGNING_MODE === "required" ? "required (the sign job runs; any signing or verification failure fails the release)" : "off (the release ships the unsigned build)"}`);
	} else {
		const problems = signingConfigProblems(process.env);
		if (problems.length > 0) {
			console.error(`SIGNING CONFIGURATION: ${problems.length} problem(s)`);
			for (const problem of problems) console.error(`  ${problem}`);
			process.exit(1);
		}
		console.log(`SIGNING CONFIGURATION: OK (${Object.keys(SIGNING_CONFIG).join(", ")} set${process.env.ARTIFACT_SIGNING_EXPECTED_SUBJECT ? "; signer subject pinned" : "; signer subject not pinned yet"})`);
	}
}
