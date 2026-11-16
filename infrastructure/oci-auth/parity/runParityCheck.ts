/**
 * Parity-check orchestrator.
 *
 * Exports the pure `compareEnvVars` function and the top-level `runParityCheck`
 * function that wires all pure checks together against the live repository files.
 *
 * Requirements: 3.6, 4.3, 4.4, 5.2, 5.4, 5.5, 5.6, 8.1, 8.5, 8.6, 8.7
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { load } from "js-yaml";

import { renderCloudInit } from "../cloudinit.js";
import { checkDeploymentMechanism } from "./deploymentMechanism.js";
import { scanDirectReferences } from "./directReference.js";
import { checkDocumentation } from "./documentation.js";
import { scanSesConfiguration } from "./emailProvider.js";
import { stripEmbeddedDeployableUnit } from "./embeddedRegion.js";
import { parseEnvContract } from "./envContract.js";
import { ENV_VAR_EXEMPTIONS } from "./exemptions.js";
import { AUTH_SERVER_DIR, OCI_DIR, OCI_SOURCE_FILES, pulumiConfigFiles } from "./paths.js";
import { providedNamesByMode, SUPPORTED_MODES } from "./providedEnv.js";
import type {
  CategoryResult,
  DirectReferenceFinding,
  DocumentationFinding,
  EnvVarFinding,
  ExemptionEntry,
  MechanismFinding,
  ParityReport,
  ScanSource,
  SesFinding,
} from "./types.js";

// ---------------------------------------------------------------------------
// Written env files (for the documentation check)
// ---------------------------------------------------------------------------

/** An env file directly under `/opt/auth/`, e.g. `/opt/auth/app.env`. */
const AUTH_ENV_PATH_RE = /^\/opt\/auth\/[^/]+\.env$/;

/**
 * The `/opt/auth/*.env` paths that a rendered cloud-init writes via
 * `write_files`, read from the render itself so a new env file cannot slip
 * past the documentation check. Sorted, without duplicates.
 */
