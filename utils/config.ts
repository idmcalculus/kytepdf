/// <reference types="vite/client" />
/**
 * KytePDF Global Configuration
 * Handles environment-specific settings.
 */

interface LoggingConfig {
  enabled: boolean;
  defaultLevel: "DEBUG" | "INFO" | "WARN" | "ERROR";
  includeTimestamps: boolean;
}

interface PdfConfig {
  workerSrc: string;
}

interface AppMetadata {
  name: string;
  version: string;
}

interface KyteConfig {
  env: string;
  isProd: boolean;
  isDev: boolean;
  logging: LoggingConfig;
  pdf: PdfConfig;
  app: AppMetadata;
}

const isProd = import.meta.env.PROD;
const isDev = import.meta.env.DEV;

export const config: KyteConfig = {
  env: import.meta.env.MODE,
  isProd,
  isDev,

  // Logging Configuration
  logging: {
    // Only enable logging if not in production, or if explicitly enabled via localStorage
    enabled: !isProd || localStorage.getItem("KYTE_DEBUG") === "true",

    // Default level
    defaultLevel: isProd ? "ERROR" : "DEBUG",

    // Whether to include timestamps in logs
    includeTimestamps: true,
  },

  // PDF Configuration
  pdf: {
    workerSrc: "/pdf.worker.min.js",
  },

  // App Metadata
  app: {
    name: "KytePDF",
    version: "1.0.0",
  },
};
