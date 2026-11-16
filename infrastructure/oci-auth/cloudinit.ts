// cloudinit.ts
// Renders the cloud-init user-data YAML for the OCI auth VM.
// Secrets are injected via pulumi.all() and written to root-only env files.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import * as pulumi from "@pulumi/pulumi";
// No ".js" on these imports. Pulumi loads this file through ts-node as CommonJS,
// and CommonJS does not map "./x.js" to "./x.ts" (tests/pulumi.loader.test.ts).
import { parseEnvContract } from "./parity/envContract";
import { ENV_VAR_EXEMPTIONS } from "./parity/exemptions";
import { AUTH_SERVER_DIR } from "./parity/paths";

/**
 * OCI rejects a launch when the instance's `metadata` and `extendedMetadata`
 * together exceed 32,000 bytes (see `metadata` in @pulumi/oci core/instance.d.ts).
 */
export const OCI_METADATA_MAX_BYTES = 32_000;

/**
 * Encode cloud-init YAML for the instance metadata `user_data` key: gzip, then base64.
 *
 * The YAML embeds auth-server/package-lock.json, so plain base64 is about three
 * times the metadata limit. OCI's cloud-init datasource base64-decodes `user_data`
 * and cloud-init unpacks gzip content itself, so the VM still sees the same YAML.
 */
export function encodeUserData(cloudInitYaml: string): string {
  const gz = gzipSync(Buffer.from(cloudInitYaml, "utf8"), { level: 9 });
  // Byte 9 of the gzip header names the OS that wrote it, and Node sets it per
  // platform (0x13 on macOS, 0x03 on Linux). gunzip ignores it. Fix it to 0x03 so
  // every machine produces the same user_data; OCI cannot change user_data on a
  // running instance, so a one-byte difference between laptop and CI would matter.
  gz[9] = 0x03;
  return gz.toString("base64");
}

/**
 * Throw if instance metadata would exceed OCI's limit. Size is measured on the
 * JSON form (keys, values and quotes), which is at least what OCI counts.
 * Returns the measured size in bytes.
 */
export function assertMetadataWithinLimit(metadata: Record<string, string>): number {
  const size = Buffer.byteLength(JSON.stringify(metadata), "utf8");
  if (size > OCI_METADATA_MAX_BYTES) {
    throw new Error(
      `OCI instance metadata is ${size} bytes, over the ${OCI_METADATA_MAX_BYTES}-byte limit. ` +
        "Shrink the cloud-init user_data (it embeds auth-server/package.json and package-lock.json) " +
        "or the SSH public key.",
    );
  }
  return size;
}

// AuthVmArgs is defined here so cloudinit.ts has no circular dependency on vm.ts.
// vm.ts imports this interface via: import type { AuthVmArgs } from "./cloudinit";
export interface AuthVmArgs {
  compartmentId: pulumi.Input<string>;
  subnetId: pulumi.Input<string>;
  imageOcid: pulumi.Input<string>;
  sshPublicKey: string;
  ocpu: number;
  memoryGb: number;
  enableBlockVolume: boolean;
  blockVolumeSizeGb: number;
  availabilityDomainIndex: number;
  // Secrets passed as Output<string> — never plain strings
  postgresPassword: pulumi.Output<string>;
  backupPassphrase: pulumi.Output<string>;
  googleClientSecret?: pulumi.Output<string>;
  githubClientSecret?: pulumi.Output<string>;
  resendApiKey?: pulumi.Output<string>;
  // Non-secret config
  domain: string;
  /** Frontend app URL (e.g. https://kytepdf.com). Used as BASE_URL for email links
   *  and OAuth redirects — must NOT be the auth API domain. */
  frontendUrl: string;
  emailProvider: string;
  resendFromAddress?: string;
  googleClientId?: string;
  githubClientId?: string;
  corsOrigins: string;
  /** Number of reverse-proxy hops in front of the auth container (default: 1 for Caddy). */
  trustedProxyHopCount: number;
  /** Tailscale auth key — when set, installs Tailscale and enables Tailscale SSH. */
  tailscaleAuthKey?: pulumi.Output<string>;
  /** Tailscale hostname for this node (default: kytepdf-auth). */
  tailscaleHostname?: string;
  /** Tailscale ACL tag (e.g. "tag:server"). Empty means no tag. */
  tailscaleTag?: string;
}

