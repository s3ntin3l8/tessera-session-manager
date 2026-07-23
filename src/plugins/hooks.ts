import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import net from "node:net";
import { chmodSync, unlinkSync } from "node:fs";
import { parseHookMessage } from "../services/hook-protocol.js";

// Phase 2's structured agent-hook channel (issue #172) — a second,
// structured channel alongside the existing PTY-parsed one (attention-detect.ts):
// agents write newline-delimited JSON to this ONE shared Unix socket
// (PtyManager.hookSocketPath, injected into every session as
// MULLION_HOOK_SOCKET — see pty-manager.ts's Session.bootstrapMaster()) and
// this listener attributes each connection to a session via a handshake
// token (MULLION_HOOK_TOKEN), validated through app.pty.resolveToken().
//
// Every line after a successful handshake is validated against the wire
// protocol (issue #173, see hook-protocol.ts) — a malformed line gets a
// `{"error":...}` reply and the connection stays open (only a failed
// *handshake*, or an oversized/unterminated line, closes the connection
// outright); a valid one is logged here as a placeholder. Routing validated
// messages into the Phase 1 notification event model lands in a follow-up
// PR (issue #176).
//
// No impact on an agent that never connects: the socket exists (like the
// dtach sockets already do) but sits idle otherwise.

// Max bytes buffered per-connection before a line terminator (\n) arrives —
// guards against a single misbehaving or malicious connection growing this
// process's memory unbounded while waiting for a newline that never comes.
// Same "don't let a chatty/broken input source blow memory" posture as
// routes/events.ts's own backpressure cap, just for the read direction
// instead of the write direction.
const MAX_LINE_BYTES = 64 * 1024;

function handleConnection(app: FastifyInstance, socket: net.Socket): void {
  let buffer = "";
  // null until the handshake line resolves to a real session id — every
  // subsequent line on this connection is attributed to it. A connection
  // that never completes a valid handshake never gets to send anything else
  // (see the `continue`/`return` shape below).
  let sessionId: string | null = null;

  socket.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    if (buffer.length > MAX_LINE_BYTES) {
      app.log.warn("hook connection sent an oversized line without a terminator, closing");
      socket.destroy();
      return;
    }

    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");

      if (line.trim() === "") continue;

      if (sessionId === null) {
        let handshake: unknown;
        try {
          handshake = JSON.parse(line);
        } catch {
          app.log.warn("malformed hook handshake, closing connection");
          socket.destroy();
          return;
        }
        const token =
          typeof handshake === "object" &&
          handshake !== null &&
          typeof (handshake as { token?: unknown }).token === "string"
            ? (handshake as { token: string }).token
            : null;
        const resolved = token !== null ? app.pty.resolveToken(token) : undefined;
        if (resolved === undefined) {
          app.log.warn("hook connection presented an unknown or invalid token, closing");
          socket.destroy();
          return;
        }
        sessionId = resolved;
        continue;
      }

      const result = parseHookMessage(line);
      if (!result.ok) {
        // Malformed *message* (as opposed to a malformed *handshake*, which
        // closes the connection above) gets an error reply but keeps the
        // connection open — a single bad line from an otherwise-well-behaved
        // agent shouldn't force it to reconnect and re-handshake.
        if (socket.writable) {
          socket.write(`${JSON.stringify({ error: result.error })}\n`);
        }
        app.log.warn({ sessionId, error: result.error }, "malformed hook message");
        continue;
      }

      // Routing validated messages into the Phase 1 notification event
      // model (issue #176) lands in a follow-up PR — for now this is a
      // deliberate stub: log the parsed, attributed message and do nothing
      // else with it yet.
      app.log.debug({ sessionId, message: result.message }, "hook message received");
    }
  });

  socket.on("error", (err) => {
    app.log.debug({ err, sessionId }, "hook connection error");
  });
}

export const hooksPlugin = fp(async (app: FastifyInstance) => {
  const socketPath = app.pty.hookSocketPath;

  // Best-effort stale-socket cleanup, mirroring pty-manager.ts's own
  // Session.spawnInternal() unlink-before-bootstrap: a prior process that
  // exited without running this plugin's onClose (crash, kill -9) can leave
  // the socket file behind, and net.Server.listen() refuses to bind an
  // already-existing path (EADDRINUSE) even though nothing is actually
  // listening on it anymore.
  try {
    unlinkSync(socketPath);
  } catch {
    // ENOENT is the expected case (no prior process, or it cleaned up fine).
  }

  const server = net.createServer((socket) => handleConnection(app, socket));

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  // 0600: this socket accepts session-attributed agent messages (eventually
  // review-gate decisions, issue #178) — filesystem perms are the first
  // line of defense alongside the per-session handshake token above. See
  // the roadmap's "Security & trust" design note.
  chmodSync(socketPath, 0o600);

  app.decorate("hookServer", server);

  // CodeQL (js/missing-rate-limiting) flags this hook: it performs a
  // filesystem access (unlinkSync) with no rate-limit decorator of its own.
  // Reviewed — not applicable, same category as the identical flag on
  // src/plugins/auth.ts's onRequest hook: `onClose` runs exactly once, at
  // graceful shutdown, triggered by this process's own lifecycle
  // (app.close()) — never per-request, never on any attacker-reachable
  // trigger a rate limiter could meaningfully throttle.
  app.addHook("onClose", () => {
    server.close();
    try {
      unlinkSync(socketPath);
    } catch {
      // Already gone is fine.
    }
  });
});

declare module "fastify" {
  interface FastifyInstance {
    hookServer: net.Server;
  }
}
