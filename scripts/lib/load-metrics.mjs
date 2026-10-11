/** Expected observations include the baseline and the requested end time. */
export function expectedRssSampleCount(durationMs, intervalMs) {
	if (!Number.isFinite(durationMs) || durationMs <= 0 || !Number.isFinite(intervalMs) || intervalMs <= 0) {
		throw new RangeError("Load duration and sample interval must be positive finite numbers.");
	}
	return Math.ceil(durationMs / intervalMs) + 1;
}

/** Missing or failed observations cannot prove a memory bound or growth. */
export function assessLoadMetrics(samples, expectedSamples, invalidFrames) {
	const valid = samples.filter((sample) => Number.isFinite(sample) && sample > 0);
	const complete = expectedSamples >= 2 && samples.length === expectedSamples && valid.length === expectedSamples;
	return {
		complete,
		validSamples: valid.length,
		expectedSamples,
		peak: complete ? Math.max(...valid) : null,
		growth: complete ? valid.at(-1) - valid[0] : null,
		framesValid: invalidFrames === 0
	};
}