export interface RenderArgs {
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
  /** Verbatim contents of auth-server/package.json (the Deployable_Unit manifest). */
  authPackageJson: string;
  /** Verbatim contents of auth-server/package-lock.json (the Deployable_Unit lockfile). */
  authPackageLock: string;
}

/**
 * Render-time guard (R4.5): given the env-file lines the deployment generated
 * and the set of required contract names, throw before the auth container can
 * start if any required, non-exempt name is absent or assigned an empty value.
 *
 * Distinct from — and run at a different time than — the name-only
 * Env_Var_Contract Parity_Check (R5). This validator inspects VALUES; the
 * Parity_Check inspects NAMES only. The two never share logic.
 */
export function validateRequiredEnv(args: {
  generatedEnv: Record<string, string>; // name -> value, parsed from app.env + auth-secrets.env
  requiredContractNames: string[]; // active names from .env.example
}): void {
  const exemptNames = new Set(ENV_VAR_EXEMPTIONS.map((e) => e.name));

  for (const name of args.requiredContractNames) {
    if (exemptNames.has(name)) continue;

    const value = args.generatedEnv[name];
    if (value === undefined || value.trim() === "") {
      throw new Error(
        `Required environment variable '${name}' is absent or empty in the generated deployment files. ` +
          `Fix the OCI deployment configuration before auth container startup.`,
      );
    }
  }
}

/**
 * Build the cloud-init user-data YAML for the auth VM.
 * Uses pulumi.all() to resolve all secret Outputs before rendering.
 * Returns the plain YAML as a pulumi.Output<string>; pass it through
 * encodeUserData() before putting it in instance metadata.
 */
export function buildCloudInit(args: AuthVmArgs): pulumi.Output<string> {
  // Read the canonical Deployable_Unit manifest and lockfile from disk at render time.
  // These are embedded verbatim into the cloud-init write_files (Embedded_Deployable_Unit).
  const authPackageJson = readFileSync(resolve(AUTH_SERVER_DIR, "package.json"), "utf8");
  const authPackageLock = readFileSync(resolve(AUTH_SERVER_DIR, "package-lock.json"), "utf8");

  return pulumi
    .all([
      args.postgresPassword,
      args.backupPassphrase,
      args.googleClientSecret ?? pulumi.output(""),
      args.githubClientSecret ?? pulumi.output(""),
      args.resendApiKey ?? pulumi.output(""),
      args.tailscaleAuthKey ?? pulumi.output(""),
    ])
    .apply(([pgPass, backupPass, googleSecret, githubSecret, resendApiKey, tailscaleAuthKey]) =>
      renderCloudInit({
        pgPass,
        backupPass,
        googleSecret,
        githubSecret,
        resendApiKey,
        domain: args.domain,
        frontendUrl: args.frontendUrl,
        emailProvider: args.emailProvider,
        resendFromAddress: args.resendFromAddress ?? "",
        googleClientId: args.googleClientId ?? "",
        githubClientId: args.githubClientId ?? "",
        corsOrigins: args.corsOrigins,
        enableBlockVolume: args.enableBlockVolume,
        trustedProxyHopCount: args.trustedProxyHopCount,
        tailscaleAuthKey,
        tailscaleHostname: args.tailscaleHostname ?? "kytepdf-auth",
        tailscaleTag: args.tailscaleTag ?? "",
        authPackageJson,
        authPackageLock,
      }),
    );
}

/**
 * Parse env-file text (lines of KEY=VALUE) into a name→value record.
 * Used by validateRequiredEnv to parse the generated app.env + auth-secrets.env.
 */
function parseEnvFileLines(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const name = line.slice(0, eqIdx).trim();
    const value = line.slice(eqIdx + 1).trim();
    if (name) result[name] = value;
  }
  return result;
}

/**
 * Render the full cloud-init YAML string from resolved (plain) values.
 * This function is exported for unit testing without Pulumi runtime.
 */
