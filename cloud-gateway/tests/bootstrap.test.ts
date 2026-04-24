import { describe, expect, it, vi } from "vitest";

const serveMock = vi.fn();
vi.mock("@hono/node-server", () => ({
  serve: serveMock,
}));

describe("Bootstrap", () => {
  it("runs when NODE_ENV is not test", async () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    vi.resetModules();
    await import("../server");
    expect(serveMock).toHaveBeenCalled();
    process.env.NODE_ENV = original;
  });
});
