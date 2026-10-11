/* The detail tile's panel: names the tile's baked role from the settings
   the app hands over at load (the same strict shapes the plugin parses in
   src/detail/slot-bindings.ts). Read-only: no socket, no write. */
(() => {
	"use strict";

	const ROLES = {
		back: ["Back tile", "Pressing it returns to the profile you came from."],
		title: ["Title tile", "Shows the view's title and which part of the list this page holds."],
		previous: ["Previous page", "Pages back through a list longer than one page."],
		next: ["Next page", "Pages forward through a list longer than one page."]
	};
	function describe(settings) {
		const slot = settings?.slot;
		if (typeof slot === "string" && Object.hasOwn(ROLES, slot)) return ROLES[slot];
		const index = settings?.index;
		if (slot === "reading" && Number.isInteger(index) && index >= 0 && index <= 255) {
			return ["Reading tile", "Shows one to four of the page's readings; a press cycles current, min, max and average for this visit. Where the opening key sits, it goes back instead, unless that key's Also go back is off."];
		}
		return ["Unrecognized detail tile", "This version does not know this tile's role; it shows an empty face and does nothing when pressed."];
	}
	window.connectElgatoStreamDeckSocket = (port, uuid, event, info, actionInfo) => {
		let settings;
		try {
			settings = JSON.parse(actionInfo)?.payload?.settings;
		} catch {
			settings = undefined;
		}
		const [role, explain] = describe(settings);
		document.getElementById("slot-role").textContent = role;
		document.getElementById("slot-explain").textContent = `${explain} This tile has no settings of its own.`;
	};
})();