export function renderCloudInit(r: RenderArgs): string {
  const dockerCompose = buildDockerCompose(r.enableBlockVolume);
  const caddyfile = buildCaddyfile(r.domain);
  const backupScript = buildBackupScript(r.enableBlockVolume);
  const systemdUnit = buildSystemdUnit(r.enableBlockVolume);
  // Split secrets by consumer to minimise exposure surface (P2)
  const postgresSecrets = buildPostgresSecrets(r);
  const authSecrets = buildAuthSecrets(r);
  const backupSecrets = buildBackupSecrets(r);
  const appEnv = buildAppEnv(r);

  // ── Render-time required-value validation (R4.5) ──────────────────────────
  // Parse .env.example to get the contract, then validate generated env values.
  const envExampleText = readFileSync(resolve(AUTH_SERVER_DIR, ".env.example"), "utf8");
  const contractEntries = parseEnvContract(envExampleText);
  const requiredContractNames = contractEntries.filter((e) => e.required).map((e) => e.name);

  // Merge app.env + auth-secrets.env into a single name→value map for validation.
  // The compose environment: block supplies PORT and HOST (exempt), so they are
  // not in the generated env files — but they are in the Exemption_List.
  const generatedEnv = {
    ...parseEnvFileLines(appEnv),
    ...parseEnvFileLines(authSecrets),
  };

  validateRequiredEnv({ generatedEnv, requiredContractNames });

  // Indent each file content for YAML block scalar (4 spaces under `content: |`)
  const indent = (text: string, spaces = 6): string =>
    text
      .split("\n")
      .map((line) => (line.length > 0 ? " ".repeat(spaces) + line : line))
      .join("\n");
  const ensureTrailingNewline = (text: string): string =>
    text.endsWith("\n") ? text : `${text}\n`;
  const contentKey = (text: string, preserveTrailingBytes = false): string => {
    const chomp = preserveTrailingBytes ? (text.endsWith("\n") ? "+" : "-") : "";
    return `content: |${chomp}\n${indent(text)}`;
  };
  const writeFiles = [
    `  # postgres-secrets.env — root:root 0600 — only what Postgres needs
  - path: /opt/auth/postgres-secrets.env
    permissions: "0600"
    owner: root:root
    ${contentKey(postgresSecrets)}`,
    `  # auth-secrets.env — root:root 0600 — only what the auth container needs
  - path: /opt/auth/auth-secrets.env
    permissions: "0600"
    owner: root:root
    ${contentKey(authSecrets)}`,
    `  # backup-secrets.env — root:root 0600 — only what the backup script needs
  - path: /opt/auth/backup-secrets.env
    permissions: "0600"
    owner: root:root
    ${contentKey(backupSecrets)}`,
    `  # Non-secret app config — no passwords or secrets
  - path: /opt/auth/app.env
    permissions: "0644"
    owner: root:root
    ${contentKey(appEnv)}`,
    `  # Deployable_Unit manifest — verbatim auth-server/package.json (Embedded_Deployable_Unit)
  - path: /opt/auth/app/package.json
    permissions: "0644"
    owner: root:root
    ${contentKey(r.authPackageJson, true)}`,
    `  # Deployable_Unit lockfile — verbatim auth-server/package-lock.json (Embedded_Deployable_Unit)
  - path: /opt/auth/app/package-lock.json
    permissions: "0644"
    owner: root:root
    ${contentKey(r.authPackageLock, true)}`,
    `  # Docker Compose stack definition
  - path: /opt/auth/docker-compose.yml
    permissions: "0644"
    owner: root:root
    ${contentKey(dockerCompose)}`,
    `  # Caddy reverse proxy + TLS config
  - path: /opt/auth/Caddyfile
    permissions: "0644"
    owner: root:root
    ${contentKey(caddyfile)}`,
    `  # Daily backup script
  - path: /opt/auth/backup.sh
    permissions: "0700"
    owner: root:root
    ${contentKey(backupScript)}`,
    `  # systemd unit to manage the Docker Compose stack
  - path: /etc/systemd/system/auth-stack.service
    permissions: "0644"
    owner: root:root
    ${contentKey(systemdUnit)}`,
  ]
    .map(ensureTrailingNewline)
    .join("");

  return `#cloud-config
packages:
  - docker.io
  - docker-compose-plugin
  - curl
  - gnupg

write_files:
${writeFiles}
${
  r.tailscaleAuthKey
    ? `
  # Tailscale auth key — root-only, deleted after first use by runcmd
  - path: /opt/auth/tailscale-authkey
    permissions: "0600"
    owner: root:root
    content: ${r.tailscaleAuthKey}
`
    : ""
}

runcmd:
${buildDataStorageRuncmd(r.enableBlockVolume)}
${buildTailscaleRuncmd(r.tailscaleAuthKey, r.tailscaleHostname, r.tailscaleTag)}
  # ── Docker ──────────────────────────────────────────────────────────────
  - systemctl enable docker
  - systemctl start docker
  # ── Auth stack ──────────────────────────────────────────────────────────
  - systemctl enable auth-stack
  - systemctl start auth-stack
  # ── Daily backup cron ───────────────────────────────────────────────────
  - echo "0 2 * * * root /opt/auth/backup.sh >> /var/log/auth-backup.log 2>&1" > /etc/cron.d/auth-backup
`;
}

