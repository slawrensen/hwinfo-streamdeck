/* The support-report copy button, shared by all three property inspectors
   (control, sensor-reading, sensor-dial): asks the plugin for the redacted
   report and puts it on the clipboard. Expects #support-report.

   The report is built by the PLUGIN, so a plugin that is not running cannot
   answer and the button used to sit there disabled forever, looking broken.
   That is the one condition this button exists to diagnose (issue #17), so a
   request that goes unanswered now says so. */
/* global SDPIComponents */
(() => {
	"use strict";

	const { streamDeckClient } = SDPIComponents;
	const supportEl = document.getElementById("support-report");
	const LABEL = "Copy support report";
	/* Generous: a busy plugin still answers well inside this. */
	const ANSWER_MS = 3000;
	const RESTORE_MS = 2000;
	let waiting = null;

	function finish(text) {
		if (waiting !== null) {
			clearTimeout(waiting);
			waiting = null;
		}
		supportEl.disabled = false;
		supportEl.textContent = text;
		setTimeout(() => {
			supportEl.textContent = LABEL;
		}, RESTORE_MS);
	}

	async function copyText(text) {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch {
			const scratch = document.createElement("textarea");
			scratch.value = text;
			document.body.appendChild(scratch);
			scratch.select();
			const ok = document.execCommand("copy");
			scratch.remove();
			return ok;
		}
	}

	supportEl.addEventListener("click", () => {
		if (waiting !== null) return;
		supportEl.disabled = true;
		waiting = setTimeout(() => {
			waiting = null;
			finish("Plugin not responding");
		}, ANSWER_MS);
		streamDeckClient.send("sendToPlugin", { event: "getSupportReport" });
	});

	streamDeckClient.sendToPropertyInspector.subscribe((ev) => {
		const p = ev && ev.payload;
		if (!p || typeof p !== "object" || p.event !== "supportReport" || typeof p.report !== "string") return;
		copyText(p.report).then((ok) => {
			finish(ok ? "Copied to clipboard" : "Copy failed");
		});
	});
})();
