/**
 * The support-report button (ui/pi-control.js), the shipped bytes in a node
 * vm with a fake clipboard and a hand-driven clock. Only the first answer
 * to the pending request copies, and an answer, timer or clipboard write
 * left over from an earlier request never settles a later one (external
 * review AX63) or copies over it through the fallback (AX69).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import vm from "node:vm";

const SOURCE = readFileSync(new URL("../com.lawrensen.hwinfo.sdPlugin/ui/pi-control.js", import.meta.url), "utf8");
const LABEL = "Copy support report";

function button() {
	let now = 0;
	let nextTimer = 0;
	let subscriber = null;
	const timers = new Map();
	const clips = [];
	const requests = [];
	const pendingCopies = [];
	let fallbacks = 0;
	let execOk = true;
	const created = [];
	const focused = [];
	class HTMLElement {
		focus() {
			focused.push(this);
		}
	}
	const before = new HTMLElement();
	const el = {
		textContent: LABEL,
		attributes: {},
		handlers: {},
		addEventListener(kind, fn) {
			this.handlers[kind] = fn;
		},
		setAttribute(name, value) {
			this.attributes[name] = value;
		},
		removeAttribute(name) {
			delete this.attributes[name];
		}
	};
	const context = {
		SDPIComponents: { streamDeckClient: { send: (...args) => requests.push(args), sendToPropertyInspector: { subscribe: (fn) => (subscriber = fn) } } },
		hwShell: { announce() {} },
		document: {
			getElementById: () => el,
			activeElement: before,
			body: { appendChild() {} },
			// Selecting the scratch field focuses it, as in a browser.
			createElement: () => {
				const scratch = { value: "", removed: false, select: () => (context.document.activeElement = scratch), remove: () => (scratch.removed = true) };
				created.push(scratch);
				return scratch;
			},
			// The fallback copy: whatever the focused scratch field holds.
			execCommand: () => (fallbacks++, execOk && clips.push(context.document.activeElement.value), execOk)
		},
		HTMLElement,
		navigator: {
			clipboard: {
				writeText: (text) => new Promise((resolve, reject) => pendingCopies.push({ text, finish: (ok) => (ok ? (clips.push(text), resolve()) : reject(new Error("denied"))) }))
			}
		},
		setTimeout: (fn, ms) => (timers.set(++nextTimer, { at: now + ms, fn }), nextTimer),
		clearTimeout: (id) => timers.delete(id),
		Math
	};
	vm.createContext(context);
	vm.runInContext(SOURCE, context);
	return {
		el,
		clips,
		click: () => el.handlers.click(),
		lastId: () => requests.at(-1)?.[1].requestId,
		requests: () => requests,
		reply: (report, requestId) => subscriber({ payload: { event: "supportReport", report, requestId } }),
		fallbacks: () => fallbacks,
		created: () => created,
		focused: () => focused,
		before,
		failCopyCommand: () => (execOk = false),
		// Lets every clipboard write finish, then its continuation run.
		copyDone: async () => {
			for (const copy of pendingCopies.splice(0)) copy.finish(true);
			await new Promise((resolve) => setImmediate(resolve));
		},
		// Finishes or fails the one clipboard write of this text.
		settle: async (text, ok) => {
			const index = pendingCopies.findIndex((copy) => copy.text === text);
			assert.ok(index >= 0, `no clipboard write of ${text} is pending`);
			pendingCopies.splice(index, 1)[0].finish(ok);
			await new Promise((resolve) => setImmediate(resolve));
		},
		advance: (ms) => {
			now += ms;
			for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
				if (timer.at <= now && timers.delete(id)) timer.fn();
			}
		},
		busy: () => el.attributes["aria-disabled"] === "true"
	};
}

describe("the support-report button answers only its own request, once", () => {
	it("the newer outcome keeps its full two seconds", async () => {
		const b = button();
		b.click();
		b.reply("OLD", b.lastId());
		await b.copyDone();
		b.advance(1000);
		b.click();
		b.reply("NEW", b.lastId());
		await b.copyDone();
		b.advance(1001); // the first outcome's restore time has passed
		assert.equal(b.el.textContent, "Copied to clipboard");
		b.advance(999);
		assert.equal(b.el.textContent, LABEL);
	});

	it("a late copy's outcome keeps its full two seconds", async () => {
		const b = button();
		b.click();
		b.reply("REPORT", b.lastId());
		b.advance(3001);
		assert.equal(b.el.textContent, "Copy failed");
		b.advance(1000);
		await b.copyDone();
		assert.equal(b.el.textContent, "Copied to clipboard");
		b.advance(1001); // the deadline outcome's restore time has passed
		assert.equal(b.el.textContent, "Copied to clipboard");
		b.advance(999);
		assert.equal(b.el.textContent, LABEL);
	});

	it("a clipboard that refuses the write falls back to a copy command", async () => {
		const b = button();
		b.click();
		b.reply("REPORT", b.lastId());
		await b.settle("REPORT", false);
		assert.deepEqual(b.clips, ["REPORT"]);
		assert.equal(b.fallbacks(), 1);
		assert.equal(b.created()[0].removed, true, "the scratch field is gone");
		assert.deepEqual(b.focused(), [b.before], "focus is back where it was");
		assert.equal(b.el.textContent, "Copied to clipboard");
	});

	it("a failed copy command says so", async () => {
		const b = button();
		b.failCopyCommand();
		b.click();
		b.reply("REPORT", b.lastId());
		await b.settle("REPORT", false);
		assert.deepEqual(b.clips, []);
		assert.equal(b.el.textContent, "Copy failed");
	});

	it("an older request's refused write does nothing while a newer one waits", async () => {
		const b = button();
		b.click();
		b.reply("OLD", b.lastId());
		b.advance(3001);
		b.click();
		await b.settle("OLD", false);
		assert.equal(b.created().length, 0, "no scratch field, so focus never moves");
		assert.deepEqual(b.clips, []);
		assert.equal(b.busy(), true);
		b.reply("NEW", b.lastId());
		await b.copyDone();
		assert.deepEqual(b.clips, ["NEW"]);
	});

	it("a refused write that lands after the deadline still falls back when no newer request started", async () => {
		const b = button();
		b.click();
		b.reply("REPORT", b.lastId());
		b.advance(3001);
		assert.equal(b.el.textContent, "Copy failed");
		await b.settle("REPORT", false);
		assert.deepEqual(b.clips, ["REPORT"]);
		assert.equal(b.el.textContent, "Copied to clipboard");
	});

	it("an older request's refused write copies nothing over a newer report", async () => {
		const b = button();
		b.click();
		b.reply("OLD", b.lastId());
		b.advance(3001); // the answer came, the copy did not finish
		b.click();
		b.reply("NEW", b.lastId());
		await b.settle("NEW", true);
		await b.settle("OLD", false);
		assert.deepEqual(b.clips, ["NEW"]);
		assert.equal(b.fallbacks(), 0);
		assert.equal(b.el.textContent, "Copied to clipboard");
	});

	it("a normal request copies once and says so, then the label comes back", async () => {
		const b = button();
		b.click();
		assert.equal(b.busy(), true);
		b.reply("REPORT", b.lastId());
		await b.copyDone();
		assert.deepEqual(b.clips, ["REPORT"]);
		assert.equal(b.el.textContent, "Copied to clipboard");
		assert.equal(b.busy(), false);
		b.advance(2000);
		assert.equal(b.el.textContent, LABEL);
	});

	it("a second click while waiting sends no second request", async () => {
		const b = button();
		b.click();
		const id = b.lastId();
		b.advance(1000);
		b.click();
		assert.equal(b.requests().length, 1);
		b.reply("REPORT", id);
		await b.copyDone();
		assert.deepEqual(b.clips, ["REPORT"]);
		assert.equal(b.el.textContent, "Copied to clipboard");
	});

	it("a copy that lands after the deadline corrects the outcome", async () => {
		const b = button();
		b.click();
		b.advance(2900);
		b.reply("REPORT", b.lastId());
		b.advance(200); // the deadline passes with the copy still going
		assert.equal(b.el.textContent, "Copy failed");
		await b.copyDone();
		assert.equal(b.el.textContent, "Copied to clipboard");
	});

	it("an answer nobody asked for copies nothing", async () => {
		const b = button();
		b.reply("UNSOLICITED", undefined);
		b.reply("UNSOLICITED", "made-up");
		await b.copyDone();
		assert.deepEqual(b.clips, []);
		assert.equal(b.el.textContent, LABEL);
	});

	it("an answer after the request timed out copies nothing", async () => {
		const b = button();
		b.click();
		const id = b.lastId();
		b.advance(3001);
		assert.equal(b.el.textContent, "Plugin not responding");
		b.reply("LATE", id);
		await b.copyDone();
		assert.deepEqual(b.clips, []);
	});

	it("an earlier request's answer cannot settle a later request", async () => {
		const b = button();
		b.click();
		const first = b.lastId();
		b.advance(3001);
		b.click();
		assert.equal(b.el.textContent, LABEL, "a new request does not keep the last outcome's words");
		b.reply("OLD", first);
		await b.copyDone();
		assert.deepEqual(b.clips, []);
		assert.equal(b.busy(), true, "still waiting for its own answer");
		b.advance(2001); // the first request's label restore must not touch this one
		assert.equal(b.busy(), true);
		b.reply("NEW", b.lastId());
		await b.copyDone();
		assert.deepEqual(b.clips, ["NEW"]);
	});

	it("a duplicate answer copies once", async () => {
		const b = button();
		b.click();
		b.reply("VALID", b.lastId());
		b.reply("DUPLICATE", b.lastId());
		await b.copyDone();
		assert.deepEqual(b.clips, ["VALID"]);
	});

	it("a clipboard write that outlives its request cannot finish the next one", async () => {
		const b = button();
		b.click();
		b.reply("SLOW", b.lastId());
		b.advance(3001); // the answer came, the copy did not finish
		assert.equal(b.el.textContent, "Copy failed");
		b.click();
		await b.copyDone();
		assert.equal(b.busy(), true, "the new request is still its own");
		b.reply("NEXT", b.lastId());
		await b.copyDone();
		assert.equal(b.el.textContent, "Copied to clipboard");
	});
});

// The answering side: both plugin entry points send the request's id back
// with the report, and only a string id (review of d15; the simulator echoes
// the id itself, so the panel suite cannot see this).
describe("the plugin answers a support-report request with its id", () => {
	it("the reading and dial panels' route and the Control key's both echo it", async (t) => {
		const { default: streamDeck } = await import("@elgato/streamdeck");
		const { connection } = await import(new URL("../node_modules/@elgato/streamdeck/dist/plugin/connection.js", import.meta.url));
		const { handlePiRequest } = await import(new URL("../src/pi-protocol.ts", import.meta.url));
		const { HwinfoControlAction } = await import(new URL("../src/actions/hwinfo-control.ts", import.meta.url));
		connection._registrationParameters = { pluginUUID: "test", info: { plugin: { version: "1.7.0.0" }, application: { version: "6.9.0.0", platformVersion: "10.0.19044" } } };
		const sent = [];
		t.mock.method(streamDeck.ui, "sendToPropertyInspector", async (payload) => void sent.push(payload));
		handlePiRequest({ event: "getSupportReport", requestId: "r1" });
		new HwinfoControlAction().onSendToPlugin({ payload: { event: "getSupportReport", requestId: "r2" } });
		handlePiRequest({ event: "getSupportReport", requestId: 7 });
		handlePiRequest({ event: "getSupportReport" });
		assert.deepEqual(
			sent.map((p) => p.requestId),
			["r1", "r2", undefined, undefined]
		);
		assert.ok(sent.every((p) => p.event === "supportReport" && typeof p.report === "string" && p.report.length > 0));
	});
});
