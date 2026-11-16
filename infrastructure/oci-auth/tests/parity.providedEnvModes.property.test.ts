// Feature: auth-server-deployment-parity, Property 10: Required names must be provided in every supported configuration mode

/**
 * Property-based tests for per-mode required-name provision.
 *
 * **Validates: Requirements 5.2, 5.4**
 *
 * Property 10: Required names must be provided in every supported configuration mode
 *
 * The key invariant: a name that is emitted only on a max-coverage path
 * (e.g. resend/oauth-on) but is absent from some supported mode (e.g. console/oauth-off)
 * is NOT in the intersection of all modes and therefore counts as "missing-required"
 * unless it appears in the exemption list.
 *
 * Formally:  missing = required \ intersection(all modes) \ exempt
 */

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { providedNamesByMode, SUPPORTED_MODES } from "../parity/providedEnv.js";
import { compareEnvVars } from "../parity/runParityCheck.js";
import type { ExemptionEntry } from "../parity/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the intersection of provided names across all supported modes.
 * A name is in the intersection iff it appears in EVERY mode's provided set.
 */
function computeIntersection(modeResults: Array<{ names: Set<string> }>): Set<string> {
  if (modeResults.length === 0) return new Set();
  const intersection = new Set(modeResults[0].names);
  for (let i = 1; i < modeResults.length; i++) {
    for (const name of intersection) {
      if (!modeResults[i].names.has(name)) {
        intersection.delete(name);
      }
    }
  }
  return intersection;
}

// ---------------------------------------------------------------------------
// Concrete setup: get real mode results once (shared by all tests)
// ---------------------------------------------------------------------------

const modeResults = providedNamesByMode();
const intersection = computeIntersection(modeResults);

// ---------------------------------------------------------------------------
// Concrete test A: RESEND_API_KEY is in resend modes but NOT in the intersection
// ---------------------------------------------------------------------------

