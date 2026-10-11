/* The HWiNFO Control panel: the header and summary say what a press does
   and which dials it reaches, from the same rules the action applies
   (an unset command is "next", the all-dials reset ignores the Target).
   The reset reach only shows for the reset command; its stored value is
   kept either way. This key has no reading, so it shows no face. */
/* global hwShell */
(() => {
	"use strict";

	const hw = hwShell;
	const reach = document.getElementById("reset-reach");
	const render = (state) => {
		const s = state.settings;
		const summary = hw.model.controlSummary(s);
		const command = document.getElementById("control-command");
		const target = document.getElementById("control-target");
		if (command.textContent !== summary.command) command.textContent = summary.command;
		const to = summary.target === "" ? "" : `Sends to ${summary.target}`;
		if (target.textContent !== to) target.textContent = to;
		reach.hidden = (s.command === undefined ? "next" : s.command) !== "resetStats";
	};
	hw.summary("command", (state) => {
		const summary = hw.model.controlSummary(state.settings);
		return summary.target === "" ? summary.command : `${summary.command} · ${summary.target}`;
	});
	hw.on("render", render);
	hw.scheduleRender();
})();
