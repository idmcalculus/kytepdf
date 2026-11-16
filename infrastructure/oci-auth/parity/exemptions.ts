/**
 * Reviewed exemptions from the Env_Var_Contract parity check.
 *
 * Each entry names a required variable that the OCI_Deployment is permitted
 * to omit from its env files without being considered non-compliant, together
 * with the reason it is exempt (R4.4).
 *
 * Requirements: 4.4, 5.5
 */

import type { ExemptionEntry } from "./types.js";

/**
 * The Exemption_List: reviewed variable names that the OCI_Deployment provides
 * via a mechanism other than the env files (`app.env` / `auth-secrets.env`),
 * and therefore must not be flagged as missing by the name-only Parity_Check.
 *
 * Currently two entries:
 * - `PORT`  — provided via the docker-compose `environment:` block, not written
 *             to any env file.
 * - `HOST`  — provided via the docker-compose `environment:` block, not written
 *             to any env file.
 */
export const ENV_VAR_EXEMPTIONS: ExemptionEntry[] = [
  {
    name: "PORT",
    reason:
      'Provided via the docker-compose `environment:` block (hardcoded to "3000"), not written to the env files.',
  },
  {
    name: "HOST",
    reason:
      'Provided via the docker-compose `environment:` block (hardcoded to "0.0.0.0"), not written to the env files.',
  },
];
