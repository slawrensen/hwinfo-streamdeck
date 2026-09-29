/**
 * A detail list's stored cell entries through the PRODUCTION editor code
 * (external review AX19, AX29, AX47). The reading panel's detail section is
 * sliced out of ui/pi-common.js and run in a node vm over stubs for the DOM
 * and the settings store, so every edit below is the shipped function. Cell
 * entries are unique objects this build cannot read: a write must carry each
 * one exactly once, in its place, and lose only the entries of a reading the
 * person removed. Entries no reading wears (dormant cells and entries stored
 * past a tile's cells) shift with every removal and insertion before them;
 * a reading that lands in a dormant cell wears its entry, as the deck draws
 * it, and owns it from then on.
 *
 * Deliberately outside the oracle: a tile whose last reading leaves goes
 * with it, stored-only entries included, as the editor has always done.
 * Layout, focus and drag stay with scripts/e2e-pi-panels.mjs.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import vm from "node:vm";

const UI = new URL("../com.lawrensen.hwinfo.sdPlugin/ui/", import.meta.url);
const SOURCE = readFileSync(new URL("pi-common.js", UI), "utf8");
const modelScope = {};
new Function("self", readFileSync(new URL("pi-model.js", UI), "utf8"))(modelScope);

function slice(start, end) {
	const a = SOURCE.indexOf(start);
	const b = SOURCE.indexOf(end, a);
	assert.ok(a >= 0 && b > a, `pi-common.js anchors moved: ${start} / ${end}`);
	return SOURCE.slice(a, b);
}

/** The detail editor over `doc`, writing back into it the way the app
 * stores a panel's setSettings. `resize(i)` is the tile size cycler.
 * `treeEntryOf` stands in for the sensor tree: aliases of one reading. */
function editor(doc, treeEntryOf = () => null) {
	const context = {
		document: { getElementById: () => ({ addEventListener() {} }) },
		model: modelScope.hwModel,
		HEX_COLOR: /^#[0-9A-Fa-f]{6}$/,
		QUAD_DEFAULT_COLORS: ["#4CC2FF", "#FF7E8E", "#38CD89", "#D4AB33"],
		detailPicker: null,
		detailTileDrag: null,
		detailArm: null,
		detailLanded: null,
		renderDetailList() {},
		revalidateDetailAim() {},
		disarmDetailAim() {},
		updateFilterCount() {},
		speakingNotes: (fn) => fn(),
		treeEntryOf,
		sameReading: (a, b) => a === b,
		useSettings: (field) => [() => doc[field], (value) => (doc[field] = value)]
	};
	context.tileTakesCell = (tile) => context.tileReadings(tile) < tile.size || tile.size < 4;
	vm.createContext(context);
	vm.runInContext(slice("function bareKey(value)", "\n\t/** The key with its friendly"), context);
	vm.runInContext(slice("const detailListEl =", "\n\t// --- live filter"), context);
	vm.runInContext(slice("function addDetailKey(key)", "function detailChip("), context);
	const resize = slice("\t\t\t\teditTile(Number(size.dataset.tile)", "\n\t\t\t\t// Same follow").replace("Number(size.dataset.tile)", "i");
	vm.runInContext(`function resize(i) { ${resize} }
function shown() { return detailTiles; }`, context);
	context.adoptDetailKeys(doc.detailKeys);
	context.adoptDetailTiles(doc.detailTiles);
	return context;
}

const FIELDS = ["labels", "colors", "automaticColors"];
const PREFIX = { labels: "L", colors: "C", automaticColors: "A" };
const cell = (n, field) => ({ id: PREFIX[field] + n });
const tile = (size, ids, extra = {}) => ({ size, ...Object.fromEntries(FIELDS.map((f) => [f, ids.map((n) => cell(n, f))])), future: { keep: ["exact ", { nested: 1 }] }, ...extra });
// The editor writes arrays built in the vm's realm: compare plain copies.
const plain = (value) => JSON.parse(JSON.stringify(value));
const ids = (list) => plain(list ?? []).map((v) => (v !== null && typeof v === "object" ? Number(v.id.slice(1)) : v));
const tokens = (doc, field) => plain(doc.detailTiles).flatMap((t) => (t[field] ?? []).filter((v) => v !== null && typeof v === "object").map((v) => v.id)).sort();

