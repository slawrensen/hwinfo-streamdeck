// Renderer scripts import action modules, whose SDK logger handles the first
// uncaught exception. Keep command failure observable without changing the
// plugin's exception policy or suppressing Node's default exception handling.
process.on("uncaughtExceptionMonitor", (error) => {
	console.error(error);
	process.exitCode = 1;
});
