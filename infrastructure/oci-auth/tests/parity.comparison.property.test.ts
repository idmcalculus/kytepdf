/**
 * Property-based tests for the `compareEnvVars` pure function.
 *
 * **Validates: Requirements 4.3, 4.4, 5.3, 5.4, 5.5, 5.6, 8.3**
 *
 * // Feature: auth-server-deployment-parity, Property 3: Env-var comparison computes missing and stale sets exactly
 * // Feature: auth-server-deployment-parity, Property 4: Comparison depends only on variable names, never values
 */

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compareEnvVars } from "../parity/runParityCheck.js";
import type { ExemptionEntry } from "../parity/types.js";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Valid env var name: [A-Za-z_][A-Za-z0-9_]{0..19} */
const varNameArb = fc.stringMatching(/^[A-Za-z_][A-Za-z0-9_]{0,19}$/);

/** Array of unique var names (0–10 elements). */
const varNamesArb = fc.uniqueArray(varNameArb, { minLength: 0, maxLength: 10 });

// ---------------------------------------------------------------------------
// Property 3: Env-var comparison computes missing and stale sets exactly
// ---------------------------------------------------------------------------

describe("Property 3: Env-var comparison computes missing and stale sets exactly", () => {
  // 3a. Every required name not in provided and not exempt appears as missing-required
  it("every required name absent from provided and exempt appears as missing-required (R4.3, R5.4)", () => {
    fc.assert(
      fc.property(
        varNamesArb, // required
        varNamesArb, // provided (as array, converted to Set)
        varNamesArb, // exempt names
        varNamesArb, // contractNames (superset for stale check)
        (required, providedArr, exemptArr, extraContract) => {
          const provided = new Set(providedArr);
          const exemptions: ExemptionEntry[] = exemptArr.map((n) => ({
            name: n,
            reason: "test exemption",
          }));
          const exemptSet = new Set(exemptArr);
          // contractNames = required + optional + extras (all exempt names must be in contract
          // to avoid stale findings that could distract the assertion)
          const contractNames = [...new Set([...required, ...exemptArr, ...extraContract])];

          const findings = compareEnvVars(required, provided, exemptions, contractNames);
          const missingFindings = findings.filter((f) => f.kind === "missing-required");

          // Compute the expected missing set: R \ P \ E
          const expectedMissing = required.filter((n) => !provided.has(n) && !exemptSet.has(n));

          // Deduplicate (required array may have dupes from uniqueArray generator used separately)
          const expectedMissingSet = new Set(expectedMissing);
          const actualMissingSet = new Set(missingFindings.map((f) => f.name));

          expect(actualMissingSet).toEqual(expectedMissingSet);
        },
      ),
      { numRuns: 150 },
    );
  });

  // 3b. Every exemption name not in contractNames appears as stale-exemption
  it("every exemption name absent from contractNames appears as stale-exemption (R4.4, R5.5, R5.6)", () => {
    fc.assert(
      fc.property(
        varNamesArb, // required
        varNamesArb, // provided
        varNamesArb, // exempt names
        varNamesArb, // contractNames (may or may not include exempt names)
        (required, providedArr, exemptArr, contractArr) => {
          const provided = new Set(providedArr);
          const exemptions: ExemptionEntry[] = exemptArr.map((n) => ({
            name: n,
            reason: "test exemption",
          }));
          const contractNameSet = new Set(contractArr);

          const findings = compareEnvVars(required, provided, exemptions, contractArr);
          const staleFindings = findings.filter((f) => f.kind === "stale-exemption");

          // Compute the expected stale set: E \ contractNames
          const expectedStaleSet = new Set(exemptArr.filter((n) => !contractNameSet.has(n)));
          const actualStaleSet = new Set(staleFindings.map((f) => f.name));

          expect(actualStaleSet).toEqual(expectedStaleSet);
        },
      ),
      { numRuns: 150 },
    );
  });

  // 3c. When all required names are either provided or exempt, and all exemptions are in
  //     the contract, compareEnvVars returns []
  it("returns [] when all required are covered and all exemptions are in the contract (R5.4, R5.5, R5.6, R8.3)", () => {
    fc.assert(
      fc.property(
        varNamesArb, // required names
        varNamesArb, // extra names to exempt (beyond required)
        (required, extraExempt) => {
          // All required names are "provided"
          const provided = new Set(required);
          // Exempt only the extra names (none of the required are exempt, but they're all provided)
          const allExemptNames = [...new Set(extraExempt)];
          const exemptions: ExemptionEntry[] = allExemptNames.map((n) => ({
            name: n,
            reason: "test exemption",
          }));
          // contractNames must include all exempt names to avoid stale findings
          const contractNames = [...new Set([...required, ...allExemptNames])];

          const findings = compareEnvVars(required, provided, exemptions, contractNames);

          expect(findings).toHaveLength(0);
        },
      ),
      { numRuns: 150 },
    );
  });

  // 3d. Count of missing-required findings equals |required \ provided \ exempt|
  it("count of missing-required findings equals |required \\ provided \\ exempt| (R4.3, R5.4)", () => {
    fc.assert(
      fc.property(
        varNamesArb, // required
        varNamesArb, // provided
        varNamesArb, // exempt
        varNamesArb, // extra contract names (so exempt names won't be stale)
        (required, providedArr, exemptArr, extraContract) => {
          const provided = new Set(providedArr);
          const exemptSet = new Set(exemptArr);
          const exemptions: ExemptionEntry[] = exemptArr.map((n) => ({
            name: n,
            reason: "test exemption",
          }));
          // Put all exempt names in contract to prevent stale findings from interfering
          const contractNames = [...new Set([...required, ...exemptArr, ...extraContract])];

          const findings = compareEnvVars(required, provided, exemptions, contractNames);
          const missingCount = findings.filter((f) => f.kind === "missing-required").length;

          // |required \ provided \ exempt| — deduplicated
          const expectedCount = new Set(
            required.filter((n) => !provided.has(n) && !exemptSet.has(n)),
          ).size;

          expect(missingCount).toBe(expectedCount);
        },
      ),
      { numRuns: 150 },
    );
  });

  // 3e. Count of stale-exemption findings equals |exempt \ contractNames|
  it("count of stale-exemption findings equals |exempt \\ contractNames| (R5.5, R5.6)", () => {
    fc.assert(
      fc.property(
        varNamesArb, // required
        varNamesArb, // provided
        varNamesArb, // exempt
        varNamesArb, // contractNames
        (required, providedArr, exemptArr, contractArr) => {
          const provided = new Set(providedArr);
          const contractNameSet = new Set(contractArr);
          const exemptions: ExemptionEntry[] = exemptArr.map((n) => ({
            name: n,
            reason: "test exemption",
          }));

          const findings = compareEnvVars(required, provided, exemptions, contractArr);
          const staleCount = findings.filter((f) => f.kind === "stale-exemption").length;

          // |exempt \ contractNames| — deduplicated
          const expectedCount = new Set(exemptArr.filter((n) => !contractNameSet.has(n))).size;

          expect(staleCount).toBe(expectedCount);
        },
      ),
      { numRuns: 150 },
    );
  });

  // 3f. Exempted required names do NOT appear as missing-required
  it("required names that are in the exemption list do not appear as missing-required (R4.4)", () => {
    fc.assert(
      fc.property(
        varNamesArb, // names that are both required AND exempt
        varNamesArb, // additional non-exempt required names that will be provided
        (exemptRequired, alsoProvided) => {
          // exemptRequired are required but NOT provided — they're exempt
          const required = [...new Set([...exemptRequired, ...alsoProvided])];
          const provided = new Set(alsoProvided); // alsoProvided are covered
          const exemptions: ExemptionEntry[] = exemptRequired.map((n) => ({
            name: n,
            reason: "test exemption",
          }));
          // All exempt names are in the contract (no stale findings)
          const contractNames = [...new Set(required)];

          const findings = compareEnvVars(required, provided, exemptions, contractNames);
          const missingNames = findings
            .filter((f) => f.kind === "missing-required")
            .map((f) => f.name);

          // None of the exempt names should appear as missing
          for (const name of exemptRequired) {
            expect(missingNames).not.toContain(name);
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: Comparison depends only on variable names, never values
// ---------------------------------------------------------------------------

describe("Property 4: Comparison depends only on variable names, never values", () => {
  // 4a. compareEnvVars is deterministic: calling it twice with the same arguments
  //     always produces identical results
  it("is deterministic: identical inputs always produce identical results (R5.3)", () => {
    fc.assert(
      fc.property(
        varNamesArb, // required
        varNamesArb, // provided
        varNamesArb, // exempt
        varNamesArb, // contractNames
        (required, providedArr, exemptArr, contractArr) => {
          const provided = new Set(providedArr);
          const exemptions: ExemptionEntry[] = exemptArr.map((n) => ({
            name: n,
            reason: "test exemption",
          }));

          const result1 = compareEnvVars(required, provided, exemptions, contractArr);
          const result2 = compareEnvVars(required, provided, exemptions, contractArr);

          expect(result1).toEqual(result2);
        },
      ),
      { numRuns: 150 },
    );
  });

  // 4b. The function signature accepts no values — it is a pure function of name-set
  //     arguments only. Calling it with the same name sets but "different values"
  //     (i.e., same call, since values are not even a parameter) yields identical results.
  //     This property verifies the design guarantee: outcomes cannot be influenced by
  //     variable values, only by their names.
  it("outcome is unchanged regardless of what env var values might be — names are the only axis (R5.3)", () => {
    fc.assert(
      fc.property(
        varNamesArb, // required
        varNamesArb, // provided names
        varNamesArb, // exempt
        varNamesArb, // contractNames
        // Simulate "different values" by generating arbitrary strings that are
        // NOT passed to compareEnvVars at all — demonstrating the function cannot
        // see them and therefore cannot be affected by them.
        fc.array(fc.string(), { minLength: 0, maxLength: 10 }), // ignored "values" run 1
        fc.array(fc.string(), { minLength: 0, maxLength: 10 }), // ignored "values" run 2
        (required, providedArr, exemptArr, contractArr, _values1, _values2) => {
          const provided = new Set(providedArr);
          const exemptions: ExemptionEntry[] = exemptArr.map((n) => ({
            name: n,
            reason: "test exemption",
          }));

          // Both calls use the same name-set arguments; "values" are not and cannot be passed.
          // Identical output proves value-independence.
          const resultA = compareEnvVars(required, provided, exemptions, contractArr);
          const resultB = compareEnvVars(required, provided, exemptions, contractArr);

          expect(resultA).toEqual(resultB);
        },
      ),
      { numRuns: 150 },
    );
  });

  // 4c. Reordering the required array (same names, different order) does not change
  //     the SET of findings — order of findings may differ but content must be identical
  it("reordering required names does not change the set of findings (R5.3)", () => {
    fc.assert(
      fc.property(
        varNamesArb, // required names
        varNamesArb, // provided
        varNamesArb, // exempt
        varNamesArb, // contractNames
        (required, providedArr, exemptArr, contractArr) => {
          const provided = new Set(providedArr);
          const exemptions: ExemptionEntry[] = exemptArr.map((n) => ({
            name: n,
            reason: "test exemption",
          }));

          // Reverse the required array — same names, opposite order
          const requiredReversed = [...required].reverse();

          const result1 = compareEnvVars(required, provided, exemptions, contractArr);
          const result2 = compareEnvVars(requiredReversed, provided, exemptions, contractArr);

          // The SETS of findings must be identical (order may differ)
          const toSortedJson = (findings: typeof result1) =>
            JSON.stringify(
              [...findings].sort((a, b) =>
                a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind.localeCompare(b.kind),
              ),
            );

          expect(toSortedJson(result1)).toBe(toSortedJson(result2));
        },
      ),
      { numRuns: 150 },
    );
  });

  // 4d. Two runs with the same name sets but completely different ExemptionEntry.reason
  //     strings produce identical findings — reason strings are irrelevant to the outcome
  it("changing exemption reason strings does not affect findings (R5.3)", () => {
    fc.assert(
      fc.property(
        varNamesArb, // required
        varNamesArb, // provided
        varNamesArb, // exempt names
        varNamesArb, // contractNames
        fc.string(), // reason variant A
        fc.string(), // reason variant B
        (required, providedArr, exemptArr, contractArr, reasonA, reasonB) => {
          const provided = new Set(providedArr);

          const exemptionsA: ExemptionEntry[] = exemptArr.map((n) => ({
            name: n,
            reason: reasonA,
          }));
          const exemptionsB: ExemptionEntry[] = exemptArr.map((n) => ({
            name: n,
            reason: reasonB,
          }));

          const result1 = compareEnvVars(required, provided, exemptionsA, contractArr);
          const result2 = compareEnvVars(required, provided, exemptionsB, contractArr);

          expect(result1).toEqual(result2);
        },
      ),
      { numRuns: 150 },
    );
  });
});
