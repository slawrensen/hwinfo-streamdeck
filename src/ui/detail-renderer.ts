/**
 * Key faces for the drill-down detail view's navigation tiles: the
 * title/page tile and the Previous/Next pagers, plus the idle face shown
 * when the detail profile is visible with no selected state (a plugin
 * restart inside the view). Reading slots and the Back tile reuse the
 * ordinary reading renderer; these tiles are the only new furniture.
 */
import { wrapLabelTwoLines } from "./format";
import { escapeXml, FONT, renderStatusKey, svgOpen } from "./key-renderer";
import { mixToward, type TextColors } from "./text-colors";
import type { Palette } from "./themes";

export interface DetailTitleKeyOptions {
	title: string;
	/** "3-7 / 12" style range from the page projection. */
	rangeText: string;
	palette: Palette;
	text: TextColors;
}

/** The title/page tile: the group name over the visible slot range. */
export function renderDetailTitleKey(opts: DetailTitleKeyOptions): string {
	const parts = svgOpen(144, 144, opts.palette.bg);
	const lines = wrapLabelTwoLines(opts.title, 14, 14);
	const single = lines.length === 1;
	for (let i = 0; i < lines.length; i++) {
		parts.push(`<text x="72" y="${single ? 56 : 44 + i * 24}" text-anchor="middle" font-family="${FONT}" font-size="16" font-weight="600" fill="${opts.text.label}">${escapeXml(lines[i] as string)}</text>`);
	}
	parts.push(`<text x="72" y="110" text-anchor="middle" font-family="${FONT}" font-size="18" font-weight="600" fill="${opts.text.unit}">${escapeXml(opts.rangeText)}</text>`);
	parts.push("</svg>");
	return parts.join("");
}

export interface DetailPagerKeyOptions {
	direction: "previous" | "next";
	/** Boundary pages render the pager visibly disabled (dimmed chevron). */
	enabled: boolean;
	palette: Palette;
	text: TextColors;
}

/** A pager tile: one large chevron, dimmed toward the face at a boundary. */
export function renderDetailPagerKey(opts: DetailPagerKeyOptions): string {
	const color = opts.enabled ? opts.text.value : mixToward(opts.text.value, opts.palette.bg, 0.72);
	const points = opts.direction === "previous" ? "82,48 58,72 82,96" : "62,48 86,72 62,96";
	const parts = svgOpen(144, 144, opts.palette.bg);
	parts.push(`<polyline points="${points}" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`);
	parts.push("</svg>");
	return parts.join("");
}

/** The detail profile is visible but the plugin holds no selected state
 * (restart inside the view, or a stale surface after cleanup): every
 * non-Back slot says so quietly instead of guessing at old data. */
export function renderDetailIdleKey(): string {
	return renderStatusKey({ icon: "target", accent: "#4cc2ff", lines: ["No detail", "selected"] });
}

/** The Back tile with no selected state: the way out must stay obvious
 * even when the plugin cannot say what it would go back FROM. */
export function renderDetailIdleBackKey(): string {
	const parts = svgOpen(144, 144, "#000000");
	parts.push(`<polyline points="80,28 56,50 80,72" fill="none" stroke="#4cc2ff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`);
	parts.push(`<text x="72" y="104" text-anchor="middle" font-family="${FONT}" font-size="19" font-weight="600" fill="#d6d9de">Back</text>`);
	parts.push("</svg>");
	return parts.join("");
}

/** An unconfigured slot past the group's end: just the themed face. */
export function renderDetailBlankKey(palette: Palette): string {
	const parts = svgOpen(144, 144, palette.bg);
	parts.push("</svg>");
	return parts.join("");
}
