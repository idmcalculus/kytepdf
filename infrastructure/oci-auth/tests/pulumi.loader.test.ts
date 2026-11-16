/**
 * Runs index.ts the way `pulumi up` loads it (Pulumi's ts-node in CommonJS
 * mode), with mocked resources. See tests/helpers/runPulumiProgram.cjs.
 *
 * Covers what the other tests cannot see:
 *  - every import in the program graph resolves under CommonJS. A ".js"
 *    specifier on a relative import works in Vitest but not under Pulumi.
 *  - the default config and the README examples pass index.ts's checks.
 *  - index.ts itself rejects emailProvider 'ses'.
 *  - vm.ts puts gzipped, base64 cloud-init in user_data, within OCI's limit.
 */

import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import { OCI_METADATA_MAX_BYTES } from "../cloudinit.js";
import { OCI_DIR } from "../parity/paths.js";

interface MockResource {
  type: string;
  name: string;
  inputs: Record<string, unknown>;
}
type RunResult = { ok: true; resources: MockResource[] } | { ok: false; error: string };

const HELPER = resolve(OCI_DIR, "tests/helpers/runPulumiProgram.cjs");

/** The four required keys, as in README Setup step 3. */
const REQUIRED = {
  compartmentOcid: "ocid1.compartment.oc1..test",
  sshPublicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAItest user@host",
  corsOrigins: "https://kytepdf.com,https://www.kytepdf.com",
  frontendUrl: "https://kytepdf.com",
};

function runProgram(config: Record<string, string>): Promise<RunResult> {
  const pulumiConfig = Object.fromEntries(
    Object.entries(config).map(([key, value]) => [`oci-auth-hosting:${key}`, value]),
  );
  return new Promise((done) => {
    execFile(
      process.execPath,
      [HELPER],
      {
        cwd: OCI_DIR,
        env: { ...process.env, PULUMI_CONFIG: JSON.stringify(pulumiConfig) },
        maxBuffer: 64 * 1024 * 1024,
        timeout: 120_000,
      },
      (error, stdout, stderr) => {
        const last = stdout.trim().split("\n").pop() ?? "";
        try {
          done(JSON.parse(last) as RunResult);
        } catch {
          done({ ok: false, error: `no result from helper: ${error?.message}\n${stderr}` });
        }
      },
    );
  });
}

function resourceOfType(result: RunResult, type: string): MockResource {
  if (!result.ok) throw new Error(result.error);
  const found = result.resources.find((r) => r.type === type);
  if (!found) throw new Error(`no ${type} registered`);
  return found;
}

let defaults: RunResult;
let resend: RunResult;
let ses: RunResult;

beforeAll(async () => {
  // Each run type-checks the program with ts-node, so run them side by side.
  [defaults, resend, ses] = await Promise.all([
    // Every optional key left at its default; SSH limited by the README's adminCidrs example.
    runProgram({ ...REQUIRED, adminCidrs: "203.0.113.10/32,198.51.100.0/24" }),
    runProgram({
      ...REQUIRED,
      emailProvider: "resend",
      resendApiKey: "re_test_key",
      resendFromAddress: "noreply@kytepdf.com",
      tailscaleAuthKey: "tskey-auth-test",
      tailscaleTag: "tag:server",
    }),
    runProgram({ ...REQUIRED, adminCidrs: "203.0.113.10/32", emailProvider: "ses" }),
  ]);
}, 180_000);

describe("index.ts under Pulumi's CommonJS ts-node loader", () => {
  it("loads and registers the stack with default config", () => {
    expect(defaults.ok ? "ok" : defaults.error).toBe("ok");
    resourceOfType(defaults, "oci:Core/instance:Instance");
  });

  it("splits the README adminCidrs example into two SSH rules", () => {
    const securityList = resourceOfType(defaults, "oci:Core/securityList:SecurityList");
    const rules = securityList.inputs.ingressSecurityRules as Array<{
      source: string;
      tcpOptions?: { min: number; max: number };
    }>;
    const sshSources = rules.filter((r) => r.tcpOptions?.min === 22).map((r) => r.source);
    expect(sshSources.sort()).toEqual(["198.51.100.0/24", "203.0.113.10/32"]);
  });

  it("puts gzipped, base64 cloud-init in user_data, within OCI's metadata limit", () => {
    const instance = resourceOfType(defaults, "oci:Core/instance:Instance");
    const metadata = instance.inputs.metadata as Record<string, string>;
    const yaml = gunzipSync(Buffer.from(metadata.user_data, "base64")).toString("utf8");

    expect(yaml.startsWith("#cloud-config\n")).toBe(true);
    expect(yaml).toContain("path: /opt/auth/app/package-lock.json");
    expect(yaml).toContain("auth.kytepdf.com {"); // default domain in the Caddyfile
    expect(Buffer.byteLength(JSON.stringify(metadata))).toBeLessThan(OCI_METADATA_MAX_BYTES);
  });

  it("accepts emailProvider resend with its two keys, and Tailscale with the default hostname", () => {
    expect(resend.ok ? "ok" : resend.error).toBe("ok");
    const instance = resourceOfType(resend, "oci:Core/instance:Instance");
    const metadata = instance.inputs.metadata as Record<string, string>;
    const yaml = gunzipSync(Buffer.from(metadata.user_data, "base64")).toString("utf8");
    expect(yaml).toContain("EMAIL_PROVIDER=resend");
    expect(yaml).toContain("--hostname=kytepdf-auth");
  });

  it("rejects emailProvider 'ses'", () => {
    expect(ses.ok).toBe(false);
    if (!ses.ok) expect(ses.error).toContain("Invalid 'emailProvider' value: 'ses'");
  });
});
