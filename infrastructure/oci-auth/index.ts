// index.ts
// Entry point for the oci-auth-hosting Pulumi stack.
// Reads config, validates inputs, auto-generates secrets, and wires up components.

import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";
import { NetworkComponent } from "./network";
import { lookupUbuntu2404Arm64 } from "./utils";
import {
  isDnsLabel,
  isDomainName,
  isEmail,
  isHttpUrl,
  isIpv4Cidr,
  isTailscaleTag,
  parseCommaList,
  requireInteger,
  validateEmailProvider,
} from "./validation";
import { AuthVmComponent } from "./vm";

const config = new pulumi.Config();

// ── Non-secret config ──────────────────────────────────────────────────────
// Note: oci:region is read directly by the OCI provider from Pulumi config;
// we don't need to reference it explicitly in code.

// Required values — config.require() throws with a descriptive error if missing
// (Requirement 8.5)
const compartmentOcid = config.require("compartmentOcid");
const sshPublicKey = config.require("sshPublicKey");
const corsOrigins = config.require("corsOrigins");

// frontendUrl: the URL of the KytePDF frontend app (e.g. https://kytepdf.com).
// FortressAuth uses this as BASE_URL for email verification/reset links and
// OAuth success redirects — it must point to the frontend, NOT the auth API.
const frontendUrl = config.require("frontendUrl");

// adminCidrs: OPTIONAL — controls which IPs can SSH to the VM via the public IP.
// When using Tailscale SSH (recommended), this can be omitted — SSH is handled
// entirely over the Tailscale mesh and port 22 is not opened in the security list.
const adminCidrsRaw = config.get("adminCidrs");
const adminCidrs = adminCidrsRaw ? parseCommaList(adminCidrsRaw) : [];
const domain = config.get("domain") ?? "auth.kytepdf.com";
const ocpu = config.getNumber("ocpu") ?? 1;
const memoryGb = config.getNumber("memoryGb") ?? 6;
const availabilityDomainIndex = config.getNumber("availabilityDomainIndex") ?? 0;
// emailProvider: 'console' or 'resend'.
// 'console' logs emails to stdout — useful for initial bring-up before email is configured.
const emailProvider = config.get("emailProvider") ?? "console";
const enableGoogle = config.getBoolean("enableGoogle") ?? false;
const enableGithub = config.getBoolean("enableGithub") ?? false;
const enableBlockVol = config.getBoolean("enableBlockVolume") ?? true;
// OCI Always Free: 200 GB total across ALL block volumes (boot + data).
// Boot volume is fixed at 50 GB, so the data volume cap is 150 GB.
const blockVolSizeGb = config.getNumber("blockVolumeSizeGb") ?? 50;
const resendApiKey = config.getSecret("resendApiKey");
const resendFromAddress = config.get("resendFromAddress");
const googleClientId = config.get("googleClientId");
const githubClientId = config.get("githubClientId");
// trustedProxyHopCount: number of reverse-proxy hops in front of the auth container.
// Caddy is one hop, so the default is 1. Increase if behind an additional load balancer.
const trustedProxyHopCount = config.getNumber("trustedProxyHopCount") ?? 1;

// Tailscale: when set, installs Tailscale on the VM and enables Tailscale SSH.
// This removes the need for port 22 in the security list entirely.
// IMPORTANT: Use a single-use, non-reusable auth key. The key is embedded in
// OCI instance metadata (gzipped, base64 user-data), so a reusable key could be extracted
// and used to register additional nodes on your tailnet.
const tailscaleAuthKey = config.getSecret("tailscaleAuthKey");
// Tailscale hostname for the VM on your tailnet (default: kytepdf-auth)
const tailscaleHostname = config.get("tailscaleHostname") ?? "kytepdf-auth";
// Tailscale tag for ACL targeting (e.g. "tag:server"). Must be pre-defined in your
// Tailscale ACL policy with appropriate tagOwners. Leave empty to skip tagging.
const tailscaleTag = config.get("tailscaleTag") ?? "";

// Image OCID: use explicit override or auto-detect latest Ubuntu 24.04 ARM64
// lookupUbuntu2404Arm64 returns pulumi.Output<string>; config.get returns string | undefined.
// We unify both branches as pulumi.Input<string>.
const imageOcid: pulumi.Input<string> =
  config.get("imageOcid") ?? lookupUbuntu2404Arm64(compartmentOcid);

// ── Validation ─────────────────────────────────────────────────────────────
if (!isDomainName(domain)) {
  throw new Error(
    `Invalid 'domain' value: ${domain}. Must be a DNS hostname such as auth.kytepdf.com.`,
  );
}

if (!isHttpUrl(frontendUrl)) {
  throw new Error(`Invalid 'frontendUrl' value: ${frontendUrl}. Must be an http(s) URL.`);
}

const corsOriginList = parseCommaList(corsOrigins);
if (corsOriginList.length === 0 || corsOriginList.some((origin) => !isHttpUrl(origin))) {
  throw new Error("'corsOrigins' must contain one or more comma-separated http(s) origins.");
}

if (adminCidrs.length > 0) {
  for (const cidr of adminCidrs) {
    if (!isIpv4Cidr(cidr)) {
      throw new Error(
        `Invalid 'adminCidrs' entry: ${cidr}. Must be an IPv4 CIDR such as 203.0.113.10/32.`,
      );
    }
    if (cidr === "0.0.0.0/0") {
      throw new Error("'adminCidrs' must not include 0.0.0.0/0. Restrict SSH to known admin IPs.");
    }
  }
}

