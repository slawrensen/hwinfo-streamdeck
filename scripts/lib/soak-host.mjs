/** Parse the two CreationDate formats emitted by Windows PowerShell and pwsh.
 * Missing or malformed creation evidence must never become a process identity. */
export function creationMs(value) {
	if (typeof value !== "string") return null;
	const wrapped = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(value);
	const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
	const time = wrapped ? Number(wrapped[1]) : iso ? Date.parse(value) : NaN;
	return Number.isSafeInteger(time) && time >= 0 ? time : null;
}

function processIdentity(row) {
	if (!row || !Number.isSafeInteger(row.ProcessId) || row.ProcessId <= 0 ||
		!Number.isSafeInteger(row.SessionId) || row.SessionId < 0) return null;
	const startedMs = creationMs(row.CreationDate);
	return startedMs === null ? null : { pid: row.ProcessId, startedMs, sessionId: row.SessionId };
}

function sameLifetime(a, b) {
	return a !== null && b !== null && a.pid === b.pid &&
		a.startedMs === b.startedMs && a.sessionId === b.sessionId;
}

/** Attribute host resources only from current plugin evidence or an already
 * established host lifetime. PID reuse, another user's host and ambiguous
 * same-session hosts must not silently change the measured process.
 *
 * A present plugin clears an old association if its own host cannot be proven.
 * During plugin absence, a known association can survive incomplete snapshots,
 * but resources are available only while that exact lifetime is observed. */
export function selectSoakHost(target, hosts, known = null) {
	const observed = hosts.filter((row) => row.Name === "StreamDeck.exe")
		.map((row) => ({ row, identity: processIdentity(row) }))
		.filter(({ identity }) => identity !== null);
	let candidates;
	if (target === null) {
		candidates = known === null ? [] : observed.filter(({ identity }) => sameLifetime(identity, known));
	} else {
		const plugin = processIdentity(target);
		if (plugin === null) return { host: null, identity: null, matches: 0, reason: "host-evidence-missing" };
		const eligible = observed.filter(({ identity }) =>
			identity.sessionId === plugin.sessionId && identity.startedMs <= plugin.startedMs);
		const parent = eligible.filter(({ identity }) => identity.pid === target.ParentProcessId);
		candidates = parent.length > 0 ? parent : eligible;
	}
	if (candidates.length !== 1) {
		return {
			host: null,
			identity: target === null ? known : null,
			matches: candidates.length,
			reason: candidates.length > 1 ? "host-ambiguous" : "host-unavailable"
		};
	}
	return { host: candidates[0].row, identity: candidates[0].identity, matches: 1, reason: "" };
}
