/**
 * Property-based tests for cloud-init content embedding round-trips.
 *
 * **Validates: Requirements 1.5, 3.4, 3.7**
 *
 * // Feature: auth-server-deployment-parity, Property 5: Cloud-init content embedding round-trips
 *
 * The key invariant (R3.4, R3.7):
 *   Embedding arbitrary content into the `write_files` block scalar via `renderCloudInit`
 *   and then extracting it via `checkDeploymentMechanism` must return the original content
 *   byte-for-byte (modulo trailing whitespace, which is normalized by YAML literal block
 *   scalar "clip" chomping semantics), establishing the precondition that makes excluding the
 *   Embedded_Deployable_Unit region from the Direct_Reference scan safe.
 *
 *   Concretely: `content.trimEnd()` equals the trimmed extracted content, meaning all
 *   non-whitespace content round-trips unchanged. The `checkDeploymentMechanism` comparison
 *   applies `trimEnd()` on both sides to reflect YAML clip semantics and to be robust to the
 *   blank separator lines the cloud-init template places between write_files entries.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { RenderArgs } from "../cloudinit.js";
import { renderCloudInit } from "../cloudinit.js";
import { checkDeploymentMechanism } from "../parity/deploymentMechanism.js";
import { AUTH_SERVER_DIR } from "../parity/paths.js";

// ---------------------------------------------------------------------------
// Base args helper
// ---------------------------------------------------------------------------

function baseArgs(overrides: Partial<RenderArgs> = {}): RenderArgs {
  const authPkg = readFileSync(resolve(AUTH_SERVER_DIR, "package.json"), "utf8");
  const authLock = readFileSync(resolve(AUTH_SERVER_DIR, "package-lock.json"), "utf8");
  return {
    pgPass: "TestPg",
    backupPass: "TestBackup",
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
    authPackageJson: authPkg,
    authPackageLock: authLock,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * Generate safe content strings that survive round-trip through the YAML block
 * scalar embedding. We restrict to printable ASCII chars that are safe in YAML
 * block scalars.
 *
 * The `indent()` helper in renderCloudInit adds 6 spaces to every non-empty line.
 * The extractor in checkDeploymentMechanism strips that indent back.
 * The comparison uses `trimEnd()` on both sides to handle YAML clip-chomping
 * semantics (trailing blank lines may be added by the template separator).
 *
 * Generator constraints:
 *  1. At least one non-empty line — purely whitespace content trimEnd()s to "".
 *     Two such strings would falsely appear equal under trimEnd() comparison.
 *  2. No YAML special characters at the start of lines that would break the
 *     6-space-indented block scalar.
 */
const safeLineChar = fc.constantFrom(
  ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-+=@#!&*()[]{}:,.<>?/|~`".split(
    "",
  ),
);

/** A non-empty safe line (at least 1 printable character). */
const nonEmptyLineArb: fc.Arbitrary<string> = fc
  .array(safeLineChar, { minLength: 1, maxLength: 60 })
  .map((chars) => chars.join(""));

/** An optional safe line (may be empty — represents blank interior lines). */
const optionalLineArb: fc.Arbitrary<string> = fc
  .array(safeLineChar, { minLength: 0, maxLength: 60 })
  .map((chars) => chars.join(""));

/**
 * Generate a multi-line string with at least one non-empty line, terminated
 * with a single trailing newline.
 *
 * Shape: nonEmptyLine ("\n" optionalLine)* "\n"
 */
const safeContentArb: fc.Arbitrary<string> = fc
  .tuple(nonEmptyLineArb, fc.array(optionalLineArb, { minLength: 0, maxLength: 18 }))
  .map(([firstLine, restLines]) => `${[firstLine, ...restLines].join("\n")}\n`);

// ---------------------------------------------------------------------------
// Property 5: Cloud-init content embedding round-trips
// ---------------------------------------------------------------------------