// Require at least one SSH access method
if (adminCidrs.length === 0 && !tailscaleAuthKey) {
  throw new Error(
    "Either 'adminCidrs' or 'tailscaleAuthKey' must be set. " +
      "Without one of these, you will have no way to SSH into the VM.",
  );
}

requireInteger("ocpu", ocpu, 1, 4);
requireInteger("memoryGb", memoryGb, 6, 24);
requireInteger("availabilityDomainIndex", availabilityDomainIndex, 0, 2);
requireInteger("blockVolumeSizeGb", blockVolSizeGb, 1, 150);
requireInteger("trustedProxyHopCount", trustedProxyHopCount, 0, 8);

// Validate Tailscale hostname (DNS-safe: alphanumeric + hyphens, max 63 chars)
if (!isDnsLabel(tailscaleHostname)) {
  throw new Error(
    `Invalid 'tailscaleHostname' value: ${tailscaleHostname}. ` +
      `Must be DNS-safe (alphanumeric + hyphens, 1–63 chars, no leading/trailing hyphen).`,
  );
}

// Validate Tailscale tag format if provided
if (tailscaleTag && !isTailscaleTag(tailscaleTag)) {
  throw new Error(
    `Invalid 'tailscaleTag' value: ${tailscaleTag}. Must be in the format 'tag:<name>' (e.g. 'tag:server').`,
  );
}

validateEmailProvider(emailProvider);

if (emailProvider === "resend") {
  if (!resendApiKey) {
    throw new Error("'resendApiKey' (secret) is required when emailProvider is 'resend'.");
  }
  if (!resendFromAddress) {
    throw new Error(
      "'resendFromAddress' is required when emailProvider is 'resend' " +
        "(e.g. 'noreply@kytepdf.com').",
    );
  }
  if (!isEmail(resendFromAddress)) {
    throw new Error("'resendFromAddress' must be a valid email address.");
  }
}

// Validate OAuth client IDs when providers are enabled (Requirement 8.2, 8.3)
if (enableGoogle && !googleClientId) {
  throw new Error("'googleClientId' is required when 'enableGoogle' is true.");
}
if (enableGithub && !githubClientId) {
  throw new Error("'githubClientId' is required when 'enableGithub' is true.");
}

// ── Secrets ────────────────────────────────────────────────────────────────
// Auto-generate postgres password if not supplied.
// RandomPassword is stable across runs — Pulumi tracks it in state.
// (Requirement 6.3)
const generatedPgPassword = new random.RandomPassword("pg-password", {
  length: 32,
  special: false,
});
const postgresPassword: pulumi.Output<string> =
  config.getSecret("postgresPassword") ?? pulumi.secret(generatedPgPassword.result);

// Auto-generate backup passphrase if not supplied (Requirement 6.4)
const generatedBackupPassphrase = new random.RandomPassword("backup-passphrase", {
  length: 48,
  special: false,
});
const backupPassphrase: pulumi.Output<string> =
  config.getSecret("backupPassphrase") ?? pulumi.secret(generatedBackupPassphrase.result);

// OAuth secrets — only required when the corresponding provider is enabled.
// config.requireSecret() throws with a descriptive error if the key is missing.
// (Requirement 8.2, 8.3)
const googleClientSecret: pulumi.Output<string> | undefined = enableGoogle
  ? config.requireSecret("googleClientSecret")
  : undefined;

const githubClientSecret: pulumi.Output<string> | undefined = enableGithub
  ? config.requireSecret("githubClientSecret")
  : undefined;

// ── Components ─────────────────────────────────────────────────────────────
const network = new NetworkComponent("auth", {
  compartmentId: compartmentOcid,
  adminCidrs,
});

const vm = new AuthVmComponent("auth", {
  compartmentId: compartmentOcid,
  subnetId: network.subnetId,
  imageOcid,
  sshPublicKey,
  ocpu,
  memoryGb,
  availabilityDomainIndex,
  enableBlockVolume: enableBlockVol,
  blockVolumeSizeGb: blockVolSizeGb,
  postgresPassword,
  backupPassphrase,
  googleClientSecret,
  githubClientSecret,
  resendApiKey,
  domain,
  frontendUrl,
  emailProvider,
  resendFromAddress,
  googleClientId,
  githubClientId,
  corsOrigins,
  trustedProxyHopCount,
  tailscaleAuthKey,
  tailscaleHostname,
  tailscaleTag,
});

// ── Stack Outputs ──────────────────────────────────────────────────────────
// IMPORTANT: postgresPassword, backupPassphrase, googleClientSecret, and
// githubClientSecret are intentionally NOT exported. (Requirement 6.2)
export const reservedIp = vm.reservedIp;
export const instanceId = vm.instanceId;
export const dnsInstruction = pulumi.interpolate`Create DNS A record: ${domain} → ${vm.reservedIp}`;
export const sshCommand = tailscaleAuthKey
  ? `ssh ubuntu@${tailscaleHostname}`
  : pulumi.interpolate`ssh -i ~/.ssh/kytepdf_oci ubuntu@${vm.reservedIp}`;
