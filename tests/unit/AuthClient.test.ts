import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthClient } from "../../utils/AuthClient.ts";

describe("AuthClient", () => {
  let client: AuthClient;

  const setCookie = (value: string) => {
    Object.defineProperty(document, "cookie", {
      configurable: true,
      writable: true,
      value,
    });
  };

  beforeEach(() => {
    setCookie("");
    client = new AuthClient();
    global.fetch = vi.fn();
  });

  it("adds CSRF token header for mutating requests", async () => {
    setCookie("fortress_csrf=fake-token");

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { user: { id: "1" } } }),
    });

    await client.login({ email: "test@example.com", password: "password" });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/auth/login"),
      expect.objectContaining({
        method: "POST",
        headers: expect.any(Headers),
      }),
    );

    const callArgs = (global.fetch as any).mock.calls[0];
    const headers = callArgs[1].headers;
    expect(headers.get("x-csrf-token")).toBe("fake-token");
  });

  it("fetches CSRF token if missing before mutating", async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { csrfToken: "new-token" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { user: { id: "1" } } }),
      });

    await client.login({ email: "test@example.com", password: "password" });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect((global.fetch as any).mock.calls[0][0]).toContain("/auth/csrf");
    expect((global.fetch as any).mock.calls[1][0]).toContain("/auth/login");

    const headers = (global.fetch as any).mock.calls[1][1].headers;
    expect(headers.get("x-csrf-token")).toBe("new-token");
  });

  it("does not add CSRF token for GET requests", async () => {
    setCookie("fortress_csrf=fake-token");

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { user: { id: "1" } } }),
    });

    await client.getMe();

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/auth/me"),
      expect.objectContaining({
        headers: expect.any(Headers),
      }),
    );

    const callArgs = (global.fetch as any).mock.calls[0];
    const headers = callArgs[1].headers;
    expect(headers.has("x-csrf-token")).toBe(false);
  });
});
