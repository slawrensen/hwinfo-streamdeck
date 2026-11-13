/**
 * CIEDE2000 color difference (Sharma, Wu and Dalal, 2005) between two
 * validated #RRGGBB colors, through CIELAB under D65. Used to decide when two
 * authored colors read as the same on a face (the dial bar's normal color
 * against an alert fill); test/color-difference.test.ts holds the published
 * reference pairs. The way back from CIELAB to sRGB, and the gamut's edge
 * at a lightness and hue, serve a lift that holds a color's hue
 * (text-colors.ts readableColorAtHue).
 */

/** CIELAB coordinates (L*, a*, b*). */
export type Lab = readonly [number, number, number];

/** D65 reference white, Y normalized to 1. */
const WHITE_X = 0.95047;
const WHITE_Z = 1.08883;

/** sRGB #RRGGBB to CIELAB (D65, 2 degree observer). */
export function hexToLab(color: string): Lab {
	const linear = (offset: number): number => {
		const channel = parseInt(color.slice(offset, offset + 2), 16) / 255;
		return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
	};
	const r = linear(1);
	const g = linear(3);
	const b = linear(5);
	const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / WHITE_X;
	const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
	const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / WHITE_Z;
	const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
	const fx = f(x);
	const fy = f(y);
	const fz = f(z);
	return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIELAB (D65) to linear sRGB, unclamped: a channel outside [0, 1] means
 * the color lies outside the sRGB gamut. The inverse of hexToLab. */
export function labToLinearRgb(lab: Lab): [number, number, number] {
	const fy = (lab[0] + 16) / 116;
	const fx = fy + lab[1] / 500;
	const fz = fy - lab[2] / 200;
	const inverse = (t: number): number => (t * t * t > 216 / 24389 ? t * t * t : (116 * t - 16) / (24389 / 27));
	const x = inverse(fx) * WHITE_X;
	const y = inverse(fy);
	const z = inverse(fz) * WHITE_Z;
	return [3.2404542 * x - 1.5371385 * y - 0.4985314 * z, -0.969266 * x + 1.8760108 * y + 0.041556 * z, 0.0556434 * x - 0.2040259 * y + 1.0572252 * z];
}

/** Linear sRGB to #RRGGBB, each channel clamped to the gamut and rounded. */
export function linearRgbToHex(rgb: readonly [number, number, number]): string {
	const encode = (c: number): string => {
		const v = Math.min(1, Math.max(0, c));
		const s = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
		return Math.round(s * 255)
			.toString(16)
			.padStart(2, "0")
			.toUpperCase();
	};
	return `#${encode(rgb[0])}${encode(rgb[1])}${encode(rgb[2])}`;
}

const RAD = Math.PI / 180;
const POW25_7 = 25 ** 7;

/** A CIELAB color's chroma and hue (degrees, 0 to 360). */
export function chromaHue(lab: Lab): { readonly chroma: number; readonly hue: number } {
	const hue = Math.atan2(lab[2], lab[1]) / RAD;
	return { chroma: Math.hypot(lab[1], lab[2]), hue: hue < 0 ? hue + 360 : hue };
}

/** The most chroma, at most `cap`, the sRGB gamut holds at lightness L and
 * CIELAB hue `hue` (degrees). */
export function gamutChroma(L: number, hue: number, cap: number): number {
	const a = Math.cos(hue * RAD);
	const b = Math.sin(hue * RAD);
	const inside = (c: number): boolean => labToLinearRgb([L, c * a, c * b]).every((v) => v >= -1e-9 && v <= 1 + 1e-9);
	if (inside(cap)) return cap;
	let lo = 0;
	let hi = cap;
	for (let i = 0; i < 24; i++) {
		const mid = (lo + hi) / 2;
		if (inside(mid)) lo = mid;
		else hi = mid;
	}
	return lo;
}

/** The sRGB color at CIELAB lightness L and hue `hue` with the most chroma
 * the gamut holds there, at most `cap`. */
export function gamutColor(L: number, hue: number, cap: number): string {
	const c = gamutChroma(L, hue, cap);
	return linearRgbToHex(labToLinearRgb([L, c * Math.cos(hue * RAD), c * Math.sin(hue * RAD)]));
}

/** CIEDE2000 between two CIELAB colors, with kL = kC = kH = 1. */
export function ciede2000Lab(first: Lab, second: Lab): number {
	const [l1, a1, b1] = first;
	const [l2, a2, b2] = second;
	const c1 = Math.hypot(a1, b1);
	const c2 = Math.hypot(a2, b2);
	const cMean = (c1 + c2) / 2;
	const cMean7 = cMean ** 7;
	const g = 0.5 * (1 - Math.sqrt(cMean7 / (cMean7 + POW25_7)));
	const a1p = (1 + g) * a1;
	const a2p = (1 + g) * a2;
	const c1p = Math.hypot(a1p, b1);
	const c2p = Math.hypot(a2p, b2);
	const hue = (b: number, ap: number): number => {
		if (b === 0 && ap === 0) return 0;
		const h = Math.atan2(b, ap) / RAD;
		return h < 0 ? h + 360 : h;
	};
	const h1p = hue(b1, a1p);
	const h2p = hue(b2, a2p);

	const dLp = l2 - l1;
	const dCp = c2p - c1p;
	let dhp = 0;
	if (c1p * c2p !== 0) {
		dhp = h2p - h1p;
		if (dhp > 180) dhp -= 360;
		else if (dhp < -180) dhp += 360;
	}
	const dHp = 2 * Math.sqrt(c1p * c2p) * Math.sin((dhp / 2) * RAD);

	const lMean = (l1 + l2) / 2;
	const cpMean = (c1p + c2p) / 2;
	let hpMean = h1p + h2p;
	if (c1p * c2p !== 0) {
		if (Math.abs(h1p - h2p) <= 180) hpMean = (h1p + h2p) / 2;
		else if (h1p + h2p < 360) hpMean = (h1p + h2p + 360) / 2;
		else hpMean = (h1p + h2p - 360) / 2;
	}
	const t = 1 - 0.17 * Math.cos((hpMean - 30) * RAD) + 0.24 * Math.cos(2 * hpMean * RAD) + 0.32 * Math.cos((3 * hpMean + 6) * RAD) - 0.2 * Math.cos((4 * hpMean - 63) * RAD);
	const dTheta = 30 * Math.exp(-(((hpMean - 275) / 25) ** 2));
	const cpMean7 = cpMean ** 7;
	const rc = 2 * Math.sqrt(cpMean7 / (cpMean7 + POW25_7));
	const lOffset = (lMean - 50) ** 2;
	const sl = 1 + (0.015 * lOffset) / Math.sqrt(20 + lOffset);
	const sc = 1 + 0.045 * cpMean;
	const sh = 1 + 0.015 * cpMean * t;
	const rt = -Math.sin(2 * dTheta * RAD) * rc;
	const termL = dLp / sl;
	const termC = dCp / sc;
	const termH = dHp / sh;
	return Math.sqrt(termL * termL + termC * termC + termH * termH + rt * termC * termH);
}

/** CIEDE2000 between two validated #RRGGBB colors. */
export function ciede2000(a: string, b: string): number {
	return ciede2000Lab(hexToLab(a), hexToLab(b));
}
