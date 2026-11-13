/**
 * The canvas open every renderer shares. Its own module so the backgrounds
 * (dial-background.ts, key-background.ts) and the key renderer can all use
 * it without importing one another in a circle.
 */

/** The SVG header plus the full-bleed background rect. */
export function svgOpen(w: number, h: number, bg: string): string[] {
	return [
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`,
		`<rect width="${w}" height="${h}" fill="${bg}"/>`
	];
}
