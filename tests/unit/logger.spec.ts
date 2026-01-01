import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../utils/logger";
import { telemetry } from "../../utils/telemetry";

vi.mock("../../utils/config", () => ({
  config: {
    logging: {
      enabled: true,
      defaultLevel: "INFO",
      includeTimestamps: false,
    },
  },
}));

vi.mock("../../utils/telemetry", () => ({
  telemetry: {
    captureException: vi.fn(),
  },
}));

describe("Logger", () => {
  let consoleSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = {
      debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
      info: vi.spyOn(console, "info").mockImplementation(() => {}),
      warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
      error: vi.spyOn(console, "error").mockImplementation(() => {}),
    };
  });

  it("should log info messages by default", () => {
    logger.info("test info");
    expect(consoleSpy.info).toHaveBeenCalledWith("[KytePDF][INFO]", "test info", "");
  });

  it("should not log debug messages by default", () => {
    logger.debug("test debug");
    expect(consoleSpy.debug).not.toHaveBeenCalled();
  });

  it("should log debug messages when level is set to DEBUG", () => {
    logger.setLevel("DEBUG");
    logger.debug("test debug");
    expect(consoleSpy.debug).toHaveBeenCalledWith("[KytePDF][DEBUG]", "test debug", "");
    // Reset to INFO for other tests
    logger.setLevel("INFO");
  });

  it("should log warn messages", () => {
    logger.warn("test warn");
    expect(consoleSpy.warn).toHaveBeenCalledWith("[KytePDF][WARN]", "test warn", "");
  });

  it("should log error messages and call telemetry", () => {
    logger.error("test error", { detail: "extra" });
    expect(consoleSpy.error).toHaveBeenCalledWith("[KytePDF][ERROR]", "test error", {
      detail: "extra",
    });
    expect(telemetry.captureException).toHaveBeenCalledWith("test error", {
      details: { detail: "extra" },
    });
  });

  it("should respect the enabled flag", () => {
    // Accessing private property for test purposes
    (logger as any).enabled = false;
    logger.info("test disabled");
    expect(consoleSpy.info).not.toHaveBeenCalled();
    (logger as any).enabled = true;
  });
});
