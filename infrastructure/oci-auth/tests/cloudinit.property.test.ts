/**
 * Property-based tests for cloud-init secrets file isolation and container
 * network isolation.
 *
 * **Validates: Requirements 3.2, 4.1, 4.2, 6.5**
 *
 * Property 7: Secrets File Isolation
 * Property 2: Container Network Isolation
 */

import * as fc from "fast-check";
import * as yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import type { RenderArgs } from "../cloudinit.js";
import { renderCloudInit } from "../cloudinit.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractFileContent(rendered: string, filePath: string): string | undefined {
  const pathMarker = `path: ${filePath}`;
  const pathIndex = rendered.indexOf(pathMarker);
  if (pathIndex === -1) return undefined;

  const contentMarker = "content: |";
  const contentIndex = rendered.indexOf(contentMarker, pathIndex);
  if (contentIndex === -1) return undefined;

  const contentStart = rendered.indexOf("\n", contentIndex) + 1;
  const nextEntryPattern = /\n {2}- path:/;
  const nextEntryMatch = nextEntryPattern.exec(rendered.slice(contentStart));
  const contentEnd =
    nextEntryMatch !== null ? contentStart + nextEntryMatch.index : rendered.length;

  // Strip the 6-space indentation added by the cloud-init renderer
  const raw = rendered.slice(contentStart, contentEnd);
  return raw
    .split("\n")
    .map((line) => (line.startsWith("      ") ? line.slice(6) : line))
    .join("\n");
}

function extractPermissions(rendered: string, filePath: string): string | undefined {
  const pathMarker = `path: ${filePath}`;
  const pathIndex = rendered.indexOf(pathMarker);
  if (pathIndex === -1) return undefined;

  const nextEntryPattern = /\n {2}- path:/;
  const nextEntryMatch = nextEntryPattern.exec(rendered.slice(pathIndex + pathMarker.length));
  const blockEnd =
    nextEntryMatch !== null
      ? pathIndex + pathMarker.length + nextEntryMatch.index
      : rendered.length;

  const block = rendered.slice(pathIndex, blockEnd);
  const permMatch = block.match(/permissions:\s*"([^"]+)"/);
  return permMatch?.[1];
}

interface DockerComposeService {
  ports?: string[];
  healthcheck?: {
    test?: string[];
  };
  environment?: Record<string, string>;
  [key: string]: unknown;
}
interface DockerCompose {
  services: Record<string, DockerComposeService | undefined>;
  [key: string]: unknown;
}
interface CloudInitFile {
  path: string;
  content: string;
  permissions?: string;
}
interface CloudInitYaml {
  write_files?: CloudInitFile[];
  [key: string]: unknown;
}

function extractDockerCompose(cloudInitYaml: string): DockerCompose {
  const parsed = yaml.load(cloudInitYaml) as CloudInitYaml;
  const composeFile = (parsed.write_files ?? []).find(
    (f) => f.path === "/opt/auth/docker-compose.yml",
  );
  if (!composeFile) throw new Error("docker-compose.yml not found in cloud-init write_files");
  // The content is already de-indented by yaml.load (block scalar handling)
  return yaml.load(composeFile.content) as DockerCompose;
}

// ---------------------------------------------------------------------------
// Arbitrary generators
// ---------------------------------------------------------------------------

/** Alphanumeric-only secret string — safe in env files and YAML. */
const secretArb: fc.Arbitrary<string> = fc
  .array(
    fc
      .integer({
        min: 0,
        max: 61,
      })
      .map((n) => {
        if (n < 26) return String.fromCharCode(65 + n);
        if (n < 52) return String.fromCharCode(97 + (n - 26));
        return String.fromCharCode(48 + (n - 52));
      }),
    {
      minLength: 8,
      maxLength: 48,
    },
  )
  .map((chars) => chars.join(""));

const secretsArb = fc.record({
  pgPass: secretArb,
  backupPass: secretArb,
  googleSecret: secretArb,
  githubSecret: secretArb,
});