export function writtenAuthEnvPaths(renderedCloudInit: string): string[] {
  const doc = load(renderedCloudInit) as { write_files?: Array<{ path?: unknown }> } | null;
  const paths = new Set<string>();
  for (const file of doc?.write_files ?? []) {
    if (typeof file.path === "string" && AUTH_ENV_PATH_RE.test(file.path)) {
      paths.add(file.path);
    }
  }
  return [...paths].sort();
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Compute the env-var comparison findings for the parity check.
 *
 * - `missing` = required names not in `provided` AND not in `exemptions`
 *   (one `EnvVarFinding` with kind `"missing-required"` per element)
 * - `stale`   = exemption names not present in `contractNames`
 *   (one `EnvVarFinding` with kind `"stale-exemption"` per element)
 *
 * This is a pure function: it does not read files or render cloud-init.
 *
 * @param required      - Required variable names from the Env_Var_Contract.
 * @param provided      - Names provided by the OCI_Deployment (intersection across modes).
 * @param exemptions    - The reviewed Exemption_List entries.
 * @param contractNames - ALL variable names from the contract (required + optional), used for
 *                        stale-exemption detection.
 * @returns Array of `EnvVarFinding`s; empty array means no drift.
 */
export function compareEnvVars(
  required: string[],
  provided: Set<string>,
  exemptions: ExemptionEntry[],
  contractNames: string[],
): EnvVarFinding[] {
  const findings: EnvVarFinding[] = [];

  const exemptNames = new Set(exemptions.map((e) => e.name));
  const contractNameSet = new Set(contractNames);

  // missing = R \ P \ E
  for (const name of required) {
    if (!provided.has(name) && !exemptNames.has(name)) {
      findings.push({ kind: "missing-required", name });
    }
  }

  // stale = E \ contractNames
  for (const exemption of exemptions) {
    if (!contractNameSet.has(exemption.name)) {
      findings.push({ kind: "stale-exemption", name: exemption.name });
    }
  }

  return findings;
}

function readAuthServerVersion(packageJsonText: string): string | null {
  try {
    const parsed = JSON.parse(packageJsonText) as {
      dependencies?: Record<string, unknown>;
    };
    const version = parsed.dependencies?.["@fortressauth/server"];
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

/**
 * Fold a `SesFinding` into an `EnvVarFinding`:
 *   - `origin: "contract"`    → `kind: "ses-in-contract"`,  `source: "auth-server/.env.example"`
 *   - `origin: "deployment"`  → `kind: "ses-in-deployment"`, `source: <artifact name>`
 *
 * Exported so the report-labelling property test can assert that every SES
 * finding is attributed to the `environment-variable` category (R8.7).
 */
export function sesFindingToEnvVarFinding(sf: SesFinding): EnvVarFinding {
  if (sf.origin === "contract") {
    return { kind: "ses-in-contract", name: sf.name, source: sf.source };
  }
  return { kind: "ses-in-deployment", name: sf.name, source: sf.source };
}

/**
 * Assemble a `ParityReport` from the per-category finding arrays.
 *
 * This is the pure report-assembly step shared by `runParityCheck` and the
 * report-labelling property test (Property 6). It guarantees the report-level
 * invariants required by R8.1, R8.5, and R8.6:
 *   - `details` carries exactly the three allowed `DriftCategory` labels and no
 *     others (R8.1).
 *   - Each `CategoryResult.ok` is `true` iff that category has no findings, and
 *     the top-level `ok` is `true` iff every category is ok (R8.5), so any
 *     detected category surfaces in the report (R8.5).
 *   - Each input finding is placed under exactly one category label, so details
 *     are partitioned across the allowed labels (R8.6).
 *
 * Callers are responsible for placing SES findings into `envVarFindings` via
 * {@link sesFindingToEnvVarFinding} so SES drift is attributed to the
 * `environment-variable` category (R8.7).
 */
export function assembleParityReport(
  directReferenceFindings: Array<DirectReferenceFinding | MechanismFinding>,
  envVarFindings: Array<EnvVarFinding | SesFinding>,
  documentationFindings: DocumentationFinding[],
): ParityReport {
  const directReferenceResult: CategoryResult<DirectReferenceFinding | MechanismFinding> = {
    ok: directReferenceFindings.length === 0,
    findings: directReferenceFindings,
  };

  const envVarResult: CategoryResult<EnvVarFinding | SesFinding> = {
    ok: envVarFindings.length === 0,
    findings: envVarFindings,
  };

  const documentationResult: CategoryResult<DocumentationFinding> = {
    ok: documentationFindings.length === 0,
    findings: documentationFindings,
  };

  return {
    ok: directReferenceResult.ok && envVarResult.ok && documentationResult.ok,
    details: {
      "direct-reference": directReferenceResult,
      "environment-variable": envVarResult,
      documentation: documentationResult,
    },
  };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Run the full parity check against the live repository files and return a
 * `ParityReport` whose `ok` field is `true` iff every category passes.
 *
 * Orchestration flow:
 *  1. Read `index.ts`, `cloudinit.ts` (OCI_SOURCE_FILES) and `pulumiConfigFiles()`.
 *     If any file is unreadable → add an `unreadable-source` MechanismFinding for it.
 *  2. Read canonical `auth-server/package.json` and `auth-server/package-lock.json`.
 *  3. Read `auth-server/.env.example` and parse with `parseEnvContract`.
 *  4. Read `infrastructure/oci-auth/README.md`.
 *  5. Render cloud-init per SUPPORTED_MODE (capturing both raw renders and stripped renders).
 *  6. Intersect provided names across all modes via `providedNamesByMode()`.
 *  7. Build the direct-reference ScanSource[] from OCI_Deployment_Authored_Content only:
 *     - OCI source files verbatim
 *     - Pulumi config files verbatim
 *     - Each rendered cloud-init passed through `stripEmbeddedDeployableUnit`
 *  8. Run `scanDirectReferences` → direct-reference findings.
 *  9. Run `checkDeploymentMechanism` (using the first available unstripped render) →
 *     MechanismFindings folded into the `direct-reference` category.
 * 10. Run `compareEnvVars` → EnvVarFindings.
 * 11. Run `scanSesConfiguration` (on OCI source files + stripped renders) → SesFindings →
 *     fold each into an `EnvVarFinding`.
 * 12. Run `checkDocumentation` against the `/opt/auth/*.env` paths the renders
 *     write (union across modes) → DocumentationFindings.
 * 13. Assemble `ParityReport`.
 */
export function runParityCheck(): ParityReport {
  // ── Accumulators ─────────────────────────────────────────────────────────
  const directReferenceFindings: Array<DirectReferenceFinding | MechanismFinding> = [];
  const envVarFindings: EnvVarFinding[] = [];
  const documentationFindings: DocumentationFinding[] = [];

  // ── 1. Read OCI source files ──────────────────────────────────────────────
  const ociSources: ScanSource[] = [];

  for (const filePath of OCI_SOURCE_FILES) {
    try {
      const content = readFileSync(filePath, "utf8");
      // Use a relative-looking name for readability in findings
      const name = filePath.replace(`${OCI_DIR}/`, "");
      ociSources.push({ name, content });
    } catch {
      const name = filePath.replace(`${OCI_DIR}/`, "");
      directReferenceFindings.push({
        aspect: "unreadable-source",
        detail: `Could not read required OCI source artifact: ${name}`,
      });
    }
  }

  // Read Pulumi config files (glob Pulumi*.yaml / Pulumi*.yml)
  const pulumiFiles = pulumiConfigFiles();
  for (const filePath of pulumiFiles) {
    try {
      const content = readFileSync(filePath, "utf8");
      const name = filePath.replace(`${OCI_DIR}/`, "");
      ociSources.push({ name, content });
    } catch {
      const name = filePath.replace(`${OCI_DIR}/`, "");
      directReferenceFindings.push({
        aspect: "unreadable-source",
        detail: `Could not read Pulumi config file: ${name}`,
      });
    }
  }

  // ── 2. Read canonical Deployable_Unit files ───────────────────────────────
  let canonicalPackageJson = "";
  let canonicalPackageLock = "";

  try {
    canonicalPackageJson = readFileSync(resolve(AUTH_SERVER_DIR, "package.json"), "utf8");
  } catch {
    directReferenceFindings.push({
      aspect: "unreadable-source",
      detail: "Could not read canonical auth-server/package.json",
    });
  }

  try {
    canonicalPackageLock = readFileSync(resolve(AUTH_SERVER_DIR, "package-lock.json"), "utf8");
  } catch {
    directReferenceFindings.push({
      aspect: "unreadable-source",
      detail: "Could not read canonical auth-server/package-lock.json",
    });
  }

  // ── 3. Read .env.example and parse contract ───────────────────────────────
  let contractEntries: ReturnType<typeof parseEnvContract> = [];

  try {
    const envExampleText = readFileSync(resolve(AUTH_SERVER_DIR, ".env.example"), "utf8");
    contractEntries = parseEnvContract(envExampleText);
  } catch {
    directReferenceFindings.push({
      aspect: "unreadable-source",
      detail: "Could not read canonical auth-server/.env.example",
    });
  }

  // ── 4. Read README ────────────────────────────────────────────────────────
  let readmeText = "";

  try {
    readmeText = readFileSync(resolve(OCI_DIR, "README.md"), "utf8");
  } catch {
    documentationFindings.push({
      location: "README.md",
      detail: "Could not read infrastructure/oci-auth/README.md — documentation check skipped",
    });
  }

  // ── 5. Render cloud-init per supported mode ───────────────────────────────
  //
  // We render inline (rather than relying solely on providedNamesByMode()) so we
  // can capture the raw renders for:
  //   (a) building stripped ScanSources for the direct-reference and SES scans
  //   (b) feeding the first unstripped render to checkDeploymentMechanism

  const strippedRenders: ScanSource[] = [];
  let firstUnstrippedRender: string | null = null;
  // Union across modes: an env file written in only some modes must still be documented.
  const writtenEnvPaths = new Set<string>();

  try {
    const baseArgs = {
      pgPass: "placeholder",
      backupPass: "placeholder",
      googleSecret: "",
      githubSecret: "",
      resendApiKey: "",
      domain: "auth.example.com",
      frontendUrl: "https://example.com",
      emailProvider: "console",
      resendFromAddress: "",
      googleClientId: "",
      githubClientId: "",
      corsOrigins: "https://example.com",
      enableBlockVolume: false,
      trustedProxyHopCount: 1,
      tailscaleAuthKey: "",
      tailscaleHostname: "kytepdf-auth",
      tailscaleTag: "",
      authPackageJson: canonicalPackageJson,
      authPackageLock: canonicalPackageLock,
    };

    for (const mode of SUPPORTED_MODES) {
      const args = { ...baseArgs };

      if (mode.emailProvider === "resend") {
        args.emailProvider = "resend";
        args.resendApiKey = "re_placeholder";
        args.resendFromAddress = "noreply@example.com";
      }

      if (mode.enableOAuth) {
        args.googleClientId = "gclient";
        args.googleSecret = "gsecret";
        args.githubClientId = "ghclient";
        args.githubSecret = "ghsecret";
      }

      const rendered = renderCloudInit(args);

      if (firstUnstrippedRender === null) {
        firstUnstrippedRender = rendered;
      }

      for (const path of writtenAuthEnvPaths(rendered)) {
        writtenEnvPaths.add(path);
      }

      strippedRenders.push({
        name: `rendered-cloud-init[${mode.label}]`,
        content: stripEmbeddedDeployableUnit(rendered),
      });
    }
  } catch (err) {
    directReferenceFindings.push({
      aspect: "unreadable-source",
      detail: `Could not render cloud-init for parity check: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // ── 6. Intersect provided names across all supported modes ────────────────
  //
  // `providedNamesByMode()` renders once per mode and returns each mode's name set.
  // We intersect them here: a name is "provided" only if it appears in EVERY mode's output.
  let intersectedProvidedNames = new Set<string>();

  try {
    const modeResults = providedNamesByMode();

    if (modeResults.length > 0) {
      // Seed with the first mode then narrow
      intersectedProvidedNames = new Set(modeResults[0].names);
      for (let i = 1; i < modeResults.length; i++) {
        for (const name of intersectedProvidedNames) {
          if (!modeResults[i].names.has(name)) {
            intersectedProvidedNames.delete(name);
          }
        }
      }
    }
  } catch {
    // Intersection cannot be computed — already flagged via render failure above.
    // Leave intersectedProvidedNames empty so all required names surface as missing.
  }

  // ── 7. Build ScanSource[] for direct-reference scan ───────────────────────
  // OCI_Deployment_Authored_Content:
  //   - OCI source files (index.ts, cloudinit.ts) verbatim
  //   - Pulumi config files verbatim
  //   - Rendered cloud-init (stripped via stripEmbeddedDeployableUnit)
  const directRefSources: ScanSource[] = [...ociSources, ...strippedRenders];

  // ── 8. Run direct-reference scan ──────────────────────────────────────────
  const authServerVersion = readAuthServerVersion(canonicalPackageJson);
  const directRefFindings = scanDirectReferences(
    directRefSources,
    authServerVersion === null ? [] : [authServerVersion],
  );
  directReferenceFindings.push(...directRefFindings);

  // ── 9. Run deployment-mechanism check (on first unstripped render) ─────────
  if (firstUnstrippedRender !== null) {
    const mechanismFindings = checkDeploymentMechanism({
      renderedCloudInit: firstUnstrippedRender,
      canonicalPackageJson,
      canonicalPackageLock,
    });
    directReferenceFindings.push(...mechanismFindings);
  }
  // If firstUnstrippedRender is null, the render failure was already flagged as
  // an unreadable-source finding above.

  // ── 10. Compare env vars ───────────────────────────────────────────────────
  const requiredNames = contractEntries.filter((e) => e.required).map((e) => e.name);
  const allContractNames = contractEntries.map((e) => e.name);

  const envComparisonFindings = compareEnvVars(
    requiredNames,
    intersectedProvidedNames,
    ENV_VAR_EXEMPTIONS,
    allContractNames,
  );
  envVarFindings.push(...envComparisonFindings);

  // ── 11. Run SES configuration scan ────────────────────────────────────────
  // Scan OCI source files verbatim + stripped renders.
  // The stripped renders have the Embedded_Deployable_Unit region removed, so SES-related
  // package names inside the verbatim lockfile (e.g. @aws-sdk/client-ses) are out of scope.
  const sesSources: ScanSource[] = [...ociSources, ...strippedRenders];
  const sesFindings: SesFinding[] = scanSesConfiguration(contractEntries, sesSources);

  // Fold each SesFinding into an EnvVarFinding
  for (const sf of sesFindings) {
    envVarFindings.push(sesFindingToEnvVarFinding(sf));
  }

  // ── 12. Run documentation check ───────────────────────────────────────────
  // The env-file list comes from the renders above. If rendering failed there is
  // no list to check against: say so, rather than flag every README path as phantom.
  if (firstUnstrippedRender === null) {
    documentationFindings.push({
      location: "written-env-files",
      detail:
        "Could not work out which /opt/auth/*.env files cloud-init writes because rendering failed; README check skipped",
    });
  } else {
    documentationFindings.push(...checkDocumentation(readmeText, [...writtenEnvPaths].sort()));
  }

  // ── 13. Assemble ParityReport ─────────────────────────────────────────────
  return assembleParityReport(directReferenceFindings, envVarFindings, documentationFindings);
}
