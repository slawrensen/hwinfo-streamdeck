// Prototype only: mirrors the checked theme chip into the folded row, so
// the folded band still shows the selected theme in its own colors and
// name (Default with its link mark, drawn in the palette it follows), and
// carries the empty-key note. Production draws both from renderGallery.
(() => {
	const details = document.getElementById("sec-theme");
	const mini = document.getElementById("theme-mini");
	const gallery = document.getElementById("theme-gallery");
	const current = document.getElementById("theme-current");
	const sum = document.getElementById("theme-sum");
	const note = document.getElementById("theme-note");
	const help = document.getElementById("theme-help");
	if (details === null || mini === null || gallery === null) return;
	let noteHeld = false;
	const sync = () => {
		const chip = gallery.querySelector('.hw-theme[aria-checked="true"]');
		details.classList.toggle("hw-mini-none", chip === null);
		if (chip !== null) {
			const face = chip.querySelector(".hw-theme-face").cloneNode(true);
			face.removeAttribute("aria-hidden");
			const wrap = document.createElement("span");
			wrap.className = "hw-mini-wrap" + (chip.classList.contains("hw-theme-deck") ? " hw-theme-deck" : "");
			wrap.appendChild(face);
			mini.replaceChildren(wrap);
		} else {
			mini.replaceChildren();
		}
		if (sum !== null && current !== null) {
			const scope = current.querySelector(".hw-look-scope");
			sum.textContent = chip === null ? current.textContent.trim() : scope !== null ? scope.textContent.trim() : "";
		}
		if (note !== null && help !== null) {
			// The empty key's fact whatever theme is stored (UXR03, A1R02,
			// ADR03; production takes renderThemeHelp's own test). The slot
			// is held only while the band stays folded (UXR02, ADR02).
			const text = /^Shows on the key/.test(help.textContent) ? help.textContent : "";
			if (note.textContent !== text) note.textContent = text;
			if (text !== "" && !details.open) noteHeld = true;
			if (text === "" && details.open) noteHeld = false;
			note.classList.toggle("shown", text !== "" || noteHeld);
			note.style.minHeight = noteHeld ? "1lh" : "";
		}
	};
	details.addEventListener("toggle", sync);
	const watch = new MutationObserver(sync);
	watch.observe(gallery, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-checked"] });
	if (current !== null) watch.observe(current, { subtree: true, childList: true, characterData: true });
	if (help !== null) watch.observe(help, { subtree: true, childList: true, characterData: true });
	sync();
})();