/** Minimal valid RenderArgs for tests that don't vary secrets. */
function baseArgs(overrides: Partial<RenderArgs> = {}): RenderArgs {
  return {
    pgPass: "TestPgPass123",
    backupPass: "TestBackupPass456",
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
    enableBlockVolume: true,
    trustedProxyHopCount: 1,
    tailscaleAuthKey: "",
    tailscaleHostname: "kytepdf-auth",
    tailscaleTag: "",
    authPackageJson: '{"name":"auth-server","version":"1.0.0"}',
    authPackageLock: '{"name":"auth-server","lockfileVersion":3,"requires":true,"packages":{}}',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Property 7: Secrets File Isolation
// ---------------------------------------------------------------------------

describe("Property 7: Secrets File Isolation", () => {
  it("pgPass appears in auth-secrets.env and never in app.env", () => {
    fc.assert(
      fc.property(secretsArb, ({ pgPass, backupPass, googleSecret, githubSecret }) => {
        const rendered = renderCloudInit(
          baseArgs({
            pgPass,
            backupPass,
            googleSecret,
            githubSecret,
          }),
        );

        const authSecrets = extractFileContent(rendered, "/opt/auth/auth-secrets.env") ?? "";
        const appContent = extractFileContent(rendered, "/opt/auth/app.env") ?? "";

        expect(authSecrets).toContain(pgPass);
        expect(authSecrets).toContain(pgPass); // pgPass in auth
        expect(appContent).not.toContain(pgPass);
        expect(appContent).not.toContain(backupPass);
        expect(appContent).not.toContain(googleSecret);
        expect(appContent).not.toContain(githubSecret);
      }),
      {
        numRuns: 500,
      },
    );
  });

  it("backupPass appears only in backup-secrets.env, not in app.env or auth-secrets.env", () => {
    fc.assert(
      fc.property(secretsArb, ({ pgPass, backupPass, googleSecret, githubSecret }) => {
        const rendered = renderCloudInit(
          baseArgs({
            pgPass,
            backupPass,
            googleSecret,
            githubSecret,
          }),
        );

        const backupSecrets = extractFileContent(rendered, "/opt/auth/backup-secrets.env") ?? "";
        const appContent = extractFileContent(rendered, "/opt/auth/app.env") ?? "";

        expect(backupSecrets).toContain(backupPass);
        expect(appContent).not.toContain(backupPass);
      }),
      {
        numRuns: 500,
      },
    );
  });

  it("secret values never appear in docker-compose.yml, Caddyfile, backup.sh, or systemd unit", () => {
    const nonSecretPaths = [
      "/opt/auth/app.env",
      "/opt/auth/docker-compose.yml",
      "/opt/auth/Caddyfile",
      "/opt/auth/backup.sh",
      "/etc/systemd/system/auth-stack.service",
    ];

    fc.assert(
      fc.property(secretsArb, ({ pgPass, backupPass, googleSecret, githubSecret }) => {
        const rendered = renderCloudInit(
          baseArgs({
            pgPass,
            backupPass,
            googleSecret,
            githubSecret,
            enableBlockVolume: false,
          }),
        );

        for (const filePath of nonSecretPaths) {
          const content = extractFileContent(rendered, filePath) ?? "";
          expect(content).not.toContain(pgPass);
          expect(content).not.toContain(backupPass);
          expect(content).not.toContain(googleSecret);
          expect(content).not.toContain(githubSecret);
        }
      }),
      {
        numRuns: 300,
      },
    );
  });

  it("all three secret files always have permissions 0600", () => {
    fc.assert(
      fc.property(secretsArb, ({ pgPass, backupPass, googleSecret, githubSecret }) => {
        const rendered = renderCloudInit(
          baseArgs({
            pgPass,
            backupPass,
            googleSecret,
            githubSecret,
          }),
        );

        expect(extractPermissions(rendered, "/opt/auth/postgres-secrets.env")).toBe("0600");
        expect(extractPermissions(rendered, "/opt/auth/auth-secrets.env")).toBe("0600");
        expect(extractPermissions(rendered, "/opt/auth/backup-secrets.env")).toBe("0600");
      }),
      {
        numRuns: 200,
      },
    );
  });

  it("postgres-secrets.env contains only POSTGRES_PASSWORD (not DATABASE_URL or OAuth secrets)", () => {
    const rendered = renderCloudInit(
      baseArgs({
        pgPass: "PgPass123",
        googleSecret: "GoogleSec",
        githubSecret: "GithubSec",
        backupPass: "BackupPass",
      }),
    );

    const pgSecrets = extractFileContent(rendered, "/opt/auth/postgres-secrets.env") ?? "";
    expect(pgSecrets).toContain("POSTGRES_PASSWORD=PgPass123");
    expect(pgSecrets).not.toContain("DATABASE_URL");
    expect(pgSecrets).not.toContain("GoogleSec");
    expect(pgSecrets).not.toContain("GithubSec");
    expect(pgSecrets).not.toContain("BackupPass");
  });

  it("DATABASE_URL containing pgPass is in auth-secrets.env, not app.env", () => {
    const pgPass = "MyDbPassword99";
    const rendered = renderCloudInit(
      baseArgs({
        pgPass,
      }),
    );

    const authSecrets = extractFileContent(rendered, "/opt/auth/auth-secrets.env") ?? "";
    const appContent = extractFileContent(rendered, "/opt/auth/app.env") ?? "";

    expect(authSecrets).toContain(
      `DATABASE_URL=postgresql://authuser:${pgPass}@postgres:5432/authdb`,
    );
    expect(appContent).not.toContain(pgPass);
  });

  it("DATABASE_URL URL-encodes postgres passwords that contain URL syntax", () => {
    const pgPass = "p@ss:/?#[]";
    const rendered = renderCloudInit(
      baseArgs({
        pgPass,
      }),
    );
    const authSecrets = extractFileContent(rendered, "/opt/auth/auth-secrets.env") ?? "";

    expect(authSecrets).toContain(
      `DATABASE_URL=postgresql://authuser:${encodeURIComponent(pgPass)}@postgres:5432/authdb`,
    );
    expect(authSecrets).not.toContain(`DATABASE_URL=postgresql://authuser:${pgPass}@`);
  });

  it("Resend config includes both RESEND_API_KEY and EMAIL_FROM_ADDRESS", () => {
    const rendered = renderCloudInit(
      baseArgs({
        emailProvider: "resend",
        resendApiKey: "re_test_key",
        resendFromAddress: "noreply@example.com",
      }),
    );

    const authSecrets = extractFileContent(rendered, "/opt/auth/auth-secrets.env") ?? "";
    const appContent = extractFileContent(rendered, "/opt/auth/app.env") ?? "";

    expect(authSecrets).toContain("RESEND_API_KEY=re_test_key");
    expect(appContent).toContain("EMAIL_PROVIDER=resend");
    expect(appContent).toContain("EMAIL_FROM_ADDRESS=noreply@example.com");
  });

  it("No SES configuration is rendered in any env file (SES is not supported)", () => {
    const rendered = renderCloudInit(baseArgs({ emailProvider: "console" }));

    const authSecrets = extractFileContent(rendered, "/opt/auth/auth-secrets.env") ?? "";
    const appContent = extractFileContent(rendered, "/opt/auth/app.env") ?? "";

    expect(authSecrets).not.toContain("SES_ACCESS_KEY_ID");
    expect(authSecrets).not.toContain("SES_SECRET_ACCESS_KEY");
    expect(appContent).not.toContain("SES_REGION");
    expect(appContent).not.toContain("SES_FROM_ADDRESS");
  });
});

// ---------------------------------------------------------------------------
// Property 2: Container Network Isolation
// ---------------------------------------------------------------------------

describe("Property 2: Container Network Isolation", () => {
  const renderArgsArb = fc
    .record({
      domain: fc
        .tuple(
          fc.stringMatching(/^[a-z]{3,8}$/),
          fc.stringMatching(/^[a-z]{3,8}$/),
          fc.constantFrom("com", "io", "net"),
        )
        .map(([sub, d, tld]) => `${sub}.${d}.${tld}`),
      enableBlockVolume: fc.boolean(),
    })
    .map(({ domain, enableBlockVolume }) =>
      baseArgs({
        domain,
        enableBlockVolume,
      }),
    );

  it("auth container never has host port bindings", () => {
    fc.assert(
      fc.property(renderArgsArb, (args) => {
        const compose = extractDockerCompose(renderCloudInit(args));
        expect(compose.services.auth?.ports).toBeUndefined();
      }),
      {
        numRuns: 200,
      },
    );
  });

  it("postgres container never has host port bindings", () => {
    fc.assert(
      fc.property(renderArgsArb, (args) => {
        const compose = extractDockerCompose(renderCloudInit(args));
        expect(compose.services.postgres?.ports).toBeUndefined();
      }),
      {
        numRuns: 200,
      },
    );
  });

  it("caddy always exposes exactly ports 80:80 and 443:443", () => {
    fc.assert(
      fc.property(renderArgsArb, (args) => {
        const compose = extractDockerCompose(renderCloudInit(args));
        const caddyPorts = compose.services.caddy?.ports;
        expect(caddyPorts).toBeDefined();
        expect(caddyPorts).toContain("80:80");
        expect(caddyPorts).toContain("443:443");
        expect(caddyPorts).toHaveLength(2);
      }),
      {
        numRuns: 200,
      },
    );
  });

  it("pg-data volume uses bind mount when enableBlockVolume is true", () => {
    const rendered = renderCloudInit(
      baseArgs({
        enableBlockVolume: true,
      }),
    );
    const compose = extractDockerCompose(rendered);
    const volumes = (compose as Record<string, unknown>).volumes as Record<string, unknown>;
    const pgDataVol = volumes?.["pg-data"] as Record<string, unknown> | null;
    expect(pgDataVol).not.toBeNull();
    expect(pgDataVol?.driver).toBe("local");
    const opts = pgDataVol?.driver_opts as Record<string, string> | undefined;
    expect(opts?.device).toBe("/mnt/data/postgres");
  });

  it("pg-data volume falls back to Docker-managed when enableBlockVolume is false", () => {
    const rendered = renderCloudInit(
      baseArgs({
        enableBlockVolume: false,
      }),
    );
    const compose = extractDockerCompose(rendered);
    const volumes = (compose as Record<string, unknown>).volumes as Record<string, unknown>;
    const pgDataVol = volumes?.["pg-data"];
    // Docker-managed volume: key exists but value is null (no driver_opts)
    expect(pgDataVol).toBeNull();
  });

  it("auth healthcheck uses Node instead of curl because node:22-slim has no curl", () => {
    const compose = extractDockerCompose(renderCloudInit(baseArgs()));
    const testCommand = compose.services.auth?.healthcheck?.test ?? [];

    expect(testCommand).toContain("node");
    expect(testCommand.join(" ")).toContain("fetch('http://localhost:3000/health')");
    expect(testCommand.join(" ")).not.toContain("curl");
  });

  it("auth container runs with NODE_ENV=production", () => {
    const compose = extractDockerCompose(renderCloudInit(baseArgs()));
    expect(compose.services.auth?.environment?.NODE_ENV).toBe("production");
  });
});

// ---------------------------------------------------------------------------
// BASE_URL correctness
// ---------------------------------------------------------------------------

describe("BASE_URL uses frontendUrl, not auth domain", () => {
  it("app.env BASE_URL equals frontendUrl, not the auth domain", () => {
    const rendered = renderCloudInit(
      baseArgs({
        domain: "auth.example.com",
        frontendUrl: "https://app.example.com",
      }),
    );
    const appContent = extractFileContent(rendered, "/opt/auth/app.env") ?? "";
    expect(appContent).toContain("BASE_URL=https://app.example.com");
    expect(appContent).not.toContain("BASE_URL=https://auth.example.com");
  });

  it("TRUSTED_PROXY_HOP_COUNT is set in app.env", () => {
    const rendered = renderCloudInit(
      baseArgs({
        trustedProxyHopCount: 1,
      }),
    );
    const appContent = extractFileContent(rendered, "/opt/auth/app.env") ?? "";
    expect(appContent).toContain("TRUSTED_PROXY_HOP_COUNT=1");
  });
});

// ---------------------------------------------------------------------------
// Block volume and backup safety
// ---------------------------------------------------------------------------

describe("Block volume and backup safety", () => {
  it("requires /mnt/data to be a real mount point when block volume is enabled", () => {
    const rendered = renderCloudInit(
      baseArgs({
        enableBlockVolume: true,
      }),
    );
    const systemdUnit =
      extractFileContent(rendered, "/etc/systemd/system/auth-stack.service") ?? "";

    expect(systemdUnit).toContain("RequiresMountsFor=/mnt/data");
    expect(systemdUnit).toContain("ConditionPathIsMountPoint=/mnt/data");
    expect(rendered).toContain("refusing to start auth stack on boot disk");
  });

  it("uses explicit boot-disk storage only when block volume is disabled", () => {
    const rendered = renderCloudInit(
      baseArgs({
        enableBlockVolume: false,
      }),
    );
    const systemdUnit =
      extractFileContent(rendered, "/etc/systemd/system/auth-stack.service") ?? "";

    expect(systemdUnit).not.toContain("RequiresMountsFor=/mnt/data");
    expect(systemdUnit).not.toContain("ConditionPathIsMountPoint=/mnt/data");
    expect(rendered).toContain("boot-disk fallback is explicit when block volume is disabled");
  });

  it("backup script refuses to write to boot disk when block volume is required", () => {
    const rendered = renderCloudInit(
      baseArgs({
        enableBlockVolume: true,
      }),
    );
    const backupScript = extractFileContent(rendered, "/opt/auth/backup.sh") ?? "";

    expect(backupScript).toContain("mountpoint -q /mnt/data");
    expect(backupScript).toContain("refusing to write backups to boot disk");
  });

  it("backup script deletes unencrypted dumps when GPG encryption fails", () => {
    const rendered = renderCloudInit(baseArgs());
    const backupScript = extractFileContent(rendered, "/opt/auth/backup.sh") ?? "";

    expect(backupScript).toContain("GPG encryption failed");
    expect(backupScript).toContain('rm -f "${DUMP_FILE}" "${DUMP_FILE}.gpg"');
    expect(backupScript).not.toContain("retaining unencrypted dump");
  });
});

// ---------------------------------------------------------------------------
// Tailscale integration tests
// ---------------------------------------------------------------------------

describe("Tailscale SSH integration", () => {
  it("when tailscaleAuthKey is empty, runcmd does not contain tailscale commands", () => {
    const rendered = renderCloudInit(
      baseArgs({
        tailscaleAuthKey: "",
      }),
    );
    expect(rendered).not.toContain("tailscale up");
    expect(rendered).not.toContain("tailscale-authkey");
    expect(rendered).toContain("tailscale: not configured");
  });

  it("when tailscaleAuthKey is set, runcmd installs and runs tailscale", () => {
    const rendered = renderCloudInit(
      baseArgs({
        tailscaleAuthKey: "tskey-auth-abc123",
        tailscaleHostname: "my-server",
      }),
    );
    expect(rendered).toContain("curl -fsSL https://tailscale.com/install.sh | sh");
    expect(rendered).toContain("tailscale up --hostname=my-server --ssh --accept-dns=false");
    expect(rendered).toContain("rm -f /opt/auth/tailscale-authkey");
  });

  it("auth key is written to a file (mode 0600), not passed on the command line", () => {
    const rendered = renderCloudInit(
      baseArgs({
        tailscaleAuthKey: "tskey-auth-secret123",
      }),
    );
    // Key should be in a write_files entry, not in a runcmd --authkey= flag
    expect(rendered).toContain("path: /opt/auth/tailscale-authkey");
    expect(rendered).toContain('permissions: "0600"');
    expect(rendered).toContain("content: tskey-auth-secret123");
    // The runcmd reads via TS_AUTHKEY env var, never --authkey on the command line
    expect(rendered).toContain("TS_AUTHKEY=$(cat /opt/auth/tailscale-authkey)");
    expect(rendered).not.toContain("--authkey=");
    expect(rendered).not.toContain("--authkey ");
  });

  it("auth key is NOT visible in the tailscale up command (suppressed via > /dev/null)", () => {
    const rendered = renderCloudInit(
      baseArgs({
        tailscaleAuthKey: "tskey-auth-secret123",
      }),
    );
    // The tailscale up output is suppressed to prevent key leakage in cloud-init logs
    expect(rendered).toContain("> /dev/null 2>&1");
  });

  it("auth key file is deleted after use", () => {
    const rendered = renderCloudInit(
      baseArgs({
        tailscaleAuthKey: "tskey-auth-abc",
      }),
    );
    expect(rendered).toContain("rm -f /opt/auth/tailscale-authkey");
  });

  it("--accept-dns=false is always set to prevent Docker DNS interference", () => {
    const rendered = renderCloudInit(
      baseArgs({
        tailscaleAuthKey: "tskey-auth-abc",
      }),
    );
    expect(rendered).toContain("--accept-dns=false");
  });

  it("--advertise-tags is set when tailscaleTag is provided", () => {
    const rendered = renderCloudInit(
      baseArgs({
        tailscaleAuthKey: "tskey-auth-abc",
        tailscaleTag: "tag:server",
      }),
    );
    expect(rendered).toContain("--advertise-tags=tag:server");
  });

  it("--advertise-tags is NOT present when tailscaleTag is empty", () => {
    const rendered = renderCloudInit(
      baseArgs({
        tailscaleAuthKey: "tskey-auth-abc",
        tailscaleTag: "",
      }),
    );
    expect(rendered).not.toContain("--advertise-tags");
  });

  it("tailscale auth key never appears in app.env or any other non-tailscale file", () => {
    const key = "tskey-auth-verysecret999";
    const rendered = renderCloudInit(
      baseArgs({
        tailscaleAuthKey: key,
      }),
    );

    const appEnv = extractFileContent(rendered, "/opt/auth/app.env") ?? "";
    const authSecrets = extractFileContent(rendered, "/opt/auth/auth-secrets.env") ?? "";
    const compose = extractFileContent(rendered, "/opt/auth/docker-compose.yml") ?? "";

    expect(appEnv).not.toContain(key);
    expect(authSecrets).not.toContain(key);
    expect(compose).not.toContain(key);
  });
});
