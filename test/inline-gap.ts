/**
 * The device gap fix (bench 2026-09-23) as a counted, reversible transform.
 * The Stream Deck app draws key and dial faces with QtSvg, which ignores dx
 * on a tspan, so the gap before a unit or badge moved from dx="6" on the
 * tspan to a space character inside it (an en space up to 14 px, a
 * three-per-em space above), and each text element carrying one gained
 * xml:space="preserve". beforeInlineGap puts the older bytes back so the
 * historical goldens keep their hashes; `sites` states how many gaps the
 * face must carry, so every other difference still fails.
 */
import assert from "node:assert/strict";

const GAP = /<tspan ([^>]*)>[\u2002\u2004]/g;
const PRESERVE = ' xml:space="preserve"';

export function beforeInlineGap(svg: string, sites: number): string {
	const found = svg.match(GAP)?.length ?? 0;
	assert.equal(found, sites, `the face carries ${found} inline gaps, expected ${sites}`);
	const preserved = svg.split(PRESERVE).length - 1;
	assert.ok(sites === 0 ? preserved === 0 : preserved >= 1 && preserved <= sites, `xml:space="preserve" on ${preserved} text elements for ${sites} gaps`);
	return svg.replace(GAP, '<tspan dx="6" $1>').replaceAll(PRESERVE, "");
}

/** How many gaps a face from before the fix drew: its dx="6" tspans. */
export function gapSitesIn(historical: string | undefined): number {
	assert.ok(historical !== undefined, "no historical face to count");
	return historical.split('<tspan dx="6" ').length - 1;
}
