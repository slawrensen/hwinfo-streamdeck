// What a shipped .streamDeckPlugin contains, as a list a person can review.
// scripts/validate-pack.mjs holds the packed archive AND the staging
// directory to this list: a member the archive lacks, a member it carries
// that is not listed, and a file in the staging directory that is not
// listed all fail. Adding a shipping file therefore means adding it here,
// in the same change, and a file that must never ship is named below by
// pattern. Paths are archive paths under the plugin root, forward slashes.
export const PLUGIN_ROOT = "com.lawrensen.hwinfo.sdPlugin";
export const PLUGIN_UUID = "com.lawrensen.hwinfo";

/** Every member of the package, and nothing else. */
export const SHIPPED_MEMBERS = Object.freeze([
	"LICENSE",
	"NOTICE.md",
	"manifest.json",
	"themes.json",
	"bin/hwsm.node",
	"bin/package.json",
	"bin/plugin.js",
	"imgs/actions/control/icon.svg",
	"imgs/actions/control/key.svg",
	"imgs/actions/dial/dial.svg",
	"imgs/actions/dial/icon.svg",
	"imgs/actions/reading/icon.svg",
	"imgs/actions/reading/key.svg",
	"imgs/plugin/category-icon.svg",
	"imgs/plugin/marketplace.png",
	"imgs/plugin/marketplace@2x.png",
	"layouts/sensor-dial.json",
	"profiles/detail-mini.streamDeckProfile",
	"profiles/detail-neo.streamDeckProfile",
	"profiles/detail-plus-xl.streamDeckProfile",
	"profiles/detail-plus.streamDeckProfile",
	"profiles/detail-r2-mini.streamDeckProfile",
	"profiles/detail-r2-neo.streamDeckProfile",
	"profiles/detail-r2-plus-xl.streamDeckProfile",
	"profiles/detail-r2-plus.streamDeckProfile",
	"profiles/detail-r2-standard.streamDeckProfile",
	"profiles/detail-r2-xl.streamDeckProfile",
	"profiles/detail-r3-mini.streamDeckProfile",
	"profiles/detail-r3-neo.streamDeckProfile",
	"profiles/detail-r3-plus-xl.streamDeckProfile",
	"profiles/detail-r3-plus.streamDeckProfile",
	"profiles/detail-r3-standard.streamDeckProfile",
	"profiles/detail-r3-xl.streamDeckProfile",
	"profiles/detail-standard.streamDeckProfile",
	"profiles/detail-xl.streamDeckProfile",
	"ui/control.html",
	"ui/detail-slot.html",
	"ui/pi-command.js",
	"ui/pi-common.js",
	"ui/pi-control.js",
	"ui/pi-model.js",
	"ui/pi-shell.js",
	"ui/pi-slot.js",
	"ui/pi.css",
	"ui/sdpi-components.js",
	"ui/sensor-dial.html",
	"ui/sensor-reading.html"
]);

/** Files the staging directory may hold without shipping: the plugin's own
 * log directory (written by every local run) and the vendoring script's
 * staging leftovers. Anything else unlisted in the staging directory is
 * drift and fails. */
export const STAGING_ONLY = Object.freeze([
	/^logs\//,
	/^bin\/hwsm\.node\.staging-/
]);

/** Names that must never appear in an archive whatever the list says:
 * checked by pattern so a renamed or relocated copy is still refused. */
export const FORBIDDEN_MEMBER_PATTERNS = Object.freeze([
	{ pattern: /(^|\/)logs\//, why: "log directory" },
	{ pattern: /\.log$/i, why: "log file" },
	{ pattern: /\.pdb$/i, why: "debug symbols" },
	{ pattern: /\.(?:obj|iobj|ipdb|ilk|exp|lib)$/i, why: "build intermediate" },
	{ pattern: /hwsm_test|hwsm_protomm/i, why: "test-only native addon" },
	{ pattern: /koffi/i, why: "koffi (test-only FFI)" },
	{ pattern: /\.staging-/i, why: "vendoring staging leftover" },
	{ pattern: /(^|\/)\.env(?:\.|$)/i, why: "environment file" },
	{ pattern: /(^|\/)(?:\.git|\.github|node_modules|release|docs|test|src|native)\//i, why: "repository directory" },
	{ pattern: /\.(?:pem|key|p12|pfx|md)$/i, why: "key material or internal document", except: /^NOTICE\.md$/ },
	{ pattern: /(?:^|\/)(?:Thumbs\.db|\.DS_Store|desktop\.ini)$/i, why: "OS metadata" }
]);

/** Text members that must not carry a machine-specific path or a secret. */
export const TEXT_MEMBER_PATTERN = /\.(?:js|html|css|json|svg|md)$|^LICENSE$/;
export const TEXT_MEMBER_FORBIDDEN = Object.freeze([
	// A path in JavaScript source carries its backslashes doubled.
	{ pattern: /[A-Za-z]:\\{1,2}Users\\{1,2}|\/Users\/|\/home\/[a-z]/, why: "machine-specific user path" },
	{ pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, why: "private key" },
	{ pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/, why: "GitHub token" }
]);
