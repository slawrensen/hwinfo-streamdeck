/* Study switcher: tags the body and sets the study's initial disclosure
   state. UI state only; the study never writes a setting. */
(() => {
	const study = (document.currentScript?.src.split("?")[1] ?? "a").slice(0, 1);
	document.body.dataset.study = study;
	if (study === "b" || study === "c") {
		for (const d of document.querySelectorAll("details.hw-sec")) d.open = d.id === "sec-reading";
	}
})();
