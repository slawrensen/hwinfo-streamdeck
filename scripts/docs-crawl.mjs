// Crawls a published docs site and reports what a reader would hit: every
// internal page reachable from the root, each internal link, image and
// anchor on it, and the private paths that must answer 404. Nothing here
// renders or scripts the page; the browser journeys are a separate pass.
//
//   node scripts/docs-crawl.mjs https://docs.slawrensen.com/hwinfo-streamdeck/
//   node scripts/docs-crawl.mjs https://docs.slawrensen.com/hwinfo-streamdeck-preview/ --expect "1.6.0"
//
// Exit 1 on any broken link, image or anchor, on a private path that
// serves, or on a page missing the --expect text. Prints a summary table.
const root = process.argv[2];
if (typeof root !== "string" || !/^https?:\/\//.test(root)) {
	console.error("usage: node scripts/docs-crawl.mjs <site root url> [--expect <text>]");
	process.exit(2);
}
const expectAt = process.argv.indexOf("--expect");
const expectText = expectAt === -1 ? null : process.argv[expectAt + 1] ?? null;
const base = new URL(root.endsWith("/") ? root : `${root}/`);

/** Paths that the site's _config.yml excludes; any 200 here is a leak. */
const PRIVATE = ["release/RELEASE_RUNBOOK.html", "release/COPY_RULES.html", "release/STREAM_DECK_MARKETPLACE.html", "release/", "release/evidence/", "README.html"];
/** Strings that never belong in a public page. */
const LEAK = [/C:\\Users\\/i, /RELEASE_RUNBOOK/, /STREAM_DECK_MARKETPLACE/, /\.private\b/, /hwinfoden|hwinfospk/, /ghp_[A-Za-z0-9]{20,}/];

const seen = new Map(); // url -> { status, html }
const problems = [];
const queue = [base.href];

async function fetchPage(url) {
	if (seen.has(url)) return seen.get(url);
	let status;
	let html;
	let type = "";
	try {
		const res = await fetch(url, { redirect: "follow" });
		status = res.status;
		type = res.headers.get("content-type") ?? "";
		html = type.includes("text/html") ? await res.text() : "";
	} catch (err) {
		status = -1;
		html = String(err);
	}
	const entry = { status, html, type };
	seen.set(url, entry);
	return entry;
}

const isInternal = (u) => u.origin === base.origin && u.pathname.startsWith(base.pathname);
const attr = (html, re) => [...html.matchAll(re)].map((m) => m[1]);

while (queue.length > 0) {
	const url = queue.shift();
	const page = await fetchPage(url);
	if (page.status !== 200) {
		problems.push(`${url}: HTTP ${page.status}`);
		continue;
	}
	if (page.html === "") continue;
	if (expectText !== null && !page.html.includes(expectText)) {
		problems.push(`${url}: missing expected text "${expectText}"`);
	}
	for (const re of LEAK) {
		if (re.test(page.html)) problems.push(`${url}: leaks ${re}`);
	}
	const ids = new Set(attr(page.html, /\sid="([^"]+)"/g));
	for (const href of attr(page.html, /<a[^>]+href="([^"]+)"/g)) {
		if (href.startsWith("mailto:") || href.startsWith("javascript:")) continue;
		let target;
		try {
			target = new URL(href, url);
		} catch {
			problems.push(`${url}: unparsable href ${href}`);
			continue;
		}
		if (!isInternal(target)) continue;
		const hash = target.hash.slice(1);
		target.hash = "";
		const isSelf = target.href === new URL(url).href.replace(/#.*$/, "");
		if (isSelf && hash !== "" && !ids.has(hash)) {
			problems.push(`${url}: anchor #${hash} not on the page`);
		}
		if (!isSelf) {
			if (hash !== "") {
				const linked = await fetchPage(target.href);
				if (linked.status === 200 && linked.html !== "" && !new Set(attr(linked.html, /\sid="([^"]+)"/g)).has(hash)) {
					problems.push(`${url}: anchor ${target.pathname}#${hash} not on that page`);
				}
			}
			if (!seen.has(target.href) && !queue.includes(target.href)) queue.push(target.href);
		}
	}
	for (const src of [...attr(page.html, /<img[^>]+src="([^"]+)"/g), ...attr(page.html, /<link[^>]+href="([^"]+)"/g), ...attr(page.html, /<script[^>]+src="([^"]+)"/g)]) {
		let target;
		try {
			target = new URL(src, url);
		} catch {
			continue;
		}
		if (!isInternal(target)) continue;
		const asset = await fetchPage(target.href);
		if (asset.status !== 200) problems.push(`${url}: asset ${target.pathname} HTTP ${asset.status}`);
	}
}

for (const rel of PRIVATE) {
	const res = await fetchPage(new URL(rel, base).href);
	if (res.status === 200) problems.push(`private path serves: ${rel}`);
}

const pages = [...seen.entries()].filter(([, e]) => e.type.includes("text/html") && e.status === 200);
console.log(`crawled ${pages.length} pages, ${seen.size} URLs under ${base.href}`);
for (const [url, e] of seen) {
	if (e.type.includes("text/html")) console.log(`  ${e.status} ${new URL(url).pathname}`);
}
if (problems.length > 0) {
	console.error(`\n${problems.length} problem(s):`);
	for (const p of problems) console.error(`  ${p}`);
	process.exit(1);
}
console.log("\nDOCS CRAWL: no broken links, images or anchors; private paths answer 404");
