// suite:full (scripts/hygiene.mjs) is documented as running every suite
// (AGENTS.md). Every e2e npm script must therefore be one of its steps,
// running the same script file the npm script names, so a new suite cannot
// ship outside the release gate. Likewise every unit test file must be named
// by an npm script (npm test lists its files one by one), so a new test file
// cannot sit in test/ without ever running.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const hygiene = readFileSync(new URL("../scripts/hygiene.mjs", import.meta.url), "utf8");
const agents = readFileSync(new URL("../AGENTS.md", import.meta.url), "utf8");

test("every e2e npm script is a suite:full step running the same file", () => {
	const suites = Object.entries(pkg.scripts).filter(([name]) => name === "e2e" || name.startsWith("e2e:"));
	assert.ok(suites.length > 0);
	for (const [name, command] of suites) {
		const file = command.split(/\s+/).find((part) => part.endsWith(".mjs"));
		assert.ok(file !== undefined, `${name}: no script file in ${JSON.stringify(command)}`);
		const step = hygiene.split("\n").find((line) => line.trimStart().startsWith(`[${JSON.stringify(name)}, `));
		assert.ok(step !== undefined, `${name} is not a suite:full step in scripts/hygiene.mjs`);
		assert.ok(step.includes(JSON.stringify(file)), `${name}: the suite:full step does not run ${file}: ${step.trim()}`);
	}
});

test("AGENTS.md's command table lists every e2e npm script on a line of its own", () => {
	const suites = Object.keys(pkg.scripts).filter((name) => name === "e2e" || name.startsWith("e2e:"));
	const rows = agents.split(/\r?\n/).filter((line) => line.startsWith("| `npm run e2e"));
	for (const name of suites) {
		const own = rows.filter((line) => line.startsWith(`| \`npm run ${name}\` |`));
		assert.equal(own.length, 1, `${name} has no row of its own in AGENTS.md`);
	}
	assert.equal(rows.length, suites.length, "no row names a script that does not exist");
});

test("every unit test file in test/ is run by an npm script", () => {
	const scripts = Object.values(pkg.scripts).join(" ");
	const files = readdirSync(new URL(".", import.meta.url)).filter((name) => /\.test\.(ts|mjs)$/.test(name));
	assert.ok(files.length > 100);
	assert.deepEqual(files.filter((name) => !scripts.includes(`test/${name}`)), []);
});
