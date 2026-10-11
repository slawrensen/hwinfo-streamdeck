/**
 * Global settings read through the real SDK (external review AX61). The app
 * answers getGlobalSettings with the same didReceiveGlobalSettings event it
 * sends for every change, and a newer document can arrive right behind the
 * reply: two frames in one socket read, delivered before the code awaiting
 * the reply resumes. The frames below go through the real ws Receiver into
 * the SDK's own connection; only its outgoing send is replaced.
 *
 * Each scenario runs in its own process: the theme migration decides once
 * per process.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));

async function scenario(name) {
	const { Receiver, Sender } = require("ws");
	const { connection } = await import(new URL("../node_modules/@elgato/streamdeck/dist/plugin/connection.js", import.meta.url));
	const themes = await import(new URL("../src/ui/theme-store.ts", import.meta.url));
	const { default: streamDeck } = await import("@elgato/streamdeck");
	// Wired as plugin.ts wires it: every delivery is applied.
	streamDeck.settings.onDidReceiveGlobalSettings((ev) => themes.applyGlobalThemeSettings(ev.settings));
	const sent = [];
	connection._registrationParameters = { pluginUUID: "test" };
	connection.send = async (message) => void sent.push(message);
	const deliverAs = (id, ...documents) => {
		const receiver = new Receiver({ isServer: false });
		receiver.on("message", (data) => connection.tryEmit({ data }));
		const frame = (settings) => Sender.frame(Buffer.from(JSON.stringify({ event: "didReceiveGlobalSettings", ...(id === undefined ? {} : { id }), payload: { settings } })), { fin: true, mask: false, opcode: 1, readOnly: false });
		receiver.write(Buffer.concat(documents.flatMap(frame)));
	};
	const deliver = (...documents) => deliverAs(undefined, ...documents);
	const settle = () => new Promise((resolve) => setImmediate(resolve));
	const OLD = { pollIntervalMs: "1000", future: { keep: "old" } };
	const NEWER = { pollIntervalMs: "250", future: { keep: "new" } };
	if (name === "read") {
		const { readGlobalSettings } = await import(new URL("../src/global-settings.ts", import.meta.url));
		const read = readGlobalSettings();
		deliver(OLD, NEWER);
		const newer = await read;
		const alone = readGlobalSettings();
		deliver(OLD);
		return { newer, alone: await alone };
	}
	if (name === "reply the listeners skip") {
		// The SDK's message-identifier mode hands the reply to the read only,
		// never to the listeners: an older document delivered before the
		// read must not stand in for it. The SDK refuses the mode below a
		// 7.1 manifest floor (this plugin's is 6.9), so its getter is forced.
		const { readGlobalSettings } = await import(new URL("../src/global-settings.ts", import.meta.url));
		Object.defineProperty(streamDeck.settings, "useExperimentalMessageIdentifiers", { get: () => true });
		deliver(OLD);
		const read = readGlobalSettings();
		deliverAs("the-read", NEWER);
		return { read: await read };
	}
	themes.decideLegacyDefault(true);
	if (name === "migration, newer document behind the reply") deliver(OLD, NEWER);
	if (name === "migration, newer theme behind the reply") deliver(OLD, { ...NEWER, theme: "ember" });
	if (name === "migration, one reply") deliver(OLD);
	await settle();
	return { writes: sent.filter((m) => m.event === "setGlobalSettings").map((m) => m.payload), theme: themes.getDeckTheme() };
}

function run(name) {
	const result = spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url)], { cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true, env: { ...process.env, GLOBAL_SETTINGS_SCENARIO: name } });
	assert.equal(result.status, 0, result.stderr);
	const line = result.stdout.split(/\r?\n/).find((l) => l.startsWith("RESULT "));
	assert.ok(line !== undefined, result.stdout + result.stderr);
	return JSON.parse(line.slice("RESULT ".length));
}

if (process.env.GLOBAL_SETTINGS_SCENARIO !== undefined) {
	process.stdout.write(`RESULT ${JSON.stringify(await scenario(process.env.GLOBAL_SETTINGS_SCENARIO))}\n`);
} else {
	test("a read resolves with the newest document delivered, not the reply it was handed", () => {
		const { newer, alone } = run("read");
		assert.deepEqual(newer, { pollIntervalMs: "250", future: { keep: "new" } });
		assert.deepEqual(alone, { pollIntervalMs: "1000", future: { keep: "old" } }, "a lone reply is the answer");
	});

	test("a reply the listeners skip is the answer, not an older delivery", () => {
		assert.deepEqual(run("reply the listeners skip").read, { pollIntervalMs: "250", future: { keep: "new" } });
	});

	// plugin.ts is the entry and cannot be imported: its startup read must
	// not apply the reply again after the listener did, which put an older
	// document back when a newer one followed it (review of d15). Every call
	// that applies global settings sits inside the delivery listener.
	test("plugin.ts applies global settings only in its delivery listener", async () => {
		const { default: ts } = await import("typescript");
		const source = readFileSync(new URL("../src/plugin.ts", import.meta.url), "utf8");
		const tree = ts.createSourceFile("plugin.ts", source, ts.ScriptTarget.Latest, true);
		const APPLY = /^(?:poller\.(?:setReadingLinks|setIntervalMs|setSourceMode)|applyGlobalThemeSettings)$/;
		const inListener = (node) => {
			for (let n = node.parent; n !== undefined; n = n.parent) {
				if (ts.isCallExpression(n) && n.expression.getText(tree) === "streamDeck.settings.onDidReceiveGlobalSettings") return true;
			}
			return false;
		};
		const calls = [];
		const visit = (node) => {
			if (ts.isCallExpression(node) && APPLY.test(node.expression.getText(tree))) calls.push({ call: node.expression.getText(tree), inListener: inListener(node), line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1 });
			ts.forEachChild(node, visit);
		};
		visit(tree);
		assert.equal(calls.length, 4, JSON.stringify(calls));
		assert.deepEqual(calls.filter((c) => !c.inListener), []);
		assert.match(source, /const globals = await readGlobalSettings<GlobalSettings>\(\);/);
	});

	test("the theme migration writes onto the newest document, never the older reply", () => {
		const { writes } = run("migration, newer document behind the reply");
		assert.deepEqual(writes, [{ pollIntervalMs: "250", future: { keep: "new" }, theme: "graphite" }]);
	});

	test("the theme migration writes nothing when a newer document already chose a theme", () => {
		const { writes, theme } = run("migration, newer theme behind the reply");
		assert.deepEqual(writes, []);
		assert.equal(theme, "ember");
	});

	test("with one reply, the migration still persists onto it", () => {
		const { writes } = run("migration, one reply");
		assert.deepEqual(writes, [{ pollIntervalMs: "1000", future: { keep: "old" }, theme: "graphite" }]);
	});
}