// ── Template builders ──────────────────────────────────────────────────────

/** Secrets consumed only by the postgres container. */
function buildPostgresSecrets(r: RenderArgs): string {
  return [`POSTGRES_PASSWORD=${r.pgPass}`].join("\n");
}

/** Secrets consumed only by the auth container. */
function buildAuthSecrets(r: RenderArgs): string {
  const lines = [
    `POSTGRES_PASSWORD=${r.pgPass}`,
    `DATABASE_URL=postgresql://authuser:${encodeURIComponent(r.pgPass)}@postgres:5432/authdb`,
  ];
  if (r.googleSecret) lines.push(`GOOGLE_CLIENT_SECRET=${r.googleSecret}`);
  if (r.githubSecret) lines.push(`GITHUB_CLIENT_SECRET=${r.githubSecret}`);
  if (r.emailProvider === "resend" && r.resendApiKey) {
    lines.push(`RESEND_API_KEY=${r.resendApiKey}`);
  }
  return lines.join("\n");
}

/** Secrets consumed only by the backup script. */
function buildBackupSecrets(r: RenderArgs): string {
  return [`BACKUP_PASSPHRASE=${r.backupPass}`].join("\n");
}

function buildAppEnv(r: RenderArgs): string {
  const lines = [
    `COOKIE_SECURE=true`,
    `COOKIE_SAMESITE=none`,
    `CSRF_COOKIE_SECURE=true`,
    `CSRF_COOKIE_SAMESITE=none`,
    // BASE_URL must be the frontend app URL, not the auth API domain.
    // FortressAuth uses it for email verification/reset links and OAuth redirects.
    `BASE_URL=${r.frontendUrl}`,
    `CORS_ORIGINS=${r.corsOrigins}`,
    `EMAIL_PROVIDER=${r.emailProvider}`,
    // EMAIL_FROM_ADDRESS sourced solely from resendFromAddress — no SES fallback.
    `EMAIL_FROM_ADDRESS=${r.resendFromAddress}`,
    `GOOGLE_CLIENT_ID=${r.googleClientId}`,
    `GOOGLE_REDIRECT_URI=https://${r.domain}/auth/oauth/google/callback`,
    `GITHUB_CLIENT_ID=${r.githubClientId}`,
    `GITHUB_REDIRECT_URI=https://${r.domain}/auth/oauth/github/callback`,
    // Tell FortressAuth how many trusted proxy hops sit in front of it (Caddy = 1).
    // This ensures client IP extraction from X-Forwarded-For is correct and
    // rate limiting cannot be spoofed by attacker-controlled headers.
    `TRUSTED_PROXY_HOP_COUNT=${r.trustedProxyHopCount}`,
  ];
  return lines.join("\n");
}

