// Production composition, identical fixtures on both sides; only the setting changes.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { renderGalleryDial } from "./lib/dial-gallery";
import { applyGlobalThemeSettings } from "../src/ui/theme-store";

const out = process.argv[2] ?? "marketing/issue-31";
const custom = process.argv.includes("--custom");
mkdirSync(out, { recursive: true });
applyGlobalThemeSettings({ theme: "void", textMode: "theme", typeAccents: custom ? "off" : "on" });
const layers = [];
for (const [row, view] of ["overview", "tworow"].entries()) {
	for (const [column, enabled] of [false, true].entries()) {
		const colors = custom && enabled ? { "31:0:1": "#4CC2FF", "31:0:2": "#FF7E8E", "31:0:3": "#38CD89", "31:0:4": "#4CC2FF", "31:0:5": "#FF7E8E" } : undefined;
		const svg = renderGalleryDial(view, !custom && enabled, colors);
		writeFileSync(path.join(out, `${custom ? "custom-" : ""}${view}-${enabled ? "on" : "off"}.svg`), svg);
		layers.push({ input: await sharp(Buffer.from(svg)).resize(600, 300).png().toBuffer(), left: 40 + column * 680, top: 132 + row * 338 });
	}
}
const board = `<svg width="1400" height="850" xmlns="http://www.w3.org/2000/svg"><rect width="1400" height="850" fill="#101116"/><g font-family="Segoe UI, Arial" fill="#EDEFF4"><text x="40" y="45" font-size="26">${custom ? "Individual reading colors" : "Color numbers by sensor type"}</text><text x="40" y="95" font-size="22">${custom ? "AUTOMATIC" : "OFF"} (released behavior)</text><text x="720" y="95" font-size="22">${custom ? "SIGNAL" : "ON"} (preview only)</text><text x="40" y="815" font-size="20">Fixed sample data through the runtime composer. Text: Theme. Type accents: ${custom ? "OFF" : "ON"}.</text></g></svg>`;
await sharp(Buffer.from(board)).composite(layers).png().toFile(path.join(out, `${custom ? "custom-" : ""}before-after.png`));
