/**
 * The Sensor Dial panel's two models from the bytes the panel loads, in its
 * order: ui/pi-model.js, then ui/pi-strip-model.js, into one `self`. The
 * strip model reads the filter grammar from self.hwModel as it loads, so a
 * suite that runs it loads both through here.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ui = (name: string): string => readFileSync(fileURLToPath(new URL(`../com.lawrensen.hwinfo.sdPlugin/ui/${name}`, import.meta.url)), "utf8");

export function loadPanelModels<Strip = Record<string, unknown>, Panel = Record<string, unknown>>(): { hwStripModel: Strip; hwModel: Panel } {
	const scope: { hwStripModel?: Strip; hwModel?: Panel } = {};
	new Function("self", ui("pi-model.js"))(scope);
	new Function("self", ui("pi-strip-model.js"))(scope);
	return { hwStripModel: scope.hwStripModel as Strip, hwModel: scope.hwModel as Panel };
}
