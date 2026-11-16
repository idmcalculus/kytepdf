/**
 * Unit / edge-case tests for the rendered cloud-init output.
 *
 * **Validates: Requirements 1.3, 1.5, 1.6, 2.2, 2.3, 9.6**
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { RenderArgs } from "../cloudinit.js";
import { renderCloudInit } from "../cloudinit.js";
import { scanDirectReferences } from "../parity/directReference.js";
import { stripEmbeddedDeployableUnit } from "../parity/embeddedRegion.js";
import { AUTH_SERVER_DIR } from "../parity/paths.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the content of a write_files entry by its path.
 * Strips the 6-space indentation added by the cloud-init renderer.
 *
 * The block ends at the next sibling YAML list item (`  - path:`) OR a YAML
 * comment line (`  # `) that separates write_files blocks in the render output.
 */
function extractFileContent(rendered: string, filePath: string): string | undefined {
  const pathMarker = `path: ${filePath}`;
  const pathIndex = rendered.indexOf(pathMarker);
  if (pathIndex === -1) return undefined;

  const contentMarker = "content: |";
  const contentIndex = rendered.indexOf(contentMarker, pathIndex);
  if (contentIndex === -1) return undefined;

  const contentStart = rendered.indexOf("\n", contentIndex) + 1;

  // A block ends at the next sibling write_files entry opener OR an
  // inter-block YAML comment (e.g. `  # Deployable_Unit lockfile…`).
  const nextBlockPattern = /\n {2}(?:- path:|# )/;
  const nextBlockMatch = nextBlockPattern.exec(rendered.slice(contentStart));
  const contentEnd =
    nextBlockMatch !== null ? contentStart + nextBlockMatch.index : rendered.length;

  const raw = rendered.slice(contentStart, contentEnd);
  // Strip the 6-space indentation added by renderCloudInit's indent() helper
  return raw
    .split("\n")
    .map((line) => (line.startsWith("      ") ? line.slice(6) : line))
    .join("\n");
}

/**
 * Build minimal valid RenderArgs reading real auth-server files from disk.
 */
function baseArgs(overrides: Partial<RenderArgs> = {}): RenderArgs {
  return {
    pgPass: "TestPgPass123",
    backupPass: "TestBackupPass456",
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
    authPackageJson: readFileSync(resolve(AUTH_SERVER_DIR, "package.json"), "utf8"),
    authPackageLock: readFileSync(resolve(AUTH_SERVER_DIR, "package-lock.json"), "utf8"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test 1: Auth command contains `npm ci` and `npm start` (R1.3, R1.5)
// ---------------------------------------------------------------------------

describe("R1.3 / R1.5: Auth container command contains npm ci and npm start", () => {
  it("docker-compose.yml command contains 'npm ci'", () => {
    const rendered = renderCloudInit(baseArgs());
    const compose = extractFileContent(rendered, "/opt/auth/docker-compose.yml") ?? "";
    expect(compose).toContain("npm ci");
  });

  it("docker-compose.yml command contains 'npm start'", () => {
    const rendered = renderCloudInit(baseArgs());
    const compose = extractFileContent(rendered, "/opt/auth/docker-compose.yml") ?? "";
    expect(compose).toContain("npm start");
  });

  it("npm ci appears before npm start in the command", () => {
    const rendered = renderCloudInit(baseArgs());
    const compose = extractFileContent(rendered, "/opt/auth/docker-compose.yml") ?? "";
    const ciIdx = compose.indexOf("npm ci");
    const startIdx = compose.indexOf("npm start");
    expect(ciIdx).toBeGreaterThanOrEqual(0);
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(ciIdx).toBeLessThan(startIdx);
  });
});

// ---------------------------------------------------------------------------
// Test 2: R1.6 failure-message wrapper (R1.6)
// ---------------------------------------------------------------------------

describe("R1.6: npm ci failure-message wrapper", () => {
  it("auth command uses '||' to branch on npm ci failure", () => {
    const rendered = renderCloudInit(baseArgs());
    const compose = extractFileContent(rendered, "/opt/auth/docker-compose.yml") ?? "";
    // The command should use || to chain failure handling
    expect(compose).toContain("||");
  });

  it("failure branch echoes a message referencing 'package-lock.json'", () => {
    const rendered = renderCloudInit(baseArgs());
    const compose = extractFileContent(rendered, "/opt/auth/docker-compose.yml") ?? "";
    // The failure message must mention the lockfile path
    expect(compose).toContain("package-lock.json");
  });

  it("failure branch echoes a message referencing 'Deployable_Unit'", () => {
    const rendered = renderCloudInit(baseArgs());
    const compose = extractFileContent(rendered, "/opt/auth/docker-compose.yml") ?? "";
    // The failure message must mention the Deployable_Unit concept
    expect(compose).toContain("Deployable_Unit");
  });

  it("failure branch exits non-zero before npm start can run", () => {
    const rendered = renderCloudInit(baseArgs());
    const compose = extractFileContent(rendered, "/opt/auth/docker-compose.yml") ?? "";
    // exit 1 must appear in the failure branch (before npm start)
    expect(compose).toContain("exit 1");
    // Verify the structure: || { ... exit 1; }; npm start
    const failureBranchIdx = compose.indexOf("||");
    const exitIdx = compose.indexOf("exit 1");
    const startIdx = compose.indexOf("npm start");
    expect(failureBranchIdx).toBeLessThan(exitIdx);
    expect(exitIdx).toBeLessThan(startIdx);
  });
});

// ---------------------------------------------------------------------------
// Test 3: No `@fortressauth/server` in authored content (R2.2, R2.3)
// ---------------------------------------------------------------------------

describe("R2.2 / R2.3: No @fortressauth/server in OCI-authored content after stripping embedded region", () => {
  it("scanDirectReferences returns [] on the stripped render", () => {
    const rendered = renderCloudInit(baseArgs());
    const stripped = stripEmbeddedDeployableUnit(rendered);
    const findings = scanDirectReferences([{ name: "rendered-cloud-init", content: stripped }]);
    expect(findings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Test 4: Embedded package.json equals canonical (R1.3)
// ---------------------------------------------------------------------------

describe("R1.3: Embedded package.json equals canonical auth-server/package.json", () => {
  it("the /opt/auth/app/package.json write_files block equals the canonical file", () => {
    const rendered = renderCloudInit(baseArgs());
    const embedded = extractFileContent(rendered, "/opt/auth/app/package.json") ?? "";
    const canonical = readFileSync(resolve(AUTH_SERVER_DIR, "package.json"), "utf8");

    // Both should round-trip the same content (trailing newline may differ from indent stripping)
    expect(embedded.trimEnd()).toBe(canonical.trimEnd());
  });
});

// ---------------------------------------------------------------------------
// Test 5: Embedded package-lock.json equals canonical (R1.3)
// ---------------------------------------------------------------------------

describe("R1.3: Embedded package-lock.json equals canonical auth-server/package-lock.json", () => {
  it("the /opt/auth/app/package-lock.json write_files block equals the canonical file", () => {
    const rendered = renderCloudInit(baseArgs());
    const embedded = extractFileContent(rendered, "/opt/auth/app/package-lock.json") ?? "";
    const canonical = readFileSync(resolve(AUTH_SERVER_DIR, "package-lock.json"), "utf8");

    expect(embedded.trimEnd()).toBe(canonical.trimEnd());
  });
});

// ---------------------------------------------------------------------------
// Test 6: SES-absence in OCI-authored content (R9.6)
// ---------------------------------------------------------------------------

describe("R9.6: No SES configuration in OCI-authored content", () => {
  it("stripped render contains no SES_-prefixed env var NAME (e.g. SES_REGION=)", () => {
    const rendered = renderCloudInit(baseArgs());
    const stripped = stripEmbeddedDeployableUnit(rendered);
    // Should not contain any SES_<NAME>= pattern
    expect(stripped).not.toMatch(/\bSES_[A-Za-z0-9_]+=\S/);
  });

  it("stripped render contains no 'ses' provider token as a standalone word in authored sections", () => {
    const rendered = renderCloudInit(baseArgs());
    const stripped = stripEmbeddedDeployableUnit(rendered);
    // The exact word 'ses' should not appear as a standalone word (emailProvider=ses etc.)
    expect(stripped).not.toMatch(/\bses\b/);
  });

  it("stripped render contains none of the SES Pulumi input identifiers", () => {
    const rendered = renderCloudInit(baseArgs());
    const stripped = stripEmbeddedDeployableUnit(rendered);

    expect(stripped).not.toMatch(/\bsesRegion\b/);
    expect(stripped).not.toMatch(/\bsesFromAddress\b/);
    expect(stripped).not.toMatch(/\bsesAccessKeyId\b/);
    expect(stripped).not.toMatch(/\bsesSecretAccessKey\b/);
  });
});

// ---------------------------------------------------------------------------
// Test 7: Embedded package names don't produce false positives (R9.6)
// ---------------------------------------------------------------------------

describe("R9.6: SES package names in embedded region don't cause false positives", () => {
  it("@aws-sdk/client-ses appears only inside the embedded region and not in the stripped render", () => {
    const rendered = renderCloudInit(baseArgs());
    const stripped = stripEmbeddedDeployableUnit(rendered);

    // The stripped (authored) content should not contain @aws-sdk/client-ses
    // (it only lives inside the embedded package-lock.json which is stripped out)
    expect(stripped).not.toContain("@aws-sdk/client-ses");
  });

  it("@fortressauth/email-ses appears only inside the embedded region and not in the stripped render", () => {
    const rendered = renderCloudInit(baseArgs());
    const stripped = stripEmbeddedDeployableUnit(rendered);

    // The stripped (authored) content should not contain @fortressauth/email-ses
    expect(stripped).not.toContain("@fortressauth/email-ses");
  });

  it("scanDirectReferences on stripped render returns [] even though package-lock.json embeds @fortressauth/server", () => {
    // The full render will contain @fortressauth/server inside the embedded region
    // (from package.json and package-lock.json), but after stripping those blocks,
    // scanDirectReferences must return []
    const rendered = renderCloudInit(baseArgs());

    // Confirm the reference exists in the full render (proving the test is meaningful)
    expect(rendered).toContain("@fortressauth/server");

    // After stripping, no findings
    const stripped = stripEmbeddedDeployableUnit(rendered);
    const findings = scanDirectReferences([{ name: "rendered-cloud-init", content: stripped }]);
    expect(findings).toEqual([]);
  });
});
