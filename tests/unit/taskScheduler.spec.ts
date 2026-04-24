import { afterEach, describe, expect, it, vi } from "vitest";
import { yieldToMain } from "../../utils/taskScheduler";

describe("yieldToMain", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("uses requestIdleCallback with a clamped timeout when available", async () => {
    const idle = vi.fn((callback: () => void) => callback());
    vi.stubGlobal("requestIdleCallback", idle);
    vi.stubGlobal("requestAnimationFrame", undefined);

    await yieldToMain({ idleTimeoutMs: 0 });

    expect(idle).toHaveBeenCalledWith(expect.any(Function), { timeout: 1 });
  });

  it("falls back to requestAnimationFrame", async () => {
    vi.stubGlobal("requestIdleCallback", undefined);
    const raf = vi.fn((callback: FrameRequestCallback) => {
      callback(12);
      return 1;
    });
    vi.stubGlobal("requestAnimationFrame", raf);

    await yieldToMain();

    expect(raf).toHaveBeenCalledWith(expect.any(Function));
  });

  it("falls back to setTimeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestIdleCallback", undefined);
    vi.stubGlobal("requestAnimationFrame", undefined);

    const yielded = yieldToMain();
    vi.advanceTimersByTime(0);

    await expect(yielded).resolves.toBeUndefined();
  });
});
