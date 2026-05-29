import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const AUTH_SERVER_DIR = path.resolve(__dirname, "../../auth-server");
const SERVER_ENTRY = path.join(AUTH_SERVER_DIR, "node_modules/@fortressauth/server/dist/index.js");

// Skip the entire suite when auth-server dependencies are not installed.
// This avoids CI failures on fresh clones that haven't run `npm install --prefix auth-server`.
// To run: `bun run auth-server:install && bun run test:unit`
const canRun = existsSync(SERVER_ENTRY);
if (!canRun) {
  console.warn(
    "[AuthServerSmoke] Skipped — auth-server/node_modules not found. " +
      "Run `bun run auth-server:install` to enable this test suite.",
  );
}

describe.skipIf(!canRun)("Auth Server Backend Smoke", () => {
  let serverProcess: ChildProcess;
  const PORT = 3099;
  const BASE_URL = `http://127.0.0.1:${PORT}`;

  beforeAll(async () => {
    serverProcess = spawn("node", [SERVER_ENTRY], {
      cwd: AUTH_SERVER_DIR,
      env: {
        ...process.env,
        PORT: String(PORT),
        HOST: "127.0.0.1",
        DATABASE_URL: "./test.db",
        COOKIE_SECURE: "false",
        CSRF_COOKIE_SECURE: "false",
        BASE_URL: "http://localhost",
        EMAIL_PROVIDER: "console",
      },
    });

    // Fail fast if the process exits unexpectedly during startup.
    const earlyExit = new Promise<never>((_, reject) => {
      serverProcess.on("exit", (code) =>
        reject(new Error(`auth-server exited early with code ${code}`)),
      );
    });

    // Poll /health instead of sleeping a fixed amount.
    const ready = (async () => {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        try {
          const res = await fetch(`${BASE_URL}/health`);
          if (res.ok) return;
        } catch {
          // Server not up yet — keep polling.
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      throw new Error("auth-server did not become ready within 10 seconds");
    })();

    await Promise.race([ready, earlyExit]);
  }, 15_000);

  afterAll(() => {
    serverProcess?.kill();
  });

  it("should respond to health check", async () => {
    const res = await fetch(`${BASE_URL}/health`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("ok");
  });

  it("should return CSRF token", async () => {
    const res = await fetch(`${BASE_URL}/auth/csrf`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.csrfToken).toBeDefined();
  });

  it("should fail signup with no CSRF token", async () => {
    const res = await fetch(`${BASE_URL}/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@example.com", password: "pass" }),
    });
    // Should fail CSRF validation
    expect(res.status).toBe(403);
  });
});
