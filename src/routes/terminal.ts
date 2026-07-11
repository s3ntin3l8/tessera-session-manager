import type { FastifyInstance } from "fastify";
import os from "node:os";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Read once at module load, not per-request. Served locally rather than via
// CDN: this box's browser tunnel can reach the app's own port fine but can't
// reach the public internet, so a CDN <script src> silently fails to load —
// which looked exactly like a blank/broken terminal and nearly got
// misdiagnosed as a dtach redraw failure. Real lesson: don't trust a browser
// screenshot without first confirming the page's own JS actually loaded.
const XTERM_JS = readFileSync(require.resolve("@xterm/xterm/lib/xterm.js"), "utf8");
const XTERM_CSS = readFileSync(require.resolve("@xterm/xterm/css/xterm.css"), "utf8");
const ADDON_FIT_JS = readFileSync(
  require.resolve("@xterm/addon-fit/lib/addon-fit.js"),
  "utf8",
);

interface ResizeMessage {
  type: "resize";
  cols: number;
  rows: number;
}

function isResizeMessage(value: unknown): value is ResizeMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "resize" &&
    typeof (value as { cols?: unknown }).cols === "number" &&
    typeof (value as { rows?: unknown }).rows === "number"
  );
}

// Milestone 1 spike page only: plain xterm.js served locally (pinned to
// verified current releases — @xterm/xterm jumped to 6.0.0 and addon-fit to
// 0.11.0 as of this writing; don't trust older numbers from memory) with a
// hand-rolled WS client, because @xterm/addon-attach can't carry the resize
// control channel — that gap is the bug in the original prototype this
// project started from. Milestone 3 replaces this with the real
// Vite/dockview app served via @fastify/static; this route disappears then.
//
// Everything is served as separate same-origin script/link files, not
// inlined into the HTML: @fastify/helmet's default CSP is script-src 'self',
// which silently blocks inline <script> content. Inlining looked identical
// to the CDN-unreachable failure (Terminal/FitAddon undefined, blank
// screen) and very nearly got misdiagnosed a second time as a dtach redraw
// bug. Same lesson as the CDN issue: confirm the page's JS actually ran
// before trusting a screenshot.
const CLIENT_JS = `
const term = new Terminal({
  cursorBlink: true,
  theme: { background: "#1e1e1e" },
  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
});
const fitAddon = new FitAddon.FitAddon();
term.loadAddon(fitAddon);
term.open(document.getElementById("terminal"));
fitAddon.fit();

const params = new URLSearchParams(window.location.search);
const wsUrl = new URL("/ws/terminal", window.location.href);
wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
for (const key of ["id", "cwd", "command"]) {
  if (params.has(key)) wsUrl.searchParams.set(key, params.get(key));
}
wsUrl.searchParams.set("cols", term.cols);
wsUrl.searchParams.set("rows", term.rows);

const ws = new WebSocket(wsUrl);
ws.binaryType = "arraybuffer";

function sendResize() {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
}

ws.onopen = () => sendResize();

ws.onmessage = (event) => {
  if (typeof event.data === "string") {
    // JSON control message (e.g. {"type":"exited"}).
    console.log("control:", event.data);
    return;
  }
  // Raw PTY bytes — hand the Uint8Array straight to xterm.js so it can
  // do its own UTF-8 decoding without risking mangling a multi-byte
  // character split across two WS frames.
  term.write(new Uint8Array(event.data));
};

term.onData((data) => {
  if (ws.readyState === WebSocket.OPEN) ws.send(new TextEncoder().encode(data));
});

window.addEventListener("resize", () => {
  fitAddon.fit();
  sendResize();
});
`;

const SPIKE_PAGE = `<!DOCTYPE html>
<html>
<head>
  <title>terminal spike (M1)</title>
  <link rel="stylesheet" href="/terminal-spike/xterm.css" />
  <script src="/terminal-spike/xterm.js"></script>
  <script src="/terminal-spike/addon-fit.js"></script>
  <style>
    body, html { margin: 0; padding: 0; height: 100%; background: #1e1e1e; }
    #terminal { height: 100vh; width: 100vw; padding: 10px; box-sizing: border-box; }
  </style>
</head>
<body>
  <div id="terminal"></div>
  <script src="/terminal-spike/client.js"></script>
</body>
</html>
`;

export async function terminalRoute(app: FastifyInstance) {
  app.get("/terminal-spike", async (_request, reply) => {
    reply.type("text/html").send(SPIKE_PAGE);
  });
  app.get("/terminal-spike/xterm.js", async (_request, reply) => {
    reply.type("application/javascript").send(XTERM_JS);
  });
  app.get("/terminal-spike/xterm.css", async (_request, reply) => {
    reply.type("text/css").send(XTERM_CSS);
  });
  app.get("/terminal-spike/addon-fit.js", async (_request, reply) => {
    reply.type("application/javascript").send(ADDON_FIT_JS);
  });
  app.get("/terminal-spike/client.js", async (_request, reply) => {
    reply.type("application/javascript").send(CLIENT_JS);
  });

  app.get("/ws/terminal", { websocket: true }, (socket, req) => {
    const query = req.query as Record<string, string | undefined>;

    // Milestone 1 spike: a single, hardcoded-by-default session, overridable
    // via query params so the same route can be pointed at any CLI
    // (?command=claude, ?command=codex, ...) to prove the design is
    // CLI-agnostic. Milestone 2 replaces this with the Drizzle-backed
    // project/session registry and a create/attach control protocol.
    const id = query.id || "dev";
    const cwd = query.cwd || os.homedir();
    const command = query.command || process.env.SHELL || "/bin/bash";
    const cols = Number(query.cols) || 80;
    const rows = Number(query.rows) || 24;

    const session = app.pty.getOrCreate({ id, cwd, command, cols, rows });

    app.log.info(
      { sessionId: id, cwd, command, alreadyAlive: session.isAlive },
      "terminal ws attached",
    );

    // Replay whatever this session produced while unwatched. In the common
    // case (browser tab closed, Node process never restarted) this alone
    // reconstructs the screen correctly, with no dtach-level reattach
    // involved at all — see pty-manager.ts.
    const backlog = session.getScrollback();
    if (backlog.length > 0) socket.send(backlog);

    const unsubscribeData = session.onData((chunk) => {
      if (socket.readyState === socket.OPEN) socket.send(chunk);
    });

    const unsubscribeExit = session.onExit(() => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ type: "exited" }));
      }
    });

    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        // RawData is Buffer | ArrayBuffer | Buffer[]; narrow each arm
        // explicitly since Buffer.from() can't take the union directly.
        const buf = Array.isArray(data)
          ? Buffer.concat(data)
          : Buffer.isBuffer(data)
            ? data
            : Buffer.from(data);
        session.write(buf.toString("utf8"));
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString("utf8"));
      } catch {
        app.log.warn({ sessionId: id }, "dropped malformed control message");
        return;
      }

      if (isResizeMessage(parsed)) {
        session.resize(parsed.cols, parsed.rows);
      }
    });

    socket.on("close", () => {
      unsubscribeData();
      unsubscribeExit();
      // Deliberately not killing the session — it keeps running on the
      // host until the Node process itself shuts down (ptyPlugin's onClose)
      // or a future explicit "kill" control message (Milestone 2).
      app.log.info(
        { sessionId: id },
        "terminal ws detached (session kept alive)",
      );
    });
  });
}
