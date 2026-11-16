/**
 * Exact semver pin predicate (R1.1).
 *
 * A valid exact pin is a bare `MAJOR.MINOR.PATCH` version string:
 *   - Three dot-separated numeric components
 *   - No leading zeros on any component
 *   - No range operators (^, ~, >, <, *, x)
 *   - No prerelease suffix (e.g. -beta.1)
 *   - No build metadata (e.g. +build)
 *   - No leading or trailing whitespace/characters
 *
 * Valid:   "1.2.3", "0.1.14", "10.0.0"
 * Invalid: "^1.2.3", "~1.2.3", ">=1.2.3", "1.2.x", "1.2.*",
 *          "1.x.3", "*", "1.2", "latest", "1.2.3-beta.1", "1.2.3+build",
 *          "01.2.3" (leading zero)
 *
 * Each component is either a single `0` or a non-zero-leading run of digits,
 * so leading zeros (e.g. "01.2.3") are rejected — matching the documented
 * "no leading zeros" contract and semver's numeric-identifier rule.
 */
const EXACT_SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * Returns `true` iff `version` is a bare `MAJOR.MINOR.PATCH` exact semver pin
 * with no range/wildcard operators, no prerelease suffix, and no build metadata.
 */
export function isExactSemverPin(version: string): boolean {
  return EXACT_SEMVER_RE.test(version);
}
