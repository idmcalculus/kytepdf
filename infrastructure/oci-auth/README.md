# OCI Auth Server Hosting

Pulumi TypeScript project that provisions the KytePDF FortressAuth authentication server on
[OCI Always Free tier](https://www.oracle.com/cloud/free/). A single ARM64 VM runs three Docker
containers (Caddy, auth, Postgres) with automatic TLS via Let's Encrypt.

**Stack:** `oci-auth-hosting` · **Runtime:** Node.js (Pulumi) · **Region default:** `us-ashburn-1`

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Setup](#setup)
3. [Deployment](#deployment)
4. [Environment Files](#environment-files)
5. [DNS Setup](#dns-setup)
6. [Verifying the Deployment](#verifying-the-deployment)
7. [Backup and Restore](#backup-and-restore)
8. [Troubleshooting](#troubleshooting)
9. [Config Reference](#config-reference)

---

## Prerequisites

| Tool                                                                             | Version | Notes                                                 |
| -------------------------------------------------------------------------------- | ------- | ----------------------------------------------------- |
| [Pulumi CLI](https://www.pulumi.com/docs/install/)                               | v3+     | `brew install pulumi` or see install docs             |
| [OCI CLI](https://docs.oracle.com/en-us/iaas/Content/API/SDKDocs/cliinstall.htm) | any     | Must be configured with API keys (`oci setup config`) |
| [Node.js](https://nodejs.org/)                                                   | 22+     | Required by the Pulumi Node.js runtime                |
| [Bun](https://bun.sh/)                                                           | any     | Optional — only needed to run the test suite locally  |

### OCI CLI configuration

The Pulumi OCI provider reads credentials from `~/.oci/config`. Run `oci setup config` if you
have not already done so, then verify access:

```bash
oci iam compartment list --all
```

You will need:

- A **compartment OCID** (or use the root/tenancy compartment)
- An **SSH key pair** — the public key is passed to the stack as `sshPublicKey`

---

## Setup

### 1. Install dependencies

```bash
cd infrastructure/oci-auth
npm install
```

### 2. Initialise the Pulumi stack

```bash
pulumi stack init prod
```

Replace `prod` with any name you prefer (e.g. `dev`, `staging`).

### 3. Set required config values

These four values are **required** — the stack will fail before creating any resources if they
are missing.

```bash
# Your OCI compartment OCID
pulumi config set compartmentOcid ocid1.compartment.oc1..aaaa...

# SSH public key (paste the full key string)
pulumi config set sshPublicKey "ssh-ed25519 AAAA... user@host"

# Comma-separated list of allowed CORS origins for the auth API
pulumi config set corsOrigins "https://kytepdf.com,https://www.kytepdf.com"

# Frontend app URL used for email links and OAuth success redirects
pulumi config set frontendUrl https://kytepdf.com
```

### 4. Set optional config values

All of these have sensible defaults (see [Config Reference](#config-reference)). Override only
what you need.

```bash
# OCI region (default: us-ashburn-1)
pulumi config set oci:region us-phoenix-1

# Custom domain (default: auth.kytepdf.com)
pulumi config set domain auth.example.com

# SSH access: set adminCidrs, tailscaleAuthKey, or both. With neither, the stack refuses to
# deploy. 0.0.0.0/0 is rejected.
pulumi config set adminCidrs "203.0.113.10/32,198.51.100.0/24"
# Or use Tailscale SSH (port 22 stays closed). Use a single-use auth key.
pulumi config set --secret tailscaleAuthKey tskey-auth-...

# VM sizing (defaults: 1 OCPU, 6 GB RAM)
pulumi config set ocpu 2
pulumi config set memoryGb 12

# Block volume size in GB (default: 50, max: 150)
pulumi config set blockVolumeSizeGb 100

# Availability domain index to use (default: 0 — change on capacity errors)
pulumi config set availabilityDomainIndex 1

# Email provider: console or resend (default: console).
# With resend, resendApiKey and resendFromAddress are also required.
pulumi config set emailProvider resend
pulumi config set --secret resendApiKey re_YOUR_RESEND_API_KEY
pulumi config set resendFromAddress noreply@kytepdf.com
```

### 5. Enable OAuth providers (optional)

```bash
# Google OAuth
pulumi config set enableGoogle true
pulumi config set googleClientId YOUR_GOOGLE_CLIENT_ID
pulumi config set --secret googleClientSecret YOUR_GOOGLE_CLIENT_SECRET

# GitHub OAuth
pulumi config set enableGithub true
pulumi config set githubClientId YOUR_GITHUB_CLIENT_ID
pulumi config set --secret githubClientSecret YOUR_GITHUB_CLIENT_SECRET
```

### 6. Set secrets (optional — auto-generated if omitted)

The stack auto-generates a 32-character Postgres password and a 48-character backup passphrase
on first deploy and stores them encrypted in the stack state. You can supply your own:

```bash
pulumi config set --secret postgresPassword "your-strong-password"
pulumi config set --secret backupPassphrase "your-strong-passphrase"
```

> **Note:** Auto-generated secrets are stable across subsequent `pulumi up` runs — Pulumi tracks
> them in the encrypted stack state.

---

## Deployment

```bash
pulumi up
```

Pulumi will show a preview of all resources to be created. Type `yes` to confirm.

**What gets created:**

| Resource            | Details                                                                               |
| ------------------- | ------------------------------------------------------------------------------------- |
| VCN                 | `10.0.0.0/16`, DNS label `authvcn`                                                    |
| Internet Gateway    | Attached to VCN, enabled                                                              |
| Route Table         | Default route `0.0.0.0/0` → Internet Gateway                                          |
| Security List       | Ingress: TCP 443, 80 (public), TCP 22 (admin CIDRs), ICMP type 3/4 (VCN); Egress: all |
| Public Subnet       | `10.0.1.0/24`, DNS label `authsubnet`                                                 |
| Reserved Public IP  | Lifetime `RESERVED` — persists across instance replacements                           |
| VM.Standard.A1.Flex | ARM64, configurable OCPU/RAM, 50 GB boot volume, cloud-init bootstrap                 |
| Block Volume        | Paravirtualized, in-transit encryption, mounted at `/mnt/data`                        |

**What happens on first boot (cloud-init):**

1. Installs `docker.io`, `docker-compose-plugin`, `curl`, `gnupg`
2. Writes four env files under `/opt/auth/` (see [Environment Files](#environment-files) below)
3. Writes `/opt/auth/docker-compose.yml`, `/opt/auth/Caddyfile`, `/opt/auth/backup.sh`, and the `auth-stack` systemd unit
4. Formats and mounts the block volume at `/mnt/data` (skipped if device is absent)
5. Enables and starts the `auth-stack` systemd service (Docker Compose: postgres → auth → caddy)
6. Installs a daily cron job at `02:00 UTC` for encrypted Postgres backups

**Expected duration:** 5–10 minutes for the full `pulumi up` (instance creation + cloud-init).

---

## Environment Files

Cloud-init writes four env files under `/opt/auth/`. Each file is owned by `root:root`.

| Path                             | Mode                       | Contains                                                                                                                                             | Consumed by                           |
| -------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `/opt/auth/postgres-secrets.env` | `0600` (secrets)           | `POSTGRES_PASSWORD`                                                                                                                                  | Postgres container                    |
| `/opt/auth/auth-secrets.env`     | `0600` (secrets)           | `POSTGRES_PASSWORD`, `DATABASE_URL`, OAuth client secrets, `RESEND_API_KEY`                                                                          | auth container                        |
| `/opt/auth/backup-secrets.env`   | `0600` (secrets)           | `BACKUP_PASSPHRASE`                                                                                                                                  | backup script (`/opt/auth/backup.sh`) |
| `/opt/auth/app.env`              | `0644` (non-secret config) | `BASE_URL`, `CORS_ORIGINS`, `EMAIL_PROVIDER`, `EMAIL_FROM_ADDRESS`, OAuth client IDs, redirect URIs, `TRUSTED_PROXY_HOP_COUNT`, cookie/CSRF settings | auth container                        |

Secrets are split across separate files so each component only has access to the credentials it
needs. The Postgres container never sees OAuth secrets; the backup script never sees the database
URL; the auth container env files never contain the backup passphrase.

---

## DNS Setup

After `pulumi up` completes, retrieve the reserved public IP:

```bash
pulumi stack output reservedIp
# e.g. 152.67.123.45

# Or read the ready-made DNS instruction:
pulumi stack output dnsInstruction
# Create DNS A record: auth.kytepdf.com → 152.67.123.45
```

Create an **A record** at your DNS registrar:

| Field             | Value                                                   |
| ----------------- | ------------------------------------------------------- |
| Type              | `A`                                                     |
| Name / Host       | `auth` (or the full subdomain, e.g. `auth.kytepdf.com`) |
| Value / Points to | The IP from `pulumi stack output reservedIp`            |
| TTL               | `300` (5 minutes) or lower for faster propagation       |

Once DNS propagates (typically 1–5 minutes with a low TTL), Caddy will automatically obtain a
TLS certificate from Let's Encrypt via the ACME HTTP-01 challenge. The first HTTPS request may
take a few seconds while the certificate is issued.

> **Tip:** The reserved IP persists even if the instance is replaced. You will not need to update
> your DNS record after a `pulumi up` that recreates the VM.

---

## Verifying the Deployment

Check that the auth stack is running on the VM:

```bash
# SSH into the instance
ssh ubuntu@$(pulumi stack output reservedIp)

# Check cloud-init completed successfully
sudo cat /var/log/cloud-init-output.log | tail -20

# Check the auth-stack systemd service
sudo systemctl status auth-stack

# Check all three containers are running
sudo docker compose -f /opt/auth/docker-compose.yml ps

# Tail container logs
sudo docker compose -f /opt/auth/docker-compose.yml logs -f
```

Test the health endpoint:

```bash
curl https://auth.kytepdf.com/health
# Expected: {"status":"ok"} or similar
```

---

## Backup and Restore

### How backups work

A cron job runs `/opt/auth/backup.sh` daily at **02:00 UTC**. It:

1. Runs `pg_dump` inside the postgres container and compresses the output with gzip
2. Encrypts the compressed dump with GPG symmetric AES256 using the `BACKUP_PASSPHRASE`
3. Deletes the unencrypted dump
4. Prunes backups older than 7 days, keeping a minimum of 3 most recent files

Backup files are stored at `/mnt/data/backups/` on the VM with the naming pattern:
`authdb_YYYYMMDD_HHMMSS.sql.gz.gpg`

### Retrieve the backup passphrase

The passphrase is stored encrypted in the Pulumi stack state. To retrieve it:

```bash
pulumi config get --show-secrets backupPassphrase
```

### Restore procedure

**Step 1 — Copy the backup file from the VM:**

```bash
scp ubuntu@$(pulumi stack output reservedIp):/mnt/data/backups/authdb_20240101_020000.sql.gz.gpg .
```

**Step 2 — Decrypt the backup:**

```bash
BACKUP_PASSPHRASE="$(pulumi config get --show-secrets backupPassphrase)"

gpg --batch --passphrase "$BACKUP_PASSPHRASE" \
    -o authdb_restore.sql.gz \
    authdb_20240101_020000.sql.gz.gpg
```

**Step 3 — Restore into Postgres:**

```bash
# SSH into the VM first, then:
gunzip -c authdb_restore.sql.gz | \
  sudo docker compose -f /opt/auth/docker-compose.yml exec -T postgres \
  psql -U authuser authdb
```

> **Note:** The restore replaces the current database contents. Stop the auth container first
> if you want to avoid write conflicts during the restore:
> ```bash
> sudo docker compose -f /opt/auth/docker-compose.yml stop auth
> # ... run restore ...
> sudo docker compose -f /opt/auth/docker-compose.yml start auth
> ```

### Run a manual backup

```bash
ssh ubuntu@$(pulumi stack output reservedIp)
sudo /opt/auth/backup.sh
ls -lh /mnt/data/backups/
```

---

## Troubleshooting

### Capacity error during instance creation

**Symptom:** `pulumi up` fails with an error like:

```
Out of host capacity.
```
or

```
The requested shape VM.Standard.A1.Flex is not available in availability domain AD-1.
```

**Fix:** Change the availability domain index and retry:

```bash
# Try index 1 (second AD)
pulumi config set availabilityDomainIndex 1
pulumi up

# If that also fails, try index 2
pulumi config set availabilityDomainIndex 2
pulumi up
```

OCI Always Free A1 capacity is limited per region. If all three ADs are at capacity, try a
different region (e.g. `us-phoenix-1`, `eu-frankfurt-1`):

```bash
pulumi config set oci:region us-phoenix-1
pulumi up
```

---

### TLS certificate not issued / HTTPS not working

**Symptom:** Browser shows a TLS error or `curl https://auth.kytepdf.com` fails.

**Cause:** DNS has not propagated yet, or the A record is not pointing to the correct IP.

**Fix:**

1. Verify the A record is correct:

   ```bash
   dig +short auth.kytepdf.com
   # Should return the IP from: pulumi stack output reservedIp
   ```

2. If DNS is correct, check Caddy logs on the VM:

   ```bash
   ssh ubuntu@$(pulumi stack output reservedIp)
   sudo docker compose -f /opt/auth/docker-compose.yml logs caddy
   ```

3. Caddy retries ACME challenges automatically with exponential backoff (up to 30 minutes between
   retries). Wait for DNS to propagate fully — this can take up to 48 hours with high TTLs, but
   is typically under 5 minutes with TTL ≤ 300.

4. If Caddy is stuck, restart it:

   ```bash
   sudo docker compose -f /opt/auth/docker-compose.yml restart caddy
   ```

---

### Block volume not mounted

**Symptom:** `df -h` on the VM does not show `/mnt/data`, or Postgres data is not persisting.

**Cause:** The block volume device (`/dev/oracleoci/oraclevdb`) was not present when cloud-init
ran, or the attachment failed.

**Diagnose:**

```bash
ssh ubuntu@$(pulumi stack output reservedIp)

# Check if the device exists
ls -la /dev/oracleoci/

# Check cloud-init output for mount errors
sudo grep -i "oraclevdb\|mnt/data\|mkfs\|mount" /var/log/cloud-init-output.log

# Check current mounts
mount | grep mnt
```

**Fix — manual mount:**

```bash
DEVICE="/dev/oracleoci/oraclevdb"

# Format only if no filesystem exists (skip if already formatted)
if ! sudo blkid "$DEVICE" | grep -q TYPE; then
  sudo mkfs.ext4 -F "$DEVICE"
fi

sudo mkdir -p /mnt/data/postgres /mnt/data/backups

# Add to fstab if not already present
grep -q "$DEVICE" /etc/fstab || \
  echo "$DEVICE /mnt/data ext4 defaults,nofail 0 2" | sudo tee -a /etc/fstab

sudo mount /mnt/data
sudo mkdir -p /mnt/data/postgres /mnt/data/backups

# Restart the auth stack so Postgres picks up the new mount
sudo systemctl restart auth-stack
```

> **Warning:** Only run `mkfs.ext4` if the device has no existing filesystem. Running it on a
> device with data will permanently erase that data.

---

### Auth stack not starting

**Symptom:** `sudo systemctl status auth-stack` shows `failed` or containers are not running.

**Diagnose:**

```bash
# Check systemd service status
sudo systemctl status auth-stack -l

# Check Docker Compose logs
sudo docker compose -f /opt/auth/docker-compose.yml logs --tail=50

# Check individual container status
sudo docker compose -f /opt/auth/docker-compose.yml ps
```

**Common causes:**

- **Postgres not healthy:** The auth container waits for Postgres to pass its health check
  (`pg_isready -U authuser -d authdb`). If Postgres fails to start (e.g. bad password, corrupt
  data directory), auth will remain in a waiting state. Check Postgres logs:

  ```bash
  sudo docker compose -f /opt/auth/docker-compose.yml logs postgres
  ```

- **Port 80/443 already in use:** Another process is using the ports. Check with:

  ```bash
  sudo ss -tlnp | grep -E ':80|:443'
  ```

- **Cloud-init still running:** On first boot, cloud-init may still be in progress. Wait for it:

  ```bash
  sudo cloud-init status --wait
  ```

---

### Viewing cloud-init logs

```bash
ssh ubuntu@$(pulumi stack output reservedIp)
sudo cat /var/log/cloud-init-output.log
```

If cloud-init fails, the instance remains accessible via SSH for manual diagnosis and re-running
provisioning steps.

---

## Config Reference

All values are set with `pulumi config set [--secret] KEY VALUE`.

| Key                       | Type    | Default                      | Secret  | Description                                                                                                                                               |
| ------------------------- | ------- | ---------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `oci:region`              | string  | `us-ashburn-1`               | no      | OCI region for all resources                                                                                                                              |
| `compartmentOcid`         | string  | **required**                 | no      | OCID of the compartment to deploy into                                                                                                                    |
| `sshPublicKey`            | string  | **required**                 | no      | SSH public key for VM access                                                                                                                              |
| `corsOrigins`             | string  | **required**                 | no      | Comma-separated CORS origins, e.g. `https://kytepdf.com`                                                                                                  |
| `adminCidrs`              | string  | —                            | no      | Comma-separated IPv4 CIDRs allowed SSH (port 22), e.g. `203.0.113.10/32,198.51.100.0/24`. `0.0.0.0/0` is rejected. Set this, `tailscaleAuthKey`, or both. |
| `domain`                  | string  | `auth.kytepdf.com`           | no      | FQDN for Caddy TLS and OAuth callback URLs                                                                                                                |
| `frontendUrl`             | string  | **required**                 | no      | Frontend app URL used for email links and OAuth success redirects                                                                                         |
| `ocpu`                    | number  | `1`                          | no      | OCPU count for `VM.Standard.A1.Flex` (1–4)                                                                                                                |
| `memoryGb`                | number  | `6`                          | no      | RAM in GB for `VM.Standard.A1.Flex` (6–24)                                                                                                                |
| `availabilityDomainIndex` | number  | `0`                          | no      | Index into the compartment's availability domains (0-based). Change on capacity errors.                                                                   |
| `imageOcid`               | string  | _(auto-detect)_              | no      | Override ARM64 image OCID. If unset, the latest Ubuntu 24.04 ARM64 image for `VM.Standard.A1.Flex` is used.                                               |
| `emailProvider`           | string  | `console`                    | no      | Email provider: `console` or `resend`                                                                                                                     |
| `resendApiKey`            | string  | —                            | **yes** | Resend API key. Required when `emailProvider` is `resend`.                                                                                                |
| `resendFromAddress`       | string  | —                            | no      | Sender address, e.g. `noreply@kytepdf.com`. Required when `emailProvider` is `resend`; must be a valid email address.                                     |
| `enableGoogle`            | boolean | `false`                      | no      | Enable Google OAuth. Requires `googleClientId` and `googleClientSecret`.                                                                                  |
| `googleClientId`          | string  | —                            | no      | Google OAuth client ID                                                                                                                                    |
| `googleClientSecret`      | string  | —                            | **yes** | Google OAuth client secret                                                                                                                                |
| `enableGithub`            | boolean | `false`                      | no      | Enable GitHub OAuth. Requires `githubClientId` and `githubClientSecret`.                                                                                  |
| `githubClientId`          | string  | —                            | no      | GitHub OAuth client ID                                                                                                                                    |
| `githubClientSecret`      | string  | —                            | **yes** | GitHub OAuth client secret                                                                                                                                |
| `enableBlockVolume`       | boolean | `true`                       | no      | Attach an extra block volume for Postgres data                                                                                                            |
| `blockVolumeSizeGb`       | number  | `50`                         | no      | Block volume size in GB (1–150; with the 50 GB boot volume this stays within the OCI Always Free 200 GB total)                                            |
| `trustedProxyHopCount`    | number  | `1`                          | no      | Reverse-proxy hops in front of the auth container (Caddy is one). 0–8.                                                                                    |
| `tailscaleAuthKey`        | string  | —                            | **yes** | Tailscale auth key. When set, the VM joins your tailnet with Tailscale SSH. Use a single-use key: it sits in the instance metadata.                       |
| `tailscaleHostname`       | string  | `kytepdf-auth`               | no      | Tailscale hostname for the VM. One DNS label: letters, digits and hyphens, 1–63 chars.                                                                    |
| `tailscaleTag`            | string  | —                            | no      | Tailscale ACL tag in the form `tag:<name>`, e.g. `tag:server`. Must exist in your tailnet's ACL policy.                                                   |
| `postgresPassword`        | string  | _(auto-generated, 32 chars)_ | **yes** | Postgres password. Auto-generated via `@pulumi/random` if not set.                                                                                        |
| `backupPassphrase`        | string  | _(auto-generated, 48 chars)_ | **yes** | GPG passphrase for backup encryption. Auto-generated via `@pulumi/random` if not set.                                                                     |

### Stack outputs

| Output           | Description                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------- |
| `reservedIp`     | The reserved public IPv4 address assigned to the VM                                       |
| `instanceId`     | The OCI instance OCID                                                                     |
| `dnsInstruction` | Ready-made DNS instruction string, e.g. `Create DNS A record: auth.kytepdf.com → 1.2.3.4` |

> **Security note:** `postgresPassword`, `backupPassphrase`, `googleClientSecret`,
> `githubClientSecret`, `resendApiKey`, and `tailscaleAuthKey` are intentionally **not** exported
> as stack outputs. Retrieve them with
> `pulumi config get --show-secrets KEY` when needed.

---

## Architecture Overview

The auth service is the `auth-server/` deployable unit run as-is. The OCI deployment embeds
`auth-server/package.json` and `auth-server/package-lock.json` verbatim into the VM via
cloud-init, then runs `npm ci` (resolving versions solely from the lockfile) followed by `npm start`
(the `auth-server/` start script). The `@fortressauth/server` version that runs in production is
determined solely by the pin in `auth-server/package.json` — the OCI deployment does not name or
pin that version independently.

The cloud-init user data is gzipped, then base64-encoded, into the instance metadata. OCI allows at
most 32,000 bytes of metadata, and the embedded lockfile alone is about 53 KB before compression,
so `pulumi up` checks the encoded size and stops before creating the instance if it is too large.

```
Internet
  │
  ├── :443 (HTTPS) ──▶ Caddy container (TLS termination, reverse proxy)
  │                         │
  │                         └──▶ auth container :3000 (FortressAuth API)
  │                                   │
  │                                   └──▶ postgres container :5432 (internal only)
  │                                               │
  │                                               └──▶ /mnt/data/postgres (block volume)
  │
  └── :22 (SSH) ──▶ VM (admin CIDRs only)

OCI Security List: TCP 443 ✓ | TCP 80 ✓ | TCP 22 (admin CIDRs) ✓ | TCP 5432 ✗ (never exposed)
```

All three containers share the `auth-net` Docker bridge network. Only Caddy exposes ports to the
host. Postgres is never reachable from outside the VM.
