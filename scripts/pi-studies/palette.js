/* global document */
/* Palette-placement studies (density pass, 2026-09-25). Each variant moves
   the REAL theme gallery (its element, listeners and all) to another place
   in the shipped panel; nothing is re-implemented and nothing is written.
   Loaded with ?A..?E after the panel's own scripts. Study only; never
   shipped.

   A  control: the gallery first inside Display (the candidate as built)
   B  look band: the gallery lifted out of Display into an always-open band
      right under the header, before Reading; it never folds
   C  header palette: the gallery inside the pinned header as a swatch row
      (names on hover and to screen readers), always in view
   D  Display first: the whole Display section moved above Reading
   E  pinned band: B, but the band pins together with the header */
(() => {
	const variant = (document.currentScript?.src.split("?")[1] ?? "A").slice(0, 1).toUpperCase();
	document.body.dataset.palette = variant;
	const gallery = document.getElementById("theme-gallery");
	const field = gallery?.closest(".hw-field") ?? null;
	const head = document.getElementById("hw-head");
	if (field === null || head === null) return;
	if (variant === "B" || variant === "E") {
		const band = document.createElement("section");
		band.className = "hw-look";
		band.setAttribute("aria-label", "Look");
		band.appendChild(field);
		head.after(band);
		if (variant === "E") {
			// Header and band pin together as one region.
			const pin = document.createElement("div");
			pin.className = "hw-pinwrap";
			head.before(pin);
			pin.append(head, band);
		}
	} else if (variant === "C") {
		const text = head.querySelector(".hw-head-text");
		field.classList.add("hw-head-palette");
		text?.appendChild(field);
	} else if (variant === "D") {
		const display = document.getElementById("sec-display");
		const reading = document.getElementById("sec-reading");
		if (display !== null && reading !== null) reading.before(display);
	}
})();