describe("Property 5: Cloud-init content embedding round-trips", () => {
  // 5a. Arbitrary safe content round-trips via authPackageJson embedding.
  // The check passes iff checkDeploymentMechanism returns no embedded-package-json finding.
  it("arbitrary content embedded as authPackageJson round-trips byte-for-byte (no embedded-package-json finding)", () => {
    fc.assert(
      fc.property(safeContentArb, (content) => {
        const rendered = renderCloudInit(baseArgs({ authPackageJson: content }));
        const findings = checkDeploymentMechanism({
          renderedCloudInit: rendered,
          canonicalPackageJson: content,
          canonicalPackageLock: baseArgs().authPackageLock,
        });

        const pkgFindings = findings.filter((f) => f.aspect === "embedded-package-json");
        expect(pkgFindings).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  });

  // 5b. Arbitrary safe content round-trips via authPackageLock embedding.
  it("arbitrary content embedded as authPackageLock round-trips byte-for-byte (no embedded-lockfile finding)", () => {
    fc.assert(
      fc.property(safeContentArb, (content) => {
        const rendered = renderCloudInit(baseArgs({ authPackageLock: content }));
        const findings = checkDeploymentMechanism({
          renderedCloudInit: rendered,
          canonicalPackageJson: baseArgs().authPackageJson,
          canonicalPackageLock: content,
        });

        const lockFindings = findings.filter((f) => f.aspect === "embedded-lockfile");
        expect(lockFindings).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  });

  // 5c. Two independent arbitrary contents can be embedded simultaneously and both round-trip.
  it("two independent arbitrary contents embedded as authPackageJson and authPackageLock both round-trip", () => {
    fc.assert(
      fc.property(safeContentArb, safeContentArb, (pkgContent, lockContent) => {
        const rendered = renderCloudInit(
          baseArgs({ authPackageJson: pkgContent, authPackageLock: lockContent }),
        );
        const findings = checkDeploymentMechanism({
          renderedCloudInit: rendered,
          canonicalPackageJson: pkgContent,
          canonicalPackageLock: lockContent,
        });

        const embedFindings = findings.filter(
          (f) => f.aspect === "embedded-package-json" || f.aspect === "embedded-lockfile",
        );
        expect(embedFindings).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  });

  // 5d. Real files pass the mechanism check with no findings at all.
  it("real auth-server/package.json and package-lock.json produce zero findings when embedded", () => {
    const authPkg = readFileSync(resolve(AUTH_SERVER_DIR, "package.json"), "utf8");
    const authLock = readFileSync(resolve(AUTH_SERVER_DIR, "package-lock.json"), "utf8");

    const rendered = renderCloudInit(baseArgs());
    const findings = checkDeploymentMechanism({
      renderedCloudInit: rendered,
      canonicalPackageJson: authPkg,
      canonicalPackageLock: authLock,
    });

    expect(findings).toHaveLength(0);
  });

  // 5e. Mismatched canonical content (different trimEnd()) is reliably detected.
  // This verifies the byte-equality precondition: the R3.7 exclusion safety guarantee
  // only holds when the embedded content matches the canonical files.
  it("mismatched canonical content (different trimEnd) is reliably detected — produces an embedded finding", () => {
    fc.assert(
      fc.property(safeContentArb, safeContentArb, (embeddedContent, differentContent) => {
        // Only run the check when the two have meaningfully different non-whitespace content.
        // The comparison normalizes trailing whitespace via trimEnd(), so we must ensure
        // the trimmed versions are different to guarantee a detectable mismatch.
        fc.pre(embeddedContent.trimEnd() !== differentContent.trimEnd());

        const rendered = renderCloudInit(baseArgs({ authPackageJson: embeddedContent }));
        const findings = checkDeploymentMechanism({
          renderedCloudInit: rendered,
          // Pass a different string as canonical — should detect mismatch
          canonicalPackageJson: differentContent,
          canonicalPackageLock: baseArgs().authPackageLock,
        });

        const pkgFindings = findings.filter((f) => f.aspect === "embedded-package-json");
        expect(pkgFindings.length).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: 100 },
    );
  });
});
