import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const clean = (value) => String(value ?? "unknown").replaceAll("|", "\\|").replace(/[\r\n]+/g, " ");
const finite = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const stable = (value) => JSON.stringify(value, function (_key, item) {
	return item && typeof item === "object" && !Array.isArray(item)
		? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item;
});
const metrics = [
	["CPU % of one core", (row) => row.cpuPercentOneCore],
	["p95 callback ms", (row) => row.callbackMs?.p95],
	["p95 loop drain ms", (row) => row.drainMs?.p95],
	["Update coverage %", (row) => finite(row.updates?.coverageRatio) && row.updates.coverageRatio <= 1 ? 100 * row.updates.coverageRatio : null],
	["p95 update ms", (row) => row.updates?.latency?.p95],
	["Peak RSS MiB", (row) => finite(row.rssPeak) ? row.rssPeak / 1024 ** 2 : null]
];
const formatted = (value) => value === null ? "unknown" : value.toFixed(2);
function median(values) {
	if (values.length === 0 || !values.every(finite)) return null;
	const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : sorted[middle - 1] + (sorted[middle] - sorted[middle - 1]) / 2;
}

function aggregate(summary) {
	if (!summary || summary.schema !== 1 || !Array.isArray(summary.results) || !Number.isInteger(summary.repeats) || summary.repeats < 1) {
		throw new TypeError("Expected schema 1, results array and positive integer repeats.");
	}
	const declared = Array.isArray(summary.cases) && summary.cases.length > 0;
	const cases = declared ? summary.cases : [...new Map(summary.results.map((row) => [row.name, row.config])).values()];
	if (cases.some((config) => !config || typeof config.name !== "string" || !config.name) || new Set(cases.map((config) => config.name)).size !== cases.length) {
		throw new TypeError("Case names must be nonempty and unique.");
	}
	const rows = cases.map((config) => {
		const samples = summary.results.filter((row) => row.name === config.name);
		const complete = samples.length === summary.repeats && new Set(samples.map((row) => row.repeat)).size === summary.repeats
			&& samples.every((row) => Number.isInteger(row.repeat) && row.repeat >= 1 && row.repeat <= summary.repeats && stable(row.config) === stable(config));
		const values = metrics.map(([, read]) => complete ? median(samples.map(read)) : null);
		const budgets = samples.flatMap((row) => row.budget && typeof row.budget === "object" && Object.keys(row.budget).length ? Object.values(row.budget) : [null]);
		const budget = samples.some((row) => row.ok === false) ? "FAIL" : !complete ? "UNKNOWN (incomplete repeats/config)"
			: budgets.includes(false) ? "REVIEW" : values.every((value) => value !== null) && budgets.length > 0 && budgets.every((value) => value === true) && samples.every((row) => row.ok === true) ? "PASS" : "UNKNOWN";
		return { name: config.name, config, complete, budget, values };
	});
	const reasons = [];
	if (!declared) reasons.push("missing declared case manifest");
	if (summary.ok !== true || summary.results.some((row) => row.ok !== true)) reasons.push("run did not complete successfully");
	if (!finite(summary.seconds) || summary.seconds === 0 || !finite(summary.warmup)) reasons.push("missing or invalid duration/warmup");
	if (!rows.length || rows.some((row) => !row.complete) || summary.results.length !== cases.length * summary.repeats) reasons.push("incomplete, duplicate or mismatched case repetitions");
	return { rows, reasons };
}

const ratio = (numerator, denominator) => finite(numerator) && numerator > 0 && finite(denominator) && denominator > 0 && Number.isFinite(numerator / denominator) ? `${(numerator / denominator).toFixed(2)}x` : "unknown";
const ratios = (a, b) => a.values.map((value, index) => ratio(b.values[index], value)).join(" | ");
const ratioHeader = `| Comparison (right / left) | ${metrics.map(([name]) => clean(name)).join(" | ")} |`;
const separator = `|${Array(metrics.length + 1).fill(" --- ").join("|")}|`;

