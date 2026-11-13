/* The HWiNFO Control panel: the header and summary say what a press does
   and which dials (or strips, for a Strip command) it reaches, from the
   same rules the action applies (an unset command is "next", the
   all-dials reset ignores the Link ID).
   The reset reach only shows for the reset command; its stored value is
   kept either way. This key has no reading, so it shows no face. */
/* global hwShell */
(() => {
	"use strict";

	const hw = hwShell;
	const reach = document.getElementById("reset-reach");
	const snoozeHelp = document.getElementById("snooze-help");
	const targetHelp = document.getElementById("target-text");
	const DIAL_HELP = targetHelp.textContent;
	const field = document.getElementById("f-target");
	const DIAL_EMPTY = field.placeholder;
	const STRIP_HELP = "Steers only the strips with this Strip Link ID.";
	const render = (state) => {
		const s = state.settings;
		const summary = hw.model.controlSummary(s);
		const command = document.getElementById("control-command");
		const target = document.getElementById("control-target");
		if (command.textContent !== summary.command) command.textContent = summary.command;
		const to = summary.target === "" ? "" : `Sends to ${summary.target}`;
		if (target.textContent !== to) target.textContent = to;
		const id = s.command === undefined ? "next" : s.command;
		reach.hidden = id !== "resetStats";
		// The snooze note shows with the two snooze commands only.
		if (snoozeHelp !== null) snoozeHelp.hidden = id !== "snoozeAlerts" && id !== "unsnoozeAlerts";
		const help = typeof id === "string" && id.startsWith("strip") ? STRIP_HELP : DIAL_HELP;
		if (targetHelp.textContent !== help) targetHelp.textContent = help;
		// An empty Link ID reaches every strip under a Strip command.
		const empty = typeof id === "string" && id.startsWith("strip") ? "Every strip" : DIAL_EMPTY;
		if (field.placeholder !== empty) field.placeholder = empty;
	};
	hw.summary("command", (state) => {
		const summary = hw.model.controlSummary(state.settings);
		return summary.target === "" ? summary.command : `${summary.command} · ${summary.target}`;
	});
	hw.on("render", render);
	hw.scheduleRender();
})();
