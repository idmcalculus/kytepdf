/**
 * Tests for the instance metadata user_data encoding.
 *
 * OCI rejects LaunchInstance when metadata and extendedMetadata together exceed
 * 32,000 bytes. The cloud-init YAML embeds auth-server/package-lock.json, so
 * plain base64 comes to about 100 KB. These tests render with the real
 * auth-server files and the largest config, and fail if the encoded metadata
 * would not fit.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import type { RenderArgs } from "../cloudinit.js";
import {
  assertMetadataWithinLimit,
  encodeUserData,
  OCI_METADATA_MAX_BYTES,
  renderCloudInit,
} from "../cloudinit.js";
import { AUTH_SERVER_DIR } from "../parity/paths.js";

/** Every optional value set, at realistic or generous lengths. */
function largestRenderArgs(): RenderArgs {
  return {
    pgPass: "p".repeat(32),
    backupPass: "b".repeat(48),
    googleSecret: "g".repeat(64),
    githubSecret: "h".repeat(64),
    resendApiKey: `re_${"k".repeat(60)}`,
    domain: "auth.kytepdf.com",
    frontendUrl: "https://kytepdf.com",
    emailProvider: "resend",
    resendFromAddress: "noreply@kytepdf.com",
    googleClientId: `${"1".repeat(80)}.apps.googleusercontent.com`,
    githubClientId: `Iv1.${"a".repeat(16)}`,
    corsOrigins: "https://kytepdf.com,https://www.kytepdf.com",
    enableBlockVolume: true,
    trustedProxyHopCount: 1,
    tailscaleAuthKey: `tskey-auth-${"z".repeat(60)}`,
    tailscaleHostname: "kytepdf-auth",
    tailscaleTag: "tag:server",
    authPackageJson: readFileSync(resolve(AUTH_SERVER_DIR, "package.json"), "utf8"),
    authPackageLock: readFileSync(resolve(AUTH_SERVER_DIR, "package-lock.json"), "utf8"),
  };
}

/** About the size of an RSA-4096 public key line, the largest common SSH key. */
const LARGE_SSH_KEY = `ssh-rsa ${"A".repeat(716)} user@workstation.example.com`;

describe("encodeUserData", () => {
  it("round-trips: base64-decode then gunzip gives back the exact YAML", () => {
    const yaml = renderCloudInit(largestRenderArgs());
    const decoded = gunzipSync(Buffer.from(encodeUserData(yaml), "base64")).toString("utf8");
    expect(decoded).toBe(yaml);
  });

  it("keeps the largest real config within OCI's metadata limit, with room to spare", () => {
    const encoded = encodeUserData(renderCloudInit(largestRenderArgs()));
    const size = assertMetadataWithinLimit({
      ssh_authorized_keys: LARGE_SSH_KEY,
      user_data: encoded,
    });

    // Measured at about 15.3 KB. Fail well before the limit so a growing
    // lockfile shows up here rather than at LaunchInstance.
    expect(size).toBeLessThan(OCI_METADATA_MAX_BYTES * 0.75);
  });

  it("would be over the limit without gzip (the reason it is compressed)", () => {
    const yaml = renderCloudInit(largestRenderArgs());
    const plain = Buffer.from(yaml, "utf8").toString("base64");
    expect(() =>
      assertMetadataWithinLimit({ ssh_authorized_keys: LARGE_SSH_KEY, user_data: plain }),
    ).toThrow(/32000-byte limit/);
  });

  it("produces the same bytes on every OS (gzip header OS byte fixed to Unix)", () => {
    const yaml = renderCloudInit(largestRenderArgs());
    const gz = Buffer.from(encodeUserData(yaml), "base64");
    expect(gz[0]).toBe(0x1f);
    expect(gz[1]).toBe(0x8b);
    expect(gz[9]).toBe(0x03);
    expect(encodeUserData(yaml)).toBe(encodeUserData(yaml));
  });
});

describe("assertMetadataWithinLimit", () => {
  it("counts keys and JSON quoting, and allows exactly the limit", () => {
    // {"k":"<v>"} is 8 bytes of JSON around the value.
    const atLimit = { k: "x".repeat(OCI_METADATA_MAX_BYTES - 8) };
    expect(assertMetadataWithinLimit(atLimit)).toBe(OCI_METADATA_MAX_BYTES);
    expect(() => assertMetadataWithinLimit({ k: `${atLimit.k}x` })).toThrow(/32001 bytes/);
  });
});
