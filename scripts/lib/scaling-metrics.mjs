function finiteNonnegative(value, label) {
	if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be finite and nonnegative.`);
}

/** Fixture values occupy pure numeric text nodes; labels include an R prefix
 * and dial extrema share a prose text node. Every visible value must agree. */
export function frameGeneration(svg, expectedValues) {
	if (typeof svg !== "string" || !svg.includes("<svg") || !svg.includes("</svg>")) throw new Error("Malformed SVG");
	if (!Number.isInteger(expectedValues) || expectedValues < 1) throw new Error("Invalid expected value count");
	const values = [...svg.matchAll(/>([0-9][0-9,]*)<(?=\/text|tspan)/g)].map((m) => Number(m[1].replaceAll(",", ""))).filter((v) => v >= 1000 && v <= 9999);
	if (values.length === 0) return null;
	if (values.length !== expectedValues || values.some((value) => value !== values[0])) throw new Error("Incomplete or mixed-generation face");
	return values[0] - 1000;
}

function positive(value, label) {
	if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be finite and positive.`);
}

function generationId(value) {
	if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("Generation must be a nonnegative safe integer.");
}

/** Nearest-rank percentiles in the input unit; never discards invalid observations. */
export function distribution(values) {
	if (!Array.isArray(values) || values.length === 0) throw new RangeError("Distribution requires a nonempty array.");
	for (const value of values) finiteNonnegative(value, "Observation");
	const sorted = [...values].sort((a, b) => a - b);
	// Incremental mean avoids overflowing a sum of individually finite values.
	const mean = sorted.reduce((current, value, index) => current + (value - current) / (index + 1), 0);
	const percentile = (fraction) => sorted[Math.ceil(sorted.length * fraction) - 1];
	return { count: sorted.length, mean, p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99), max: sorted.at(-1) };
}

/**
 * All times and intervals use milliseconds from the same monotonic clock.
 * Publications have strictly increasing IDs and times; frames are in receipt-time
 * order, with ties permitted. IDs need not be consecutive. A repeated pair is a
 * duplicate; a generation below that context's highest received ID is out of
 * order. These counts can overlap. Only the first receipt contributes latency.
 *
 * Unknown contexts are reported and excluded from coverage, but their generation
 * and time must still be valid. Unknown generations, receipt before publication,
 * and receipt after endAt are invalid evidence, not missing-update observations.
 * Missing pairs may result from polling/coalescing; this function reports them
 * without deciding whether the workload should require every publication.
 */
export function analyzeGenerations({ publications, frames, contexts, endAt, pollMs, producerMs }) {
	positive(pollMs, "pollMs");
	positive(producerMs, "producerMs");
	finiteNonnegative(endAt, "endAt");
	if (!Array.isArray(contexts) || contexts.length === 0 || contexts.some((context) => typeof context !== "string" || context.length === 0)) {
		throw new TypeError("Contexts must be a nonempty array of nonempty strings.");
	}
	if (new Set(contexts).size !== contexts.length) throw new RangeError("Contexts must be unique.");
	if (!Array.isArray(publications) || publications.length === 0) throw new RangeError("Publications must be nonempty.");
	if (!Array.isArray(frames)) throw new TypeError("Frames must be an array.");
	const totalPairs = publications.length * contexts.length;
	if (!Number.isSafeInteger(totalPairs)) throw new RangeError("Pair count exceeds safe integer precision.");
	const byGeneration = new Map();
	let previousGeneration = -1;
	let previousPublishedAt = -1;
	for (const publication of publications) {
		if (!publication || typeof publication !== "object") throw new TypeError("Invalid publication.");
		const { generation, publishedAt } = publication;
		generationId(generation);
		finiteNonnegative(publishedAt, "publishedAt");
		if (generation <= previousGeneration || publishedAt <= previousPublishedAt) throw new RangeError("Publications must increase strictly in generation and time.");
		if (publishedAt > endAt) throw new RangeError("Publication is after endAt.");
		byGeneration.set(generation, { publishedAt, receipts: new Map() });
		previousGeneration = generation;
		previousPublishedAt = publishedAt;
	}
	const byContext = new Map(contexts.map((context) => [context, { highestGeneration: -1, latencies: [], duplicates: 0, outOfOrder: 0 }]));
	let previousFrameAt = -1;
	let duplicates = 0;
	let outOfOrder = 0;
	let unknownFrames = 0;
	const latencies = [];
	for (const frame of frames) {
		if (!frame || typeof frame !== "object" || typeof frame.context !== "string" || frame.context.length === 0) throw new TypeError("Invalid frame context.");
		const { context, generation, at } = frame;
		generationId(generation);
		finiteNonnegative(at, "Frame time");
		if (at < previousFrameAt) throw new RangeError("Frames must be in nondecreasing receipt-time order.");
		previousFrameAt = at;
		const publication = byGeneration.get(generation);
		if (!publication) throw new RangeError("Frame references an unknown generation.");
		if (at < publication.publishedAt || at > endAt) throw new RangeError("Frame time is outside publication/end bounds.");
		const state = byContext.get(context);
		if (!state) {
			unknownFrames++;
			continue;
		}
		if (generation < state.highestGeneration) {
			outOfOrder++;
			state.outOfOrder++;
		}
		state.highestGeneration = Math.max(state.highestGeneration, generation);
		if (publication.receipts.has(context)) {
			duplicates++;
			state.duplicates++;
			continue;
		}
		publication.receipts.set(context, at);
		state.latencies.push(at - publication.publishedAt);
		latencies.push(at - publication.publishedAt);
	}
	const completeLatencies = [];
	const generations = [...byGeneration].map(([generation, { publishedAt, receipts }]) => {
		const missingContexts = contexts.filter((context) => !receipts.has(context));
		const complete = missingContexts.length === 0;
		const completeLatency = complete ? [...receipts.values()].reduce((latest, at) => Math.max(latest, at), publishedAt) - publishedAt : null;
		if (complete) completeLatencies.push(completeLatency);
		return { generation, publishedAt, receivedContexts: receipts.size, missingContexts, complete, completeLatency };
	});
	const graceMs = Math.max(2000, 4 * pollMs);
	if (!Number.isFinite(graceMs)) throw new RangeError("Grace interval exceeds finite time precision.");
	const graceComplete = endAt - publications.at(-1).publishedAt >= graceMs;
	return {
		unit: "ms",
		pollMs,
		producerMs,
		publicationCount: publications.length,
		contextCount: contexts.length,
		frameCount: frames.length,
		totalPairs,
		receivedPairs: latencies.length,
		missingPairs: totalPairs - latencies.length,
		coverageRatio: latencies.length / totalPairs,
		completeGenerations: completeLatencies.length,
		unobservedGenerations: generations.filter((generation) => generation.receivedContexts === 0).length,
		latency: latencies.length ? distribution(latencies) : null,
		completeLatency: completeLatencies.length ? distribution(completeLatencies) : null,
		overBudgetPairs: latencies.filter((latency) => latency > pollMs).length,
		duplicates,
		outOfOrder,
		unknownFrames,
		graceMs,
		graceComplete,
		finalComplete: graceComplete && generations.at(-1).complete,
		generations,
		perContext: [...byContext].map(([context, state]) => ({
			context,
			receivedPairs: state.latencies.length,
			missingPairs: publications.length - state.latencies.length,
			latency: state.latencies.length ? distribution(state.latencies) : null,
			duplicates: state.duplicates,
			outOfOrder: state.outOfOrder
		}))
	};
}
