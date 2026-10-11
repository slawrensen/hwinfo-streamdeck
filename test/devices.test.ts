// Device capability derivation: one fixture per hardware family the plugin
// can meet, plus the unknown-future-device fallback. The table must never
// gate live events, so these tests only assert derived facts (grid, encoder
// count, touch geometry, kind), not behavior. The plugin's own device
// boundary (describing a device and ingesting its events) is held at the end.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { DeviceType } from "@elgato/schemas/streamdeck/plugins";

import { deriveCapabilities, deviceCapabilities, tapCanvasWidth, TOUCH_SEGMENT } from "../src/devices";

describe("deriveCapabilities", () => {
	it("Stream Deck + XL: 9x4 keys, six encoders, 200x100 touch segments", () => {
		const caps = deriveCapabilities({ type: 13, columns: 9, rows: 4 });
		assert.equal(caps.model, "Stream Deck + XL");
		assert.equal(caps.keys, 36);
		assert.equal(caps.encoders, 6);
		assert.deepEqual(caps.touch, { width: 200, height: 100 });
		assert.equal(caps.kind, "keys+dials");
		assert.equal(caps.known, true);
	});

	it("Stream Deck +: 4x2 keys, four encoders, touch strip", () => {
		const caps = deriveCapabilities({ type: 7, columns: 4, rows: 2 });
		assert.equal(caps.encoders, 4);
		assert.deepEqual(caps.touch, TOUCH_SEGMENT);
		assert.equal(caps.kind, "keys+dials");
	});

	it("Stream Deck XL: 8x4 key grid, no encoders", () => {
		const caps = deriveCapabilities({ type: 2, columns: 8, rows: 4 });
		assert.equal(caps.keys, 32);
		assert.equal(caps.encoders, 0);
		assert.equal(caps.touch, null);
		assert.equal(caps.kind, "keys");
	});

	it("15-key family: 5x3", () => {
		const caps = deriveCapabilities({ type: 0, columns: 5, rows: 3 });
		assert.equal(caps.keys, 15);
		assert.equal(caps.kind, "keys");
	});

	it("Stream Deck Mini: 3x2, no encoders", () => {
		const caps = deriveCapabilities({ type: 1, columns: 3, rows: 2 });
		assert.equal(caps.model, "Stream Deck Mini");
		assert.equal(caps.keys, 6);
		assert.equal(caps.encoders, 0);
		assert.equal(caps.touch, null);
		assert.equal(caps.kind, "keys");
	});

	it("Stream Deck Neo: 4x2", () => {
		const caps = deriveCapabilities({ type: 9, columns: 4, rows: 2 });
		assert.equal(caps.keys, 8);
		assert.equal(caps.encoders, 0);
		assert.equal(caps.kind, "keys");
	});

	it("Mobile and Virtual decks take the grid the app reports, not a table", () => {
		assert.equal(deriveCapabilities({ type: 3, columns: 3, rows: 5 }).keys, 15);
		assert.equal(deriveCapabilities({ type: 11, columns: 8, rows: 8 }).keys, 64);
		assert.equal(deriveCapabilities({ type: 11, columns: 1, rows: 1 }).keys, 1);
	});

	it("Pedal and G-keys are headless: key input without a display", () => {
		for (const type of [5, 4, 8]) {
			const caps = deriveCapabilities({ type, columns: 3, rows: 1 });
			assert.equal(caps.displayCapable, false, `type ${type}`);
			assert.equal(caps.kind, "headless", `type ${type}`);
		}
	});

	it("Studio and Galleon stay unclaimed until hardware-verified: unknown fallback", () => {
		// Not in the table: the Studio has no drawable dial strip, and the
		// Galleon's 720x384 screen is not the 200x100-per-encoder strip
		// class this plugin renders (and takes no touch input). Unknown
		// fallback until a real support pass; see docs/hardware.md.
		for (const [type, columns, rows] of [
			[10, 16, 2],
			[12, 3, 4]
		] as const) {
			const caps = deriveCapabilities({ type, columns, rows });
			assert.equal(caps.known, false, `type ${type}`);
			assert.equal(caps.encoders, 0, `type ${type}`);
			assert.equal(caps.touch, null, `type ${type}`);
			assert.equal(caps.kind, "keys", `type ${type}`);
		}
	});

	it("an unknown future device degrades to a safe keys profile", () => {
		const caps = deriveCapabilities({ type: 99, columns: 6, rows: 6 });
		assert.equal(caps.known, false);
		assert.equal(caps.model, "Unknown device (type 99)");
		assert.equal(caps.keys, 36);
		assert.equal(caps.encoders, 0);
		assert.equal(caps.touch, null);
		assert.equal(caps.displayCapable, true); // rendering is a harmless no-op
		assert.equal(caps.kind, "keys");
	});

	it("a device event with nothing usable still yields a capability object", () => {
		const caps = deriveCapabilities({});
		assert.equal(caps.known, false);
		assert.equal(caps.keys, 0);
		assert.equal(caps.kind, "headless");
	});
});

