import type { IncomingHttpHeaders } from "node:http";
import fastifyCookie from "@fastify/cookie";
import { timingSafeTokenMatch } from "./crypto-utils.js";

// Deliberately not a Fastify plugin — pure logic, importable from both
// src/plugins/auth.ts's onRequest hook (a real FastifyRequest) and, if a
// future caller needs it, any raw node:http request/response pair (a
// FastifyRequest's .headers is structurally the same IncomingHttpHeaders a
// raw request has). See src/plugins/preview-proxy.ts's own comment on why
// its WS upgrade path bypasses Fastify's request lifecycle entirely — this
// module's functions don't assume that lifecycle exists.

export const SESSION_COOKIE_NAME = "tessera_session";

// A signed, but NOT encrypted, cookie (see createSessionCookieValue) — HMAC
// via @fastify/cookie's sign/unsign gives integrity (the browser can't forge
// or tamper with it) but not confidentiality (the payload is base64, not
// encrypted, so treat it as client-readable). Fine for today's
// `{ authenticated: true }` payload; issue #30 (native OIDC) adding identity
// claims here should keep that in mind rather than assume opacity.
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const SESSION_MAX_AGE_SECONDS = SESSION_MAX_AGE_MS / 1000;

interface SessionPayload {
  authenticated: true;
  issuedAt: number;
}

// The subset of app.config this module needs — kept as its own interface
// (rather than importing Fastify's `config` augmentation) so this stays
// framework-agnostic. Phase 2 (issue #30) will extend both this and
// isAuthEnabled with OIDC fields.
export interface AuthConfig {
  TESSERA_AUTH_TOKEN: string;
  TESSERA_SESSION_SECRET: string;
}

/**
 * Whether in-process auth is switched on at all. Empty TESSERA_AUTH_TOKEN
 * (the default) means "rely on the gateway/network, same as before this
 * feature existed" — see that key's doc in src/plugins/env.ts. Phase 2 will
 * OR in an OIDC-configured check here so either credential alone is enough
 * to turn the gate on.
 */
export function isAuthEnabled(config: AuthConfig): boolean {
  return config.TESSERA_AUTH_TOKEN.trim() !== "";
}

/** Mint a signed session cookie value for a Set-Cookie header after login. */
export function createSessionCookieValue(secret: string): string {
  const payload: SessionPayload = { authenticated: true, issuedAt: Date.now() };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return fastifyCookie.sign(encoded, secret);
}

function parseCookieHeader(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const rawValue = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Verify a request's session cookie against `secret` — a pure function of
 * (secret, raw Cookie header) rather than @fastify/cookie's request
 * decorators, which only exist on a real FastifyRequest. Returns false (not
 * just "invalid") whenever secret is empty, matching TESSERA_SESSION_SECRET's
 * "auth enabled but no secret configured" boot-time refusal in src/app.ts —
 * this function never trusts an unsigned/unsignable cookie.
 */
export function hasValidSessionCookie(secret: string, cookieHeader: string | undefined): boolean {
  if (secret === "") return false;
  const raw = parseCookieHeader(cookieHeader, SESSION_COOKIE_NAME);
  if (!raw) return false;

  const result = fastifyCookie.unsign(raw, secret);
  if (!result.valid || result.value === null) return false;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(result.value, "base64url").toString("utf8")) as SessionPayload;
  } catch {
    return false;
  }
  if (payload.authenticated !== true || typeof payload.issuedAt !== "number") return false;
  return Date.now() - payload.issuedAt <= SESSION_MAX_AGE_MS;
}

/** Bearer-token check, reusing the same constant-time compare the agent-role internal API uses. */
export function hasValidBearerToken(
  authorizationHeader: string | undefined,
  expectedToken: string,
): boolean {
  if (expectedToken === "") return false;
  const provided = authorizationHeader?.startsWith("Bearer ")
    ? authorizationHeader.slice("Bearer ".length)
    : "";
  return timingSafeTokenMatch(provided, expectedToken);
}

/** POST /api/auth/login's own check — same constant-time compare, body-token shaped. */
export function isValidLoginToken(provided: string, config: AuthConfig): boolean {
  if (config.TESSERA_AUTH_TOKEN === "") return false;
  return timingSafeTokenMatch(provided, config.TESSERA_AUTH_TOKEN);
}

/**
 * The single "is this request allowed through the gate" decision, shared by
 * src/plugins/auth.ts's global onRequest hook. Accepts either credential: a
 * valid session cookie (how the browser SPA authenticates after POST
 * /api/auth/login) or a valid Bearer header (keeps curl/scripts working, and
 * is the only option available to a caller that can't hold cookies).
 */
export function isRequestAuthenticated(
  headers: Pick<IncomingHttpHeaders, "cookie" | "authorization">,
  config: AuthConfig,
): boolean {
  if (hasValidSessionCookie(config.TESSERA_SESSION_SECRET, headers.cookie)) return true;
  return hasValidBearerToken(headers.authorization, config.TESSERA_AUTH_TOKEN);
}
