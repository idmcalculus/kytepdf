/**
 * Property-based tests for the direct-reference scanner and the
 * Embedded_Deployable_Unit region exclusion.
 *
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.5, 3.1, 3.2, 3.3, 8.2**
 *
 * // Feature: auth-server-deployment-parity, Property 1: Direct-reference scanner detects exactly the references present
 * // Feature: auth-server-deployment-parity, Property 9: Embedded_Deployable_Unit region is excluded, and the exclusion cannot be abused
 */

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { scanDirectReferences } from "../parity/directReference.js";
import { EMBEDDED_UNIT_PATHS, stripEmbeddedDeployableUnit } from "../parity/embeddedRegion.js";
import type { ScanSource } from "../parity/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal cloud-init text with write_files blocks.
 */
function makeCloudInitWithWriteFiles(entries: Array<{ path: string; content: string }>): string {
  const blocks = entries
    .map(
      (e) => `  - path: ${e.path}\n    content: |\n      ${e.content.replace(/\n/g, "\n      ")}`,
    )
    .join("\n");
  return `#cloud-config\nwrite_files:\n${blocks}\nruncmd: []`;
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Safe identifier characters — no whitespace, no YAML/regex special chars. */
const safeIdentChar = fc.constantFrom(
  ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-".split(""),
);

/** Short safe string of length 3..12 — suitable for names, paths, identifiers. */
const safeStringArb: fc.Arbitrary<string> = fc
  .array(safeIdentChar, { minLength: 3, maxLength: 12 })
  .map((chars) => chars.join(""));

/** File name that is safe to use as a ScanSource name. */
const fileNameArb: fc.Arbitrary<string> = fc
  .tuple(safeStringArb, fc.constantFrom(".ts", ".js", ".yaml", ".yml", ".json"))
  .map(([base, ext]) => `src/${base}${ext}`);

/** A semver-like version suffix (e.g. "0.1.14", "1.0.0-beta"). */
const versionSuffixArb: fc.Arbitrary<string> = fc
  .tuple(fc.nat({ max: 5 }), fc.nat({ max: 20 }), fc.nat({ max: 99 }))
  .map(([major, minor, patch]) => `${major}.${minor}.${patch}`);

/** Content that does NOT contain @fortressauth/server (case-insensitive). */
const contentWithoutRefArb: fc.Arbitrary<string> = fc
  .array(
    fc
      .string({ minLength: 0, maxLength: 40 })
      .filter(
        (s) => !s.toLowerCase().includes("@fortressauth/server") && !/\bappVersion\b/.test(s),
      ),
    { minLength: 0, maxLength: 10 },
  )
  .map((lines) => lines.join("\n"));

// ---------------------------------------------------------------------------
// Property 1: Direct-reference scanner detects exactly the references present
// ---------------------------------------------------------------------------

describe("Property 1: Direct-reference scanner detects exactly the references present", () => {
  // 1a. Empty input always produces empty output
  it("scanDirectReferences([]) always returns []", () => {
    expect(scanDirectReferences([])).toEqual([]);
  });

  // 1b. Injecting @fortressauth/server into content means the scanner finds it
  it("finds a reference when @fortressauth/server is injected into source content", () => {
    fc.assert(
      fc.property(fileNameArb, contentWithoutRefArb, (name, surrounding) => {
        const content = `${surrounding}\n@fortressauth/server\n${surrounding}`;
        const sources: ScanSource[] = [{ name, content }];
        const findings = scanDirectReferences(sources);
        expect(findings.length).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: 150 },
    );
  });

  // 1c. Content with no @fortressauth/server substring produces no findings
  it("produces no findings when content has no @fortressauth/server substring", () => {
    fc.assert(
      fc.property(fileNameArb, contentWithoutRefArb, (name, content) => {
        const sources: ScanSource[] = [{ name, content }];
        const findings = scanDirectReferences(sources);
        expect(findings).toHaveLength(0);
      }),
      { numRuns: 150 },
    );
  });

  // 1d. Each finding's `file` matches the source `name`
  it("each finding's file field equals the source name", () => {
    fc.assert(
      fc.property(fileNameArb, (name) => {
        const sources: ScanSource[] = [
          { name, content: "const pkg = require('@fortressauth/server');" },
        ];
        const findings = scanDirectReferences(sources);
        expect(findings.length).toBeGreaterThanOrEqual(1);
        for (const finding of findings) {
          expect(finding.file).toBe(name);
        }
      }),
      { numRuns: 100 },
    );
  });

  // 1e. matchedText contains @fortressauth/server (case-insensitively)
  it("matchedText always contains @fortressauth/server case-insensitively", () => {
    fc.assert(
      fc.property(fileNameArb, (name) => {
        // Use an uppercase variant to exercise case-insensitivity
        const sources: ScanSource[] = [{ name, content: "import x from '@FORTRESSAUTH/SERVER';" }];
        const findings = scanDirectReferences(sources);
        expect(findings.length).toBeGreaterThanOrEqual(1);
        for (const finding of findings) {
          expect(finding.matchedText.toLowerCase()).toContain("@fortressauth/server");
        }
      }),
      { numRuns: 100 },
    );
  });

  // 1f. Version suffixes like @fortressauth/server@0.1.14 are captured in matchedText
  it("matchedText includes the version suffix when @fortressauth/server@<version> is present", () => {
    fc.assert(
      fc.property(fileNameArb, versionSuffixArb, (name, version) => {
        const ref = `@fortressauth/server@${version}`;
        const sources: ScanSource[] = [{ name, content: `npm install ${ref}` }];
        const findings = scanDirectReferences(sources);
        expect(findings.length).toBeGreaterThanOrEqual(1);
        const allText = findings.map((f) => f.matchedText).join(" ");
        expect(allText).toContain(ref);
      }),
      { numRuns: 150 },
    );
  });

  it("flags an appVersion config key even when the package name is absent", () => {
    const findings = scanDirectReferences([
      {
        name: "index.ts",
        content: 'const appVersion = config.get("appVersion") ?? "0.1.14";',
      },
    ]);

    expect(findings.map((f) => f.matchedText)).toContain("appVersion");
  });

  it("flags a copied canonical version literal when the caller supplies it", () => {
    const findings = scanDirectReferences(
      [
        {
          name: "index.ts",
          content: 'const authPackageVersion = "0.1.14";',
        },
      ],
      ["0.1.14"],
    );

    expect(findings.map((f) => f.matchedText)).toContain("0.1.14");
  });

  // 1g. Count of findings equals count of injected references
  it("finding count equals the number of @fortressauth/server occurrences injected", () => {
    fc.assert(
      fc.property(
        fileNameArb,
        fc.integer({ min: 1, max: 5 }),
        contentWithoutRefArb,
        (name, count, padding) => {
          // Put each reference on its own line surrounded by neutral padding
          const refs = Array.from({ length: count }, (_, i) => `@fortressauth/server@1.0.${i}`);
          const content = [padding, ...refs, padding].join("\n");
          const sources: ScanSource[] = [{ name, content }];
          const findings = scanDirectReferences(sources);
          expect(findings).toHaveLength(count);
        },
      ),
      { numRuns: 150 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 9: Embedded_Deployable_Unit region is excluded, and the exclusion
//             cannot be abused
// ---------------------------------------------------------------------------

describe("Property 9: Embedded_Deployable_Unit region is excluded, and the exclusion cannot be abused", () => {
  // 9a. References inside the two embedded paths are stripped before scanning
  it("references inside the embedded write_files paths produce 0 findings after stripping", () => {
    fc.assert(
      fc.property(
        // Vary neutral surrounding content (no @fortressauth/server in it)
        contentWithoutRefArb,
        (surrounding) => {
          const embeddedContent = `${surrounding}\n@fortressauth/server@1.0.0\n${surrounding}`;

          const cloudInit = makeCloudInitWithWriteFiles([
            { path: EMBEDDED_UNIT_PATHS[0], content: embeddedContent },
            { path: EMBEDDED_UNIT_PATHS[1], content: embeddedContent },
          ]);

          const stripped = stripEmbeddedDeployableUnit(cloudInit);
          const sources: ScanSource[] = [{ name: "rendered-cloud-init", content: stripped }];
          const findings = scanDirectReferences(sources);

          expect(findings).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  // 9b. References OUTSIDE the embedded paths are still detected after stripping
  it("references outside the embedded paths are still found after stripping", () => {
    fc.assert(
      fc.property(contentWithoutRefArb, (_surrounding) => {
        // Embedded blocks carry the package name (should be stripped)
        const embeddedContent = "@fortressauth/server embedded";
        // External content injected in runcmd section
        const cloudInitWithExtra = `#cloud-config\nwrite_files:\n  - path: ${EMBEDDED_UNIT_PATHS[0]}\n    content: |\n      ${embeddedContent}\n  - path: /opt/auth/app/other.sh\n    content: |\n      npm install @fortressauth/server\nruncmd:\n  - npm install @fortressauth/server\n  - echo done`;

        const stripped = stripEmbeddedDeployableUnit(cloudInitWithExtra);
        const sources: ScanSource[] = [{ name: "rendered-cloud-init", content: stripped }];
        const findings = scanDirectReferences(sources);

        // At least the runcmd and the other write_files block references remain
        expect(findings.length).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: 100 },
    );
  });

  // 9c. A look-alike path (e.g. /opt/auth/app/package.json.bak) is NOT stripped
  it("a look-alike path is NOT stripped and references within it ARE found", () => {
    fc.assert(
      fc.property(
        // Generate a suffix to append to the exact embedded path — making it a look-alike
        fc.constantFrom(".bak", ".orig", ".tmp", "-copy", "_old"),
        (suffix) => {
          const lookAlikePath = `${EMBEDDED_UNIT_PATHS[0]}${suffix}`;
          const referenceContent = "@fortressauth/server@1.0.0";

          const cloudInit = makeCloudInitWithWriteFiles([
            { path: lookAlikePath, content: referenceContent },
          ]);

          const stripped = stripEmbeddedDeployableUnit(cloudInit);
          const sources: ScanSource[] = [{ name: "rendered-cloud-init", content: stripped }];
          const findings = scanDirectReferences(sources);

          // The look-alike block is NOT stripped, so the reference must be found
          expect(findings.length).toBeGreaterThanOrEqual(1);
        },
      ),
      { numRuns: 100 },
    );
  });

  // 9d. References in authored content outside the cloud-init render are still detected
  it("references injected into other authored sources are detected regardless of embedded stripping", () => {
    fc.assert(
      fc.property(fileNameArb, contentWithoutRefArb, (name, surrounding) => {
        // A second source (not the cloud-init) that contains a direct reference
        const authoredContent = `${surrounding}\n@fortressauth/server\n${surrounding}`;
        const sources: ScanSource[] = [{ name, content: authoredContent }];
        const findings = scanDirectReferences(sources);
        expect(findings.length).toBeGreaterThanOrEqual(1);
        for (const f of findings) {
          expect(f.file).toBe(name);
        }
      }),
      { numRuns: 100 },
    );
  });
});
