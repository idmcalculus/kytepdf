/**
 * Env-var contract parser for `auth-server/.env.example`.
 *
 * Requirements: 4.1, 4.2, 5.1
 */

import type { EnvVarEntry } from "./types.js";

/**
 * Regex that matches a contract entry line (optionally `#`-prefixed assignment).
 *
 * Groups:
 *   1 — the `#` prefix (present → commented-out → required: false)
 *   2 — the variable NAME (`[A-Za-z_][A-Za-z0-9_]*`)
 *
 * A line is an entry iff, after trimming, it has the form:
 *   [# [whitespace]] NAME = ...
 * where NAME matches `[A-Za-z_][A-Za-z0-9_]*`.
 *
 * Pure prose/comment lines (e.g. `# Server`, `# Use PostgreSQL in prod`)
 * do NOT match because they have no `NAME=` shape.
 */
const CONTRACT_LINE_RE = /^(#\s*)?([A-Za-z_][A-Za-z0-9_]*)=/;

/**
 * Parse the text of `auth-server/.env.example` into the Env_Var_Contract.
 *
 * - Active assignment lines (`NAME=...`)   → `{ name, required: true }`
 * - Commented-out lines (`# NAME=...`)     → `{ name, required: false }`
 * - Pure comment/prose lines               → no entry
 * - Blank lines                            → no entry
 *
 * Names are treated case-sensitively and exactly (R4.1, R5.1).
 */
export function parseEnvContract(text: string): EnvVarEntry[] {
  const entries: EnvVarEntry[] = [];

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    const match = CONTRACT_LINE_RE.exec(line);
    if (!match) continue;

    const isCommentedOut = match[1] !== undefined;
    const name = match[2];

    entries.push({ name, required: !isCommentedOut });
  }

  return entries;
}
