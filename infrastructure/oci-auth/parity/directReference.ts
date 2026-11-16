/**
 * Direct-reference scanner for the Parity_Check.
 *
 * Scans OCI_Deployment_Authored_Content for any occurrence of the
 * `@fortressauth/server` package name (case-insensitive), including any
 * `@fortressauth/server@<version-or-tag>` install/pin form.
 *
 * Callers are responsible for passing only OCI_Deployment_Authored_Content:
 * - Source files (index.ts, cloudinit.ts) are passed verbatim.
 * - Pulumi_Config_Files (Pulumi*.yaml / Pulumi*.yml) are passed verbatim.
 * - The rendered cloud-init MUST be pre-processed with
 *   `stripEmbeddedDeployableUnit(render)` before passing, so the
 *   Embedded_Deployable_Unit region is excluded from the scan.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.5, 3.1, 3.2, 3.3, 8.2
 */

import type { DirectReferenceFinding, ScanSource } from "./types.js";

/**
 * Case-insensitive regex that matches:
 *   - `@fortressauth/server`          (bare package name)
 *   - `@fortressauth/server@<suffix>` (version/tag suffix, e.g. @0.1.14 or @latest)
 *
 * The suffix is any run of non-whitespace, non-quote characters after the `@`,
 * which covers semver literals, dist-tags, and range expressions.
 *
 * The `g` flag is required so `exec` advances through all matches in the line.
 * A new RegExp instance is created per-call (see `scanLine`) to avoid shared
 * `lastIndex` state across sources.
 */
const DIRECT_REFERENCE_PATTERN = /@fortressauth\/server(?:@[^\s"'`]+)?/gi;
const APP_VERSION_PATTERN = /\bappVersion\b/g;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectMatches(line: string, re: RegExp): string[] {
  const found: string[] = [];
  let match = re.exec(line);

  while (match !== null) {
    found.push(match[0]);
    match = re.exec(line);
  }

  return found;
}

/**
 * Find all Direct_Reference matches in a single line of text.
 * Returns an array of matched strings (may be empty).
 *
 * A fresh regex is used each time to avoid lastIndex cross-contamination.
 */
function matchesInLine(line: string, forbiddenVersionLiterals: string[]): string[] {
  // Create a fresh regex instance so lastIndex is always 0 at the start.
  const found = collectMatches(
    line,
    new RegExp(DIRECT_REFERENCE_PATTERN.source, DIRECT_REFERENCE_PATTERN.flags),
  );
  found.push(...collectMatches(line, new RegExp(APP_VERSION_PATTERN.source, "g")));

  for (const version of forbiddenVersionLiterals) {
    const trimmed = version.trim();
    if (!trimmed) continue;

    found.push(...collectMatches(line, new RegExp(`\\b${escapeRegExp(trimmed)}\\b`, "g")));
  }

  return found;
}

/**
 * Scan each source in `sources` for Direct_References to `@fortressauth/server`.
 * Callers may pass canonical Auth_Server version literals to catch a copied
 * standalone infrastructure-side version pin, even when the package name is not
 * repeated on the same line.
 *
 * For each match the function records:
 *   - `file`        — the source artifact name (e.g. a file path or logical label)
 *   - `matchedText` — the full matched text including any `@<version>` suffix
 *   - `line`        — best-effort 1-based line number within the source
 *
 * Returns an empty array when no matches are found in any source.
 *
 * @param sources — Named text sources representing OCI_Deployment_Authored_Content.
 *                  For the rendered cloud-init, callers MUST pass
 *                  `stripEmbeddedDeployableUnit(render)` as the content so the
 *                  Embedded_Deployable_Unit region is excluded before scanning.
 */
export function scanDirectReferences(
  sources: ScanSource[],
  forbiddenVersionLiterals: string[] = [],
): DirectReferenceFinding[] {
  const findings: DirectReferenceFinding[] = [];

  for (const source of sources) {
    const lines = source.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const matched = matchesInLine(lines[i], forbiddenVersionLiterals);
      for (const matchedText of matched) {
        findings.push({
          file: source.name,
          matchedText,
          line: i + 1, // 1-based line number
        });
      }
    }
  }

  return findings;
}
