/**
 * Parity integration test — runs the full parity check against the live
 * repository files and asserts every category passes.
 *
 * Requirements: 1.1, 1.2, 5.9, 9.2, 9.3, 9.6
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import type { RenderArgs } from "../cloudinit.js";
import { renderCloudInit } from "../cloudinit.js";
import { scanDirectReferences } from "../parity/directReference.js";
import { scanSesConfiguration } from "../parity/emailProvider.js";
import { stripEmbeddedDeployableUnit } from "../parity/embeddedRegion.js";
import { parseEnvContract } from "../parity/envContract.js";
import { AUTH_SERVER_DIR } from "../parity/paths.js";
import { ENV_FILE_PATHS } from "../parity/providedEnv.js";
import { runParityCheck, writtenAuthEnvPaths } from "../parity/runParityCheck.js";
import { isExactSemverPin } from "../parity/semverPin.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Read a UTF-8 file relative to auth-server/. */
function readAuthServerFile(name: string): string {
  return readFileSync(resolve(AUTH_SERVER_DIR, name), "utf8");
}

/** Parse the live auth-server/package.json into an object. */
function readAuthPackageJson(): {
  dependencies?: Record<string, string>;
  scripts?: Record<string, string>;
} {
  return JSON.parse(readAuthServerFile("package.json")) as {
    dependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
}

/** Minimal render args that exercise a console-provider, no-OAuth mode. */
function baseRenderArgs(): RenderArgs {
  const authPackageJson = readAuthServerFile("package.json");
  const authPackageLock = readAuthServerFile("package-lock.json");

  return {
    pgPass: "pg-placeholder",
    backupPass: "backup-placeholder",
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
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("parity integration tests — live repository files", () => {
  /**
   * 1. Main CI assertion: runParityCheck() must return ok === true.
   *    Uses placeholder values for secrets (the same approach runParityCheck
   *    itself uses internally). If this fails, the full categorised findings
   *    are included in the failure message.
   */
  it("runParityCheck() returns ok === true against the live repository", () => {
    const report = runParityCheck();
    expect(report.ok, JSON.stringify(report.details, null, 2)).toBe(true);
  });

  /**
   * 2. auth-server/package.json pins @fortressauth/server as an exact semver
   *    (MAJOR.MINOR.PATCH with no range operators).   (R1.1)
   */
  it("auth-server/package.json has an exact semver pin for @fortressauth/server", () => {
    const pkg = readAuthPackageJson();
    const version = pkg.dependencies?.["@fortressauth/server"];

    expect(
      version,
      "@fortressauth/server must be listed in auth-server/package.json dependencies",
    ).toBeDefined();

    expect(
      isExactSemverPin(version as string),
      `Expected an exact semver pin (MAJOR.MINOR.PATCH) but got: "${version}"`,
    ).toBe(true);
  });

  /**
   * 3. auth-server/package.json declares a non-empty start script.  (R1.2)
   */
  it("auth-server/package.json has a non-empty start script", () => {
    const pkg = readAuthPackageJson();
    const startScript = pkg.scripts?.start;

    expect(
      typeof startScript === "string" && startScript.trim().length > 0,
      `Expected a non-empty start script in auth-server/package.json but got: ${JSON.stringify(startScript)}`,
    ).toBe(true);
  });

  /**
   * 4. scanSesConfiguration over the real .env.example contract and the stripped
   *    rendered cloud-init (Embedded_Deployable_Unit removed) returns no findings.
   *    (R5.9, R9.2, R9.3, R9.6)
   *
   *    The stripped render represents the OCI_Deployment_Authored_Content view —
   *    the region over which the SES check applies.
   */
  it("scanSesConfiguration over real contract + stripped rendered cloud-init returns no findings", () => {
    // Parse the live Env_Var_Contract.
    const envExampleText = readAuthServerFile(".env.example");
    const contract = parseEnvContract(envExampleText);

    // Render one mode (console/no-OAuth) and strip the Embedded_Deployable_Unit region.
    const rendered = renderCloudInit(baseRenderArgs());
    const stripped = stripEmbeddedDeployableUnit(rendered);

    const sources = [{ name: "rendered-cloud-init[console]", content: stripped }];
    const findings = scanSesConfiguration(contract, sources);

    expect(
      findings,
      `Expected no SES findings but got: ${JSON.stringify(findings, null, 2)}`,
    ).toEqual([]);
  });

  /**
   * 5. The embedded package names @aws-sdk/client-ses and @fortressauth/email-ses
   *    that appear inside the Embedded_Deployable_Unit region in the UNSTRIPPED render
   *    do NOT produce false positives once the region is stripped.
   *
   *    - Scanning the stripped render with scanDirectReferences returns no findings.
   *    - Scanning the unstripped render with scanDirectReferences may return findings
   *      (the embedded region contains @fortressauth/server), but that is expected and
   *      is NOT what we assert here — we only confirm the stripped version is clean.
   *
   *    (R9.6, R3.7)
   */
  it("SES package names in the embedded region do not produce false positives after stripping", () => {
    const rendered = renderCloudInit(baseRenderArgs());
    const stripped = stripEmbeddedDeployableUnit(rendered);

    // The stripped render should contain no @fortressauth/server reference.
    const drFindings = scanDirectReferences([
      { name: "rendered-cloud-init[stripped]", content: stripped },
    ]);

    expect(
      drFindings,
      `scanDirectReferences on the stripped render should return [] — ` +
        `found: ${JSON.stringify(drFindings, null, 2)}`,
    ).toEqual([]);

    // The stripped render should also contain no SES configuration items.
    const sesFindings = scanSesConfiguration(
      [], // empty contract — only checking the deployment side
      [{ name: "rendered-cloud-init[stripped]", content: stripped }],
    );

    expect(
      sesFindings,
      `scanSesConfiguration on the stripped render should return [] — ` +
        `found: ${JSON.stringify(sesFindings, null, 2)}`,
    ).toEqual([]);
  });

  /**
   * 6. The env files the documentation check covers are read from the render.
   *    Today that is the four files the README documents. (R6.1, R6.2)
   */
  it("writtenAuthEnvPaths reads the four /opt/auth/*.env files from a real render", () => {
    const rendered = renderCloudInit({ ...baseRenderArgs(), enableBlockVolume: true });
    expect(writtenAuthEnvPaths(rendered)).toEqual([
      "/opt/auth/app.env",
      "/opt/auth/auth-secrets.env",
      "/opt/auth/backup-secrets.env",
      "/opt/auth/postgres-secrets.env",
    ]);
  });

  /**
   * 7. providedEnv reads exactly the env files the auth container loads. If the
   *    auth service gains an env file, providedEnv must read it too, or names in
   *    it would be missed by the env-var comparison. (R5.2)
   */
  it("providedEnv's ENV_FILE_PATHS equals the auth service env_file list in docker-compose.yml", () => {
    const rendered = renderCloudInit(baseRenderArgs());
    const doc = load(rendered) as { write_files: Array<{ path: string; content: string }> };
    const compose = doc.write_files.find((f) => f.path === "/opt/auth/docker-compose.yml");
    expect(compose).toBeDefined();

    const services = (
      load(compose?.content ?? "") as {
        services: Record<string, { env_file?: string[] }>;
      }
    ).services;
    expect([...(services.auth.env_file ?? [])].sort()).toEqual([...ENV_FILE_PATHS].sort());
  });
});
