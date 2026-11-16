/**
 * Smoke tests for the CI workflow file.
 * Validates: Requirements 7.1, 7.2
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Test file is at infrastructure/oci-auth/tests/ci.workflow.test.ts
// __dirname = <repo-root>/infrastructure/oci-auth/tests
// Up 3 levels → repo root → .github/workflows/ci.yml
const CI_YML_PATH = resolve(__dirname, "../../../.github/workflows/ci.yml");

const ciYml = readFileSync(CI_YML_PATH, "utf8");

describe("CI workflow smoke test (R7.1, R7.2)", () => {
  it("contains the oci-auth-parity job", () => {
    expect(ciYml).toContain("oci-auth-parity:");
  });

  it("runs npm test in the infrastructure/oci-auth working directory", () => {
    expect(ciYml).toContain("infrastructure/oci-auth");
    expect(ciYml).toContain("npm test");
  });

  it("triggers on pull_request (R7.1)", () => {
    expect(ciYml).toContain("pull_request");
  });

  it("triggers on push to main or master (R7.2)", () => {
    expect(ciYml).toMatch(/\bmain\b|\bmaster\b/);
  });
});
