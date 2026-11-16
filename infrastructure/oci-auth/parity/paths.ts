/**
 * Canonical source-file paths and Pulumi config file discovery for the
 * OCI_Deployment parity checks.
 *
 * Requirements: 3.6, 1.3, 5.2, 2.1, 3.1
 */

import { existsSync, globSync } from "node:fs";
import { dirname, resolve } from "node:path";

function findOciDir(startDir: string): string {
  let current = resolve(startDir);

  while (true) {
    if (
      existsSync(resolve(current, "Pulumi.yaml")) &&
      existsSync(resolve(current, "package.json"))
    ) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      throw new Error(
        `Could not locate infrastructure/oci-auth from ${startDir}; expected Pulumi.yaml and package.json`,
      );
    }
    current = parent;
  }
}

function findAuthServerDir(ociDir: string): string {
  let current = resolve(ociDir);

  while (true) {
    const candidate = resolve(current, "auth-server");
    if (existsSync(resolve(candidate, "package.json"))) {
      return candidate;
    }

    const parent = dirname(current);
    if (parent === current) {
      throw new Error(
        `Could not locate auth-server from ${ociDir}; expected auth-server/package.json`,
      );
    }
    current = parent;
  }
}

/** The `infrastructure/oci-auth/` directory — root of the OCI_Deployment. */
export const OCI_DIR = findOciDir(__dirname);

/**
 * The `auth-server/` directory — the canonical Deployable_Unit.
 * Located by walking upward from OCI_DIR until the repository-level
 * `auth-server/package.json` is found. This keeps the path stable when these
 * modules are imported from compiled `dist/` output.
 */
export const AUTH_SERVER_DIR = findAuthServerDir(OCI_DIR);

/**
 * OCI_Deployment-authored TypeScript sources scanned for Direct_References and
 * SES configuration. Their content is OCI_Deployment_Authored_Content and must
 * not contain `@fortressauth/server`. validation.ts holds the supported email
 * provider list that index.ts enforces, so it is scanned too.
 */
export const OCI_SOURCE_FILES: string[] = ["index.ts", "cloudinit.ts", "validation.ts"].map((f) =>
  resolve(OCI_DIR, f),
);

/**
 * Pulumi_Config_Files: every file matching `Pulumi*.yaml` or `Pulumi*.yml`
 * in the OCI directory. `dir` exists so tests can glob a temporary directory
 * instead of writing fixtures into the real one.
 *
 * Using a glob (not a hard-coded `Pulumi.yaml`) ensures per-stack files added
 * later (`Pulumi.<stack>.yaml` / `Pulumi.<stack>.yml`) are included in the
 * Direct_Reference scan rather than silently missed (R2.1, R3.1).
 */
export function pulumiConfigFiles(dir: string = OCI_DIR): string[] {
  return globSync(["Pulumi*.yaml", "Pulumi*.yml"], { cwd: dir }).map((f) => resolve(dir, f));
}
