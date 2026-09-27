// Lists every round-3 reviewer finding from the saved agent results
// (round3/agents/<role>.json) as one Markdown table, most severe first, so
// the register can be written against the full set.
//   node review/pi-density/round3/tabulate-findings.mjs [pass]   (pass = r1 | r2)
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pass = process.argv[2] ?? "r1";
const dir = path.join(here, "agents", pass);
const rows = [];
for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
	const r = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
	for (const f of r.findings ?? []) rows.push({ role: r.key ?? r.role, ...f });
}
const order = { S1: 1, S2: 2, S3: 3, S4: 4, S5: 5, S6: 6 };
rows.sort((a, b) => order[a.severity] - order[b.severity] || a.id.localeCompare(b.id));
const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
console.log(`${rows.length} findings (${pass})\n`);
console.log("| ID | Sev | Conf | Category | Area | Title | Affected |");
console.log("| --- | --- | --- | --- | --- | --- | --- |");
for (const f of rows) console.log(`| ${f.id} | ${f.severity} | ${f.confidence} | ${f.evidence_category} | ${cell(f.area)} | ${cell(f.title)} | ${cell(f.affected_user)} |`);
