import { config } from "./config.ts";
import { telemetry } from "./telemetry.ts";

/**
 * KytePDF Logger Utility
 * Provides structured logging with levels and optional persistence/remote reporting.
 */

type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

class Logger {
  private levels: Record<LogLevel, number>;
  private enabled: boolean;
  private currentLevel: number = 1; // Default to INFO if something goes wrong

  constructor() {
    this.levels = {
      DEBUG: 0,
      INFO: 1,
      WARN: 2,
      ERROR: 3,
    };
    this.enabled = config.logging.enabled;
    this.setLevel(config.logging.defaultLevel);
  }

  setLevel(level: LogLevel) {
    if (this.levels[level] !== undefined) {
      this.currentLevel = this.levels[level];
    }
  }

  private _log(level: LogLevel, message: string, data?: any) {
    if (!this.enabled) return;
    if (this.levels[level] < this.currentLevel) return;

    const timestamp = config.logging.includeTimestamps ? `[${new Date().toISOString()}]` : "";
    const prefix = `[KytePDF]${timestamp}[${level}]`;

    switch (level) {
      case "DEBUG":
        console.debug(prefix, message, data || "");
        break;
      case "INFO":
        console.info(prefix, message, data || "");
        break;
      case "WARN":
        console.warn(prefix, message, data || "");
        break;
      case "ERROR":
        console.error(prefix, message, data || "");
        // Always capture technical errors in telemetry for production monitoring
        telemetry.captureException(message, { details: data });
        break;
    }
  }

  debug(message: string, data?: any) {
    this._log("DEBUG", message, data);
  }
  info(message: string, data?: any) {
    this._log("INFO", message, data);
  }
  warn(message: string, data?: any) {
    this._log("WARN", message, data);
  }
  error(message: string, data?: any) {
    this._log("ERROR", message, data);
  }
}

export const logger = new Logger();
