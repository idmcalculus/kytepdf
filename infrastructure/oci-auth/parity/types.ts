/**
 * Shared type definitions for the parity check system.
 *
 * Requirements: 8.1, 8.3, 8.7
 */

// ---------------------------------------------------------------------------
// Drift categories
// ---------------------------------------------------------------------------

/**
 * The exact, case-sensitive set of drift category labels the Parity_Check
 * may emit. No label outside this set is permitted (R8.1).
 */
export type DriftCategory = "direct-reference" | "environment-variable" | "documentation";

// ---------------------------------------------------------------------------
// Contract / configuration primitives
// ---------------------------------------------------------------------------

/** A single entry in the Env_Var_Contract parsed from `auth-server/.env.example`. */
export interface EnvVarEntry {
  /** The environment variable name (case-sensitive, exact). */
  name: string;
  /**
   * `true` when the assignment line is active (not `#`-prefixed);
   * `false` when the assignment line is commented out.
   */
  required: boolean;
}

/** A reviewed exemption entry in the Exemption_List. */
export interface ExemptionEntry {
  /** The environment variable name being exempted. */
  name: string;
  /** Human-readable reason the OCI_Deployment may omit this variable. */
  reason: string;
}

// ---------------------------------------------------------------------------
// Scanner inputs
// ---------------------------------------------------------------------------

/** A named source artifact and its textual content to be scanned. */
export interface ScanSource {
  /** The source artifact identifier (e.g. file path or logical name). */
  name: string;
  /**
   * The textual content to scan.
   * For rendered cloud-init this must be the output of
   * `stripEmbeddedDeployableUnit(render)` so the Embedded_Deployable_Unit
   * region is excluded before scanning.
   */
  content: string;
}

// ---------------------------------------------------------------------------
// Finding types (one per drift category / sub-check)
// ---------------------------------------------------------------------------

/**
 * A single Direct_Reference occurrence found in OCI_Deployment_Authored_Content.
 * Contributes to the `direct-reference` drift category.
 */
export interface DirectReferenceFinding {
  /** The source artifact path or logical name (e.g. `"rendered-cloud-init"`). */
  file: string;
  /** The matched text that constitutes the Direct_Reference. */
  matchedText: string;
  /** Best-effort 1-based line number within the source, when available. */
  line?: number;
}

/**
 * The kind of environment-variable finding reported under the
 * `environment-variable` drift category (R8.3, R8.7).
 *
 * - `"missing-required"` — a required Env_Var_Contract name is absent from
 *   both the OCI_Deployment provided variables and the Exemption_List.
 * - `"stale-exemption"` — an Exemption_List entry is not present in the
 *   Env_Var_Contract (the exemption is outdated).
 * - `"ses-in-contract"` — a `SES_`-prefixed variable name was found in the
 *   Env_Var_Contract (R8.7).
 * - `"ses-in-deployment"` — a SES_Configuration item was found in the
 *   OCI_Deployment (R8.7).
 */
export type EnvVarFindingKind =
  | "missing-required"
  | "stale-exemption"
  | "ses-in-contract"
  | "ses-in-deployment";

/**
 * A single environment-variable parity finding.
 * Contributes to the `environment-variable` drift category.
 */
export interface EnvVarFinding {
  kind: EnvVarFindingKind;
  /** The environment variable name involved in this finding. */
  name: string;
  /**
   * The OCI_Deployment source artifact in which the item was found.
   * Present for `ses-in-deployment` findings; omitted for contract-side findings.
   */
  source?: string;
}

/**
 * A SES_Configuration finding, always attributed to the `environment-variable`
 * drift category (R8.7).
 */
export interface SesFinding {
  /**
   * `"contract"` when the SES item originates from the Env_Var_Contract
   * (`auth-server/.env.example`);
   * `"deployment"` when it originates from OCI_Deployment authored content.
   */
  origin: "contract" | "deployment";
  /** The SES configuration name (variable name, config input, or provider option). */
  name: string;
  /** The source artifact in which this item was found (always present). */
  source: string;
}

/**
 * A documentation parity finding.
 * Contributes to the `documentation` drift category.
 */
export interface DocumentationFinding {
  /**
   * The README section or location identifier where the drift was detected.
   * May be a heading, an absolute file path referenced in the README, or a
   * logical label such as `"version-literal"`.
   */
  location: string;
  /**
   * A human-readable description of what drifted — e.g. a file path the
   * deployment does not actually write, a file description that no longer
   * matches the deployment, or a `@fortressauth/server` version literal.
   */
  detail: string;
}

/**
 * The aspect of the deployment mechanism that a `MechanismFinding` refers to.
 *
 * - `"npm-ci"` — the `npm ci` install step is absent or malformed.
 * - `"ci-failure-message"` — the R1.6 failure-message wrapper is absent or
 *   does not contain the required lockfile/Deployable_Unit references.
 * - `"start-script"` — the `npm start` invocation is absent.
 * - `"embedded-package-json"` — the `/opt/auth/app/package.json` embedded
 *   `write_files` block does not equal the canonical `auth-server/package.json`
 *   byte-for-byte.
 * - `"embedded-lockfile"` — the `/opt/auth/app/package-lock.json` embedded
 *   `write_files` block does not equal the canonical `auth-server/package-lock.json`
 *   byte-for-byte.
 * - `"unreadable-source"` — a required source artifact could not be located
 *   or read when the Parity_Check executed.
 */
export type MechanismAspect =
  | "npm-ci"
  | "ci-failure-message"
  | "start-script"
  | "embedded-package-json"
  | "embedded-lockfile"
  | "unreadable-source";

/**
 * A deployment-mechanism finding (part of the `direct-reference` category,
 * covering the R3.4 byte-equality and R1.3/R1.6 mechanism checks).
 */
export interface MechanismFinding {
  aspect: MechanismAspect;
  /** Human-readable detail describing what was missing or mismatched. */
  detail: string;
}

// ---------------------------------------------------------------------------
// Category result and top-level report
// ---------------------------------------------------------------------------

/**
 * The result for a single drift category, parameterised by the finding type
 * specific to that category.
 *
 * `ok` is `true` iff `findings` is empty.
 */
export interface CategoryResult<F> {
  ok: boolean;
  findings: F[];
}

/**
 * The complete parity report returned by `runParityCheck()`.
 *
 * - `ok` is `true` iff every category is ok (R8.1).
 * - `details` carries one entry per `DriftCategory`; each detail is attributed
 *   to **exactly one** label (R8.6).
 */
export interface ParityReport {
  /** `true` iff every category result is passing. */
  ok: boolean;
  details: {
    /** R3, R2 — direct-reference and deployment-mechanism findings. */
    "direct-reference": CategoryResult<DirectReferenceFinding | MechanismFinding>;
    /** R4, R5, R9 — env-var contract and SES configuration findings. */
    "environment-variable": CategoryResult<EnvVarFinding | SesFinding>;
    /** R6 — documentation parity findings. */
    documentation: CategoryResult<DocumentationFinding>;
  };
}