// Host input is untyped at runtime: only an own, whole, non-negative number
// names a model (external review AX66).
describe("deriveCapabilities with malformed types", () => {
	it("inherited names, strings, objects and non-integers are unknown devices, never coerced", () => {
		const odd: unknown[] = ["__proto__", "constructor", "toString", "13", "", null, [], { toString: null }, { toString: 0, valueOf: 0 }, -1, 0.5, Number.NaN, Infinity, -Infinity, true];
		for (const type of odd) {
			const caps = deriveCapabilities({ type: type as number, columns: 5, rows: 3 });
			assert.equal(caps.known, false, JSON.stringify(type));
			assert.equal(caps.type, undefined);
			assert.equal(caps.model, "Unknown device");
			assert.equal(caps.kind, "keys", "a key grid still draws");
		}
	});

	it("a grid that is not whole non-negative numbers reads as no keys, never coerced", () => {
		for (const columns of ["5", null, { toString: null }, -1, 2.5, Number.NaN]) {
			const caps = deriveCapabilities({ type: 13, columns: columns as number, rows: 4 });
			assert.equal(caps.columns, 0, JSON.stringify(columns));
			assert.equal(caps.keys, 0);
			assert.equal(caps.kind, "dials", "the + XL still has its dials");
		}
	});

	it("every numeric type and grid derives as before", () => {
		for (let type = 0; type < 32; type++) {
			const caps = deriveCapabilities({ type, columns: 0, rows: 0 });
			assert.equal(caps.type, type);
			assert.equal(caps.model === `Unknown device (type ${type})`, !caps.known, `type ${type}`);
		}
		assert.equal(deriveCapabilities({ type: 13, columns: 9, rows: 4 }).model, "Stream Deck + XL");
	});
});

describe("tapCanvasWidth", () => {
	it("uses the touch segment width, falling back to the SDK's 200", () => {
		assert.equal(tapCanvasWidth(deriveCapabilities({ type: 13, columns: 9, rows: 4 })), 200);
		// An unlisted/unknown device can still surprise us with a tap.
		assert.equal(tapCanvasWidth(deriveCapabilities({ type: 10, columns: 16, rows: 2 })), 200);
		assert.equal(tapCanvasWidth(deriveCapabilities({})), 200);
	});
});

// Execute only the two device-boundary declarations, never the plugin entry
// point. The real derivation and registry remain in use behind this boundary.
describe("the plugin device boundary", () => {
	const source = readFileSync(new URL("../src/plugin.ts", import.meta.url), "utf8");
	const ast = ts.createSourceFile("plugin.ts", source, ts.ScriptTarget.Latest, true);
	const declarations = ast.statements.filter((statement) => ts.isVariableStatement(statement)
		&& statement.declarationList.declarations.some((declaration) => ts.isIdentifier(declaration.name)
			&& ["describeDevice", "ingestDevice"].includes(declaration.name.text)));
	assert.equal(declarations.length, 2, "both production device-boundary declarations must be present");
	const compiled = ts.transpileModule(declarations.map((statement) => statement.getText(ast)).join("\n"), {
		compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
	}).outputText;
	const boundary = runInNewContext(`${compiled}\n({ describeDevice, ingestDevice });`, {
		deriveCapabilities, deviceCapabilities, DeviceType
	}) as { describeDevice(device: unknown): string; ingestDevice(device: unknown): void };

	it("stores the reported model and grid and replaces them on a later device event", () => {
		const id = "plugin-boundary-test";
		boundary.ingestDevice({ id, type: 7, size: { columns: 4, rows: 2 } });
		assert.equal(deviceCapabilities.get(id).model, "Stream Deck +");
		assert.equal(deviceCapabilities.get(id).keys, 8);
		assert.equal(deviceCapabilities.get(id).encoders, 4);
		boundary.ingestDevice({ id, type: 13, size: { columns: 9, rows: 4 } });
		assert.equal(deviceCapabilities.get(id).model, "Stream Deck + XL");
		assert.equal(deviceCapabilities.get(id).keys, 36);
		assert.equal(deviceCapabilities.get(id).encoders, 6);
	});

	it("describes known and future numeric types without losing the name or grid", () => {
		assert.equal(boundary.describeDevice({ name: "Desk\nA", type: 13, size: { columns: 9, rows: 4 } }), '"Desk\\nA" (StreamDeckPlusXL, 9x4)');
		assert.equal(boundary.describeDevice({ name: "Future", type: 99, size: { columns: 6, rows: 6 } }), '"Future" (type 99, 6x6)');
	});

	it("quotes malformed type values without coercion or inherited enum lookup", () => {
		for (const type of ["StreamDeckPlusXL", "constructor", { toString: null }]) {
			assert.equal(boundary.describeDevice({ name: "Desk", type, size: { columns: 5, rows: 3 } }), `"Desk" (type ${JSON.stringify(type)}, 5x3)`);
		}
	});
});
