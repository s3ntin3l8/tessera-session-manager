# Browser previews

Tessera can show a project's dev server — or any external URL — in a
dockview panel alongside your terminals, with working HMR. This is opt-in
and fully inert until you set `PREVIEW_BASE_HOST`.

## How it works

A preview isn't a plain iframe pointing at `http://localhost:5173`: on an
HTTPS dashboard that's blocked outright as mixed content (and most sites
also refuse to be framed cross-origin via their own `X-Frame-Options`/CSP).
Instead, Tessera proxies the target itself and serves it same-origin at
`preview-<slug>.<PREVIEW_BASE_HOST>` — a subdomain of the dashboard's own
origin, so the browser treats it as same-site. `src/plugins/security.ts`
adds `frame-src 'self' http(s)://*.<PREVIEW_BASE_HOST>` to CSP specifically
to allow this.

There are two kinds of preview:

- **Project preview** — one per project (opening it again reuses the same
  slug). Resolves to the project's configured dev-server URL/port.
- **External preview** — any URL you paste via "Open URL", validated
  against SSRF guards at creation time (see Security below).

Dev-server WebSocket traffic (Vite/webpack-dev-server HMR, etc.) is proxied
transparently through the same subdomain, so hot reload keeps working
inside the panel.

Open a preview from a project's Dock row ("Open browser preview"), the
command palette ("Preview: `<project>`"), or the "Open URL" action for an
arbitrary external site.

## Setup

1. Set `PREVIEW_BASE_HOST` in `.env` (e.g. `preview.example.com`). Leave it
   empty to disable the feature entirely — no preview routes are even
   registered.
2. **Wildcard DNS**: `*.<PREVIEW_BASE_HOST>` must resolve to the same place
   as your main hostname. There's currently no DNS-free local convention
   (no `nip.io`/`*.localhost` fallback) — even local use needs real
   wildcard DNS pointed at `PREVIEW_BASE_HOST`.
3. **Wildcard TLS**: a single-name cert doesn't cover
   `preview-<slug>.*`. See [`deploy/README.md`](../deploy/README.md) for
   the Traefik dynamic-config template — its preview router needs a
   wildcard `tls.domains` entry, which forces a **DNS-01** challenge
   (not HTTP-01), so your `certResolver` needs DNS-01 support.
4. `PREVIEW_BASE_HOST` in `.env` must exactly match
   `CHANGEME_PREVIEW_BASE_HOST` in `traefik-dynamic.yml` — same value,
   same case.
5. **Put the same forwardAuth middleware on the preview router as the main
   app.** This is not optional: without it, every preview subdomain is an
   open, unauthenticated proxy into whatever it's pointed at.

## Dev-server port auto-discovery

For local (non-remote-host) projects, Tessera scans that project's dock
session's terminal scrollback for a dev server's own "Local:
http://localhost:`<port>`" startup banner (Vite/Next/CRA/Astro-style) and
offers it as a one-click suggestion — "Detected dev server on port N — use
it?" — when creating/editing a project. It's never applied automatically;
you still confirm it, and it only ever informs the `devServerUrl` field you
could also type in by hand.

## Multi-host previews

If a project's session runs on a remote **agent** host (see
[`multi-host.md`](multi-host.md)) rather than the primary, previewing it is
a two-hop proxy: the primary forwards the request to that agent's internal
API, and the **agent** then connects to its own `127.0.0.1:<port>` — never
to an arbitrary host or port. The remote host portion of the project's
`devServerUrl` is intentionally discarded for this hop, so even a leaked
`TESSERA_AGENT_TOKEN` or a compromised primary can only reach ports on that
agent's own loopback, never pivot into its LAN.

## Security

- External preview URLs are validated with the same SSRF-guard classifier
  used elsewhere in Tessera (`src/services/url-guard.ts`), but with a
  stricter policy than host registration: loopback and RFC1918/IPv6-ULA
  private ranges are blocked outright here (unlike remote-host
  registration, where loopback/private ranges are legitimate), along with
  link-local, RFC 6598 shared-NAT space, and IPv4-mapped/IPv4-compatible
  IPv6 forms that could otherwise smuggle a blocked address past an
  IPv4-only check. Redirects are followed manually (`redirect: "manual"`)
  and re-checked rather than trusted.
- As with remote-host registration, this is IP-literal validation at
  creation time, not DNS-rebinding protection — a hostname that resolves
  safely when the preview is created and gets rebound to a private address
  afterward isn't caught. Treat "who can create a preview" as a trusted-user
  action for the same reason multi-host registration is.
- `GET /api/server-info` exposes `previewsEnabled`/`previewBaseHost` so the
  frontend can gate the preview UI on it; there's nothing sensitive in that
  response.

## Current limitations

- No DNS-rebinding protection (see Security above).
- No local-dev path that avoids setting up real wildcard DNS.
- WebSocket upgrades proxied through an Authentik forwardAuth deployment
  are not yet verified end-to-end in production for previews specifically
  (same open question as `/ws/terminal` — see `deploy/README.md`).
- Port auto-discovery only works for projects running on the primary
  itself; it has no visibility into a remote agent's terminal scrollback.
