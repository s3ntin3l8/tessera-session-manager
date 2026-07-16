import { describe, it, expect } from "vitest";
import { deepMerge } from "../../src/services/settings.js";

describe("deepMerge", () => {
  it("ignores __proto__/constructor/prototype keys instead of writing through them", () => {
    // JSON.parse builds these as ordinary own-enumerable keys, so a PATCH
    // body reaching deepMerge is an attacker-controlled Object.entries()
    // source — this is the shape a prototype-pollution payload takes.
    const patch = JSON.parse('{"__proto__":{"polluted":"yes"},"theme":"light"}') as unknown;

    const result = deepMerge({ theme: "dark" }, patch) as Record<string, unknown>;

    expect(result.theme).toBe("light");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype as Record<string, unknown>).not.toHaveProperty("polluted");
  });

  it("merges nested plain objects while leaving unrelated sibling keys untouched", () => {
    const base = { a: { x: 1, y: 2 }, b: "unchanged" };
    const result = deepMerge(base, { a: { x: 9 } });
    expect(result).toEqual({ a: { x: 9, y: 2 }, b: "unchanged" });
  });

  it("replaces arrays outright rather than merging element-wise", () => {
    const base = { list: [1, 2, 3] };
    const result = deepMerge(base, { list: [] });
    expect(result.list).toEqual([]);
  });
});
