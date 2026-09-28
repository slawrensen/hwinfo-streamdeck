/* The support-report copy button, shared by all three property inspectors
   (control, sensor-reading, sensor-dial): asks the plugin for the redacted
   report and puts it on the clipboard. Expects #support-report.

   The report is built by the PLUGIN, so a plugin that is not running cannot
   answer and the button used to sit there disabled forever, looking broken.
   That is the one condition this button exists to diagnose (issue #17), so a
   request that goes unanswered now says so. */
/* global SDPIComponents, hwShell */
(() => {
	"use strict";

	const { streamDeckClient } = SDPIComponents;
	const supportEl = document.getElementById("support-report");
	const LABEL = "Copy support report";
	/* Generous: a busy plugin still answers well inside this. */
	const ANSWER_MS = 3000;
	const RESTORE_MS = 2000;
	let waiting = null;
	// The pending request, by id. Only its first answer copies, and an
	// answer, timer or clipboard write left over from an earlier request
	// never settles a later one (external review AX63).
	let pending = null;
	let latest = null;
	let restoring = null;

	// The outcome is spoken once through the panel's polite region (the
	// label alone changes for two seconds and is announced nowhere). The
	// shell says nothing on a channel's first message, so it is primed.
	// The shell is the page's global hwShell (hw is local to the other
	// panel scripts, so it is not visible here).
	const shell = typeof hwShell !== "undefined" ? hwShell : null;
	const speak = shell !== null ? (text) => shell.announce("support", text, { repeat: true }) : () => {};
	shell?.announce("support", "");

	function finish(text) {
		clearTimeout(waiting);
		waiting = null;
		pending = null;
		supportEl.removeAttribute("aria-disabled");
		supportEl.textContent = text;
		speak(text);
		clearTimeout(restoring);
		restoring = setTimeout(() => {
			supportEl.textContent = LABEL;
		}, RESTORE_MS);
	}

	async function copyText(text, request) {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch {
			// A newer request owns the clipboard now: an older write that
			// failed late copies nothing (external review AX69).
			if (latest !== request) return false;
			// The fallback selects a scratch field, which takes focus; focus
			// goes back where it was once the copy is done.
			const back = document.activeElement;
			const scratch = document.createElement("textarea");
			scratch.value = text;
			document.body.appendChild(scratch);
			scratch.select();
			const ok = document.execCommand("copy");
			scratch.remove();
			if (back instanceof HTMLElement) back.focus({ preventScroll: true });
			return ok;
		}
	}

	supportEl.addEventListener("click", () => {
		if (pending !== null) return;
		// aria-disabled, not disabled: a disabled button drops keyboard focus
		// to the page while the plugin answers. The guard above stops a
		// second request. A restore still due from the last outcome writes
		// the label shown here, and finish() cancels it.
		supportEl.textContent = LABEL;
		supportEl.setAttribute("aria-disabled", "true");
		const request = { id: Math.random().toString(36).slice(2), answered: false };
		pending = request;
		latest = request;
		waiting = setTimeout(() => finish(request.answered ? "Copy failed" : "Plugin not responding"), ANSWER_MS);
		streamDeckClient.send("sendToPlugin", { event: "getSupportReport", requestId: request.id });
	});

	streamDeckClient.sendToPropertyInspector.subscribe((ev) => {
		const p = ev && ev.payload;
		if (!p || typeof p !== "object" || p.event !== "supportReport" || typeof p.report !== "string") return;
		const request = pending;
		if (request === null || request.answered || p.requestId !== request.id) return;
		request.answered = true;
		// A copy that lands after the deadline still corrects the outcome,
		// unless a newer request has started since (pending is always null
		// or the latest request).
		copyText(p.report, request).then((ok) => {
			if (latest === request) finish(ok ? "Copied to clipboard" : "Copy failed");
		});
	});
})();