// A cell field stored in a shape this build cannot read (not a list) stays
// exactly as stored through edits that do not write it, with or without a
// reload between them; an edit of that field may replace it (external
// review AX58).
describe("an unreadable cell field survives edits that do not write it", () => {
	const shapes = [null, 17, "future", { future: [" x ", false] }];
	for (const field of FIELDS) {
		for (const shape of shapes) {
			it(`${field} stored as ${JSON.stringify(shape)}: the Abc toggle leaves it alone`, () => {
				const stored = { detailKeys: ["a", "b"], detailTiles: [{ size: 2, labels: ["A", "B"], colors: ["#123456", "#234567"], automaticColors: [false, false], [field]: shape, unknown: { keep: 1 } }], futureTop: [" y "] };
				editor(stored).editTile(0, (t) => (t.cellLabels = false));
				assert.deepEqual(plain(stored.detailTiles[0][field]), shape);
				assert.equal(stored.detailTiles[0].cellLabels, false);
				editor(stored).editTile(0, (t) => (t.cellLabels = true)); // after a reload
				assert.deepEqual(plain(stored.detailTiles[0][field]), shape);
				assert.deepEqual(plain(stored.detailTiles[0].unknown), { keep: 1 });
				assert.deepEqual(stored.futureTop, [" y "]);
			});
		}
	}
	// Removing, resizing or moving cells writes nothing into such a field
	// while every cell still reads as neutral (review of d15). A move inside
	// a four-reading tile is left out for colors: it writes the identity
	// color each moved chip showed, on purpose.
	for (const field of ["labels", "colors"]) {
		for (const [name, run] of [
			["a removal", (c) => c.removeDetailKey("c")],
			["a resize", (c) => c.resize(0)],
			...(field === "labels" ? [["a move", (c) => c.moveDetailKey("d", 0)]] : [])
		]) {
			it(`${field} stored as an object: ${name} leaves it alone`, () => {
				const stored = { detailKeys: ["a", "b", "c", "d"], detailTiles: [{ size: 4, [field]: { future: "keep" } }] };
				run(editor(stored));
				assert.deepEqual(plain(stored.detailTiles[0][field]), { future: "keep" });
			});
		}
	}
	it("an edit of that field writes it as a list", () => {
		const stored = { detailKeys: ["a", "b"], detailTiles: [{ size: 2, labels: { future: "keep" } }] };
		editor(stored).editDetailCell("b", (t, i) => (t.labels[i] = "Two"));
		assert.deepEqual(plain(stored.detailTiles[0].labels), ["", "Two"]);
	});
});

