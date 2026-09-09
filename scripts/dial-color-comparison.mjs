// Production composition, identical fixtures on both sides; only the setting changes.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { renderGalleryDial } from "./lib/dial-gallery";
import { applyGlobalThemeSettings } from "../src/ui/theme-store";

const out = process.argv[2] ?? "marketing/issue-31";
mkdirSync(out, { recursive: true });
applyGlobalThemeSettings({ theme: "void", textMode: "theme", typeAccents: "on" });
const layers = [];
for (const [row, view] of ["overview", "tworow"].entries()) {
	for (const [column, enabled] of [false, true].entries()) {
		const svg = renderGalleryDial(view, enabled);
		writeFileSync(path.join(out, `${view}-${enabled ? "on" : "off"}.svg`), svg);
		layers.push({ input: await sharp(Buffer.from(svg)).resize(600, 300).png().toBuffer(), left: 40 + column * 680, top: 132 + row * 338 });
	}
}
const board = `<svg width="1400" height="850" xmlns="http://www.w3.org/2000/svg"><rect width="1400" height="850" fill="#101116"/><g font-family="Segoe UI, Arial" fill="#EDEFF4"><text x="40" y="45" font-size="26">Color numbers by sensor type</text><text x="40" y="95" font-size="22">OFF (released behavior)</text><text x="720" y="95" font-size="22">ON (preview only)</text><text x="40" y="815" font-size="20">Fixed sample data through the runtime composer. Text: Theme. Type accents: ON.</text></g></svg>`;
await sharp(Buffer.from(board)).composite(layers).png().toFile(path.join(out, "before-after.png"));
