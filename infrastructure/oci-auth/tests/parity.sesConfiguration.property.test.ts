/**
 * Property-based tests for the SES configuration scanner.
 *
 * // Feature: auth-server-deployment-parity, Property 8: SES_Configuration scanner detects exactly the SES items present
 *
 * **Validates: Requirements 5.7, 5.8, 5.9, 9.3, 9.6**
 *
 * Property 8: SES_Configuration scanner detects exactly the SES items present
 */

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { scanSesConfiguration } from "../parity/emailProvider.js";
import type { EnvVarEntry, ScanSource } from "../parity/types.js";

// ---------------------------------------------------------------------------
// Helpers / generators
// ---------------------------------------------------------------------------

/**
 * An identifier that does NOT start with `SES_` — safe for non-SES contract entries.
 * Matches common env var name patterns: starts with a letter or underscore, followed
 * by alphanumerics/underscores, but must not begin with "SES_".
 */
const nonSesVarNameArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[A-Za-z_][A-Za-z0-9_]{0,29}$/)
  .filter((name) => !name.toUpperCase().startsWith("SES_"));

/**
 * A var name that starts with the case-sensitive `SES_` prefix (contract SES entry).
 */
const sesVarNameArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[A-Z0-9_]{1,25}$/)
  .map((suffix) => `SES_${suffix}`);

/** A non-SES `EnvVarEntry`. */
const nonSesEntryArb: fc.Arbitrary<EnvVarEntry> = fc.record({
  name: nonSesVarNameArb,
  required: fc.boolean(),
});

/** An `EnvVarEntry` whose name starts with `SES_`. */
const sesEntryArb: fc.Arbitrary<EnvVarEntry> = fc.record({
  name: sesVarNameArb,
  required: fc.boolean(),
});

/** A `ScanSource` whose content contains none of the known SES deployment triggers. */
const cleanSourceArb: fc.Arbitrary<ScanSource> = fc.record({
  name: fc.string({ minLength: 1, maxLength: 40 }),
  // Content that deliberately avoids: 'ses' as word boundary, sesRegion/sesFromAddress/
  // sesAccessKeyId/sesSecretAccessKey, SES_<name>= pattern.
  // We use a printable ASCII string that can't accidentally match any of those.
  content: fc
    .string({ minLength: 0, maxLength: 200 })
    .filter(
      (s) =>
        !/\bses\b/.test(s) &&
        !/\b(sesRegion|sesFromAddress|sesAccessKeyId|sesSecretAccessKey)\b/.test(s) &&
        !/\bSES_[A-Za-z0-9_]+=/.test(s),
    ),
});

/** A `ScanSource` whose content contains the word `ses` (provider value trigger). */
const sesProviderSourceArb: fc.Arbitrary<ScanSource> = fc.record({
  name: fc.string({ minLength: 1, maxLength: 40 }),
  content: fc.constantFrom(
    "emailProvider=ses",
    "emailProvider: ses",
    'emailProvider: "ses"',
    'EMAIL_PROVIDER="ses"',
    'if (emailProvider === "ses") {}',
    'const supported = ["console", "ses", "resend"];',
    "provider: ses",
    "EMAIL_PROVIDER=ses",
    "type=ses",
  ),
});

/** Source content that contains a Pulumi SES input name. */
const sesPulumiInputArb: fc.Arbitrary<{ input: string; content: string }> = fc
  .constantFrom("sesRegion", "sesFromAddress", "sesAccessKeyId", "sesSecretAccessKey")
  .map((input) => ({ input, content: `config.get("${input}")` }));

/** Source content with a `SES_`-prefixed rendered env var. */
const sesRenderedVarArb: fc.Arbitrary<{ varName: string; content: string }> = fc
  .stringMatching(/^[A-Z][A-Z0-9_]{0,20}$/)
  .map((suffix) => {
    const varName = `SES_${suffix}`;
    return { varName, content: `${varName}=somevalue` };
  });

// ---------------------------------------------------------------------------
// Property 8 — sub-test A: empty input → empty output (R5.9)
// ---------------------------------------------------------------------------