/** Median of repeat-level metrics; never substitutes missing observations with zero. */
export function report(summary, other) {
	const current = aggregate(summary);
	const lines = ["# Scaling measurements", "", `Run: ${summary.ok === true ? "PASS" : "FAIL or incomplete"}; mode: ${clean(summary.mode)}; machine: ${clean(summary.machine?.label)}; Node: ${clean(summary.machine?.node)}.`,
		`Per case: ${clean(summary.seconds)} s measured, ${clean(summary.warmup)} s warmup, ${summary.repeats} repeat(s).`,
		`Source: ${clean(summary.source)}; plugin SHA256: ${clean(summary.pluginSha256)}; native SHA256: ${clean(summary.nativeSha256)}.`, "",
		"Values are medians across repeats. A p95 column is the median of repeat-level p95s, not a pooled percentile. Unknown values are not zero.", "",
		`| Case | ${metrics.map(([name]) => name).join(" | ")} | Budget |`, `|${Array(metrics.length + 2).fill(" --- ").join("|")}|`,
		...current.rows.map((row) => `| ${clean(row.name)} | ${row.values.map(formatted).join(" | ")} | ${row.budget} |`), "",
		"## Within-machine ratios", ""];
	if (current.reasons.length) lines.push(`Ratios refused: ${current.reasons.join("; ")}.`);
	else {
		lines.push(ratioHeader, separator);
		const comparisons = [
			["changing-250", "inventory-2048", ["inventory"], "inventory"],
			["changing-250", "actions-84", ["keys", "dials"], "visible actions"],
			["changing-250", "mixed-250", ["rotation", "rich", "pi"], "combined layout/rotation/PI workload"],
			["changing-250", "control-250", ["timing"], "instrumentation control"],
			["reference-1000", "reference-250", ["pollMs"], "poll interval"]
		];
		for (const [left, right, axis, label] of comparisons) {
			const a = current.rows.find((row) => row.name === left), b = current.rows.find((row) => row.name === right);
			if (!a || !b) { lines.push(`| ${left} → ${right} (${label}) | ${Array(metrics.length).fill("unavailable case").join(" | ")} |`); continue; }
			const omit = (config) => Object.fromEntries(Object.entries(config).filter(([key]) => key !== "name" && !axis.includes(key)));
			const changed = axis.some((key) => stable(a.config[key]) !== stable(b.config[key]));
			lines.push(`| ${left} → ${right} (${label}) | ${stable(omit(a.config)) === stable(omit(b.config)) && changed ? ratios(a, b) : Array(metrics.length).fill("refused: axis mismatch").join(" | ")} |`);
		}
	}
	if (other !== undefined) {
		const compared = aggregate(other), reasons = [...current.reasons, ...compared.reasons];
		for (const field of ["seconds", "warmup", "repeats"]) if (!finite(summary[field]) || !finite(other[field]) || summary[field] !== other[field]) reasons.push(`incompatible ${field}`);
		const nodeMajor = (value) => /^v?(\d+)\./.exec(value ?? "")?.[1];
		if (!nodeMajor(summary.machine?.node) || nodeMajor(summary.machine?.node) !== nodeMajor(other.machine?.node)) reasons.push("incompatible Node major");
		for (const field of ["mode", "measurementMode"]) if ((field === "mode" && typeof summary[field] !== "string") || summary[field] !== other[field]) reasons.push(`incompatible ${field}`);
		const configs = (rows) => rows.map((row) => row.config).sort((a, b) => a.name.localeCompare(b.name));
		if (stable(configs(current.rows)) !== stable(configs(compared.rows))) reasons.push("incompatible case configurations");
		lines.push("", "## Second-run comparison", "", `Right-hand run: ${clean(other.machine?.label)}; Node: ${clean(other.machine?.node)}; source: ${clean(other.source)}.`,
			`Plugin SHA256: ${clean(other.pluginSha256)}; native SHA256: ${clean(other.nativeSha256)}.`);
		const hashes = ["pluginSha256", "nativeSha256"];
		if (hashes.some((key) => typeof summary[key] !== "string" || !/^[a-f\d]{64}$/i.test(summary[key]) || typeof other[key] !== "string" || !/^[a-f\d]{64}$/i.test(other[key]))) reasons.push("missing or invalid byte hashes");
		if (typeof summary.source !== "string" || !summary.source || typeof other.source !== "string" || !other.source) reasons.push("missing source identity");
		lines.push(hashes.some((key) => summary[key] !== other[key]) || summary.source !== other.source ? "Different bytes or source: this is also a code comparison; hardware effects are not isolated." : "Matching source and shipping bytes; machine/environment differences remain uncontrolled.");
		if (reasons.length) lines.push(`Ratios refused: ${[...new Set(reasons)].join("; ")}.`);
		else lines.push("", ratioHeader, separator, ...current.rows.map((row) => `| ${clean(row.name)} (second / first) | ${ratios(row, compared.rows.find((entry) => entry.name === row.name))} |`));
	}
	lines.push("", "Budget REVIEW means a measured budget was exceeded without a functional failure; UNKNOWN includes unmeasured instrumentation. Ratios with a zero or missing measurement are unknown.",
		"Synthetic shared memory and a mock host measure this workload on this machine. A smoke run is not capacity proof. Diagnostic preload timings are not physical display latency; no high/low-spec hardware extrapolation is made.",
		clean(summary.limits ?? "Consult the raw measurements and workload configuration before interpreting scaling."), "");
	return lines.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const files = process.argv.slice(2);
		if (files.length < 1 || files.length > 2) throw new Error("Usage: node scripts/scaling-report.mjs summary.json [other-summary.json]");
		console.log(report(...files.map((file) => JSON.parse(fs.readFileSync(file, "utf8")))));
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
