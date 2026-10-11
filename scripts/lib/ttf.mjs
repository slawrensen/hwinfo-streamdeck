// Minimal TrueType reader for C:\Windows\Fonts\tahomabd.ttf (read-only):
// table directory, head, hhea, hmtx, cmap 3/1 format 4, loca, glyf bbox, kern.
import fs from "node:fs";
export function loadFont(file) {
	const b = fs.readFileSync(file);
	const u16 = (o) => b.readUInt16BE(o), i16 = (o) => b.readInt16BE(o), u32 = (o) => b.readUInt32BE(o);
	const T = {};
	for (let i = 0; i < u16(4); i++) { const o = 12 + i * 16; T[b.toString("latin1", o, o + 4)] = { off: u32(o + 8), len: u32(o + 12) }; }
	const head = T.head.off, hhea = T.hhea.off;
	const upem = u16(head + 18), longLoca = i16(head + 50) === 1, numHM = u16(hhea + 34);
	let sub = null;
	for (let i = 0; i < u16(T.cmap.off + 2); i++) {
		const p = u16(T.cmap.off + 4 + i * 8), e = u16(T.cmap.off + 6 + i * 8), off = u32(T.cmap.off + 8 + i * 8);
		if (p === 3 && e === 1 && u16(T.cmap.off + off) === 4) sub = T.cmap.off + off;
	}
	const n = u16(sub + 6) / 2, ends = sub + 14, starts = ends + n * 2 + 2, deltas = starts + n * 2, ranges = deltas + n * 2;
	const gid = (cp) => {
		for (let i = 0; i < n; i++) {
			if (cp > u16(ends + i * 2)) continue;
			const s = u16(starts + i * 2); if (cp < s) return 0;
			const d = i16(deltas + i * 2), ro = u16(ranges + i * 2);
			if (ro === 0) return (cp + d) & 0xffff;
			const g = u16(ranges + i * 2 + ro + (cp - s) * 2);
			return g === 0 ? 0 : (g + d) & 0xffff;
		}
		return 0;
	};
	const codepoints = () => {
		const out = [];
		for (let i = 0; i < n; i++) {
			const s = u16(starts + i * 2), e = u16(ends + i * 2);
			for (let cp = s; cp <= e && cp !== 0xffff; cp++) if (gid(cp) !== 0) out.push(cp);
		}
		return out;
	};
	const adv = (g) => u16(T.hmtx.off + Math.min(g, numHM - 1) * 4);
	const loca = (g) => (longLoca ? u32(T.loca.off + g * 4) : u16(T.loca.off + g * 2) * 2);
	const metricsOfGid = (g) => {
		const a = adv(g), o0 = loca(g), o1 = loca(g + 1);
		if (o1 === o0) return { gid: g, a, lsb: 0, rsb: 0, empty: true };
		const o = T.glyf.off + o0, xMin = i16(o + 2), xMax = i16(o + 6);
		return { gid: g, a, lsb: xMin, rsb: a - xMax, xMin, xMax, empty: false };
	};
	// Legacy 'kern' table, format 0 pairs (Qt applies it when no GPOS kern).
	const kernPairs = new Map();
	if (T.kern) {
		const k = T.kern.off, nTables = u16(k + 2);
		let o = k + 4;
		for (let t = 0; t < nTables; t++) {
			const len = u16(o + 2), cov = u16(o + 4), format = cov >> 8;
			if (format === 0) {
				const nPairs = u16(o + 6);
				for (let p = 0; p < nPairs; p++) { const q = o + 14 + p * 6; kernPairs.set(`${u16(q)},${u16(q + 2)}`, i16(q + 4)); }
			}
			o += len;
		}
	}
	return {
		upem, tables: Object.keys(T), codepoints, gid,
		metrics(ch) { const g = gid(ch.codePointAt(0)); return g === 0 ? null : metricsOfGid(g); },
		kern(a, b) { return kernPairs.get(`${gid(a.codePointAt(0))},${gid(b.codePointAt(0))}`) ?? 0; },
		kernCount: kernPairs.size
	};
}
