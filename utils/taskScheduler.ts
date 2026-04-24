export type YieldToMainOptions = {
  idleTimeoutMs?: number;
};

export const yieldToMain = (options: YieldToMainOptions = {}) => {
  const requestIdle = (globalThis as any).requestIdleCallback as
    | ((cb: () => void, options?: { timeout: number }) => void)
    | undefined;
  if (typeof requestIdle === "function") {
    const timeout = Math.max(1, options.idleTimeoutMs ?? 50);
    return new Promise<void>((resolve) => {
      requestIdle(() => resolve(), { timeout });
    });
  }

  const raf = globalThis.requestAnimationFrame;
  if (typeof raf === "function") {
    return new Promise<void>((resolve) => {
      raf(() => resolve());
    });
  }

  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
};
