/**
 * Deployment-mechanism checker.
 *
 * Verifies that the rendered cloud-init:
 *   1. Contains `npm ci` in the auth container command (R1.3)
 *   2. Wraps the install with the R1.6 failure-message handler that names the lockfile
 *      (`package-lock.json`) AND `Deployable_Unit`, and exits non-zero before `npm start`
 *   3. Invokes `npm start` (R1.3, R2.4)
 *   4. Embeds `/opt/auth/app/package.json` content that equals `canonicalPackageJson` byte-for-byte
 *      (R3.4, R3.7)
 *   5. Embeds `/opt/auth/app/package-lock.json` content that equals `canonicalPackageLock`
 *      byte-for-byte (R3.4, R3.7)
 *
 * Returns `[]` when all checks pass; returns `MechanismFinding[]` listing failing aspects.
 *
 * Requirements: 1.3, 1.5, 1.6, 3.4, 3.5, 3.7
 */

import { load } from "js-yaml";
import type { MechanismFinding } from "./types.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract the command string from the Docker Compose `auth` service block inside
 * the rendered cloud-init. The command is authored inside the docker-compose.yml
 * content which is embedded as a block scalar in cloud-init's `write_files` section.
 *
 * The Docker Compose service uses `command: >` (YAML folded scalar), meaning
 * newlines within the command are replaced by spaces when parsed.  We extract
 * the raw text of the folded-scalar lines (everything indented more deeply than
 * the `command:` key) and join them with a single space, mirroring what a YAML
 * parser would produce.
 *
 * Returns the joined command string, or `null` if no `command:` key is found
 * inside an `auth:` service block in the cloud-init content.
 */
function extractAuthCommand(renderedCloudInit: string): string | null {
  const lines = renderedCloudInit.split("\n");

  // We scan for the `auth:` service header first, then the `command:` key
  // underneath it, then collect the folded-scalar body.
  let inAuthService = false;
  let authServiceIndent = -1;
  let collectingCommand = false;
  let commandIndent = -1;
  const commandParts: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    const indent = line.length - trimmed.length;

    // Detect `  auth:` service header (any indentation, as long as it is
    // exactly `auth:` after trimming leading whitespace).
    if (trimmed === "auth:" || trimmed.startsWith("auth: ")) {
      inAuthService = true;
      authServiceIndent = indent;
      collectingCommand = false;
      commandIndent = -1;
      commandParts.length = 0;
      continue;
    }

    if (inAuthService) {
      // If we see a sibling or parent key (indentation <= service indent),
      // we have left the auth service block.
      if (
        trimmed.length > 0 &&
        !trimmed.startsWith("#") &&
        indent <= authServiceIndent &&
        // it must be a YAML mapping key (contains `:`) or a list item
        (trimmed.includes(":") || trimmed.startsWith("- "))
      ) {
        inAuthService = false;
        authServiceIndent = -1;
        collectingCommand = false;
        commandIndent = -1;
        // If we already accumulated parts, stop — we're done.
        if (commandParts.length > 0) break;
        continue;
      }

      if (!collectingCommand) {
        // Look for `command:` key inside the auth service.
        // It may use a block scalar indicator (`>` or `|`) or be inline.
        const cmdMatch = /^(\s*)command:\s*(>[-+]?|[|][-+]?)?\s*(.*)$/.exec(line);
        if (cmdMatch !== null) {
          collectingCommand = true;
          commandIndent = cmdMatch[1].length;
          const indicator = cmdMatch[2] ?? "";
          const inline = cmdMatch[3].trim();
          if (!indicator && inline) {
            // Inline command value — no block scalar
            commandParts.push(inline);
            collectingCommand = false; // single-line, done
          }
          // Otherwise collect continuation lines below
        }
      } else {
        // Collecting the block-scalar body of `command:`.
        // The body ends when indentation drops to <= command key's indent.
        if (trimmed.length === 0) {
          // Blank lines inside a folded scalar become newlines — skip for our
          // purposes (we join with space anyway).
          continue;
        }
        if (indent <= commandIndent) {
          // Back to the same or shallower level — command body is complete.
          break;
        }
        commandParts.push(trimmed);
      }
    }
  }

  if (commandParts.length === 0) return null;

  // Join parts with a single space (mirrors YAML folded-scalar semantics).
  return commandParts.join(" ");
}

/**
 * Extract the verbatim content of a `write_files` block whose `path:` value
 * equals `targetPath` from the rendered cloud-init.
 *
 * The cloud-init uses `content: |` (YAML literal block scalar) with the body
 * indented by 6 spaces relative to the start of the file.  We locate the
 * `- path: <targetPath>` line, advance to the `content: |` line, then collect
 * every following line that is more deeply indented, stripping the common
 * indent prefix.
 *
 * Returns the collected content as a string (trailing newline preserved as
 * written), or `null` if no matching block is found.
 */