describe("structural detail edits keep every stored cell entry in its place", () => {
	const cases = [
		{ name: "a reading removed from a partial tile takes only its own entries; the dormant ones move up", doc: { detailKeys: [" a name ", "\tb named "], detailTiles: [tile(4, [1, 2, 3, 4])] }, run: (c) => c.removeDetailKey("a"), cells: [2, 3, 4] },
		{ name: "a tile shrunk and grown back keeps its dormant entries", doc: { detailKeys: [" a name "], detailTiles: [tile(4, [1, 2, 3, 4])] }, run: (c) => (c.resize(0), c.resize(0)), cells: [1, 2, 3, 4] },
		{ name: "a chip inserted into a partial tile pushes the dormant entries on, past its size", doc: { detailKeys: [" a name ", " b name "], detailTiles: [tile(1, [1]), tile(4, [2, 3, 4, 5])] }, run: (c) => c.moveDetailChip("a", "b", true), cells: [2, 1, 3, 4, 5] },
		{ name: "an inserted chip removed again puts the dormant entries back", doc: { detailKeys: [" a name ", " b name "], detailTiles: [tile(1, [1]), tile(4, [2, 3, 4, 5])] }, run: (c) => (c.moveDetailChip("a", "b", true), c.removeDetailKey("a")), cells: [2, 3, 4, 5] },
		{ name: "two removals without a reload", doc: { detailKeys: [" a name ", " b name ", " c name "], detailTiles: [tile(4, [1, 2, 3, 4])] }, run: (c) => (c.removeDetailKey("a"), c.removeDetailKey("b")), cells: [3, 4] },
		{ name: "a new pick lands in a dormant cell and wears its entries, written once", doc: { detailKeys: [" a name "], detailTiles: [tile(4, [1, 2, 3, 4])] }, run: (c) => c.addDetailKey("b"), cells: [1, 2, 3, 4] },
		{ name: "a pick owns the dormant entries it landed on: removing it removes them", doc: { detailKeys: [" a name "], detailTiles: [tile(4, [1, 2, 3, 4])] }, run: (c) => (c.addDetailKey("b"), c.removeDetailKey("b")), cells: [1, 3, 4] },
		{ name: "a whole source picked into dormant cells, then its first reading removed", doc: { detailKeys: [" a name "], detailTiles: [tile(4, [1, 2, 3, 4])] }, run: (c) => (c.addDetailSource({ readings: [{ key: "b" }, { key: "c" }] }), c.removeDetailKey("b")), cells: [1, 3, 4] },
		{ name: "the fourth reading of a full quad removed: the entry past the cells moves up with the rest", doc: { detailKeys: ["a", "b", "c", "d"], detailTiles: [tile(4, [1, 2, 3, 4, 5])] }, run: (c) => c.removeDetailKey("d"), cells: [1, 2, 3, 5] }
	];
	for (const { name, doc, run, cells } of cases) {
		it(name, () => {
			const stored = structuredClone({ ...doc, futureTop: { keep: "yes" } });
			run(editor(stored));
			for (const field of FIELDS) assert.deepEqual(ids(stored.detailTiles[0][field]), cells, field);
			assert.deepEqual(plain(stored.detailTiles[0].future), { keep: ["exact ", { nested: 1 }] });
			assert.deepEqual(stored.futureTop, { keep: "yes" });
		});
	}

	it("a whole-tile move keeps the moved tile's dormant entries and unknown fields", () => {
		const stored = { detailKeys: [" a name ", " b name "], detailTiles: [tile(1, [1]), tile(4, [2, 3, 4, 5])] };
		editor(stored).moveDetailTile(1, 0);
		assert.deepEqual(plain(stored.detailTiles).flatMap((t) => ids(t.labels)), [2, 3, 4, 5, 1]);
	});

	it("an edit elsewhere leaves short stored lists short, and a cleared last label keeps its slot", () => {
		const stored = { detailKeys: [" a name ", "b"], detailTiles: [{ size: 2, labels: [" one ", "two"], colors: [], automaticColors: [], future: 1 }] };
		const c = editor(stored);
		c.editDetailCell("a", (t, i) => (t.labels[i] = "edited"));
		assert.deepEqual(plain(stored.detailTiles[0]), { size: 2, labels: ["edited", "two"], colors: [], automaticColors: [], future: 1 });
		c.editDetailCell("b", (t, i) => (t.labels[i] = ""));
		assert.deepEqual(plain(stored.detailTiles[0].labels), ["edited", ""], "an entry the person cleared stays an entry");
	});

	it("a short stored list stays short when a reading before its end is removed", () => {
		const stored = { detailKeys: ["a", "b"], detailTiles: [{ size: 3, labels: ["A", "B"], colors: ["#111111"] }] };
		editor(stored).removeDetailKey("a");
		assert.deepEqual(plain(stored.detailTiles), [{ size: 2, labels: ["B"], colors: [] }]);
	});

	it("a full stored list keeps its length when a reading with nothing stored moves into its last cell", () => {
		const stored = { detailKeys: ["a", "b", "c", "d", "e"], detailTiles: [{ size: 4, labels: ["", "", "", "MINE"] }] };
		editor(stored).moveDetailKey("d", 5);
		assert.deepEqual(plain(stored.detailTiles), [{ size: 4, labels: ["", "", "", ""] }, { size: 1, labels: ["MINE"], colors: [null], cellLabels: true }]);
	});

	// Readable values, as a person sees them (review of d14): a pick wears the
	// dormant label it lands on and nothing is written twice, with or without
	// a reload between picks, and a full round of the size cycler with a
	// reload after every press comes back to the stored plan it started from.
	it("readable: a pick wears the dormant label once, before and after a reload", () => {
		const stored = { detailKeys: ["a"], detailTiles: [{ size: 4, labels: ["A", "B", "C", "D"], colors: ["#111111", "#222222", "#333333", "#444444"] }] };
		let c = editor(stored);
		c.addDetailKey("b");
		assert.deepEqual(plain(stored.detailTiles), [{ size: 4, labels: ["A", "B", "C", "D"], colors: ["#111111", "#222222", "#333333", "#444444"] }]);
		assert.deepEqual(plain(c.shown()[0].labels), ["A", "B", "C", "D"], "the pick shows the label it is written with");
		c = editor(stored);
		c.addDetailKey("c");
		assert.deepEqual(plain(stored.detailTiles[0].labels), ["A", "B", "C", "D"]);
	});
	it("readable: a round of the size cycler with reloads comes back to where it started", () => {
		const start = { detailKeys: ["a", "b", "c"], detailTiles: [{ size: 1, labels: ["A"] }, { size: 2, labels: ["B", "C"] }] };
		const stored = structuredClone(start);
		for (let round = 0; round < 3; round++) {
			for (let press = 0; press < 4; press++) editor(stored).resize(0);
			assert.ok(plain(stored.detailTiles).every((t) => (t.labels?.length ?? 0) <= 4), JSON.stringify(stored.detailTiles));
		}
		// As shown: a missing entry reads as a blank label.
		const shown = (tiles) => tiles.map((t) => [t.size, Array.from({ length: t.size }, (_, i) => t.labels?.[i] ?? "")]);
		assert.deepEqual(shown(plain(stored.detailTiles)), shown(start.detailTiles));
	});

	it("reading a written list back and writing it again changes nothing", () => {
		const stored = { detailKeys: [" a name ", " b name "], detailTiles: [tile(1, [1]), tile(4, [2, 3, 4, 5])] };
		editor(stored).moveDetailChip("a", "b", true);
		const written = plain(stored);
		editor(stored).writeDetailState();
		assert.deepEqual(plain(stored), written);
	});

	// A seeded walk over the structural edits, with reloads between them. The
	// oracle follows the entry objects alone: every one stays stored exactly
	// once until the reading that wears it (the one at its cell) is removed.
	it("a seeded walk of removals, moves, resizes, picks and reloads loses no entry", () => {
		let seed = 0x0d14a47;
		const rnd = (n) => {
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
			return seed % n;
		};
		let steps = 0;
		for (let run = 0; run < 250; run++) {
			const size = 2 + rnd(3);
			const filled = 1 + rnd(size - 1);
			const count = 2 + filled;
			const keys = Array.from({ length: count }, (_, i) => `${[" ", "\t", ""][rnd(3)]}k${i} name ${run}`);
			const stored = { detailKeys: keys, detailTiles: [tile(2, [0, 1]), tile(size, Array.from({ length: size + rnd(3) }, (_, i) => i + 2))], futureTop: { run } };
			const alive = new Set(Array.from({ length: 2 + size + 3 }, (_, i) => i).filter((i) => stored.detailTiles.some((t) => ids(t.labels).includes(i))));
			let c = editor(stored);
			let fresh = 0;
			const history = [];
			for (let step = 0; step < 16; step++) {
				const listed = [...c.listedDetailKeys()];
				if (listed.length === 0) break;
				const walk = c.detailTileWalk();
				const key = listed[rnd(listed.length)];
				const home = walk.find((t) => listed.indexOf(key) >= t.head && listed.indexOf(key) < t.head + t.size);
				const op = rnd(7);
				if (op === 0) {
					// A tile's last reading takes the tile with it: outside the oracle.
					if (c.tileReadings(home) < 2) continue;
					// What the reading wears is the entry stored at its cell.
					const worn = plain(stored.detailTiles)[walk.indexOf(home)]?.labels?.[listed.indexOf(key) - home.head];
					c.removeDetailKey(key);
					if (worn !== null && typeof worn === "object") alive.delete(Number(worn.id.slice(1)));
				} else if (op === 1) {
					c.moveDetailKey(key, rnd(listed.length + 1));
				} else if (op === 2) {
					c.moveDetailTile(rnd(walk.length), rnd(walk.length + 1));
				} else if (op === 3) {
					// The cycler resizes a one-reading tile; a wider one would push
					// readings into other tiles' dressed cells, which is AX19's rule.
					const one = walk.map((t, i) => [t, i]).filter(([t]) => c.tileReadings(t) === 1);
					if (one.length === 0) continue;
					c.resize(one[rnd(one.length)][1]);
				} else if (op === 4) {
					if (c.tileReadings(home) < 2) continue;
					c.moveDetailChip(key, listed[rnd(listed.length)], rnd(2) === 1);
				} else if (op === 5) {
					c.addDetailKey(`n${run}x${fresh++}`);
				} else {
					c = editor(stored);
				}
				history.push(op);
				steps++;
				for (const field of FIELDS) {
					assert.deepEqual(tokens(stored, field), [...alive].map((n) => PREFIX[field] + n).sort(), `run ${run} ops ${history.join(",")} ${field}`);
				}
				assert.deepEqual(plain(stored.futureTop), { run });
			}
		}
		assert.ok(steps > 2500, `the walk ran ${steps} edits`);
	});
});

