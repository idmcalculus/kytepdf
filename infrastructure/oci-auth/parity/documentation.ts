/**
 * Documentation parity checker for the OCI_Deployment README.
 *
 * Checks that the README accurately describes what the deployment does:
 *   - All four `/opt/auth/` env files cloud-init writes are documented (R6.1)
 *   - No `/opt/auth/*.env` path is documented that the deployment does not write (R6.2)
 *   - The README states the auth service is the `auth-server/` unit run as-is,
 *     with version determined by `auth-server/package.json` (R6.3)
 *   - No `@fortressauth/server` version literal or `appVersion … 0.1.14` row
 *     appears in the README (R6.4)
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 8.4
 */

import type { DocumentationFinding } from "./types.js";

/**
 * Regex that matches any `/opt/auth/` path reference ending in `.env` in the
 * README text. Used to detect phantom path documentation (R6.2).
 *
 * Captures the full path (group 1), e.g. `/opt/auth/secrets.env`.
 */
const OPT_AUTH_ENV_PATH_RE = /\/opt\/auth\/[A-Za-z0-9_-]+\.env/g;

/**
 * Regex patterns that indicate the README describes the deployed auth service
 * as the `auth-server/` Deployable_Unit run as-is, with its version from the
 * `auth-server/package.json` pin (R6.3).
 *
 * Any one of these matches is sufficient to satisfy the requirement.
 */
const RUN_AS_IS_PATTERNS: RegExp[] = [
  /run\s+as[- ]is/i,
  /auth-server\/package\.json/i,
  /package\.json\s+pin/i,
];

/**
 * Regex patterns that identify a `@fortressauth/server` version literal (R6.4).
 * Matches occurrences such as:
 *   - `@fortressauth/server@0.1.14`
 *   - `@fortressauth/server` followed by a semver version anywhere on the same line
 */
const VERSION_LITERAL_PATTERNS: RegExp[] = [
  /@fortressauth\/server@[^\s"'`\])}]+/i,
  /appVersion[^\n]*0\.1\.14/i,
];

/**
 * Check the OCI_Deployment README for documentation parity.
 *
 * @param readmeText      - The full text content of the README.
 * @param writtenAuthPaths - The set of `/opt/auth/` file paths that the
 *                           cloud-init `write_files` configuration actually
 *                           creates (as absolute path strings). Callers pass
 *                           the real written paths so the checker can detect
 *                           both missing documentation (R6.1) and phantom paths
 *                           documented but not written (R6.2).
 *
 * @returns An array of `DocumentationFinding` entries, one per detected drift.
 *          An empty array means the documentation is in parity.
 */
export function checkDocumentation(
  readmeText: string,
  writtenAuthPaths: string[],
): DocumentationFinding[] {
  const findings: DocumentationFinding[] = [];

  // ── R6.1: Every written file must be documented ──────────────────────────
  for (const writtenPath of writtenAuthPaths) {
    if (!readmeText.includes(writtenPath)) {
      findings.push({
        location: `required-file-${writtenPath}`,
        detail: `File ${writtenPath} not documented in README`,
      });
    }
  }

  // ── R6.2: No `/opt/auth/*.env` path documented that is not in writtenAuthPaths ──
  const writtenSet = new Set(writtenAuthPaths);
  const mentionedPaths = new Set<string>();

  // Reset lastIndex before iterating (the regex has the `g` flag).
  OPT_AUTH_ENV_PATH_RE.lastIndex = 0;
  let match = OPT_AUTH_ENV_PATH_RE.exec(readmeText);
  while (match !== null) {
    mentionedPaths.add(match[0]);
    match = OPT_AUTH_ENV_PATH_RE.exec(readmeText);
  }

  for (const mentionedPath of mentionedPaths) {
    if (!writtenSet.has(mentionedPath)) {
      findings.push({
        location: mentionedPath,
        detail: `Path ${mentionedPath} is documented in README but is not a file written by cloud-init write_files (undocumented-or-phantom-path)`,
      });
    }
  }

  // ── R6.3: "Run as-is / version from auth-server/package.json pin" phrasing ──
  const hasRunAsIs = RUN_AS_IS_PATTERNS.some((pattern) => pattern.test(readmeText));
  if (!hasRunAsIs) {
    findings.push({
      location: "run-as-is-phrasing",
      detail:
        "README does not state that the auth service is the auth-server/ Deployable_Unit run as-is with its version from the auth-server/package.json pin",
    });
  }

  // ── R6.4: No @fortressauth/server version literal or appVersion 0.1.14 row ──
  for (const pattern of VERSION_LITERAL_PATTERNS) {
    const versionMatch = pattern.exec(readmeText);
    if (versionMatch !== null) {
      findings.push({
        location: "version-literal",
        detail: `README contains a @fortressauth/server version literal or appVersion pin: "${versionMatch[0]}"`,
      });
      // Report only one finding per pattern to avoid duplicate entries for
      // the same kind of version literal.
    }
  }

  return findings;
}
