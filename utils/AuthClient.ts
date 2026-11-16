import type { User } from "./AuthStore.ts";
import { config } from "./config.ts";

export class AuthClient {
  private readonly baseUrl: string | null;
  private csrfToken: string | null = null;

  constructor() {
    this.baseUrl = config.auth.apiUrl;
  }

  /** True when the auth service is configured and reachable. */
  get isAvailable(): boolean {
    return this.baseUrl !== null;
  }

  private requireBaseUrl(): string {
    if (!this.baseUrl) {
      throw new Error("Auth service is not configured. Set VITE_AUTH_API_URL.");
    }
    return this.baseUrl;
  }

  private getCsrfTokenFromCookie(): string | null {
    const match = document.cookie.match(/(^| )fortress_csrf=([^;]+)/);
    return match ? decodeURIComponent(match[2]) : null;
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    let json: any;
    try {
      json = await response.json();
    } catch {
      throw new Error(
        `Request failed with status ${response.status} (non-JSON response from server)`,
      );
    }
    if (json === null || typeof json !== "object") {
      throw new Error(
        `Request failed with status ${response.status} (unexpected response from server)`,
      );
    }
    if (!response.ok || json.success === false) {
      // Production fortress replies carry a readable `message` and no `details`;
      // without it users would see bare codes such as "INVALID_CREDENTIALS".
      throw new Error(
        json.details ||
          json.message ||
          json.error ||
          `Request failed with status ${response.status}`,
      );
    }
    return json.data as T;
  }

  async fetch(path: string, options: RequestInit = {}, retry = false): Promise<Response> {
    const base = this.requireBaseUrl();
    const headers = new Headers(options.headers || {});

    const method = options.method?.toUpperCase() || "GET";
    const needsCsrf = ["POST", "PUT", "DELETE", "PATCH"].includes(method);

    // Only set Content-Type when we are actually sending a JSON body.
    // Setting it on GET/HEAD forces an unnecessary CORS preflight.
    if (options.body !== undefined && options.body !== null) {
      headers.set("Content-Type", "application/json");
    }

    if (needsCsrf) {
      let csrfToken = this.getCsrfTokenFromCookie() || this.csrfToken;
      if (!csrfToken) {
        await this.fetchCsrf();
        csrfToken = this.getCsrfTokenFromCookie() || this.csrfToken;
      }
      if (csrfToken) {
        headers.set("x-csrf-token", csrfToken);
      }
    }

    const response = await fetch(`${base}${path}`, {
      ...options,
      headers,
      credentials: "include",
    });

    if (needsCsrf && !retry && response.status === 403) {
      const clone = response.clone();
      const json = await clone.json().catch(() => null);
      if (json?.error === "CSRF_TOKEN_INVALID") {
        this.csrfToken = null;
        await this.fetchCsrf();
        return this.fetch(path, options, true);
      }
    }

    return response;
  }

  async fetchCsrf(): Promise<void> {
    const base = this.requireBaseUrl();
    const response = await fetch(`${base}/auth/csrf`, { credentials: "include" });
    let json: any;
    try {
      json = await response.json();
    } catch {
      return; // Non-JSON response — CSRF unavailable, proceed without it.
    }
    if (response.ok && json?.success && json.data?.csrfToken) {
      this.csrfToken = json.data.csrfToken;
    }
  }

  async getMe() {
    const res = await this.fetch("/auth/me");
    const data = await this.parseResponse<{ user: User }>(res);
    return data.user;
  }

  async signUp(credentials: Record<string, string>) {
    const res = await this.fetch("/auth/signup", {
      method: "POST",
      body: JSON.stringify(credentials),
    });
    const data = await this.parseResponse<{ user: User }>(res);
    return data.user;
  }

  async login(credentials: Record<string, string>) {
    const res = await this.fetch("/auth/login", {
      method: "POST",
      body: JSON.stringify(credentials),
    });
    const data = await this.parseResponse<{ user: User }>(res);
    return data.user;
  }

  async logout() {
    const res = await this.fetch("/auth/logout", { method: "POST" });
    await this.parseResponse(res);
  }

  async verifyEmail(token: string) {
    const res = await this.fetch("/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
    return this.parseResponse(res);
  }

  async requestPasswordReset(email: string) {
    const res = await this.fetch("/auth/request-password-reset", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    return this.parseResponse(res);
  }

  async resetPassword(token: string, newPassword: string) {
    const res = await this.fetch("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, newPassword }),
    });
    return this.parseResponse(res);
  }

  /** OAuth redirect — navigates the page to the provider. */
  openOAuth(provider: "google" | "github"): void {
    const base = this.requireBaseUrl();
    window.location.href = `${base}/auth/oauth/${provider}`;
  }
}

export const authClient = new AuthClient();