function buildDockerCompose(enableBlockVolume: boolean): string {
  // pg-data volume: bind-mount to block volume path when available, otherwise
  // fall back to a Docker-managed volume so the stack still starts.
  const pgDataVolume = enableBlockVolume
    ? `  pg-data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /mnt/data/postgres`
    : `  pg-data:`;

  return `networks:
  auth-net:
    driver: bridge

volumes:
${pgDataVolume}
  caddy-data:
  caddy-logs:

services:
  postgres:
    image: postgres:17-alpine
    restart: unless-stopped
    networks: [auth-net]
    volumes:
      - pg-data:/var/lib/postgresql/data
    env_file:
      - /opt/auth/postgres-secrets.env
    environment:
      POSTGRES_USER: authuser
      POSTGRES_DB: authdb
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U authuser -d authdb"]
      interval: 10s
      timeout: 5s
      retries: 5

  auth:
    image: node:22-slim
    restart: unless-stopped
    networks: [auth-net]
    working_dir: /app
    volumes:
      - /opt/auth/app:/app
    command: >
      sh -c "npm ci --omit=dev || { echo 'ERROR: npm ci could not reproduce the version pinned in the Auth_Server lockfile (/opt/auth/app/package-lock.json) for the Deployable_Unit; refusing to start auth container' >&2; exit 1; }; npm start"
    env_file:
      - /opt/auth/app.env
      - /opt/auth/auth-secrets.env
    environment:
      NODE_ENV: "production"
      PORT: "3000"
      HOST: "0.0.0.0"
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
      interval: 30s
      timeout: 10s
      retries: 3

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    networks: [auth-net]
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /opt/auth/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-logs:/var/log/caddy
    depends_on:
      auth:
        condition: service_healthy`;
}

function buildCaddyfile(domain: string): string {
  return `{
  email admin@kytepdf.com
}

${domain} {
  reverse_proxy auth:3000

  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
    X-Content-Type-Options nosniff
    X-Frame-Options DENY
    Referrer-Policy strict-origin-when-cross-origin
  }

  log {
    output file /var/log/caddy/access.log {
      roll_size 10mb
      roll_keep 5
    }
  }
}`;
}

function buildDataStorageRuncmd(enableBlockVolume: boolean): string {
  if (!enableBlockVolume) {
    return `  # ── Data storage: boot-disk fallback is explicit when block volume is disabled ──
  - mkdir -p /mnt/data/postgres /mnt/data/backups`;
  }

  return `  # ── Block volume: require a real /mnt/data mount before starting auth ─────
  - |
    set -euo pipefail
    DEVICE="/dev/oracleoci/oraclevdb"
    # OCI paravirtualized attachment can arrive after instance launch.
    # Wait up to 180 s (90 × 2 s), then fail closed instead of using the boot disk.
    for i in $(seq 1 90); do
      [ -b "$DEVICE" ] && break
      sleep 2
    done
    if [ ! -b "$DEVICE" ]; then
      echo "ERROR: required block volume device $DEVICE did not appear; refusing to start auth stack on boot disk" >&2
      exit 1
    fi
    if ! blkid "$DEVICE" | grep -q TYPE; then
      mkfs.ext4 -F "$DEVICE"
    fi
    mkdir -p /mnt/data
    if ! grep -q "^$DEVICE /mnt/data " /etc/fstab; then
      echo "$DEVICE /mnt/data ext4 defaults,nofail 0 2" >> /etc/fstab
    fi
    mount /mnt/data
    if ! mountpoint -q /mnt/data; then
      echo "ERROR: /mnt/data is not a mount point; refusing to start auth stack on boot disk" >&2
      exit 1
    fi
    mkdir -p /mnt/data/postgres /mnt/data/backups`;
}

function buildSystemdUnit(requireBlockVolume: boolean): string {
  const blockVolumeRequirements = requireBlockVolume
    ? `RequiresMountsFor=/mnt/data
ConditionPathIsMountPoint=/mnt/data
`
    : "";

  return `[Unit]
Description=KytePDF Auth Stack (Docker Compose)
${blockVolumeRequirements}\
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/auth
ExecStart=/usr/bin/docker compose up -d --remove-orphans
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target`;
}

