//#region src/utils/logger.ts
/** A logger that discards all messages. Zero overhead. */
const noopLogger = {
	debug() {},
	info() {},
	warn() {},
	error() {}
};
const LOG_LEVELS = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3
};
/**
* Creates a console-based logger that only logs messages at or above the given level.
*
* @param minLevel - Minimum log level to output. Default: "warn".
*/
function createConsoleLogger(minLevel = "warn") {
	const threshold = LOG_LEVELS[minLevel];
	const log = (level, message, data) => {
		if (LOG_LEVELS[level] < threshold) return;
		const prefix = "[DecartSDK]";
		if (data) console[level](prefix, message, data);
		else console[level](prefix, message);
	};
	return {
		debug: (msg, data) => log("debug", msg, data),
		info: (msg, data) => log("info", msg, data),
		warn: (msg, data) => log("warn", msg, data),
		error: (msg, data) => log("error", msg, data)
	};
}
//#endregion
export { createConsoleLogger, noopLogger };
