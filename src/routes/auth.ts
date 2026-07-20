import type { FastifyInstance } from "fastify";
import {
  createSessionCookieValue,
  isAuthEnabled,
  isRequestAuthenticated,
  isValidLoginToken,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from "../services/auth.js";

const loginSchema = {
  body: {
    type: "object",
    required: ["token"],
    properties: {
      token: { type: "string" },
    },
  },
};

// All three routes live under /api/auth/ — src/plugins/auth.ts's onRequest
// gate deliberately exempts that whole prefix (see its own comment), since
// a request can't authenticate itself against a gate that also blocks the
// one endpoint that authenticates it. GET /api/auth/me is what the frontend
// polls on load to decide whether to render the dashboard or a login view
// (see App.tsx) — reachable unauthenticated by design.
export async function authRoute(app: FastifyInstance) {
  app.post<{ Body: { token: string } }>(
    "/api/auth/login",
    { schema: loginSchema },
    async (request, reply) => {
      if (!isValidLoginToken(request.body.token, app.config)) {
        return reply.unauthorized("invalid token");
      }

      reply.setCookie(
        SESSION_COOKIE_NAME,
        createSessionCookieValue(app.config.TESSERA_SESSION_SECRET),
        {
          httpOnly: true,
          sameSite: "lax",
          // Traefik terminates TLS and talks plain HTTP to this process
          // internally (see src/plugins/security.ts's own CSP comment on the
          // same deployment model) — Secure governs what the *browser* sends
          // based on the origin it sees (https, once Traefik is in front), not
          // this internal hop, so it's safe to require in production. In dev
          // (plain http://localhost) requiring it would silently drop the
          // cookie, so it's off outside production.
          secure: app.config.NODE_ENV === "production",
          path: "/",
          maxAge: SESSION_MAX_AGE_SECONDS,
        },
      );
      reply.code(204);
    },
  );

  app.post("/api/auth/logout", async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    reply.code(204);
  });

  app.get("/api/auth/me", async (request) => {
    const enabled = isAuthEnabled(app.config);
    return {
      authMode: enabled ? "token" : "none",
      // With auth disabled there's no credential to check — the frontend
      // never needs to gate on this, but reporting `true` (rather than
      // running isRequestAuthenticated against a config that can never
      // match) keeps the shape simple for callers that only branch on this
      // field and ignore authMode entirely.
      authenticated: enabled ? isRequestAuthenticated(request.headers, app.config) : true,
    };
  });
}
