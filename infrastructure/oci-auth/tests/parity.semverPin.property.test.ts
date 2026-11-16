/**
 * Property-based tests for the exact-semver-pin predicate.
 *
 * // Feature: auth-server-deployment-parity, Property 7: Exact-semver-pin predicate accepts only bare MAJOR.MINOR.PATCH
 *
 * **Validates: Requirements 1.1**
 */

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isExactSemverPin } from "../parity/semverPin.js";

// ---------------------------------------------------------------------------
// Arbitrary generators
// ---------------------------------------------------------------------------

/** Generates valid bare MAJOR.MINOR.PATCH strings. */
const majorMinorPatchArb = fc
  .tuple(fc.nat(), fc.nat(), fc.nat())
  .map(([major, minor, patch]) => `${major}.${minor}.${patch}`);

const rangeOperators = ["^", "~", ">=", ">", "<=", "<", "="];

// ---------------------------------------------------------------------------
// Property 7: Exact-semver-pin predicate accepts only bare MAJOR.MINOR.PATCH
// ---------------------------------------------------------------------------

describe("Property 7: Exact-semver-pin predicate accepts only bare MAJOR.MINOR.PATCH", () => {
  it("any MAJOR.MINOR.PATCH (non-negative integers) returns true", () => {
    fc.assert(
      fc.property(majorMinorPatchArb, (version) => {
        expect(isExactSemverPin(version)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("versions with a ^ prefix return false", () => {
    fc.assert(
      fc.property(majorMinorPatchArb, (version) => {
        expect(isExactSemverPin(`^${version}`)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("versions with a ~ prefix return false", () => {
    fc.assert(
      fc.property(majorMinorPatchArb, (version) => {
        expect(isExactSemverPin(`~${version}`)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("versions with range operators (>=, >, <=, <) prefix return false", () => {
    const rangeOpsArb = fc.constantFrom(">=", ">", "<=", "<");
    fc.assert(
      fc.property(rangeOpsArb, majorMinorPatchArb, (op, version) => {
        expect(isExactSemverPin(`${op}${version}`)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("versions with * or x wildcards return false", () => {
    const wildcardVersions = fc.constantFrom(
      "1.*",
      "1.x",
      "1.2.*",
      "1.2.x",
      "1.x.3",
      "*",
      "*.*.* ",
      "1.*.3",
    );
    fc.assert(
      fc.property(wildcardVersions, (version) => {
        expect(isExactSemverPin(version)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("versions missing a component (e.g. MAJOR.MINOR only) return false", () => {
    const twoPartArb = fc.tuple(fc.nat(), fc.nat()).map(([major, minor]) => `${major}.${minor}`);
    fc.assert(
      fc.property(twoPartArb, (version) => {
        expect(isExactSemverPin(version)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("versions with a prerelease suffix return false", () => {
    const prereleaseArb = fc
      .tuple(majorMinorPatchArb, fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{0,9}$/))
      .map(([version, tag]) => `${version}-${tag}`);
    fc.assert(
      fc.property(prereleaseArb, (version) => {
        expect(isExactSemverPin(version)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("versions with build metadata return false", () => {
    const buildMetaArb = fc
      .tuple(majorMinorPatchArb, fc.stringMatching(/^[a-zA-Z0-9]{1,10}$/))
      .map(([version, meta]) => `${version}+${meta}`);
    fc.assert(
      fc.property(buildMetaArb, (version) => {
        expect(isExactSemverPin(version)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('"latest", "next", and empty string return false', () => {
    const specialArb = fc.constantFrom("latest", "next", "");
    fc.assert(
      fc.property(specialArb, (version) => {
        expect(isExactSemverPin(version)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("any version string with a known range operator prefix returns false", () => {
    const allRangeOpsArb = fc.constantFrom(...rangeOperators);
    fc.assert(
      fc.property(allRangeOpsArb, majorMinorPatchArb, (op, version) => {
        // Skip bare "=" since "=1.2.3" is not a standard semver pin
        expect(isExactSemverPin(`${op}${version}`)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
