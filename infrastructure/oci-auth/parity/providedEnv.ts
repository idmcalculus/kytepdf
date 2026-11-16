/**
 * Provided-env extractor with per-mode support.
 *
 * Locates the `/opt/auth/app.env` and `/opt/auth/auth-secrets.env` write_files
 * blocks in a rendered cloud-init document and collects every `NAME=` left-hand
 * side. This is a NAME-ONLY operation: values are never inspected, and a name
 * rendered with an empty value still contributes to the provided set.
 *
 * Requirements: 5.2, 5.3
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderCloudInit } from "../cloudinit.js";
import { AUTH_SERVER_DIR } from "./paths.js";

// ---------------------------------------------------------------------------
// Supported configuration modes
// ---------------------------------------------------------------------------

/**
 * A supported configuration mode the deployment can be rendered in.
 * The parity check enumerates all supported modes and requires that every
 * required contract name is provided in EVERY mode (R5.2, Finding 5).
 */
export interface SupportedMode {
  /** Human-readable label, e.g. "console/oauth-off". */
  label: string;
  /** Email provider for this mode. */
  emailProvider: "console" | "resend";
  /** Whether Google and GitHub OAuth are enabled in this mode. */
  enableOAuth: boolean;
}

/**
 * The four supported configuration modes: email provider ∈ {console, resend}
 * crossed with OAuth ∈ {off, on}. SES is excluded by R9.
 */
export const SUPPORTED_MODES: SupportedMode[] = [
  { label: "console/oauth-off", emailProvider: "console", enableOAuth: false },
  { label: "console/oauth-on", emailProvider: "console", enableOAuth: true },
  { label: "resend/oauth-off", emailProvider: "resend", enableOAuth: false },
  { label: "resend/oauth-on", emailProvider: "resend", enableOAuth: true },
];

// ---------------------------------------------------------------------------
// Env-block extraction
// ---------------------------------------------------------------------------

/**
 * The exact env-file paths whose `write_files` blocks are scanned for
 * provided variable names. These must be the auth service's `env_file` list in
 * the rendered docker-compose.yml; tests/parity.integration.test.ts checks this.
 */
export const ENV_FILE_PATHS = ["/opt/auth/app.env", "/opt/auth/auth-secrets.env"] as const;

/**
 * Extract the content of a single `write_files` block for the given `path:`
 * value from a rendered cloud-init YAML string.
 *
 * The function looks for the pattern:
 *   - path: <targetPath>
 *     ...
 *     content: |
 *       <indented content lines>
 *
 * Returns the raw content lines (dedented), or an empty string if not found.
 */
function extractWriteFilesBlockContent(renderedCloudInit: string, targetPath: string): string {
  const lines = renderedCloudInit.split("\n");
  const result: string[] = [];
  let inBlock = false;
  let inContent = false;
  let contentIndent = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    if (!inBlock) {
      // Detect the start of the target write_files entry
      // Matches "  - path: /opt/auth/app.env" (with any leading whitespace/dash)
      if (trimmed === `- path: ${targetPath}` || trimmed === `path: ${targetPath}`) {
        inBlock = true;
      }
      continue;
    }

    // Inside the target block — look for "content: |"
    if (!inContent) {
      if (trimmed === "content: |") {
        inContent = true;
        contentIndent = -1; // will be determined from first content line
        continue;
      }
      // If we hit another "- path:" or a top-level key, we've left this block
      if (trimmed.startsWith("- path:") && trimmed !== `- path: ${targetPath}`) {
        break;
      }
      // Any other line inside the block header (permissions, owner, etc.)
      continue;
    }

    // Inside the content block scalar
    // Determine indentation from the first content line
    if (contentIndent === -1) {
      if (line.trim() === "") {
        result.push("");
        continue;
      }
      contentIndent = line.length - line.trimStart().length;
    }

    const lineIndent = line.length - line.trimStart().length;

    // If indentation drops below the block scalar indent, we're out of the block
    if (line.trim() !== "" && lineIndent < contentIndent) {
      break;
    }

    // Strip the common indentation
    if (line.trim() === "") {
      result.push("");
    } else {
      result.push(line.slice(contentIndent));
    }
  }

  return result.join("\n");
}

/**
 * Names the OCI_Deployment provides to the auth container via env files, for one
 * rendered cloud-init. NAME-ONLY: collects every `NAME=` left-hand side from the
 * `/opt/auth/app.env` and `/opt/auth/auth-secrets.env` blocks and never inspects
 * the value — an empty value (`NAME=`) still contributes its name. (R5.2, R5.3)
 */
export function extractProvidedEnvNames(renderedCloudInit: string): Set<string> {
  const names = new Set<string>();
  // Matches: optional whitespace, NAME (identifier), =, anything (or nothing)
  const assignmentRe = /^([A-Za-z_][A-Za-z0-9_]*)=/;

  for (const filePath of ENV_FILE_PATHS) {
    const content = extractWriteFilesBlockContent(renderedCloudInit, filePath);
    for (const rawLine of content.split("\n")) {
      const line = rawLine.trimStart();
      // Skip blank lines and comment lines
      if (!line || line.startsWith("#")) continue;
      const match = assignmentRe.exec(line);
      if (match) {
        names.add(match[1]);
      }
    }
  }

  return names;
}

// ---------------------------------------------------------------------------
// Per-mode rendering
// ---------------------------------------------------------------------------

/**
 * Render cloud-init once per `SUPPORTED_MODE` and return the provided name set
 * for each mode, so the comparison can require provision in EVERY supported mode
 * rather than trusting a single max-coverage render. (R5.2, Finding 5)
 */
export function providedNamesByMode(): Array<{ mode: SupportedMode; names: Set<string> }> {
  // Read canonical Deployable_Unit files once (shared across modes)
  const authPackageJson = readFileSync(resolve(AUTH_SERVER_DIR, "package.json"), "utf8");
  const authPackageLock = readFileSync(resolve(AUTH_SERVER_DIR, "package-lock.json"), "utf8");

  // Minimal placeholder render args — NOT real Pulumi secrets; only enough to
  // produce valid rendered env blocks for name extraction.
  const baseRenderArgs: {
    pgPass: string;
    backupPass: string;
    googleSecret: string;
    githubSecret: string;
    resendApiKey: string;
    domain: string;
    frontendUrl: string;
    emailProvider: string;
    resendFromAddress: string;
    googleClientId: string;
    githubClientId: string;
    corsOrigins: string;
    enableBlockVolume: boolean;
    trustedProxyHopCount: number;
    tailscaleAuthKey: string;
    tailscaleHostname: string;
    tailscaleTag: string;
    authPackageJson: string;
    authPackageLock: string;
  } = {
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
    authPackageJson,
    authPackageLock,
  };

  return SUPPORTED_MODES.map((mode) => {
    const args = { ...baseRenderArgs };

    // Apply email-provider overrides
    if (mode.emailProvider === "resend") {
      args.emailProvider = "resend";
      args.resendApiKey = "re_placeholder";
      args.resendFromAddress = "noreply@example.com";
    }

    // Apply OAuth overrides
    if (mode.enableOAuth) {
      args.googleClientId = "gclient";
      args.googleSecret = "gsecret";
      args.githubClientId = "ghclient";
      args.githubSecret = "ghsecret";
    }

    const rendered = renderCloudInit(args);
    const names = extractProvidedEnvNames(rendered);

    return { mode, names };
  });
}