function extractWriteFileContent(renderedCloudInit: string, targetPath: string): string | null {
  const doc = load(renderedCloudInit) as {
    write_files?: Array<{
      path?: unknown;
      content?: unknown;
    }>;
  } | null;
  const entry = doc?.write_files?.find((file) => file.path === targetPath);

  if (entry === undefined) return null;
  return typeof entry.content === "string" ? entry.content : "";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check all deployment-mechanism aspects and return any failures.
 *
 * Returns `[]` when every aspect passes; returns one `MechanismFinding` per
 * failing aspect otherwise.
 */
export function checkDeploymentMechanism(args: {
  renderedCloudInit: string;
  canonicalPackageJson: string;
  canonicalPackageLock: string;
}): MechanismFinding[] {
  const { renderedCloudInit, canonicalPackageJson, canonicalPackageLock } = args;
  const findings: MechanismFinding[] = [];

  // ── 1–3: Command checks ──────────────────────────────────────────────────
  const command = extractAuthCommand(renderedCloudInit);

  if (command === null) {
    // Cannot locate the auth container command at all — flag all command-related
    // aspects as failing so the caller sees exactly what is missing.
    findings.push({
      aspect: "npm-ci",
      detail:
        "Could not locate the auth container `command:` in the rendered cloud-init. " +
        "`npm ci` install step is absent or undetectable.",
    });
    findings.push({
      aspect: "ci-failure-message",
      detail:
        "Could not locate the auth container `command:` in the rendered cloud-init. " +
        "The R1.6 failure-message wrapper (naming `package-lock.json` and `Deployable_Unit`) " +
        "is absent or undetectable.",
    });
    findings.push({
      aspect: "start-script",
      detail:
        "Could not locate the auth container `command:` in the rendered cloud-init. " +
        "`npm start` invocation is absent or undetectable.",
    });
  } else {
    // 1. npm ci (R1.3)
    if (!/\bnpm\s+ci\b/.test(command)) {
      findings.push({
        aspect: "npm-ci",
        detail:
          `The auth container command does not contain \`npm ci\`. ` +
          `Found command: ${command.slice(0, 200)}`,
      });
    }

    // 2. R1.6 failure-message wrapper (R1.6)
    // The wrapper must:
    //   (a) use the `||` pattern (not bare `&&`) so a failure is intercepted, AND
    //   (b) mention `package-lock.json` in the failure handler, AND
    //   (c) mention `Deployable_Unit` in the failure handler.
    // A bare `npm ci && npm start` has no `||` and therefore no explicit failure
    // message referencing the lockfile and the unit — it fails this check.
    const hasOrOperator = /\|\|/.test(command);
    const hasLockfileRef = /package-lock\.json/.test(command);
    const hasDeployableUnitRef = /Deployable_Unit/.test(command);

    if (!hasOrOperator || !hasLockfileRef || !hasDeployableUnitRef) {
      const missing: string[] = [];
      if (!hasOrOperator) missing.push("a `||` failure-handler operator");
      if (!hasLockfileRef) missing.push("the literal `package-lock.json`");
      if (!hasDeployableUnitRef) missing.push("the literal `Deployable_Unit`");
      findings.push({
        aspect: "ci-failure-message",
        detail:
          `The auth container command is missing the R1.6 failure-message wrapper. ` +
          `Required elements absent: ${missing.join(", ")}. ` +
          `A bare \`npm ci && npm start\` (no \`||\` handler) does not satisfy R1.6. ` +
          `Found command: ${command.slice(0, 200)}`,
      });
    }

    // 3. npm start (R1.3, R2.4)
    if (!/\bnpm\s+start\b/.test(command)) {
      findings.push({
        aspect: "start-script",
        detail:
          `The auth container command does not invoke \`npm start\`. ` +
          `Found command: ${command.slice(0, 200)}`,
      });
    }
  }

  // ── 4: Embedded package.json byte-equality (R3.4, R3.7) ─────────────────
  const embeddedPackageJson = extractWriteFileContent(
    renderedCloudInit,
    "/opt/auth/app/package.json",
  );

  if (embeddedPackageJson === null) {
    findings.push({
      aspect: "embedded-package-json",
      detail:
        "Could not find a `write_files` block for `/opt/auth/app/package.json` in the " +
        "rendered cloud-init. The Embedded_Deployable_Unit manifest is absent.",
    });
  } else if (embeddedPackageJson !== canonicalPackageJson) {
    findings.push({
      aspect: "embedded-package-json",
      detail:
        "The embedded `/opt/auth/app/package.json` content does not equal the canonical " +
        "`auth-server/package.json` byte-for-byte. " +
        `Embedded length: ${embeddedPackageJson.length}, ` +
        `canonical length: ${canonicalPackageJson.length}.`,
    });
  }

  // ── 5: Embedded package-lock.json byte-equality (R3.4, R3.7) ────────────
  const embeddedPackageLock = extractWriteFileContent(
    renderedCloudInit,
    "/opt/auth/app/package-lock.json",
  );

  if (embeddedPackageLock === null) {
    findings.push({
      aspect: "embedded-lockfile",
      detail:
        "Could not find a `write_files` block for `/opt/auth/app/package-lock.json` in the " +
        "rendered cloud-init. The Embedded_Deployable_Unit lockfile is absent.",
    });
  } else if (embeddedPackageLock !== canonicalPackageLock) {
    findings.push({
      aspect: "embedded-lockfile",
      detail:
        "The embedded `/opt/auth/app/package-lock.json` content does not equal the canonical " +
        "`auth-server/package-lock.json` byte-for-byte. " +
        `Embedded length: ${embeddedPackageLock.length}, ` +
        `canonical length: ${canonicalPackageLock.length}.`,
    });
  }

  return findings;
}
