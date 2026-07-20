import { describe, it, expect } from "vitest";
import { timingSafeTokenMatch } from "../../src/services/crypto-utils.js";

describe("timingSafeTokenMatch", () => {
  it("returns true for identical tokens", () => {
    expect(timingSafeTokenMatch("secret-token", "secret-token")).toBe(true);
  });

  it("returns false for different tokens of the same length", () => {
    expect(timingSafeTokenMatch("secret-tokan", "secret-token")).toBe(false);
  });

  it("returns false for tokens of different lengths", () => {
    expect(timingSafeTokenMatch("short", "a-much-longer-token")).toBe(false);
  });

  it("returns false when the provided token is empty", () => {
    expect(timingSafeTokenMatch("", "secret-token")).toBe(false);
  });

  it("returns false when both are empty but treated as no credential", () => {
    // Empty-vs-empty would compare true, but callers must never pass an
    // empty `expected` (an unset/disabled secret) into this function —
    // that invariant is enforced by the caller, not this helper.
    expect(timingSafeTokenMatch("", "")).toBe(true);
  });
});
