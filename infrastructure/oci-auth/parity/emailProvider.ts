/**
 * SES configuration scanner for the environment-variable parity check.
 *
 * Detects SES_Configuration items in both the Env_Var_Contract and the
 * OCI_Deployment authored content, contributing findings to the
 * `environment-variable` drift category (R8.7).
 *
 * Requirements: 5.7, 5.8, 5.9, 9.3, 9.6
 */

import type { EnvVarEntry, ScanSource, SesFinding } from "./types.js";

/**
 * The case-sensitive prefix that identifies an SES_Configuration variable name
 * in the Env_Var_Contract (R9.3).
 */
const SES_VAR_PREFIX = "SES_";

/**
 * The `ses` email-provider option value that constitutes an SES_Configuration
 * item in the OCI_Deployment (R9.6).
 *
 * Matched as the exact lower-case provider option value `ses` in the common
 * forms that can expose a provider option:
 *   - assignment/config forms such as `emailProvider=ses`,
 *     `emailProvider: "ses"`, and `EMAIL_PROVIDER="ses"`
 *   - TypeScript comparisons such as `emailProvider === "ses"`
 *   - literal supported-provider lists such as `["console", "ses", "resend"]`
 *
 * This intentionally avoids broad substring matching so package names such as
 * `@aws-sdk/client-ses` and `@fortressauth/email-ses` are not false positives.
 */
const SES_PROVIDER_RE =
  /\b(?:emailProvider|EMAIL_PROVIDER|provider|type)\b\s*(?::|={1,3})\s*["']?ses\b["']?|["']ses["']|^\s*-\s*ses\s*$/m;

/**
 * The exact Pulumi config input names whose presence in OCI_Deployment
 * authored content constitutes SES_Configuration (R9.6).
 *
 * Each identifier is matched as a whole word (no partial matches).
 */
const SES_PULUMI_INPUTS: ReadonlyArray<string> = [
  "sesRegion",
  "sesFromAddress",
  "sesAccessKeyId",
  "sesSecretAccessKey",
];

/**
 * Regex that matches a `SES_`-prefixed rendered environment variable name in
 * the OCI_Deployment authored content, e.g. `SES_REGION=` or
 * `SES_FROM_ADDRESS=` (case-sensitive prefix, R9.6).
 *
 * Captures the full `SES_`-prefixed name (group 1).
 */
const SES_RENDERED_VAR_RE = /\b(SES_[A-Za-z0-9_]+)=/g;

/**
 * Scan for SES_Configuration items in the Env_Var_Contract and in the
 * OCI_Deployment authored source artifacts.
 *
 * **Contract scan** — every `EnvVarEntry` whose `name` begins with the
 * case-sensitive prefix `SES_` produces a finding with:
 *   - `origin: "contract"`
 *   - `source: "auth-server/.env.example"`
 *
 * **Deployment scan** — for each `ScanSource` in `sources`, the following
 * items are detected (callers must pass OCI_Deployment_Authored_Content only;
 * the rendered cloud-init should be pre-processed with
 * `stripEmbeddedDeployableUnit` before being included in `sources`):
 *   1. The `ses` provider option (the exact word `ses` as a provider value).
 *   2. Any of the Pulumi config inputs `sesRegion`, `sesFromAddress`,
 *      `sesAccessKeyId`, `sesSecretAccessKey` (exact identifier names).
 *   3. Any `SES_`-prefixed rendered env var name (e.g. `SES_REGION=`,
 *      `SES_FROM_ADDRESS=`).
 *
 * Each deployment finding carries:
 *   - `origin: "deployment"`
 *   - `source`: the `name` of the `ScanSource` in which the item was found.
 *
 * **Passing result** — an empty array (`[]`) is the observably distinct
 * passing result: no findings means no SES_Configuration is present in either
 * the contract or the deployment (R5.9).
 *
 * @param contract - Parsed entries from `auth-server/.env.example`.
 * @param sources  - Named OCI_Deployment authored content artifacts to scan.
 * @returns        Array of `SesFinding`s; empty on a clean pass.
 */
export function scanSesConfiguration(contract: EnvVarEntry[], sources: ScanSource[]): SesFinding[] {
  const findings: SesFinding[] = [];

  // --- Contract scan (R5.7, R9.3) -------------------------------------------
  // Any entry whose name starts with the case-sensitive prefix `SES_` is an
  // SES_Configuration variable, active or commented-out alike.
  for (const entry of contract) {
    if (entry.name.startsWith(SES_VAR_PREFIX)) {
      findings.push({
        origin: "contract",
        name: entry.name,
        source: "auth-server/.env.example",
      });
    }
  }

  // --- Deployment scan (R5.8, R9.6) ------------------------------------------
  for (const src of sources) {
    const { name: sourceName, content } = src;

    // 1. `ses` provider option — the literal word `ses` as a provider value.
    if (SES_PROVIDER_RE.test(content)) {
      findings.push({
        origin: "deployment",
        name: "ses",
        source: sourceName,
      });
    }

    // 2. Pulumi config inputs — exact identifier names (whole-word match).
    for (const input of SES_PULUMI_INPUTS) {
      // Build a word-boundary regex for each identifier.
      const inputRe = new RegExp(`\\b${input}\\b`);
      if (inputRe.test(content)) {
        findings.push({
          origin: "deployment",
          name: input,
          source: sourceName,
        });
      }
    }

    // 3. `SES_`-prefixed rendered env var names (e.g. `SES_REGION=`).
    // Reset lastIndex before each use of the global regex.
    SES_RENDERED_VAR_RE.lastIndex = 0;
    const seenVarNames = new Set<string>();
    let varMatch = SES_RENDERED_VAR_RE.exec(content);
    while (varMatch !== null) {
      const varName = varMatch[1];
      // Deduplicate: report each distinct SES_ var name once per source.
      if (!seenVarNames.has(varName)) {
        seenVarNames.add(varName);
        findings.push({
          origin: "deployment",
          name: varName,
          source: sourceName,
        });
      }
      varMatch = SES_RENDERED_VAR_RE.exec(content);
    }
  }

  return findings;
}
