import { describe, it, expect } from "vitest";
import fastifyCookie from "@fastify/cookie";
import {
  createSessionCookieValue,
  hasValidBearerToken,
  hasValidSessionCookie,
  isAuthEnabled,
  isRequestAuthenticated,
  isValidLoginToken,
  SESSION_COOKIE_NAME,
} from "../../src/services/auth.js";

const SECRET = "test-session-secret-abcdef123456";
const TOKEN = "test-auth-token-abcdef123456";

function cookieHeader(value: string, name = SESSION_COOKIE_NAME) {
  return `${name}=${value}`;
}

describe("isAuthEnabled", () => {
  it("is false with an empty token (the default — 'rely on the gateway')", () => {
    expect(isAuthEnabled({ TESSERA_AUTH_TOKEN: "", TESSERA_SESSION_SECRET: "" })).toBe(false);
  });

  it("is false for a whitespace-only token", () => {
    expect(isAuthEnabled({ TESSERA_AUTH_TOKEN: "   ", TESSERA_SESSION_SECRET: "" })).toBe(false);
  });

  it("is true once a token is set", () => {
    expect(isAuthEnabled({ TESSERA_AUTH_TOKEN: TOKEN, TESSERA_SESSION_SECRET: SECRET })).toBe(true);
  });
});

describe("createSessionCookieValue / hasValidSessionCookie", () => {
  it("round-trips: a freshly minted cookie validates against the same secret", () => {
    const value = createSessionCookieValue(SECRET);
    expect(hasValidSessionCookie(SECRET, cookieHeader(value))).toBe(true);
  });

  it("rejects when secret is empty — never trusts an unsigned/unsignable cookie", () => {
    const value = createSessionCookieValue(SECRET);
    expect(hasValidSessionCookie("", cookieHeader(value))).toBe(false);
  });

  it("rejects a cookie signed with a different secret", () => {
    const value = createSessionCookieValue("a-completely-different-secret-value");
    expect(hasValidSessionCookie(SECRET, cookieHeader(value))).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const value = createSessionCookieValue(SECRET);
    expect(hasValidSessionCookie(SECRET, cookieHeader(`${value}x`))).toBe(false);
  });

  it("rejects a missing Cookie header entirely", () => {
    expect(hasValidSessionCookie(SECRET, undefined)).toBe(false);
  });

  it("rejects a Cookie header without the session cookie name present", () => {
    expect(hasValidSessionCookie(SECRET, "other=value; another=thing")).toBe(false);
  });

  it("rejects malformed percent-encoding in the cookie value", () => {
    // decodeURIComponent throws on a lone/invalid "%" escape.
    expect(hasValidSessionCookie(SECRET, cookieHeader("%E0%A4%A"))).toBe(false);
  });

  it("rejects a validly-signed value whose decoded payload isn't valid JSON", () => {
    // Sign a payload that fastifyCookie.unsign will accept (valid signature),
    // but that isn't the base64url-encoded JSON hasValidSessionCookie
    // expects — proves a signature alone isn't enough to be trusted.
    const garbage = fastifyCookie.sign("not-valid-base64url-json", SECRET);
    expect(hasValidSessionCookie(SECRET, cookieHeader(garbage))).toBe(false);
  });

  it("rejects a validly-signed payload missing authenticated: true", () => {
    const encoded = Buffer.from(JSON.stringify({ issuedAt: Date.now() })).toString("base64url");
    const signed = fastifyCookie.sign(encoded, SECRET);
    expect(hasValidSessionCookie(SECRET, cookieHeader(signed))).toBe(false);
  });

  it("rejects an expired session (older than the 30-day max age)", () => {
    const THIRTY_ONE_DAYS_MS = 31 * 24 * 60 * 60 * 1000;
    const encoded = Buffer.from(
      JSON.stringify({ authenticated: true, issuedAt: Date.now() - THIRTY_ONE_DAYS_MS }),
    ).toString("base64url");
    const signed = fastifyCookie.sign(encoded, SECRET);
    expect(hasValidSessionCookie(SECRET, cookieHeader(signed))).toBe(false);
  });

  it("finds the session cookie among other cookies in the same header", () => {
    const value = createSessionCookieValue(SECRET);
    expect(hasValidSessionCookie(SECRET, `foo=bar; ${cookieHeader(value)}; baz=qux`)).toBe(true);
  });
});

describe("hasValidBearerToken", () => {
  it("accepts a matching Bearer header", () => {
    expect(hasValidBearerToken(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
  });

  it("rejects a mismatched token", () => {
    expect(hasValidBearerToken("Bearer wrong-token", TOKEN)).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(hasValidBearerToken(undefined, TOKEN)).toBe(false);
  });

  it("rejects a header without the Bearer prefix", () => {
    expect(hasValidBearerToken(TOKEN, TOKEN)).toBe(false);
  });

  it("rejects when the expected token is empty (auth not actually enabled)", () => {
    expect(hasValidBearerToken(`Bearer ${TOKEN}`, "")).toBe(false);
  });
});

describe("isValidLoginToken", () => {
  it("accepts the configured token", () => {
    expect(
      isValidLoginToken(TOKEN, { TESSERA_AUTH_TOKEN: TOKEN, TESSERA_SESSION_SECRET: SECRET }),
    ).toBe(true);
  });

  it("rejects a wrong token", () => {
    expect(
      isValidLoginToken("wrong", { TESSERA_AUTH_TOKEN: TOKEN, TESSERA_SESSION_SECRET: SECRET }),
    ).toBe(false);
  });

  it("rejects any token when none is configured", () => {
    expect(isValidLoginToken("", { TESSERA_AUTH_TOKEN: "", TESSERA_SESSION_SECRET: SECRET })).toBe(
      false,
    );
  });
});

describe("isRequestAuthenticated", () => {
  const config = { TESSERA_AUTH_TOKEN: TOKEN, TESSERA_SESSION_SECRET: SECRET };

  it("accepts a valid session cookie alone", () => {
    const value = createSessionCookieValue(SECRET);
    expect(isRequestAuthenticated({ cookie: cookieHeader(value) }, config)).toBe(true);
  });

  it("accepts a valid bearer token alone", () => {
    expect(isRequestAuthenticated({ authorization: `Bearer ${TOKEN}` }, config)).toBe(true);
  });

  it("rejects when neither credential is present", () => {
    expect(isRequestAuthenticated({}, config)).toBe(false);
  });

  it("rejects an invalid cookie and a missing bearer header together", () => {
    expect(isRequestAuthenticated({ cookie: cookieHeader("garbage") }, config)).toBe(false);
  });
});
