/**
 * Edge-case tests for the Pulumi_Config_Files glob (`pulumiConfigFiles()`).
 *
 * Validates that `pulumiConfigFiles()` enumerates every `Pulumi*.yaml` / `Pulumi*.yml`
 * in the OCI directory — including per-stack files added later — so that no Pulumi
 * config file carrying a Direct_Reference is silently missed.
 *
 * Requirements: 2.1, 3.1
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanDirectReferences } from "../parity/directReference.js";
import { OCI_DIR, pulumiConfigFiles } from "../parity/paths.js";

// Fixtures go in a temporary directory, never in OCI_DIR. Other test files run
// runParityCheck() in parallel, and it globs OCI_DIR: a fixture there that names
// @fortressauth/server would make those runs fail at random, and one left behind
// by a killed run would be hidden by the `Pulumi.*.yaml` entry in .gitignore.
let tmpDir: string;
let fixturePath: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "oci-parity-paths-"));
  fixturePath = resolve(tmpDir, "Pulumi.ci-test.yaml");
  writeFileSync(resolve(tmpDir, "Pulumi.yaml"), "name: x\nruntime: nodejs\n", "utf8");
  writeFileSync(
    fixturePath,
    [
      "name: ci-test-stack",
      "runtime: nodejs",
      "description: Temporary CI test fixture.",
      "config:",
      "  # This line intentionally references @fortressauth/server to test the scanner.",
      "  authPackage: '@fortressauth/server'",
    ].join("\n"),
    "utf8",
  );
  // A look-alike the glob must skip. (No lowercase pulumi.yaml: on a
  // case-insensitive file system it would overwrite Pulumi.yaml.)
  writeFileSync(resolve(tmpDir, "notPulumi.yaml"), "name: wrong-prefix\n", "utf8");
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("pulumiConfigFiles() glob enumeration", () => {
  it("returns at least the base Pulumi.yaml that already exists", () => {
    const files = pulumiConfigFiles();
    const baseConfig = resolve(OCI_DIR, "Pulumi.yaml");
    expect(files).toContain(baseConfig);
  });

  it("includes a per-stack Pulumi.ci-test.yaml (proving per-stack files are not missed)", () => {
    const files = pulumiConfigFiles(tmpDir);
    expect(files).toContain(fixturePath);
    expect(files).toContain(resolve(tmpDir, "Pulumi.yaml"));
  });

  it("flags a Direct_Reference inside the per-stack fixture (scanner catches per-stack files)", () => {
    const fixtureContent = readFileSync(fixturePath, "utf8");
    const findings = scanDirectReferences([{ name: fixturePath, content: fixtureContent }]);

    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].file).toBe(fixturePath);
    expect(findings[0].matchedText.toLowerCase()).toContain("@fortressauth/server");
  });

  it("does NOT include a file named pulumi.yaml (lowercase — wrong capitalisation)", () => {
    // The glob is Pulumi*.yaml — capital P is required.
    const files = pulumiConfigFiles(tmpDir).map((f) => f.slice(tmpDir.length + 1));
    expect(files).not.toContain("pulumi.yaml");
  });

  it("does NOT include a file named notPulumi.yaml (missing Pulumi prefix)", () => {
    const files = pulumiConfigFiles(tmpDir);
    expect(files).not.toContain(resolve(tmpDir, "notPulumi.yaml"));
  });

  it("returns only absolute paths", () => {
    for (const f of pulumiConfigFiles(tmpDir)) {
      expect(f.startsWith("/")).toBe(true);
    }
  });

  it("returns only files that actually exist on disk", () => {
    for (const f of [...pulumiConfigFiles(), ...pulumiConfigFiles(tmpDir)]) {
      expect(existsSync(f)).toBe(true);
    }
  });

  it("never leaves a fixture in the real OCI directory", () => {
    expect(existsSync(resolve(OCI_DIR, "Pulumi.ci-test.yaml"))).toBe(false);
  });

  it("compiled dist paths still resolve to the source OCI directory and auth-server directory", () => {
    const compiled = require(
      resolve(OCI_DIR, "dist/parity/paths.js"),
    ) as typeof import("../parity/paths.js");

    expect(compiled.OCI_DIR).toBe(OCI_DIR);
    expect(compiled.AUTH_SERVER_DIR.endsWith("/auth-server")).toBe(true);
    expect(existsSync(resolve(compiled.AUTH_SERVER_DIR, "package.json"))).toBe(true);
    expect(compiled.OCI_SOURCE_FILES).toContain(resolve(OCI_DIR, "index.ts"));
    expect(compiled.OCI_SOURCE_FILES).toContain(resolve(OCI_DIR, "cloudinit.ts"));
    expect(compiled.pulumiConfigFiles()).toContain(resolve(OCI_DIR, "Pulumi.yaml"));
  });

  it("compiled dist runParityCheck() passes against the live repository", () => {
    const { runParityCheck } = require(
      resolve(OCI_DIR, "dist/parity/runParityCheck.js"),
    ) as typeof import("../parity/runParityCheck.js");
    const report = runParityCheck();

    expect(report.ok, JSON.stringify(report.details, null, 2)).toBe(true);
  });
});
