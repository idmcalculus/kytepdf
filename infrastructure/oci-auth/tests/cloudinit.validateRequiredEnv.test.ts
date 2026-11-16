/**
 * Edge-case unit tests for the render-time `validateRequiredEnv` guard (R4.5).
 *
 * This validates that `validateRequiredEnv` correctly throws for absent/empty
 * required env vars, respects the ENV_VAR_EXEMPTIONS list, and produces
 * error messages that name the missing variable.
 *
 * **Validates: Requirements 4.5**
 */

import { describe, expect, it } from "vitest";
import { validateRequiredEnv } from "../cloudinit.js";

describe("validateRequiredEnv edge cases (R4.5)", () => {
  // 1. Throws when a required non-exempt name is absent
  it("throws when a required non-exempt name is absent from generatedEnv", () => {
    expect(() =>
      validateRequiredEnv({
        generatedEnv: {},
        requiredContractNames: ["MY_VAR"],
      }),
    ).toThrow("MY_VAR");
  });

  // 2. Throws when a required non-exempt name has an empty value
  it("throws when a required non-exempt name has an empty string value", () => {
    expect(() =>
      validateRequiredEnv({
        generatedEnv: { MY_VAR: "" },
        requiredContractNames: ["MY_VAR"],
      }),
    ).toThrow();
  });

  // 3. Throws when a required non-exempt name has a whitespace-only value
  it("throws when a required non-exempt name has a whitespace-only value", () => {
    expect(() =>
      validateRequiredEnv({
        generatedEnv: { MY_VAR: "   " },
        requiredContractNames: ["MY_VAR"],
      }),
    ).toThrow();
  });

  // 4. Does NOT throw when all required names have non-empty values
  it("does not throw when all required names are present with non-empty values", () => {
    expect(() =>
      validateRequiredEnv({
        generatedEnv: { MY_VAR: "someValue", OTHER_VAR: "anotherValue" },
        requiredContractNames: ["MY_VAR", "OTHER_VAR"],
      }),
    ).not.toThrow();
  });

  // 5. Exempt names (PORT and HOST) do NOT trigger failure even when absent
  it("does not throw for PORT and HOST even when they are absent from generatedEnv", () => {
    expect(() =>
      validateRequiredEnv({
        generatedEnv: {},
        requiredContractNames: ["PORT", "HOST"],
      }),
    ).not.toThrow();
  });

  // 6. Error message names the missing variable
  it("error message contains the name of the missing variable", () => {
    let caught: Error | undefined;
    try {
      validateRequiredEnv({
        generatedEnv: {},
        requiredContractNames: ["MISSING_SECRET"],
      });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    expect(caught?.message).toContain("MISSING_SECRET");
  });

  // 7. Throws for the first missing variable when multiple are missing
  it("throws when at least one required variable is missing (multiple missing vars)", () => {
    expect(() =>
      validateRequiredEnv({
        generatedEnv: {},
        requiredContractNames: ["FIRST_VAR", "SECOND_VAR"],
      }),
    ).toThrow();
  });
});