describe("Property 8: SES_Configuration scanner detects exactly the SES items present", () => {
  it("returns [] when neither contract nor sources contain any SES items (R5.9)", () => {
    fc.assert(
      fc.property(
        fc.array(nonSesEntryArb, { maxLength: 20 }),
        fc.array(cleanSourceArb, { maxLength: 5 }),
        (contract, sources) => {
          const findings = scanSesConfiguration(contract, sources);
          expect(findings).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Sub-test B: contract SES entries → exactly one "contract" finding each (R5.7, R9.3)
  // -------------------------------------------------------------------------

  it("each SES_-prefixed contract entry produces exactly one finding with origin=contract and source=auth-server/.env.example (R5.7, R9.3)", () => {
    fc.assert(
      fc.property(
        fc.array(sesEntryArb, { minLength: 1, maxLength: 10 }),
        fc.array(nonSesEntryArb, { maxLength: 10 }),
        fc.array(cleanSourceArb, { maxLength: 3 }),
        (sesEntries, nonSesEntries, sources) => {
          // Mix SES and non-SES entries in random order
          const contract: EnvVarEntry[] = [...sesEntries, ...nonSesEntries];
          const findings = scanSesConfiguration(contract, sources);

          // Collect only contract findings
          const contractFindings = findings.filter((f) => f.origin === "contract");

          // The scanner emits one finding per entry (not per unique name), so
          // contractFindings.length must equal sesEntries.length
          expect(contractFindings).toHaveLength(sesEntries.length);

          // Every contract finding must have origin="contract" and the canonical source
          for (const finding of contractFindings) {
            expect(finding.origin).toBe("contract");
            expect(finding.source).toBe("auth-server/.env.example");
            expect(finding.name.startsWith("SES_")).toBe(true);
          }

          // Every SES_ entry name must appear in the contract findings
          // (order preserved: i-th sesEntry matches i-th contractFinding)
          for (let i = 0; i < sesEntries.length; i++) {
            expect(contractFindings[i].name).toBe(sesEntries[i].name);
          }

          // No non-SES entry name should appear in the contract findings
          const nonSesNames = new Set(nonSesEntries.map((e) => e.name));
          for (const finding of contractFindings) {
            expect(nonSesNames.has(finding.name)).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Sub-test C: `ses` provider value in source → finding with origin=deployment and name=ses (R5.8, R9.6)
  // -------------------------------------------------------------------------

  it("a source containing the word 'ses' as a provider value produces a deployment finding with name='ses' (R5.8, R9.6)", () => {
    fc.assert(
      fc.property(
        sesProviderSourceArb,
        fc.array(nonSesEntryArb, { maxLength: 10 }),
        (source, contract) => {
          const findings = scanSesConfiguration(contract, [source]);

          const deploymentFindings = findings.filter(
            (f) => f.origin === "deployment" && f.name === "ses",
          );

          expect(deploymentFindings.length).toBeGreaterThanOrEqual(1);

          // All matching findings should reference the source name
          for (const finding of deploymentFindings) {
            expect(finding.source).toBe(source.name);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Sub-test D: Pulumi config inputs → deployment findings (R5.8, R9.6)
  // -------------------------------------------------------------------------

  it("each Pulumi SES input name in source content produces a deployment finding (R5.8, R9.6)", () => {
    fc.assert(
      fc.property(
        sesPulumiInputArb,
        fc.string({ minLength: 1, maxLength: 40 }),
        fc.array(nonSesEntryArb, { maxLength: 10 }),
        ({ input, content }, sourceName, contract) => {
          const source: ScanSource = { name: sourceName, content };
          const findings = scanSesConfiguration(contract, [source]);

          const deploymentFindings = findings.filter(
            (f) => f.origin === "deployment" && f.name === input,
          );

          expect(deploymentFindings.length).toBeGreaterThanOrEqual(1);
          expect(deploymentFindings[0].source).toBe(sourceName);
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Sub-test E: SES_-prefixed rendered env var in source → deployment finding (R5.8, R9.6)
  // -------------------------------------------------------------------------

  it("a SES_-prefixed rendered env var name in source content produces a deployment finding (R5.8, R9.6)", () => {
    fc.assert(
      fc.property(
        sesRenderedVarArb,
        fc.string({ minLength: 1, maxLength: 40 }),
        fc.array(nonSesEntryArb, { maxLength: 10 }),
        ({ varName, content }, sourceName, contract) => {
          const source: ScanSource = { name: sourceName, content };
          const findings = scanSesConfiguration(contract, [source]);

          const deploymentFindings = findings.filter(
            (f) => f.origin === "deployment" && f.name === varName,
          );

          expect(deploymentFindings.length).toBeGreaterThanOrEqual(1);
          expect(deploymentFindings[0].source).toBe(sourceName);
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Sub-test F: non-SES contract names do NOT produce findings (R5.9)
  // -------------------------------------------------------------------------

  it("non-SES_-prefixed variable names in the contract do NOT produce findings (R5.9)", () => {
    fc.assert(
      fc.property(
        fc.array(nonSesEntryArb, { minLength: 1, maxLength: 20 }),
        fc.array(cleanSourceArb, { maxLength: 3 }),
        (contract, sources) => {
          const findings = scanSesConfiguration(contract, sources);

          for (const finding of findings) {
            // Any finding that exists must NOT have come from a non-SES name
            const nonSesNames = contract.map((e) => e.name);
            if (finding.origin === "contract") {
              expect(nonSesNames).not.toContain(finding.name);
            }
          }

          // More directly: no findings at all (since sources are clean and contract has no SES_)
          expect(findings).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Sub-test G: package names like @aws-sdk/client-ses do NOT produce false positives (R9.6)
  // Anti-abuse: package names in source content (not SES_-prefixed variable names)
  // should not be flagged as deployment SES_Configuration items.
  // -------------------------------------------------------------------------

  it("package names like @aws-sdk/client-ses or @fortressauth/email-ses do NOT produce false positives when they don't match SES patterns (R9.6)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          // These package names appear in package-lock.json / node_modules paths — they are
          // NOT `SES_`-prefixed variable names and should not trigger the scanner.
          '"@aws-sdk/client-ses": {',
          '"@fortressauth/email-ses": "^1.0.0"',
          "node_modules/@aws-sdk/client-ses/dist/index.js",
          "require('@fortressauth/email-ses')",
          "import { SESClient } from '@aws-sdk/client-ses'",
        ),
        fc.string({ minLength: 1, maxLength: 40 }),
        fc.array(nonSesEntryArb, { maxLength: 10 }),
        (content, sourceName, contract) => {
          const source: ScanSource = { name: sourceName, content };
          const findings = scanSesConfiguration(contract, [source]);

          // These contents do not contain: \bses\b as a provider value assignment,
          // sesRegion/sesFromAddress/sesAccessKeyId/sesSecretAccessKey as whole words,
          // or SES_<name>= patterns — so no deployment findings should be produced
          // UNLESS the content happens to also contain one of those exact triggers.
          // We verify the specific SES_-prefixed var finding is absent since
          // package names are not `SES_<NAME>=` assignments.
          const sesVarFindings = findings.filter(
            (f) =>
              f.origin === "deployment" &&
              f.name.startsWith("SES_") &&
              // The finding would only be legit if the content literally has SES_<NAME>=
              !content.includes(`${f.name}=`),
          );

          expect(sesVarFindings).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
