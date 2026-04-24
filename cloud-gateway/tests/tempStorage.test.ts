import { describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  const rm = vi.fn().mockRejectedValue(new Error("boom"));
  return {
    ...actual,
    rm,
    default: {
      ...actual,
      rm,
    },
  };
});

const { TempStorage } = await import("../server");

describe("TempStorage cleanup", () => {
  it("swallows cleanup errors", async () => {
    const storage = new TempStorage();
    await expect(storage.cleanup(["/tmp/nope"])).resolves.toBeUndefined();
  });
});
