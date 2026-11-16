import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { icons } from "lucide";
import { describe, expect, it } from "vitest";
import { APP_ICONS } from "../../utils/appIcons";

/** Every icon name the app asks lucide for, from data-lucide attributes and tool definitions. */
function iconNamesInSource(): string[] {
  const names = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|html)$/.test(entry)) {
        const text = readFileSync(path, "utf8");
        for (const match of text.matchAll(/data-lucide="([a-z0-9-]+)"|icon: "([a-z0-9-]+)"/g)) {
          names.add(match[1] ?? match[2]);
        }
      }
    }
  };
  for (const dir of ["components", "utils"]) walk(dir);
  for (const file of ["index.html", "main.ts"]) {
    for (const match of readFileSync(file, "utf8").matchAll(/data-lucide="([a-z0-9-]+)"/g)) {
      names.add(match[1]);
    }
  }
  return [...names].sort();
}

/** The key lucide's createIcons() looks a data-lucide name up by: "edit-3" -> "Edit3". */
const pascalCase = (name: string) =>
  name
    .split("-")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");

describe("lucide icons", () => {
  const names = iconNamesInSource();

  it("finds the icons the app uses", () => {
    expect(names.length).toBeGreaterThan(10);
    expect(names).toContain("file-text");
  });

  it("registers every icon the app uses in its own icon set", () => {
    // createIcons() silently skips a name missing from the set it is given,
    // so an icon used without adding it to utils/appIcons.ts would vanish.
    const missing = names.filter((name) => !(pascalCase(name) in APP_ICONS));
    expect(missing).toEqual([]);
  });

  it("registers no icon the app does not use", () => {
    // Each one adds to the bundle; remove it from utils/appIcons.ts.
    const used = new Set(names.map(pascalCase));
    const unused = Object.keys(APP_ICONS).filter((key) => !used.has(key));
    expect(unused).toEqual([]);
  });

  it("registers real lucide icons", () => {
    // lucide 1.0 dropped brand logos; a renamed or removed icon imports as undefined.
    for (const [key, node] of Object.entries(APP_ICONS)) {
      expect(node, key).toBe((icons as Record<string, unknown>)[key]);
      expect(Array.isArray(node), key).toBe(true);
    }
  });
});