// Readable entries, one edit each, with the stored tiles written out whole.
// The rules: a short stored list stays short (AX33) and its end moves with
// the cells (AX47); an entry holding nothing gives up its slot; a reading
// that lands in a dormant cell wears that cell's entries, and no other
// reading does.
describe("readable entries through single structural edits", () => {
	// "a~2" names the same reading as "a": the list hides it as a duplicate.
	const aliases = (key) => (key.includes("~") ? { reading: { key: key.split("~")[0] } } : null);
	const cases = [
		{ name: "a chip inserted past the end of a short list leaves it short", doc: { detailKeys: ["a", "b", "c"], detailTiles: [{ size: 2, labels: [] }, { size: 1 }] }, run: (c) => c.moveDetailChip("c", "a", true), tiles: [{ size: 3, labels: [], colors: [null, null, null] }] },
		{ name: "a parked chip leaves a list a removal shortened short", doc: { detailKeys: ["a", "b", "c", "d"], detailTiles: [{ size: 3, labels: ["A", "B"] }, { size: 1, labels: ["D"] }] }, run: (c) => (c.removeDetailKey("a"), c.moveDetailChip("d", null)), tiles: [{ size: 2, labels: ["B"], colors: [null, null] }, { size: 1, labels: ["D"], colors: [null], cellLabels: true }] },
		{ name: "a hidden duplicate's cell leaves the short list short", doc: { detailKeys: ["a", "a~1", "c"], detailTiles: [{ size: 3, labels: ["A", "B"] }] }, run: (c) => c.editTile(0, (t) => (t.cellLabels = false)), tiles: [{ size: 2, labels: ["A"], colors: [null, null], cellLabels: false }] },
		{ name: "a blank dormant entry a pick lands on gives up its slot when the pick moves on", doc: { detailKeys: ["a", "b"], detailTiles: [{ size: 1, labels: ["A"] }, { size: 2, labels: ["", ""] }] }, run: (c) => (c.addDetailKey("c"), c.moveDetailChip("c", "a", true)), tiles: [{ size: 2, labels: ["A"], colors: [null, null] }] },
		{ name: "a blank dormant entry a pick lands on gives up its slot when a resize moves the pick on", doc: { detailKeys: ["a"], detailTiles: [{ size: 2, labels: ["A", ""] }] }, run: (c) => (c.addDetailKey("b"), c.resize(0), c.resize(0), c.resize(0)), tiles: [{ size: 1, labels: ["A"], colors: [null] }] },
		{ name: "a reading a resize flows into a dormant cell wears its label", doc: { detailKeys: ["a", "b"], detailTiles: [{ size: 1, labels: ["A", "B"] }] }, run: (c) => c.resize(0), tiles: [{ size: 2, labels: ["A", "B"], colors: [null, null] }] },
		{ name: "a pick landing in a later tile's dormant cell takes that cell's entry, and its neighbor keeps its own", doc: { detailKeys: ["a", "b"], detailTiles: [{ size: 1 }, { size: 2, labels: [" b ", " C "] }] }, run: (c) => c.addDetailKey("c"), tiles: [{ size: 1 }, { size: 2, labels: [" b ", " C "] }] },
		{ name: "a chip moved out of a tile moves the entry stored past its cells up", doc: { detailKeys: ["a", "b", "c"], detailTiles: [{ size: 2, labels: ["A", "B", "X"] }, { size: 1, labels: ["C"] }] }, run: (c) => c.moveDetailChip("a", "c", true), tiles: [{ size: 1, labels: ["B", "X"], colors: [null] }, { size: 2, labels: ["C", "A"], colors: [null, null] }] },
		{ name: "a chip inserted into a partial tile pushes a dormant entry on, never wears it", doc: { detailKeys: ["a", "x", "b"], detailTiles: [{ size: 2 }, { size: 3, labels: ["B", "D"] }] }, run: (c) => c.moveDetailChip("a", "b", true), tiles: [{ size: 1, labels: [""], colors: [null] }, { size: 3, labels: ["B", "", "D"] }] }
	];
	for (const { name, doc, run, tiles } of cases) {
		it(name, () => {
			const stored = structuredClone(doc);
			run(editor(stored, aliases));
			assert.deepEqual(plain(stored.detailTiles), tiles);
		});
	}

	it("a stored tile that is not an object does not stop the list hiding a duplicate", () => {
		const c = editor({ detailKeys: ["a", "b", "a~2"], detailTiles: [5] }, aliases);
		assert.deepEqual(plain(c.listedDetailKeys()), ["a", "b"]);
	});
});
