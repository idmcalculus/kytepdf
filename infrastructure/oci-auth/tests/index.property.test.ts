/**
 * Tests for the config checks index.ts runs (validation.ts).
 *
 * The defaults and README examples must pass: a stray space in a regex
 * quantifier (`{1, 253}`) or a `split(", ")` once rejected every default
 * config. tests/pulumi.loader.test.ts runs index.ts itself with these values.
 *
 * **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5**
 */

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  isDnsLabel,
  isDomainName,
  isEmail,
  isHttpUrl,
  isIpv4Cidr,
  isTailscaleTag,
  parseCommaList,
  requireInteger,
} from "../validation.js";

describe("isDomainName", () => {
  it.each([
    "auth.kytepdf.com", // index.ts default
    "auth.example.com", // README example
    "a.io",
    `${"a".repeat(63)}.com`,
  ])("accepts %s", (domain) => {
    expect(isDomainName(domain)).toBe(true);
  });

  it.each([
    "localhost",
    "-auth.kytepdf.com",
    "auth kytepdf.com",
    "https://auth.kytepdf.com",
    `${"a".repeat(64)}.com`,
    `${"a.".repeat(126)}com`, // 255 chars, over the 253 limit
    "",
  ])("rejects %j", (domain) => {
    expect(isDomainName(domain)).toBe(false);
  });
});

describe("isDnsLabel (tailscaleHostname)", () => {
  it.each(["kytepdf-auth", "a", "A1", "a".repeat(63)])("accepts %s", (label) => {
    expect(isDnsLabel(label)).toBe(true);
  });

  it.each(["-a", "a-", "a.b", "a_b", "", "a".repeat(64)])("rejects %j", (label) => {
    expect(isDnsLabel(label)).toBe(false);
  });

  it("accepts every 1–63 char label of letters, digits and inner hyphens", () => {
    const alnum = fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789".split(""));
    const inner = fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-".split(""));
    fc.assert(
      fc.property(alnum, fc.array(inner, { maxLength: 61 }), alnum, (first, middle, last) => {
        expect(isDnsLabel(first)).toBe(true);
        expect(isDnsLabel(`${first}${middle.join("")}${last}`)).toBe(true);
      }),
    );
  });
});

describe("parseCommaList (adminCidrs, corsOrigins)", () => {
  it("splits the README adminCidrs example, which has no spaces", () => {
    expect(parseCommaList("203.0.113.10/32,198.51.100.0/24")).toEqual([
      "203.0.113.10/32",
      "198.51.100.0/24",
    ]);
  });

  it("trims spaces and drops empty entries", () => {
    expect(parseCommaList(" https://kytepdf.com , ,https://www.kytepdf.com,")).toEqual([
      "https://kytepdf.com",
      "https://www.kytepdf.com",
    ]);
  });

  it("returns the same entries however the commas are spaced", () => {
    const entry = fc.stringMatching(/^[a-z0-9./:]{1,20}$/);
    fc.assert(
      fc.property(fc.array(entry, { minLength: 1, maxLength: 5 }), fc.nat(3), (entries, pad) => {
        const sep = `${" ".repeat(pad)},${" ".repeat(pad)}`;
        expect(parseCommaList(entries.join(sep))).toEqual(entries);
      }),
    );
  });
});

describe("isIpv4Cidr", () => {
  it.each(["203.0.113.10/32", "198.51.100.0/24", "0.0.0.0/0"])("accepts %s", (cidr) => {
    expect(isIpv4Cidr(cidr)).toBe(true);
  });

  it.each(["203.0.113.10/32,198.51.100.0/24", "203.0.113.10", "203.0.113.10/33", "::1/128"])(
    "rejects %j",
    (cidr) => {
      expect(isIpv4Cidr(cidr)).toBe(false);
    },
  );

  it("accepts every entry of the README adminCidrs example once split", () => {
    expect(parseCommaList("203.0.113.10/32,198.51.100.0/24").every(isIpv4Cidr)).toBe(true);
  });
});

describe("other checks", () => {
  it("isHttpUrl accepts http(s) URLs only", () => {
    expect(isHttpUrl("https://kytepdf.com")).toBe(true);
    expect(isHttpUrl("http://localhost:5173")).toBe(true);
    expect(isHttpUrl("ftp://kytepdf.com")).toBe(false);
    expect(isHttpUrl("kytepdf.com")).toBe(false);
  });

  it("isEmail accepts the README sender address", () => {
    expect(isEmail("noreply@kytepdf.com")).toBe(true);
    expect(isEmail("noreply@kytepdf")).toBe(false);
  });

  it("isTailscaleTag accepts tag:<name> only", () => {
    expect(isTailscaleTag("tag:server")).toBe(true);
    expect(isTailscaleTag("server")).toBe(false);
  });

  it("requireInteger enforces an inclusive integer range", () => {
    expect(() => requireInteger("ocpu", 1, 1, 4)).not.toThrow();
    expect(() => requireInteger("ocpu", 4, 1, 4)).not.toThrow();
    expect(() => requireInteger("ocpu", 5, 1, 4)).toThrow(/ocpu/);
    expect(() => requireInteger("ocpu", 1.5, 1, 4)).toThrow(/integer/);
  });
});
