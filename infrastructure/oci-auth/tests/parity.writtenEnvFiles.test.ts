/**
 * The documentation check must cover every /opt/auth/*.env file the render
 * writes, read from the render rather than from a fixed list.
 *
 * renderCloudInit is wrapped here to add an extra env file, as a future change
 * to cloudinit.ts might. runParityCheck() must then report it as undocumented.
 *
 * Requirements: 6.1, 6.2
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderCloudInit } from "../cloudinit.js";
import { AUTH_SERVER_DIR } from "../parity/paths.js";
import { runParityCheck, writtenAuthEnvPaths } from "../parity/runParityCheck.js";

const EXTRA_ENV_FILE = "/opt/auth/email-secrets.env";

vi.mock("../cloudinit.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../cloudinit.js")>();
  return {
    ...actual,
    renderCloudInit: (args: Parameters<typeof actual.renderCloudInit>[0]) =>
      actual
        .renderCloudInit(args)
        .replace(
          "write_files:\n",
          `write_files:\n  - path: ${EXTRA_ENV_FILE}\n    permissions: "0600"\n    owner: root:root\n    content: |\n      EXTRA_SECRET=x\n`,
        ),
  };
});

describe("documentation check follows the env files the render writes", () => {
  it("writtenAuthEnvPaths picks up an env file added to write_files", () => {
    // renderCloudInit is the wrapped version from vi.mock above.
    const rendered = renderCloudInit({
      pgPass: "p",
      backupPass: "b",
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
      authPackageJson: readFileSync(resolve(AUTH_SERVER_DIR, "package.json"), "utf8"),
      authPackageLock: readFileSync(resolve(AUTH_SERVER_DIR, "package-lock.json"), "utf8"),
    });

    expect(writtenAuthEnvPaths(rendered)).toContain(EXTRA_ENV_FILE);
  });

  it("runParityCheck() reports the new env file as undocumented in the README", () => {
    const report = runParityCheck();
    const docs = report.details.documentation.findings;

    expect(report.ok).toBe(false);
    expect(docs).toContainEqual({
      location: `required-file-${EXTRA_ENV_FILE}`,
      detail: `File ${EXTRA_ENV_FILE} not documented in README`,
    });
  });
});
