// Settings ground truth for the bench, taken from disk (never from the app):
// every HWiNFO action's stored Settings in every ProfilesV3 page manifest,
// each page file's SHA-256, and the plugin's global-settings registry value
// (HKCU\Software\Elgato Systems GmbH\StreamDeck, a Qt @ByteArray string).
//
//   node snap.mjs take <label>          writes snaps/<label>.json
//   node snap.mjs diff <a> <b> [--all]  field-level changes per action,
//                                       page files that changed outside
//                                       HWiNFO actions, and the global value
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const bench = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const snaps = path.join(bench, "snaps");
const root = path.join(process.env.APPDATA, "Elgato", "StreamDeck", "ProfilesV3");
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

function globalValue() {
	try {
		const out = execFileSync("reg", ["query", "HKCU\\Software\\Elgato Systems GmbH\\StreamDeck", "/v", "com.lawrensen.hwinfocom.lawrensen.hwinfo"], { encoding: "utf8" });
		const line = out.split(/\r?\n/).find((l) => l.includes("com.lawrensen.hwinfocom.lawrensen.hwinfo")) ?? "";
		return sha(line.trim());
	} catch {
		return "absent";
	}
}

function take(label) {
	const pages = {};
	const actions = {};
	for (const prof of fs.readdirSync(root).filter((d) => d.endsWith(".sdProfile"))) {
		const pdir = path.join(root, prof, "Profiles");
		if (!fs.existsSync(pdir)) continue;
		for (const page of fs.readdirSync(pdir)) {
			const file = path.join(pdir, page, "manifest.json");
			if (!fs.existsSync(file)) continue;
			const buf = fs.readFileSync(file);
			const rel = `${prof.slice(0, 8)}/${page.slice(0, 8)}`;
			let doc;
			try {
				doc = JSON.parse(buf.toString("utf8"));
			} catch {
				pages[rel] = { sha: sha(buf), unreadable: true };
				continue;
			}
			const others = [];
			for (const [ci, ctrl] of (doc.Controllers ?? []).entries()) {
				for (const [cell, a] of Object.entries(ctrl.Actions ?? {})) {
					if (String(a.UUID ?? "").startsWith("com.lawrensen.hwinfo")) {
						actions[`${rel}/${ctrl.Type ?? ci}/${cell}`] = { uuid: a.UUID, settings: a.Settings ?? null };
					} else {
						others.push([ctrl.Type ?? ci, cell, a]);
					}
				}
			}
			// Everything on the page except HWiNFO action settings, so a
			// change outside our documents is visible on its own.
			const rest = JSON.parse(JSON.stringify(doc));
			for (const ctrl of rest.Controllers ?? []) for (const a of Object.values(ctrl.Actions ?? {})) if (String(a.UUID ?? "").startsWith("com.lawrensen.hwinfo")) delete a.Settings;
			pages[rel] = { sha: sha(buf), restSha: sha(JSON.stringify(rest)), name: doc.Name ?? "" };
		}
	}
	fs.mkdirSync(snaps, { recursive: true });
	const snap = { label, at: new Date().toISOString(), global: globalValue(), pages, actions };
	fs.writeFileSync(path.join(snaps, `${label}.json`), JSON.stringify(snap));
	console.log(`snap ${label}: ${Object.keys(pages).length} pages, ${Object.keys(actions).length} HWiNFO actions, global ${snap.global.slice(0, 12)}`);
}

const flat = (o, p = "", out = {}) => {
	if (o !== null && typeof o === "object") {
		const entries = Object.entries(o);
		if (entries.length === 0) out[p] = Array.isArray(o) ? "[]" : "{}";
		for (const [k, v] of entries) flat(v, p === "" ? k : `${p}.${k}`, out);
	} else {
		out[p] = JSON.stringify(o);
	}
	return out;
};

function diff(a, b, all) {
	const A = JSON.parse(fs.readFileSync(path.join(snaps, `${a}.json`), "utf8"));
	const B = JSON.parse(fs.readFileSync(path.join(snaps, `${b}.json`), "utf8"));
	let n = 0;
	for (const id of new Set([...Object.keys(A.actions), ...Object.keys(B.actions)])) {
		const x = A.actions[id];
		const y = B.actions[id];
		if (!x || !y) {
			console.log(`${x ? "REMOVED" : "ADDED"} ${id} ${(x ?? y).uuid}`);
			n++;
			continue;
		}
		const sx = JSON.stringify(x.settings);
		const sy = JSON.stringify(y.settings);
		if (sx === sy) continue;
		const fx = flat(x.settings);
		const fy = flat(y.settings);
		const changed = [...new Set([...Object.keys(fx), ...Object.keys(fy)])].filter((k) => fx[k] !== fy[k]);
		const orderOnly = changed.length === 0;
		console.log(`SETTINGS ${id} ${y.uuid}${orderOnly ? " (key order only)" : ""}`);
		for (const k of changed.slice(0, all ? 999 : 12)) console.log(`   ${k}: ${fx[k] ?? "(absent)"} -> ${fy[k] ?? "(absent)"}`);
		if (!all && changed.length > 12) console.log(`   ... ${changed.length - 12} more`);
		n++;
	}
	for (const rel of new Set([...Object.keys(A.pages), ...Object.keys(B.pages)])) {
		const x = A.pages[rel];
		const y = B.pages[rel];
		if (!x || !y) {
			console.log(`PAGE ${x ? "REMOVED" : "ADDED"} ${rel}`);
			n++;
		} else if (x.restSha !== y.restSha) {
			console.log(`PAGE ${rel} changed OUTSIDE HWiNFO settings`);
			n++;
		} else if (all && x.sha !== y.sha) {
			console.log(`page ${rel} file bytes changed (HWiNFO settings only)`);
		}
	}
	if (A.global !== B.global) {
		console.log("GLOBAL settings registry value changed");
		n++;
	}
	console.log(`${n} change(s) ${a} -> ${b}`);
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "take") take(args[0]);
else if (cmd === "diff") diff(args[0], args[1], args.includes("--all"));
else console.error("usage: node snap.mjs take <label> | diff <a> <b> [--all]");
