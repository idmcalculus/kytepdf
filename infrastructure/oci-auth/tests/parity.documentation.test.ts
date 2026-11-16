/**
 * Example / edge-case tests for the documentation parity checker.
 *
 * Validates that `checkDocumentation()` correctly detects (or ignores) drift
 * between the OCI_Deployment README and the actual cloud-init `write_files`
 * configuration.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 8.4
 */

import { describe, expect, it } from "vitest";
import { checkDocumentation } from "../parity/documentation.js";

// ---------------------------------------------------------------------------
// Constants shared across tests
// ---------------------------------------------------------------------------

const WRITTEN_AUTH_PATHS = [
  "/opt/auth/postgres-secrets.env",
  "/opt/auth/auth-secrets.env",
  "/opt/auth/backup-secrets.env",
  "/opt/auth/app.env",
];

/**
 * A README that satisfies all four documentation requirements:
 *   - Documents all four written env-file paths (R6.1)
 *   - No phantom paths beyond the four written ones (R6.2)
 *   - States the service is run as-is with version from auth-server/package.json (R6.3)
 *   - No @fortressauth/server version literal (R6.4)
 */
const goodReadme = `
# OCI Auth

The auth service is the auth-server/ Deployable_Unit run as-is.
Its version is from the auth-server/package.json pin.

## Environment Files

| Path | Mode | Contains | Consumed by |
|---|---|---|---|
| /opt/auth/postgres-secrets.env | 0600 | POSTGRES_PASSWORD | Postgres container |
| /opt/auth/auth-secrets.env | 0600 | secrets | auth container |
| /opt/auth/backup-secrets.env | 0600 | BACKUP_PASSPHRASE | backup script |
| /opt/auth/app.env | 0644 | non-secret config | auth container |
`;

// ---------------------------------------------------------------------------
// R6.1 — All four files documented → no finding
// ---------------------------------------------------------------------------

