/**
 * Unit / edge-case tests for the deployment-mechanism checker.
 *
 * **Validates: Requirements 1.6, 3.4, 3.5, 3.7**
 */

import { describe, expect, it } from "vitest";
import { checkDeploymentMechanism } from "../parity/deploymentMechanism.js";

// ---------------------------------------------------------------------------
// Helper: build a minimal cloud-init string with a specific auth command
// and optionally custom embedded package.json / package-lock.json content.
// ---------------------------------------------------------------------------

/**
 * Indent each non-empty line of `s` by 6 spaces (mirrors the cloud-init
 * renderer's `indent()` helper so the block scalar body lines sit at the
 * correct depth for `extractWriteFileContent`).
 */
function indent(s: string): string {
  return s
    .split("\n")
    .map((l) => (l ? `      ${l}` : l))
    .join("\n");
}

function contentBlock(s: string): string {
  return `content: |${s.endsWith("\n") ? "+" : "-"}\n${indent(s)}`;
}

/**
 * Build a minimal cloud-init string that embeds the given command inside the
 * docker-compose `auth` service block, plus optional package.json / lockfile
 * content in their `write_files` entries.
 *
 * The structure mirrors what `renderCloudInit` produces so that
 * `extractAuthCommand` and `extractWriteFileContent` (both internals of
 * `checkDeploymentMechanism`) can parse it correctly.
 */
function makeCloudInitWithCommand(command: string, pkgJson = "", pkgLock = ""): string {
  return `#cloud-config
write_files:
  - path: /opt/auth/app/package.json
    permissions: "0644"
    ${contentBlock(pkgJson || '{"name":"test"}')}
  - path: /opt/auth/app/package-lock.json
    permissions: "0644"
    ${contentBlock(pkgLock || '{"name":"test","lockfileVersion":3}')}
  - path: /opt/auth/docker-compose.yml
    permissions: "0644"
    content: |
      services:
        auth:
          image: node:22-slim
          command: >
            ${command}
`;
}

// ---------------------------------------------------------------------------
// The canonical "good" command that satisfies R1.3 + R1.6:
//   - contains `npm ci`
//   - uses `||` failure operator
//   - references `package-lock.json` in the failure message
//   - references `Deployable_Unit` in the failure message
//   - ends with `npm start`
// ---------------------------------------------------------------------------
const GOOD_COMMAND = `sh -c "npm ci --omit=dev || { echo 'ERROR: npm ci could not reproduce the version pinned in the Auth_Server lockfile (/opt/auth/app/package-lock.json) for the Deployable_Unit; refusing to start auth container' >&2; exit 1; }; npm start"`;

// ---------------------------------------------------------------------------
// Test 1: Missing `npm ci` → "npm-ci" finding
// ---------------------------------------------------------------------------

describe("R1.3: missing npm ci → npm-ci finding", () => {
  it("reports aspect 'npm-ci' when the command has no npm ci", () => {
    const cloudInit = makeCloudInitWithCommand("npm start");
    const findings = checkDeploymentMechanism({
      renderedCloudInit: cloudInit,
      canonicalPackageJson: '{"name":"test"}',
      canonicalPackageLock: '{"name":"test","lockfileVersion":3}',
    });

    const aspects = findings.map((f) => f.aspect);
    expect(aspects).toContain("npm-ci");
  });

  it("does not report aspect 'start-script' when npm start is present", () => {
    const cloudInit = makeCloudInitWithCommand("npm start");
    const findings = checkDeploymentMechanism({
      renderedCloudInit: cloudInit,
      canonicalPackageJson: '{"name":"test"}',
      canonicalPackageLock: '{"name":"test","lockfileVersion":3}',
    });

    const aspects = findings.map((f) => f.aspect);
    expect(aspects).not.toContain("start-script");
  });
});

// ---------------------------------------------------------------------------
// Test 2: Missing R1.6 wrapper → "ci-failure-message" finding
// ---------------------------------------------------------------------------

