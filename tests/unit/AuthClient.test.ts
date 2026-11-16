import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthClient } from "../../utils/AuthClient.ts";
import { config } from "../../utils/config.ts";

describe("AuthClient", () => {
  let client: AuthClient;
  const base = config.auth.apiUrl as string;

  const setCookie = (value: string) => {
    Object.defineProperty(document, "cookie", {
      configurable: true,
      writable: true,
      value,
    });
  };

  const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  const fetchMock = () => globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
  const requestTo = (path: string) => {
    const call = fetchMock().mock.calls.find(([url]) => url === `${base}${path}`);
    if (!call) throw new Error(`No request was sent to ${path}`);
    return call[1] as RequestInit & { headers: Headers };
  };

  beforeEach(() => {
    setCookie("");
    client = new AuthClient();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

  describe("endpoints", () => {
    beforeEach(() => {
      setCookie("fortress_csrf=tok");
    });

    it("reads the current user with a plain cookie-carrying GET", async () => {
      const user = { id: "1", email: "a@example.com" };
      fetchMock().mockResolvedValueOnce(jsonResponse({ success: true, data: { user } }));

      await expect(client.getMe()).resolves.toEqual(user);

      const init = requestTo("/auth/me");
      expect(init.credentials).toBe("include");
      expect(init.body).toBeUndefined();
      // No body means no Content-Type, which keeps the request free of a CORS preflight.
      expect(init.headers.has("Content-Type")).toBe(false);
    });

    it.each([
      {
        name: "signUp",
        call: (c: AuthClient) => c.signUp({ email: "a@example.com", password: "longenough" }),
        path: "/auth/signup",
        body: { email: "a@example.com", password: "longenough" },
        data: { user: { id: "1" } },
        result: { id: "1" },
      },
      {
        name: "verifyEmail",
        call: (c: AuthClient) => c.verifyEmail("verify-token"),
        path: "/auth/verify-email",
        body: { token: "verify-token" },
        data: { verified: true },
        result: { verified: true },
      },
      {
        name: "requestPasswordReset",
        call: (c: AuthClient) => c.requestPasswordReset("a@example.com"),
        path: "/auth/request-password-reset",
        body: { email: "a@example.com" },
        data: { requested: true },
        result: { requested: true },
      },
      {
        name: "resetPassword",
        call: (c: AuthClient) => c.resetPassword("reset-token", "new-password"),
        path: "/auth/reset-password",
        body: { token: "reset-token", newPassword: "new-password" },
        data: { reset: true },
        result: { reset: true },
      },
    ])("$name POSTs JSON with the CSRF token and returns the data", async (endpoint) => {
      fetchMock().mockResolvedValueOnce(jsonResponse({ success: true, data: endpoint.data }));

      await expect(endpoint.call(client)).resolves.toEqual(endpoint.result);

      const init = requestTo(endpoint.path);
      expect(init.method).toBe("POST");
      expect(init.credentials).toBe("include");
      expect(JSON.parse(init.body as string)).toEqual(endpoint.body);
      expect(init.headers.get("Content-Type")).toBe("application/json");
      expect(init.headers.get("x-csrf-token")).toBe("tok");
    });

    it("logout POSTs with the CSRF token but no body", async () => {
      fetchMock().mockResolvedValueOnce(jsonResponse({ success: true }));

      await expect(client.logout()).resolves.toBeUndefined();

      const init = requestTo("/auth/logout");
      expect(init.method).toBe("POST");
      expect(init.body).toBeUndefined();
      expect(init.headers.has("Content-Type")).toBe(false);
      expect(init.headers.get("x-csrf-token")).toBe("tok");
    });
  });

  describe("error messages", () => {
    it("explains a non-JSON reply instead of failing on the parse", async () => {
      fetchMock().mockResolvedValueOnce(new Response("<html>Bad gateway</html>", { status: 502 }));

      await expect(client.getMe()).rejects.toThrow(
        "Request failed with status 502 (non-JSON response from server)",
      );
    });

    it("explains a JSON null reply instead of failing with a TypeError", async () => {
      fetchMock().mockResolvedValueOnce(jsonResponse(null, 500));

      await expect(client.getMe()).rejects.toThrow(
        "Request failed with status 500 (unexpected response from server)",
      );
    });

    it("shows the server's readable message, not the bare error code, in production replies", async () => {
      // Production fortress responses carry `message` and no `details`.
      fetchMock().mockResolvedValueOnce(
        jsonResponse(
          {
            success: false,
            error: "INVALID_CREDENTIALS",
            message: "Authentication failed. Please check your credentials.",
            code: "AUTH_001",
          },
          401,
        ),
      );

      await expect(client.getMe()).rejects.toThrow(
        "Authentication failed. Please check your credentials.",
      );
    });

    it.each([
      {
        case: "development details",
        body: { success: false, error: "INVALID_CREDENTIALS", details: "Login failed" },
        status: 401,
        message: "Login failed",
      },
      {
        case: "a bare error code",
        body: { success: false, error: "RATE_LIMITED" },
        status: 429,
        message: "RATE_LIMITED",
      },
      {
        case: "an empty body",
        body: {},
        status: 500,
        message: "Request failed with status 500",
      },
      {
        case: "success: false on a 200",
        body: { success: false, error: "EMAIL_NOT_VERIFIED" },
        status: 200,
        message: "EMAIL_NOT_VERIFIED",
      },
    ])("falls back sensibly for $case", async ({ body, status, message }) => {
      fetchMock().mockResolvedValueOnce(jsonResponse(body, status));

      await expect(client.getMe()).rejects.toThrow(message);
    });
  });

  describe("CSRF handling", () => {
    it("reads a URL-encoded token from among other cookies", async () => {
      setCookie("theme=dark; fortress_csrf=a%2Bb%3D; other=1");
      fetchMock().mockResolvedValueOnce(jsonResponse({ success: true }));

      await client.logout();

      expect(requestTo("/auth/logout").headers.get("x-csrf-token")).toBe("a+b=");
    });

    it("fetches the token once and reuses it for later requests", async () => {
      fetchMock()
        .mockResolvedValueOnce(jsonResponse({ success: true, data: { csrfToken: "fetched" } }))
        .mockImplementation(async () => jsonResponse({ success: true, data: { requested: true } }));

      await client.requestPasswordReset("a@example.com");
      await client.requestPasswordReset("b@example.com");

      const csrfCalls = fetchMock().mock.calls.filter(([url]) => url === `${base}/auth/csrf`);
      expect(csrfCalls).toHaveLength(1);
      expect(csrfCalls[0][1]).toEqual({ credentials: "include" });
      const resetCalls = fetchMock().mock.calls.filter(([url]) => String(url).endsWith("reset"));
      expect(resetCalls.map(([, init]) => init.headers.get("x-csrf-token"))).toEqual([
        "fetched",
        "fetched",
      ]);
    });

    it("refreshes a rejected token and retries the request once", async () => {
      const user = { id: "1" };
      fetchMock()
        .mockResolvedValueOnce(jsonResponse({ success: true, data: { csrfToken: "stale" } }))
        .mockResolvedValueOnce(jsonResponse({ success: false, error: "CSRF_TOKEN_INVALID" }, 403))
        .mockResolvedValueOnce(jsonResponse({ success: true, data: { csrfToken: "fresh" } }))
        .mockResolvedValueOnce(jsonResponse({ success: true, data: { user } }));

      await expect(client.login({ email: "a@example.com", password: "pw" })).resolves.toEqual(user);

      const urls = fetchMock().mock.calls.map(([url]) => String(url).replace(base, ""));
      expect(urls).toEqual(["/auth/csrf", "/auth/login", "/auth/csrf", "/auth/login"]);
      const logins = fetchMock().mock.calls.filter(([url]) => url === `${base}/auth/login`);
      expect(logins[0][1].headers.get("x-csrf-token")).toBe("stale");
      expect(logins[1][1].headers.get("x-csrf-token")).toBe("fresh");
    });

    it("gives up after one retry so a broken token cannot loop", async () => {
      const rejected = () =>
        jsonResponse(
          {
            success: false,
            error: "CSRF_TOKEN_INVALID",
            message: "Security verification failed. Please try again.",
          },
          403,
        );
      fetchMock()
        .mockResolvedValueOnce(jsonResponse({ success: true, data: { csrfToken: "t1" } }))
        .mockResolvedValueOnce(rejected())
        .mockResolvedValueOnce(jsonResponse({ success: true, data: { csrfToken: "t2" } }))
        .mockResolvedValueOnce(rejected());

      await expect(client.login({ email: "a@example.com", password: "pw" })).rejects.toThrow(
        "Security verification failed. Please try again.",
      );
      expect(fetchMock()).toHaveBeenCalledTimes(4);
    });

    it.each([
      { case: "another kind of 403", response: () => jsonResponse({ error: "FORBIDDEN" }, 403) },
      { case: "a non-JSON 403", response: () => new Response("Forbidden", { status: 403 }) },
    ])("does not retry $case", async ({ response }) => {
      setCookie("fortress_csrf=tok");
      fetchMock().mockResolvedValueOnce(response());

      await expect(client.logout()).rejects.toThrow();
      expect(fetchMock()).toHaveBeenCalledTimes(1);
    });

    it.each([
      { case: "replies with non-JSON", response: () => new Response("oops", { status: 502 }) },
      { case: "replies with JSON null", response: () => jsonResponse(null) },
      {
        case: "reports failure",
        response: () => jsonResponse({ success: false, error: "INTERNAL_ERROR" }, 500),
      },
    ])("still sends the request, without a token, when the CSRF endpoint $case", async ({
      response,
    }) => {
      fetchMock()
        .mockResolvedValueOnce(response())
        .mockResolvedValueOnce(jsonResponse({ success: true, data: { requested: true } }));

      await expect(client.requestPasswordReset("a@example.com")).resolves.toEqual({
        requested: true,
      });
      expect(requestTo("/auth/request-password-reset").headers.has("x-csrf-token")).toBe(false);
    });
  });

  describe("configuration", () => {
    it("is unavailable and refuses every request when no auth URL is configured", async () => {
      const original = config.auth.apiUrl;
      config.auth.apiUrl = null;
      try {
        const unconfigured = new AuthClient();

        expect(unconfigured.isAvailable).toBe(false);
        await expect(unconfigured.getMe()).rejects.toThrow(
          "Auth service is not configured. Set VITE_AUTH_API_URL.",
        );
        await expect(unconfigured.fetchCsrf()).rejects.toThrow("Auth service is not configured");
        expect(() => unconfigured.openOAuth("google")).toThrow("Auth service is not configured");
        expect(fetchMock()).not.toHaveBeenCalled();
      } finally {
        config.auth.apiUrl = original;
      }
    });

    it("is available when an auth URL is configured", () => {
      expect(client.isAvailable).toBe(true);
    });

    it.each([
      "google",
      "github",
    ] as const)("sends the browser to the %s sign-in start page", (provider) => {
      const location = { href: "http://localhost/" };
      vi.stubGlobal("location", location);

      client.openOAuth(provider);

      expect(location.href).toBe(`${base}/auth/oauth/${provider}`);
    });
  });
});
