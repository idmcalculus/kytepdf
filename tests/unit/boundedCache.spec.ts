import { describe, expect, it } from "vitest";
import { BoundedMap } from "../../utils/boundedCache";

describe("BoundedMap", () => {
  it("behaves like a normal Map under the cap", () => {
    const map = new BoundedMap<string, number>(3);
    map.set("a", 1);
    map.set("b", 2);
    expect(map.size).toBe(2);
    expect(map.get("a")).toBe(1);
    expect(map.get("b")).toBe(2);
  });

  it("evicts the oldest entry once the cap is exceeded", () => {
    const map = new BoundedMap<string, number>(2);
    map.set("a", 1);
    map.set("b", 2);
    map.set("c", 3);

    expect(map.size).toBe(2);
    expect(map.has("a")).toBe(false); // oldest entry evicted
    expect(map.get("b")).toBe(2);
    expect(map.get("c")).toBe(3);
  });

  it("does not evict when overwriting an existing key", () => {
    const map = new BoundedMap<string, number>(2);
    map.set("a", 1);
    map.set("b", 2);
    map.set("a", 99); // update, not a new entry — must not trigger eviction

    expect(map.size).toBe(2);
    expect(map.get("a")).toBe(99);
    expect(map.get("b")).toBe(2);
  });

  it("never grows past the configured cap across many inserts", () => {
    const map = new BoundedMap<number, number>(5);
    for (let i = 0; i < 50; i++) {
      map.set(i, i * 2);
    }
    expect(map.size).toBe(5);
    // Only the most recent 5 keys should survive.
    expect([...map.keys()]).toEqual([45, 46, 47, 48, 49]);
  });
});