describe("R6.1 — all four written files documented", () => {
  it("returns no findings when README mentions all four paths with run-as-is phrasing", () => {
    const findings = checkDocumentation(goodReadme, WRITTEN_AUTH_PATHS);
    expect(findings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// R6.1 — Missing one file → finding for that path
// ---------------------------------------------------------------------------

describe("R6.1 — missing one documented file", () => {
  it("reports a finding for /opt/auth/backup-secrets.env when it is omitted from the README", () => {
    const missingPath = "/opt/auth/backup-secrets.env";
    const readme = goodReadme.replace(
      "| /opt/auth/backup-secrets.env | 0600 | BACKUP_PASSPHRASE | backup script |\n",
      "",
    );

    const findings = checkDocumentation(readme, WRITTEN_AUTH_PATHS);

    const finding = findings.find((f) => f.location.includes(missingPath));
    expect(finding).toBeDefined();
    expect(finding?.location).toContain(missingPath);
  });

  it("reports a finding for /opt/auth/app.env when it is omitted from the README", () => {
    const missingPath = "/opt/auth/app.env";
    const readme = goodReadme.replace(
      "| /opt/auth/app.env | 0644 | non-secret config | auth container |\n",
      "",
    );

    const findings = checkDocumentation(readme, WRITTEN_AUTH_PATHS);

    const finding = findings.find((f) => f.location.includes(missingPath));
    expect(finding).toBeDefined();
    expect(finding?.location).toContain(missingPath);
  });
});

// ---------------------------------------------------------------------------
// R6.2 — Phantom path flagged
// ---------------------------------------------------------------------------

describe("R6.2 — phantom path documentation", () => {
  it("reports a finding when README documents /opt/auth/secrets.env (old phantom path)", () => {
    const phantomPath = "/opt/auth/secrets.env";
    const readmeWithPhantom = `${goodReadme}\n| ${phantomPath} | 0600 | old secrets | auth container |\n`;

    const findings = checkDocumentation(readmeWithPhantom, WRITTEN_AUTH_PATHS);

    const finding = findings.find((f) => f.location === phantomPath);
    expect(finding).toBeDefined();
    expect(finding?.location).toBe(phantomPath);
  });

  it("does not report a finding when only the four canonical paths appear in the README", () => {
    const findings = checkDocumentation(goodReadme, WRITTEN_AUTH_PATHS);
    // No phantom-path findings should be present
    const phantomFindings = findings.filter((f) =>
      f.detail.includes("undocumented-or-phantom-path"),
    );
    expect(phantomFindings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// R6.3 — Run-as-is phrasing present → no finding
// ---------------------------------------------------------------------------

describe("R6.3 — run-as-is phrasing", () => {
  it("returns no run-as-is finding when README contains 'run as-is' and 'auth-server/package.json'", () => {
    const findings = checkDocumentation(goodReadme, WRITTEN_AUTH_PATHS);
    const runAsIsFindings = findings.filter((f) => f.location === "run-as-is-phrasing");
    expect(runAsIsFindings).toHaveLength(0);
  });

  it("returns no run-as-is finding when README uses 'package.json pin' phrasing", () => {
    const readmeWithPin = goodReadme.replace(
      "auth-server/package.json pin",
      "package.json pin for the deployable unit",
    );
    const findings = checkDocumentation(readmeWithPin, WRITTEN_AUTH_PATHS);
    const runAsIsFindings = findings.filter((f) => f.location === "run-as-is-phrasing");
    expect(runAsIsFindings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// R6.3 — Missing run-as-is phrasing → finding
// ---------------------------------------------------------------------------

describe("R6.3 — missing run-as-is phrasing", () => {
  it("reports a run-as-is-phrasing finding when README omits both 'run as-is' and 'package.json' pin", () => {
    // Build a README that lists all four files but contains no run-as-is language.
    const readmeNoRunAsIs = `
# OCI Auth

The auth service handles authentication.

## Environment Files

| Path | Mode | Contains | Consumed by |
|---|---|---|---|
| /opt/auth/postgres-secrets.env | 0600 | POSTGRES_PASSWORD | Postgres container |
| /opt/auth/auth-secrets.env | 0600 | secrets | auth container |
| /opt/auth/backup-secrets.env | 0600 | BACKUP_PASSPHRASE | backup script |
| /opt/auth/app.env | 0644 | non-secret config | auth container |
`;

    const findings = checkDocumentation(readmeNoRunAsIs, WRITTEN_AUTH_PATHS);

    const finding = findings.find((f) => f.location === "run-as-is-phrasing");
    expect(finding).toBeDefined();
    expect(finding?.location).toBe("run-as-is-phrasing");
  });
});

// ---------------------------------------------------------------------------
// R6.4 — No version literal → no version-literal finding
// ---------------------------------------------------------------------------

describe("R6.4 — no version literal in README", () => {
  it("returns no version-literal finding when README has no @fortressauth/server version", () => {
    const findings = checkDocumentation(goodReadme, WRITTEN_AUTH_PATHS);
    const versionFindings = findings.filter((f) => f.location === "version-literal");
    expect(versionFindings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// R6.4 — Version literal `@fortressauth/server@0.1.14` → version-literal finding
// ---------------------------------------------------------------------------

describe("R6.4 — @fortressauth/server version literal", () => {
  it("reports a version-literal finding when README includes '@fortressauth/server@0.1.14'", () => {
    const readmeWithVersion = `${goodReadme}\nUses \`@fortressauth/server@0.1.14\` from the registry.\n`;

    const findings = checkDocumentation(readmeWithVersion, WRITTEN_AUTH_PATHS);

    const finding = findings.find((f) => f.location === "version-literal");
    expect(finding).toBeDefined();
    expect(finding?.location).toBe("version-literal");
  });
});

// ---------------------------------------------------------------------------
// R6.4 — `appVersion: 0.1.14` row → version-literal finding
// ---------------------------------------------------------------------------

describe("R6.4 — appVersion 0.1.14 row", () => {
  it("reports a version-literal finding when README includes an appVersion … 0.1.14 row", () => {
    const readmeWithAppVersion = `${goodReadme}\n| appVersion | 0.1.14 | pinned release |\n`;

    const findings = checkDocumentation(readmeWithAppVersion, WRITTEN_AUTH_PATHS);

    const finding = findings.find((f) => f.location === "version-literal");
    expect(finding).toBeDefined();
    expect(finding?.location).toBe("version-literal");
  });
});

// ---------------------------------------------------------------------------
// R8.4 — Findings carry non-empty location and detail strings
// ---------------------------------------------------------------------------

describe("R8.4 — finding shape (location and detail are non-empty strings)", () => {
  it("every finding from a README with multiple drift issues has non-empty location and detail", () => {
    // README with several problems: missing a file, phantom path, no run-as-is, version literal.
    const badReadme = `
# OCI Auth

Uses @fortressauth/server@0.1.14.

## Environment Files

| /opt/auth/postgres-secrets.env | 0600 | POSTGRES_PASSWORD | Postgres container |
| /opt/auth/auth-secrets.env | 0600 | secrets | auth container |
| /opt/auth/backup-secrets.env | 0600 | BACKUP_PASSPHRASE | backup script |
| /opt/auth/secrets.env | 0600 | old secrets | auth container |
`;
    // Note: /opt/auth/app.env is missing, /opt/auth/secrets.env is phantom,
    //       no run-as-is phrasing, and there's a version literal.

    const findings = checkDocumentation(badReadme, WRITTEN_AUTH_PATHS);

    expect(findings.length).toBeGreaterThan(0);

    for (const finding of findings) {
      expect(typeof finding.location).toBe("string");
      expect(finding.location.length).toBeGreaterThan(0);
      expect(typeof finding.detail).toBe("string");
      expect(finding.detail.length).toBeGreaterThan(0);
    }
  });
});