describe("Property 10: Required names must be provided in every supported configuration mode", () => {
  it("RESEND_API_KEY is provided in resend modes but not in console modes, so it is absent from the intersection (R5.2)", () => {
    // Verify that resend modes include RESEND_API_KEY
    const resendEntries = modeResults.filter((r) => r.mode.emailProvider === "resend");
    for (const entry of resendEntries) {
      expect(entry.names.has("RESEND_API_KEY")).toBe(true);
    }

    // Verify that console modes do NOT include RESEND_API_KEY
    const consoleEntries = modeResults.filter((r) => r.mode.emailProvider === "console");
    for (const entry of consoleEntries) {
      expect(entry.names.has("RESEND_API_KEY")).toBe(false);
    }

    // Therefore RESEND_API_KEY must NOT be in the intersection
    expect(intersection.has("RESEND_API_KEY")).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Concrete test B: RESEND_API_KEY if required and non-exempt → missing-required
  // -------------------------------------------------------------------------

  it("if RESEND_API_KEY were required and non-exempt, compareEnvVars reports it as missing-required (R5.4)", () => {
    // Treat RESEND_API_KEY as a required name and not exempt
    const required = ["RESEND_API_KEY"];
    const contractNames = ["RESEND_API_KEY"];
    const exemptions: ExemptionEntry[] = [];

    const findings = compareEnvVars(required, intersection, exemptions, contractNames);

    const missingFindings = findings.filter(
      (f) => f.kind === "missing-required" && f.name === "RESEND_API_KEY",
    );

    expect(missingFindings).toHaveLength(1);
    expect(missingFindings[0].kind).toBe("missing-required");
    expect(missingFindings[0].name).toBe("RESEND_API_KEY");
  });

  // -------------------------------------------------------------------------
  // Concrete test C: a name in the intersection is NOT reported as missing
  // -------------------------------------------------------------------------

  it("a name present in ALL modes' provided sets is not reported as missing-required (R5.2)", () => {
    // Pick a name that is in the intersection (present in all modes)
    // EMAIL_PROVIDER is always provided by every mode
    const commonName = "EMAIL_PROVIDER";

    // Only run this assertion if the name is actually in the intersection
    // (guards against future changes to the codebase)
    if (!intersection.has(commonName)) {
      // If EMAIL_PROVIDER is somehow not in intersection, pick any name that is
      const [anyCommonName] = intersection;
      if (!anyCommonName) return; // nothing to test if intersection is empty
      const findings = compareEnvVars([anyCommonName], intersection, [], [anyCommonName]);
      const missingFindings = findings.filter((f) => f.kind === "missing-required");
      expect(missingFindings).toHaveLength(0);
      return;
    }

    const findings = compareEnvVars([commonName], intersection, [], [commonName]);
    const missingFindings = findings.filter((f) => f.kind === "missing-required");
    expect(missingFindings).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Concrete test D: all 4 SUPPORTED_MODES are represented
  // -------------------------------------------------------------------------

  it("providedNamesByMode() returns exactly SUPPORTED_MODES.length entries, one per mode (R5.2)", () => {
    expect(modeResults).toHaveLength(SUPPORTED_MODES.length);
    expect(modeResults).toHaveLength(4);

    const modeLabels = modeResults.map((r) => r.mode.label);
    const expectedLabels = SUPPORTED_MODES.map((m) => m.label);
    expect(modeLabels).toEqual(expectedLabels);
  });

  // -------------------------------------------------------------------------
  // Property 10a: For any required name NOT in the intersection (and not exempt),
  // compareEnvVars reports exactly one missing-required finding for it.
  // -------------------------------------------------------------------------

  it("any required name absent from the intersection (and non-exempt) is reported as missing-required (R5.2, R5.4)", () => {
    // Build the set of names that are NOT in the intersection
    // We use names that appear in at least one mode but not all
    const namesNotInIntersection: string[] = [];
    for (const entry of modeResults) {
      for (const name of entry.names) {
        if (!intersection.has(name)) {
          namesNotInIntersection.push(name);
        }
      }
    }

    // Deduplicate
    const uniqueNamesNotInIntersection = [...new Set(namesNotInIntersection)];

    if (uniqueNamesNotInIntersection.length === 0) {
      // All names are in the intersection — nothing to test here
      return;
    }

    fc.assert(
      fc.property(
        // Pick a random subset of the names that are NOT in the intersection
        fc.subarray(uniqueNamesNotInIntersection, { minLength: 1 }),
        (requiredNames) => {
          const findings = compareEnvVars(
            requiredNames,
            intersection,
            [], // no exemptions
            requiredNames, // contractNames = same as required
          );

          const missingFindings = findings.filter((f) => f.kind === "missing-required");

          // Every required name not in intersection (no exemptions) must be reported
          expect(missingFindings).toHaveLength(requiredNames.length);

          const reportedNames = new Set(missingFindings.map((f) => f.name));
          for (const name of requiredNames) {
            expect(reportedNames.has(name)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Property 10b: For any required name IN the intersection,
  // compareEnvVars does NOT report it as missing-required.
  // -------------------------------------------------------------------------

  it("any required name present in the intersection is NOT reported as missing-required (R5.2)", () => {
    const intersectionNames = [...intersection];

    if (intersectionNames.length === 0) {
      return; // Nothing to test
    }

    fc.assert(
      fc.property(
        // Pick a random non-empty subset of names that ARE in the intersection
        fc.subarray(intersectionNames, { minLength: 1 }),
        (requiredNames) => {
          const findings = compareEnvVars(
            requiredNames,
            intersection,
            [], // no exemptions
            requiredNames, // contractNames = same as required
          );

          const missingFindings = findings.filter((f) => f.kind === "missing-required");

          // No name from the intersection should be flagged as missing
          expect(missingFindings).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Property 10c: missing = required \ intersection \ exempt (set-theoretic identity)
  //
  // For arbitrary sets of required names and exempt names, the set of missing-required
  // findings returned by compareEnvVars equals exactly: required \ intersection \ exempt.
  // -------------------------------------------------------------------------

  it("missing-required findings equal required \\ intersection \\ exempt (set-theoretic identity) (R5.2, R5.4)", () => {
    // Build a combined universe of names: intersection names + mode-specific names
    const allKnownNames = new Set<string>();
    for (const entry of modeResults) {
      for (const name of entry.names) {
        allKnownNames.add(name);
      }
    }
    const allKnownNamesArr = [...allKnownNames];

    if (allKnownNamesArr.length === 0) {
      return;
    }

    fc.assert(
      fc.property(
        // A random set of required names drawn from known env var names
        fc.subarray(allKnownNamesArr),
        // A random set of exempt names, also drawn from known names
        fc.subarray(allKnownNamesArr),
        (requiredNames, exemptNames) => {
          const exemptions: ExemptionEntry[] = exemptNames.map((name) => ({
            name,
            reason: "test exemption",
          }));

          // contractNames must include both required names and exempt names
          // (so exempt names are not reported as stale)
          const contractNames = [...new Set([...requiredNames, ...exemptNames])];

          const findings = compareEnvVars(requiredNames, intersection, exemptions, contractNames);

          const missingFindings = findings.filter((f) => f.kind === "missing-required");
          const reportedMissingNames = new Set(missingFindings.map((f) => f.name));

          // Compute the expected missing set: required \ intersection \ exempt
          const exemptSet = new Set(exemptNames);
          const expectedMissing = requiredNames.filter(
            (name) => !intersection.has(name) && !exemptSet.has(name),
          );
          const expectedMissingSet = new Set(expectedMissing);

          // The reported missing set must equal the expected missing set exactly
          expect(reportedMissingNames.size).toBe(expectedMissingSet.size);
          for (const name of expectedMissingSet) {
            expect(reportedMissingNames.has(name)).toBe(true);
          }
          for (const name of reportedMissingNames) {
            expect(expectedMissingSet.has(name)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Property 10d: an exempt name, even if required and not in intersection,
  // is NOT reported as missing-required.
  // -------------------------------------------------------------------------

  it("an exempt name is not reported as missing-required even when required and absent from intersection (R5.4)", () => {
    const namesNotInIntersection: string[] = [];
    for (const entry of modeResults) {
      for (const name of entry.names) {
        if (!intersection.has(name)) {
          namesNotInIntersection.push(name);
        }
      }
    }

    const uniqueNamesNotInIntersection = [...new Set(namesNotInIntersection)];

    if (uniqueNamesNotInIntersection.length === 0) {
      return;
    }

    fc.assert(
      fc.property(fc.subarray(uniqueNamesNotInIntersection, { minLength: 1 }), (nameSubset) => {
        // Mark all of them as both required AND exempt
        const exemptions: ExemptionEntry[] = nameSubset.map((name) => ({
          name,
          reason: "test: exempt name",
        }));
        const contractNames = [...nameSubset];

        const findings = compareEnvVars(
          nameSubset, // required: these names
          intersection, // provided: the intersection (does NOT contain these names)
          exemptions, // exempt: same names — so they should be excused
          contractNames,
        );

        const missingFindings = findings.filter((f) => f.kind === "missing-required");
        expect(missingFindings).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  });
});
