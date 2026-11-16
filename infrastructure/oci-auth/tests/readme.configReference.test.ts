/**
 * Every config key index.ts reads must have a row in the README's Config
 * Reference table, and every key that index.ts reads as a secret must be
 * marked secret there. Without this, a key such as resendApiKey can be
 * required at deploy time yet appear nowhere in the setup docs.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { OCI_DIR } from "../parity/paths.js";

const indexSource = readFileSync(resolve(OCI_DIR, "index.ts"), "utf8");
const readme = readFileSync(resolve(OCI_DIR, "README.md"), "utf8");

const CONFIG_READ_RE =
  /\bconfig\.(get|require|getSecret|requireSecret|getNumber|getBoolean)\(\s*"([A-Za-z0-9_]+)"/g;

/** Keys index.ts reads, and whether it reads each one as a secret. */
function keysReadByIndex(): Map<string, boolean> {
  const keys = new Map<string, boolean>();
  for (const [, method, key] of indexSource.matchAll(CONFIG_READ_RE)) {
    const secret = method === "getSecret" || method === "requireSecret";
    keys.set(key, (keys.get(key) ?? false) || secret);
  }
  return keys;
}

/** Rows of the Config Reference table: key -> the row's Secret column. */
function configReferenceRows(): Map<string, string> {
  const start = readme.indexOf("## Config Reference");
  expect(start, "README has no '## Config Reference' section").toBeGreaterThanOrEqual(0);
  const section = readme.slice(start).split(/\n#{2,3} (?!Config Reference)/)[0];

  const rows = new Map<string, string>();
  for (const line of section.split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    const key = /^`([^`]+)`$/.exec(cells[1] ?? "")?.[1];
    if (key) rows.set(key, cells[4] ?? "");
  }
  return rows;
}

describe("README Config Reference matches the keys index.ts reads", () => {
  const keys = keysReadByIndex();
  const rows = configReferenceRows();

  it("finds the config reads in index.ts (guards the pattern itself)", () => {
    expect(keys.get("resendApiKey")).toBe(true);
    expect(keys.get("resendFromAddress")).toBe(false);
    expect(keys.size).toBeGreaterThan(20);
  });

  it("documents every key index.ts reads", () => {
    const missing = [...keys.keys()].filter((key) => !rows.has(key));
    expect(missing).toEqual([]);
  });

  it("marks every key index.ts reads as a secret as secret in the table", () => {
    const notMarked = [...keys]
      .filter(([key, secret]) => secret && !/yes/i.test(rows.get(key) ?? ""))
      .map(([key]) => key);
    expect(notMarked).toEqual([]);
  });

  it("shows how to set the Resend keys next to emailProvider resend in the setup steps", () => {
    expect(readme).toContain("pulumi config set emailProvider resend");
    expect(readme).toMatch(/pulumi config set --secret resendApiKey \S+/);
    expect(readme).toMatch(/pulumi config set resendFromAddress \S+@\S+/);
  });
});
