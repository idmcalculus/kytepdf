// Feature: auth-server-deployment-parity, Task 7.2: Unit/edge-case tests for provided-env extraction

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { RenderArgs } from "../cloudinit.js";
import { renderCloudInit } from "../cloudinit.js";
import { AUTH_SERVER_DIR } from "../parity/paths.js";
import {
  extractProvidedEnvNames,
  providedNamesByMode,
  SUPPORTED_MODES,
} from "../parity/providedEnv.js";

// ---------------------------------------------------------------------------
// Shared test fixture helpers
// ---------------------------------------------------------------------------

/**
 * Minimal RenderArgs with real Deployable_Unit files but placeholder secrets.
 * Allows rendering a valid cloud-init YAML without Pulumi runtime.
 */
function makeRenderArgs(overrides: Partial<RenderArgs> = {}): RenderArgs {
  const authPackageJson = readFileSync(resolve(AUTH_SERVER_DIR, "package.json"), "utf8");
  const authPackageLock = readFileSync(resolve(AUTH_SERVER_DIR, "package-lock.json"), "utf8");

  return {
    pgPass: "placeholder",
    backupPass: "placeholder",
    googleSecret: "",
    githubSecret: "",
    resendApiKey: "",
    domain: "auth.example.com",
    frontendUrl: "https://example.com",
    emailProvider: "console",
    resendFromAddress: "",
    googleClientId: "",
    githubClientId: "",
    corsOrigins: "https://example.com",
    enableBlockVolume: false,
    trustedProxyHopCount: 1,
    tailscaleAuthKey: "",
    tailscaleHostname: "kytepdf-auth",
    tailscaleTag: "",
    authPackageJson,
    authPackageLock,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test 1: Extraction over a real render returns the expected provided set
// ---------------------------------------------------------------------------

describe("extractProvidedEnvNames — real render extraction", () => {
  it("returns expected names when rendering with resend email provider", () => {
    const rendered = renderCloudInit(
      makeRenderArgs({
        emailProvider: "resend",
        resendApiKey: "re_test",
        resendFromAddress: "test@example.com",
      }),
    );

    const names = extractProvidedEnvNames(rendered);

    // Names expected from app.env
    expect(names).toContain("EMAIL_PROVIDER");
    expect(names).toContain("COOKIE_SECURE");
    expect(names).toContain("COOKIE_SAMESITE");
    expect(names).toContain("CSRF_COOKIE_SECURE");
    expect(names).toContain("CSRF_COOKIE_SAMESITE");
    expect(names).toContain("BASE_URL");
    expect(names).toContain("CORS_ORIGINS");
    expect(names).toContain("EMAIL_FROM_ADDRESS");
    expect(names).toContain("TRUSTED_PROXY_HOP_COUNT");

    // Names expected from auth-secrets.env
    expect(names).toContain("DATABASE_URL");
    expect(names).toContain("RESEND_API_KEY");
  });

  it("returns expected names when rendering with console email provider", () => {
    const rendered = renderCloudInit(makeRenderArgs({ emailProvider: "console" }));
    const names = extractProvidedEnvNames(rendered);

    expect(names).toContain("EMAIL_PROVIDER");
    expect(names).toContain("DATABASE_URL");
    expect(names).toContain("COOKIE_SECURE");
  });
});

// ---------------------------------------------------------------------------
// Test 2: Blank lines inside env blocks are skipped
// ---------------------------------------------------------------------------

describe("extractProvidedEnvNames — blank lines inside env blocks are skipped", () => {
  it("correctly extracts all names even when blank lines appear between entries", () => {
    // Build a synthetic cloud-init snippet that contains the env block structure
    // with intentional blank lines between entries.
    const envBlockWithBlanks = [
      "  - path: /opt/auth/app.env",
      '    permissions: "0644"',
      "    owner: root:root",
      "    content: |",
      "      FIRST_VAR=value1",
      "      ", // blank line
      "      SECOND_VAR=value2",
      "      ", // another blank line
      "      THIRD_VAR=value3",
      "  - path: /opt/auth/auth-secrets.env",
      '    permissions: "0600"',
      "    owner: root:root",
      "    content: |",
      "      SECRET_VAR=secret",
    ].join("\n");

    // Wrap in minimal cloud-init structure so the parser can locate the blocks
    const fakeCloudInit = `#cloud-config\nwrite_files:\n${envBlockWithBlanks}\n`;

    const names = extractProvidedEnvNames(fakeCloudInit);

    expect(names).toContain("FIRST_VAR");
    expect(names).toContain("SECOND_VAR");
    expect(names).toContain("THIRD_VAR");
    expect(names).toContain("SECRET_VAR");
    // No spurious entries from blank lines
    expect(names.size).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Test 3: Comment lines inside env blocks are skipped
// ---------------------------------------------------------------------------

describe("extractProvidedEnvNames — comment lines inside env blocks are skipped", () => {
  it("does not produce entries for # comment lines", () => {
    const envBlockWithComments = [
      "  - path: /opt/auth/app.env",
      '    permissions: "0644"',
      "    owner: root:root",
      "    content: |",
      "      # This is a comment",
      "      REAL_VAR=value",
      "      # Another comment line",
      "      ANOTHER_VAR=123",
      "  - path: /opt/auth/auth-secrets.env",
      '    permissions: "0600"',
      "    owner: root:root",
      "    content: |",
      "      SECRET_ONE=s1",
    ].join("\n");

    const fakeCloudInit = `#cloud-config\nwrite_files:\n${envBlockWithComments}\n`;

    const names = extractProvidedEnvNames(fakeCloudInit);

    expect(names).toContain("REAL_VAR");
    expect(names).toContain("ANOTHER_VAR");
    expect(names).toContain("SECRET_ONE");
    // Comment text must not become an entry
    expect(names.has("This")).toBe(false);
    expect(names.has("Another")).toBe(false);
    expect(names.size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Test 4: A name rendered with an empty value is still returned
// ---------------------------------------------------------------------------

describe("extractProvidedEnvNames — empty value still contributes the name", () => {
  it("includes SOME_VAR in the result when rendered as SOME_VAR=", () => {
    const envBlockEmptyValue = [
      "  - path: /opt/auth/app.env",
      '    permissions: "0644"',
      "    owner: root:root",
      "    content: |",
      "      SOME_VAR=",
      "      ANOTHER_WITH_VALUE=hello",
      "  - path: /opt/auth/auth-secrets.env",
      '    permissions: "0600"',
      "    owner: root:root",
      "    content: |",
      "      EMPTY_SECRET=",
    ].join("\n");

    const fakeCloudInit = `#cloud-config\nwrite_files:\n${envBlockEmptyValue}\n`;

    const names = extractProvidedEnvNames(fakeCloudInit);

    // NAME= with empty value must still appear in the set (R5.3 name-only behavior)
    expect(names).toContain("SOME_VAR");
    expect(names).toContain("EMPTY_SECRET");
    expect(names).toContain("ANOTHER_WITH_VALUE");
  });
});

// ---------------------------------------------------------------------------
// Test 5: providedNamesByMode() returns one set per supported mode
// ---------------------------------------------------------------------------

describe("providedNamesByMode — structure", () => {
  it("returns an array with length equal to SUPPORTED_MODES.length", () => {
    const results = providedNamesByMode();
    expect(results).toHaveLength(SUPPORTED_MODES.length);
    expect(results).toHaveLength(4);
  });

  it("each entry has a 'mode' field and a 'names' field that is a Set<string>", () => {
    const results = providedNamesByMode();

    for (const entry of results) {
      // 'mode' field must be present and be one of the supported modes
      expect(entry).toHaveProperty("mode");
      expect(SUPPORTED_MODES).toContain(entry.mode);

      // 'names' field must be a Set<string>
      expect(entry).toHaveProperty("names");
      expect(entry.names).toBeInstanceOf(Set);

      // Every element in the set must be a string
      for (const name of entry.names) {
        expect(typeof name).toBe("string");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Test 6: resend mode provides RESEND_API_KEY; console mode does not
// ---------------------------------------------------------------------------

describe("providedNamesByMode — mode-specific variables", () => {
  it("resend modes include RESEND_API_KEY while console modes do not", () => {
    const results = providedNamesByMode();

    const consoleEntries = results.filter((r) => r.mode.emailProvider === "console");
    const resendEntries = results.filter((r) => r.mode.emailProvider === "resend");

    expect(consoleEntries).toHaveLength(2); // console/oauth-off and console/oauth-on
    expect(resendEntries).toHaveLength(2); // resend/oauth-off and resend/oauth-on

    for (const entry of resendEntries) {
      expect(entry.names).toContain("RESEND_API_KEY");
    }

    for (const entry of consoleEntries) {
      expect(entry.names.has("RESEND_API_KEY")).toBe(false);
    }
  });
});
