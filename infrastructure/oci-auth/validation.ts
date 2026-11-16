// validation.ts
// Config checks used by index.ts. This module imports nothing from Pulumi, so
// tests can load it without a Pulumi engine or stack config.

import { isIP } from "node:net";

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** A DNS name with at least two labels, such as auth.kytepdf.com (at most 253 chars). */
export function isDomainName(value: string): boolean {
  return /^(?=.{1,253}$)(?!-)(?:[a-zA-Z0-9-]{1,63}\.)+[a-zA-Z]{2,63}$/.test(value);
}

export function isIpv4Cidr(value: string): boolean {
  const parts = value.split("/");
  if (parts.length !== 2) return false;
  const prefix = Number(parts[1]);
  return isIP(parts[0]) === 4 && Number.isInteger(prefix) && prefix >= 0 && prefix <= 32;
}

/** One DNS label: letters, digits and hyphens, 1–63 chars, no leading or trailing hyphen. */
export function isDnsLabel(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(value);
}

/** A Tailscale ACL tag such as tag:server. */
export function isTailscaleTag(value: string): boolean {
  return /^tag:[a-z0-9-]+$/.test(value);
}

/** Split a comma-separated config value. Spaces around entries and empty entries are dropped. */
export function parseCommaList(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function requireInteger(name: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(
      `Invalid '${name}' value: ${value}. Must be an integer between ${min} and ${max} (inclusive).`,
    );
  }
}

export const SUPPORTED_EMAIL_PROVIDERS = ["console", "resend"] as const;
export type EmailProvider = (typeof SUPPORTED_EMAIL_PROVIDERS)[number];

export function validateEmailProvider(provider: string): asserts provider is EmailProvider {
  if (!(SUPPORTED_EMAIL_PROVIDERS as readonly string[]).includes(provider)) {
    throw new Error(
      `Invalid 'emailProvider' value: '${provider}'. ` +
        `Must be one of: ${SUPPORTED_EMAIL_PROVIDERS.join(", ")}.`,
    );
  }
}