function buildBackupScript(requireBlockVolume: boolean): string {
  const mountGuard = requireBlockVolume
    ? `
if ! mountpoint -q /mnt/data; then
  echo "[$(date)] ERROR: /mnt/data is not mounted; refusing to write backups to boot disk" >&2
  exit 1
fi
`
    : "";

  return `#!/usr/bin/env bash
# /opt/auth/backup.sh — runs daily at 02:00 UTC via cron
set -euo pipefail

# Restrict permissions on all files created by this script (dump, encrypted output).
umask 077

BACKUP_DIR="/mnt/data/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DUMP_FILE="\${BACKUP_DIR}/authdb_\${TIMESTAMP}.sql.gz"
RETENTION_DAYS=7
MIN_KEEP=3
${mountGuard}
mkdir -p "\${BACKUP_DIR}"

# 1. Dump Postgres and compress
if ! docker compose -f /opt/auth/docker-compose.yml exec -T postgres \\
    pg_dump -U authuser authdb | gzip > "\${DUMP_FILE}"; then
  echo "[$(date)] ERROR: pg_dump failed" >&2
  rm -f "\${DUMP_FILE}"
  exit 1
fi

# 2. Encrypt with GPG symmetric AES256.
# Read only BACKUP_PASSPHRASE from its dedicated secrets file — do NOT source
# a broader file, which would expose other credentials in the process environment.
BACKUP_PASSPHRASE=$(grep '^BACKUP_PASSPHRASE=' /opt/auth/backup-secrets.env | cut -d= -f2-)
if [ -z "\${BACKUP_PASSPHRASE}" ]; then
  echo "[$(date)] ERROR: BACKUP_PASSPHRASE not found in /opt/auth/backup-secrets.env" >&2
  rm -f "\${DUMP_FILE}"
  exit 1
fi

PASSPHRASE_FILE=$(mktemp)
trap 'rm -f "\${PASSPHRASE_FILE}"' EXIT
printf '%s' "\${BACKUP_PASSPHRASE}" > "\${PASSPHRASE_FILE}"

if ! gpg --batch --yes --passphrase-file "\${PASSPHRASE_FILE}" \\
    --symmetric --cipher-algo AES256 \\
    -o "\${DUMP_FILE}.gpg" "\${DUMP_FILE}"; then
  echo "[$(date)] ERROR: GPG encryption failed — deleting unencrypted dump" >&2
  rm -f "\${DUMP_FILE}" "\${DUMP_FILE}.gpg"
  exit 1
fi

# 3. Remove unencrypted dump (only after successful encryption)
rm -f "\${DUMP_FILE}"

# 4. Prune old backups: keep at least MIN_KEEP, delete those older than RETENTION_DAYS
BACKUP_FILES=( $(ls -t "\${BACKUP_DIR}"/*.gpg 2>/dev/null) )
TOTAL=\${#BACKUP_FILES[@]}
if [ "\${TOTAL}" -gt "\${MIN_KEEP}" ]; then
  # Delete files older than RETENTION_DAYS, but never drop below MIN_KEEP
  find "\${BACKUP_DIR}" -name "*.gpg" -mtime +\${RETENTION_DAYS} -print | \\
    while read -r OLD_FILE; do
      REMAINING=( $(ls -t "\${BACKUP_DIR}"/*.gpg 2>/dev/null) )
      if [ "\${#REMAINING[@]}" -gt "\${MIN_KEEP}" ]; then
        rm -f "\${OLD_FILE}"
      fi
    done
fi

echo "[$(date)] Backup complete: \${DUMP_FILE}.gpg"`;
}

function buildTailscaleRuncmd(authKey: string, hostname: string, tag: string): string {
  if (!authKey) {
    return `  - 'true'  # tailscale: not configured — SSH via adminCidrs / port 22`;
  }

  const tagFlag = tag ? ` --advertise-tags=${tag}` : "";

  // The auth key is NOT passed on the command line (would leak to ps, cloud-init logs).
  // Instead it's read from /opt/auth/tailscale-authkey (written via write_files, mode 0600)
  // and passed via the TS_AUTHKEY environment variable.
  return `  # ── Tailscale: install and enable SSH over tailnet ────────────────────────
  - |
    set -e
    curl -fsSL https://tailscale.com/install.sh | sh
    TS_AUTHKEY=$(cat /opt/auth/tailscale-authkey) \\
      tailscale up --hostname=${hostname} --ssh --accept-dns=false${tagFlag} \\
      > /dev/null 2>&1
    rm -f /opt/auth/tailscale-authkey
    echo "Tailscale registered: $(tailscale ip -4)"`;
}
