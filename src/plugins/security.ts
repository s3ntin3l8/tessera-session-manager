import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import cors from "@fastify/cors";

export const securityPlugin = fp(async (app: FastifyInstance) => {
  // Security headers (CSP, HSTS, etc.).
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        // Helmet's default directives include upgrade-insecure-requests,
        // which tells the browser to silently rewrite every same-origin
        // http:// subresource request to https:// — including behind a
        // reverse proxy (Traefik) that terminates TLS and talks plain HTTP
        // to this app internally, which is exactly this app's deployment
        // model (see the plan). With it on, every asset request 404s/503s
        // against a port that never speaks TLS; this cost real time to
        // diagnose (looked identical to a blank/broken terminal). Disabled
        // by setting the directive to null, helmet's documented way to
        // drop a default directive.
        upgradeInsecureRequests: null,
      },
    },
  });

  // Basic abuse protection. Tune via RATE_LIMIT_MAX / RATE_LIMIT_WINDOW.
  await app.register(rateLimit, {
    max: app.config.RATE_LIMIT_MAX,
    timeWindow: app.config.RATE_LIMIT_WINDOW,
  });

  // CORS is disabled by default. Set CORS_ORIGIN to a comma-separated allowlist
  // (e.g. "https://app.example.com,https://admin.example.com") to enable it.
  const allowlist = app.config.CORS_ORIGIN.split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);

  await app.register(cors, {
    origin: allowlist.length > 0 ? allowlist : false,
  });
});
