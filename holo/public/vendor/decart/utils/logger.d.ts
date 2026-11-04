//#region src/utils/logger.d.ts
type LogLevel = "debug" | "info" | "warn" | "error";
type Logger = {
  debug: (message: string, data?: Record<string, unknown>) => void;
  info: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, data?: Record<string, unknown>) => void;
};
/** A logger that discards all messages. Zero overhead. */
declare const noopLogger: Logger;
/**
 * Creates a console-based logger that only logs messages at or above the given level.
 *
 * @param minLevel - Minimum log level to output. Default: "warn".
 */
declare function createConsoleLogger(minLevel?: LogLevel): Logger;
//#endregion
export { LogLevel, Logger, createConsoleLogger, noopLogger };