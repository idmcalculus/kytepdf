import { describe, expect, it, vi } from "vitest";

const serveMock = vi.fn();
vi.mock("@hono/node-server", () => ({
  serve: serveMock,
}));

describe("Bootstrap", () => {
  it("runs when NODE_ENV is not test", async () => {
    const original = process.env.NODE_ENV;
    const originalApiKey = process.env.CLOUD_GATEWAY_API_KEY;
    const originalCorsOrigin = process.env.CORS_ORIGIN;
    process.env.NODE_ENV = "production";
    process.env.CLOUD_GATEWAY_API_KEY = "secret";
    process.env.CORS_ORIGIN = "https://example.com";
    vi.resetModules();
    await import("../server");
    expect(serveMock).toHaveBeenCalled();
    process.env.NODE_ENV = original;
    if (originalApiKey === undefined) {
      delete process.env.CLOUD_GATEWAY_API_KEY;
    } else {
      process.env.CLOUD_GATEWAY_API_KEY = originalApiKey;
    }
    if (originalCorsOrigin === undefined) {
      delete process.env.CORS_ORIGIN;
    } else {
      process.env.CORS_ORIGIN = originalCorsOrigin;
    }
  });
});
