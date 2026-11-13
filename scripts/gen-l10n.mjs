// Writes the language files from the string catalog (src/i18n-catalog.ts):
// com.lawrensen.hwinfo.sdPlugin/en.json (manifest strings + Localization)
// and com.lawrensen.hwinfo.sdPlugin/ui/pi-strings.js (the panel catalog).
// Run after editing the catalog or the manifest's Name, Description,
// Tooltip or TriggerDescription; test/i18n.test.ts fails until you do.
//   npm run l10n
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { EN, PANEL } from "../src/i18n-catalog.ts";
import { enJson, piStringsJs } from "./lib/l10n-files.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const plugin = path.join(root, "com.lawrensen.hwinfo.sdPlugin");
const manifest = JSON.parse(readFileSync(path.join(plugin, "manifest.json"), "utf8"));
writeFileSync(path.join(plugin, "en.json"), enJson(manifest, EN));
writeFileSync(path.join(plugin, "ui", "pi-strings.js"), piStringsJs(PANEL));
console.error("wrote en.json and ui/pi-strings.js");