describe("R1.6: bare npm ci && npm start → ci-failure-message finding", () => {
  it("reports aspect 'ci-failure-message' when the command uses bare && with no || wrapper", () => {
    const cloudInit = makeCloudInitWithCommand("npm ci && npm start");
    const findings = checkDeploymentMechanism({
      renderedCloudInit: cloudInit,
      canonicalPackageJson: '{"name":"test"}',
      canonicalPackageLock: '{"name":"test","lockfileVersion":3}',
    });

    const aspects = findings.map((f) => f.aspect);
    expect(aspects).toContain("ci-failure-message");
  });

  it("does not report npm-ci or start-script when both npm ci and npm start are present", () => {
    const cloudInit = makeCloudInitWithCommand("npm ci && npm start");
    const findings = checkDeploymentMechanism({
      renderedCloudInit: cloudInit,
      canonicalPackageJson: '{"name":"test"}',
      canonicalPackageLock: '{"name":"test","lockfileVersion":3}',
    });

    const aspects = findings.map((f) => f.aspect);
    expect(aspects).not.toContain("npm-ci");
    expect(aspects).not.toContain("start-script");
  });

  it("reports ci-failure-message when || is present but package-lock.json is not referenced", () => {
    // Has || and Deployable_Unit but no package-lock.json reference
    const cmdWithoutLockRef = `sh -c "npm ci || { echo 'ERROR: Deployable_Unit failed' >&2; exit 1; }; npm start"`;
    const cloudInit = makeCloudInitWithCommand(cmdWithoutLockRef);
    const findings = checkDeploymentMechanism({
      renderedCloudInit: cloudInit,
      canonicalPackageJson: '{"name":"test"}',
      canonicalPackageLock: '{"name":"test","lockfileVersion":3}',
    });

    const aspects = findings.map((f) => f.aspect);
    expect(aspects).toContain("ci-failure-message");
  });

  it("reports ci-failure-message when || and package-lock.json are present but Deployable_Unit is not referenced", () => {
    // Has || and package-lock.json but no Deployable_Unit reference
    const cmdWithoutUnitRef = `sh -c "npm ci || { echo 'ERROR: package-lock.json mismatch' >&2; exit 1; }; npm start"`;
    const cloudInit = makeCloudInitWithCommand(cmdWithoutUnitRef);
    const findings = checkDeploymentMechanism({
      renderedCloudInit: cloudInit,
      canonicalPackageJson: '{"name":"test"}',
      canonicalPackageLock: '{"name":"test","lockfileVersion":3}',
    });

    const aspects = findings.map((f) => f.aspect);
    expect(aspects).toContain("ci-failure-message");
  });
});

// ---------------------------------------------------------------------------
// Test 3: Missing `npm start` → "start-script" finding
// ---------------------------------------------------------------------------

describe("R1.3 / R2.4: missing npm start → start-script finding", () => {
  it("reports aspect 'start-script' when the command has npm ci but no npm start", () => {
    // Uses the full R1.6 wrapper but replaces npm start with node server.js
    const cmdWithoutStart = `sh -c "npm ci || { echo 'ERROR: package-lock.json Deployable_Unit' >&2; exit 1; }; node server.js"`;
    const cloudInit = makeCloudInitWithCommand(cmdWithoutStart);
    const findings = checkDeploymentMechanism({
      renderedCloudInit: cloudInit,
      canonicalPackageJson: '{"name":"test"}',
      canonicalPackageLock: '{"name":"test","lockfileVersion":3}',
    });

    const aspects = findings.map((f) => f.aspect);
    expect(aspects).toContain("start-script");
  });

  it("does not report npm-ci when npm ci is present", () => {
    const cmdWithoutStart = `sh -c "npm ci || { echo 'ERROR: package-lock.json Deployable_Unit' >&2; exit 1; }; node server.js"`;
    const cloudInit = makeCloudInitWithCommand(cmdWithoutStart);
    const findings = checkDeploymentMechanism({
      renderedCloudInit: cloudInit,
      canonicalPackageJson: '{"name":"test"}',
      canonicalPackageLock: '{"name":"test","lockfileVersion":3}',
    });

    const aspects = findings.map((f) => f.aspect);
    expect(aspects).not.toContain("npm-ci");
  });
});

// ---------------------------------------------------------------------------
// Test 4: Mismatched embedded package.json → "embedded-package-json" finding
// ---------------------------------------------------------------------------

describe("R3.4 / R3.7: mismatched embedded package.json → embedded-package-json finding", () => {
  it("reports aspect 'embedded-package-json' when canonicalPackageJson differs from embedded content", () => {
    const cloudInit = makeCloudInitWithCommand(
      GOOD_COMMAND,
      '{"name":"test"}', // embedded content
      '{"name":"test","lockfileVersion":3}',
    );

    const findings = checkDeploymentMechanism({
      renderedCloudInit: cloudInit,
      canonicalPackageJson: "different content", // mismatch
      canonicalPackageLock: '{"name":"test","lockfileVersion":3}',
    });

    const aspects = findings.map((f) => f.aspect);
    expect(aspects).toContain("embedded-package-json");
  });

  it("does not report embedded-lockfile when only the package.json mismatches", () => {
    const cloudInit = makeCloudInitWithCommand(
      GOOD_COMMAND,
      '{"name":"test"}',
      '{"name":"test","lockfileVersion":3}',
    );

    const findings = checkDeploymentMechanism({
      renderedCloudInit: cloudInit,
      canonicalPackageJson: "different content",
      canonicalPackageLock: '{"name":"test","lockfileVersion":3}',
    });

    const aspects = findings.map((f) => f.aspect);
    expect(aspects).not.toContain("embedded-lockfile");
  });
});

