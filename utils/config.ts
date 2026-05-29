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

interface CloudConfig {
  apiEndpoint: string;
}

interface AuthConfig {
  /**
   * Base URL for the auth API.
   * Always set in production via VITE_AUTH_API_URL.
   * Falls back to localhost only in development.
   * `null` means auth is unavailable (misconfigured production build).
   */
  apiUrl: string | null;
  /** True when the auth service URL is properly configured. */
  available: boolean;
  /** OAuth providers enabled for this deployment (e.g. ["google", "github"]). */
  oauthProviders: string[];
}

interface KyteConfig {
  env: string;
  isProd: boolean;
  isDev: boolean;
  logging: LoggingConfig;
  pdf: PdfConfig;
  cloud: CloudConfig;
  auth: AuthConfig;
  app: AppMetadata;
}

const isProd = import.meta.env.PROD;
const isDev = import.meta.env.DEV;

// Auth API URL resolution:
// - In dev, fall back to localhost so local development works without extra config.
// - In production, require the env var; treat its absence as "unavailable" so the
//   UI can show a clear message instead of silently calling localhost in user browsers.
const rawAuthApiUrl = import.meta.env.VITE_AUTH_API_URL as string | undefined;
const authApiUrl: string | null = rawAuthApiUrl
  ? rawAuthApiUrl
  : isDev
    ? "http://localhost:3000"
    : null;

// Comma-separated list of enabled OAuth providers, e.g. "google,github".
// Empty/unset means OAuth buttons are hidden.
const rawOAuthProviders = (import.meta.env.VITE_AUTH_OAUTH_PROVIDERS as string | undefined) || "";
const oauthProviders = rawOAuthProviders
  .split(",")
  .map((p) => p.trim().toLowerCase())
  .filter(Boolean);

export const config: KyteConfig = {
  env: import.meta.env.MODE,
  isProd,
  isDev,

  // Logging Configuration
  logging: {
    // Only enable logging if not in production, or if explicitly enabled via localStorage in dev
    enabled: !isProd || (isDev && localStorage.getItem("KYTE_DEBUG") === "true"),

    // Default level
    defaultLevel: isProd ? "ERROR" : "DEBUG",

    // Whether to include timestamps in logs
    includeTimestamps: true,
  },

  // PDF Configuration
  pdf: {
    workerSrc: "/pdf.worker.min.js",
  },

  // Cloud Conversion Gateway
  // NOTE: API key is NOT embedded in the client bundle for security.
  // Requests should be proxied through a backend-for-frontend (BFF)
  // or use short-lived tokens issued by a server-side auth endpoint.
  cloud: {
    apiEndpoint: import.meta.env.VITE_CLOUD_GATEWAY_URL || "",
  },

  // Auth service
  auth: {
    apiUrl: authApiUrl,
    available: authApiUrl !== null,
    oauthProviders,
  },

  // App Metadata
  app: {
    name: "KytePDF",
    version: "1.0.0",
  },
};
