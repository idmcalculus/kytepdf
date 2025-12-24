/**
 * KytePDF Telemetry Utility
 * Handles remote logging and performance monitoring.
 * In a production app, this would connect to Sentry, LogRocket, or a custom API.
 */

import { config } from "./config.ts";

interface ErrorDetails {
  message: string;
  stack: string | null;
  timestamp: string;
  url: string;
  userAgent: string;
  [key: string]: any;
}

class Telemetry {
  private isProd: boolean;

  constructor() {
    this.isProd = config.isProd;
  }

  /**
   * Logs an event to the remote service.
   * @param category
   * @param action
   * @param metadata
   */
  logEvent(_category: string, _action: string, _metadata: Record<string, any> = {}) {
    if (!this.isProd) {
      // In development, we just use the logger (which is already active)
      return;
    }

    // Placeholder for actual telemetry implementation (e.g., Google Analytics, PostHog, etc.)
    // console.log(`[Telemetry] ${category}:${action}`, metadata);
  }

  /**
   * Specifically captures errors and sends them to a crash reporting tool.
   * @param error
   * @param context
   */
  captureException(error: Error | string, context: Record<string, any> = {}) {
    if (!this.isProd) return;

    const errorDetails: ErrorDetails = {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack || null : null,
      timestamp: new Date().toISOString(),
      url: window.location.href,
      userAgent: navigator.userAgent,
      ...context,
    };

    // In a real app, you would fetch() this to your backend or use a library like Sentry.init()
    console.error("[Telemetry Exception]", errorDetails);

    // Example implementation for Sentry:
    // if ((window as any).Sentry) {
    //   (window as any).Sentry.captureException(error, { extra: context });
    // }
  }
}

export const telemetry = new Telemetry();