// ---------------------------------------------------------------------------
// Test 5: Mismatched embedded package-lock.json → "embedded-lockfile" finding
// ---------------------------------------------------------------------------

describe("R3.4 / R3.7: mismatched embedded package-lock.json → embedded-lockfile finding", () => {
  it("reports aspect 'embedded-lockfile' when canonicalPackageLock differs from embedded content", () => {
    const cloudInit = makeCloudInitWithCommand(
      GOOD_COMMAND,
      '{"name":"test"}',
      '{"name":"test","lockfileVersion":3}', // embedded lockfile content
    );

    const findings = checkDeploymentMechanism({
      renderedCloudInit: cloudInit,
      canonicalPackageJson: '{"name":"test"}',
      canonicalPackageLock: "different lockfile content", // mismatch
    });

    const aspects = findings.map((f) => f.aspect);
    expect(aspects).toContain("embedded-lockfile");
  });

  it("does not report embedded-package-json when only the lockfile mismatches", () => {
    const cloudInit = makeCloudInitWithCommand(
      GOOD_COMMAND,
      '{"name":"test"}',
      '{"name":"test","lockfileVersion":3}',
    );

    const findings = checkDeploymentMechanism({
      renderedCloudInit: cloudInit,
      canonicalPackageJson: '{"name":"test"}',
      canonicalPackageLock: "different lockfile content",
    });

    const aspects = findings.map((f) => f.aspect);
    expect(aspects).not.toContain("embedded-package-json");
  });
});

// ---------------------------------------------------------------------------
// Test 6: All correct → empty findings array
// ---------------------------------------------------------------------------

describe("R3.4 / R3.5: all aspects correct → [] (no findings)", () => {
  it("returns [] when command and embedded files are all compliant", () => {
    const pkgJson = '{"name":"test"}';
    const pkgLock = '{"name":"test","lockfileVersion":3}';

    const cloudInit = makeCloudInitWithCommand(GOOD_COMMAND, pkgJson, pkgLock);

    const findings = checkDeploymentMechanism({
      renderedCloudInit: cloudInit,
      canonicalPackageJson: pkgJson,
      canonicalPackageLock: pkgLock,
    });

    expect(findings).toEqual([]);
  });

  it("returns [] for multi-line package.json with matching content", () => {
    const pkgJson = `{\n  "name": "auth-server",\n  "version": "1.0.0"\n}`;
    const pkgLock = `{\n  "name": "auth-server",\n  "lockfileVersion": 3\n}`;

    const cloudInit = makeCloudInitWithCommand(GOOD_COMMAND, pkgJson, pkgLock);

    const findings = checkDeploymentMechanism({
      renderedCloudInit: cloudInit,
      canonicalPackageJson: pkgJson,
      canonicalPackageLock: pkgLock,
    });

    expect(findings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Test 7: Edge cases — missing command block entirely
// ---------------------------------------------------------------------------

describe("Edge cases: no auth command block in cloud-init", () => {
  it("reports npm-ci, ci-failure-message, and start-script when no command: key exists", () => {
    const noCommandCloudInit = `#cloud-config
write_files:
  - path: /opt/auth/app/package.json
    permissions: "0644"
    content: |
      {"name":"test"}
  - path: /opt/auth/app/package-lock.json
    permissions: "0644"
    content: |
      {"name":"test","lockfileVersion":3}
  - path: /opt/auth/docker-compose.yml
    permissions: "0644"
    content: |
      services:
        auth:
          image: node:22-slim
`;

    const findings = checkDeploymentMechanism({
      renderedCloudInit: noCommandCloudInit,
      canonicalPackageJson: '{"name":"test"}',
      canonicalPackageLock: '{"name":"test","lockfileVersion":3}',
    });

    const aspects = findings.map((f) => f.aspect);
    expect(aspects).toContain("npm-ci");
    expect(aspects).toContain("ci-failure-message");
    expect(aspects).toContain("start-script");
  });

  it("each finding has a non-empty detail string", () => {
    const cloudInit = makeCloudInitWithCommand("npm start");
    const findings = checkDeploymentMechanism({
      renderedCloudInit: cloudInit,
      canonicalPackageJson: "different",
      canonicalPackageLock: "different",
    });

    for (const finding of findings) {
      expect(typeof finding.detail).toBe("string");
      expect(finding.detail.length).toBeGreaterThan(0);
    }
  });
});
