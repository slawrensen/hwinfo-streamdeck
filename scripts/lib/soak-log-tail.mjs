// Log tail for scripts/soak-monitor.mjs: newest plugin log, WARN/ERROR
// deltas, harness lines excluded. Its own module so the tail can be driven
// by a test without starting the monitor (the monitor samples on import).
//
// Pre-existing content is the baseline and is never counted. Rotation is
// detected by NTFS file identity (ino), not by path or size: the Stream
// Deck SDK recreates the SAME .0.log path on plugin restart, and the new
// file can grow past the old offset before the next poll, which a
// path-or-shrink check silently misses (found against the live SDK).
//
// A rotation must not lose lines either. The SDK rotates by renaming
// (.0.log becomes .1.log on every plugin start and at the size cap), so the
// file being tailed is still in the directory under its next index, with
// the same identity. What it gained after the previous poll is the window
// right before a restart, the most diagnostic one there is; it is counted
// before the new file is adopted. Adopting the new file at offset 0 alone
// read "0 / 0" over a soak whose plugin logged an ERROR and restarted.
import fs from "node:fs";
import path from "node:path";

const HARNESS_RE = /Harness Deck|Load Deck/;
const LEVEL_RE = /\b(WARN|ERROR)\b/;

/** WARN/ERROR lines in `file` between two byte offsets, added to `totals`. */
function tally(file, from, to, totals, expectedIno) {
	if (to <= from) {
		return;
	}
	const fd = fs.openSync(file, "r");
	const buf = Buffer.alloc(to - from);
	try {
		const opened = fs.fstatSync(fd, { bigint: true });
		if (opened.ino !== expectedIno || opened.size < BigInt(to)) throw new Error("Plugin log changed while opening; observation incomplete");
		if (fs.readSync(fd, buf, 0, buf.length, from) !== buf.length) throw new Error("Plugin log short read; observation incomplete");
	} finally { fs.closeSync(fd); }
	for (const line of buf.toString("utf8").split(/\r?\n/)) {
		const m = LEVEL_RE.exec(line);
		if (m && !HARNESS_RE.test(line)) {
			if (m[1] === "WARN") totals.warn++;
			else totals.error++;
		}
	}
}

export function makeLogTail(dir) {
	let file = null;
	let fileIno = null;
	let offset = 0;
	let primed = false;
	const newest = () => {
		if (!fs.existsSync(dir)) {
			return null;
		}
		const logs = fs
			.readdirSync(dir)
			.filter((f) => f.endsWith(".log"))
			.map((f) => ({ p: path.join(dir, f), m: fs.statSync(path.join(dir, f)).mtimeMs }))
			.sort((a, b) => b.m - a.m);
		return logs[0]?.p ?? null;
	};
	/** Counts what a rotation left behind; false when the tailed file is gone
	 * (pruned at the SDK's file cap, or truncated in place). */
	const drainRotated = (current, totals) => {
		const others = fs
			.readdirSync(dir)
			.filter((f) => f.endsWith(".log") && path.join(dir, f) !== current)
			.map((f) => ({ p: path.join(dir, f), st: fs.statSync(path.join(dir, f), { bigint: true }) }));
		const old = others.find((f) => f.st.ino === fileIno);
		if (old === undefined) {
			return false;
		}
		tally(old.p, Math.min(offset, Number(old.st.size)), Number(old.st.size), totals, old.st.ino);
		// Two restarts inside one interval leave a whole log between the
		// tailed file and the newest: never tailed, so every line is new.
		// The tailed file was the newest at the previous poll, so only a
		// log written since then can carry a later mtime.
		for (const f of others) {
			if (f !== old && f.st.mtimeNs > old.st.mtimeNs) {
				tally(f.p, 0, Number(f.st.size), totals, f.st.ino);
			}
		}
		return true;
	};
	return function poll() {
		const current = newest();
		if (current === null) {
			// Before priming, nothing to baseline yet. After it, the tailed log
			// is gone: a sample with no log behind it is not a clean one, and
			// the summary says so instead of reading "0 / 0" over the gap.
			return { warn: 0, error: 0, note: "logs-missing" };
		}
		const st = fs.statSync(current, { bigint: true });
		const size = Number(st.size);
		if (!primed) {
			// Baseline: only lines written after the soak starts count.
			primed = true;
			file = current;
			fileIno = st.ino;
			offset = size;
			return { warn: 0, error: 0, note: "" };
		}
		const totals = { warn: 0, error: 0 };
		let note = "";
		let readFrom = offset;
		if (current !== file && st.ino === fileIno && size >= offset) {
			// The SDK renames the log away at a plugin start and only creates
			// the new one with its first line. A poll inside that gap finds
			// the tailed file under its new name: nothing rotated past it.
		} else if (current !== file || st.ino !== fileIno || size < offset) {
			// A lost tail says so: the summary must not read clean silently.
			note = drainRotated(current, totals) ? "log-rotated" : "log-rotated-tail-lost";
			readFrom = 0;
		}
		tally(current, readFrom, size, totals, st.ino);
		// Commit the cursor only after every read succeeds. A failed sample
		// becomes unknown in the monitor and the next poll retries its tail.
		file = current;
		fileIno = st.ino;
		offset = size;
		return { ...totals, note };
	};
}
