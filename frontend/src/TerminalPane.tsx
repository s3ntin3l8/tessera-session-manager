import { useEffect, useRef } from "react";
import type { IDockviewPanelProps } from "dockview-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

export interface TerminalPaneParams {
  sessionId: number;
}

interface ResizeMessage {
  type: "resize";
  cols: number;
  rows: number;
}

// One xterm.js instance + one WebSocket per session, bound to a session id
// (not to the panel's own lifetime) — closing this panel only tears down the
// browser-side view; the WS close handler in terminal.ts explicitly does not
// kill the session, matching the "browser tab close never kills the session"
// premise from the plan.
export function TerminalPane(props: IDockviewPanelProps<TerminalPaneParams>) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "Menlo, Consolas, monospace",
      theme: { background: "#1e1e1e" },
      // Unicode11Addon reads term.unicode, which xterm gates behind this
      // flag as a "proposed" (not yet stabilized) API.
      allowProposedApi: true,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11";
    term.loadAddon(new WebLinksAddon());

    try {
      term.loadAddon(new WebglAddon());
    } catch (err) {
      // Not every environment has a usable WebGL context (e.g. some headless
      // or GPU-restricted setups) — xterm falls back to its default DOM
      // renderer automatically, so this is a soft failure, not a blocker.
      console.warn("[terminal] WebGL renderer unavailable, using default renderer", err);
    }

    term.open(container);
    fitAddon.fit();

    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${location.host}/ws/terminal?sessionId=${props.params.sessionId}&cols=${term.cols}&rows=${term.rows}`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";

    ws.addEventListener("message", (event) => {
      if (typeof event.data === "string") return;
      term.write(new Uint8Array(event.data as ArrayBuffer));
    });

    const dataSub = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(new TextEncoder().encode(data));
      }
    });

    let lastCols = term.cols;
    let lastRows = term.rows;
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (term.cols === lastCols && term.rows === lastRows) return;
      lastCols = term.cols;
      lastRows = term.rows;
      if (ws.readyState === WebSocket.OPEN) {
        const message: ResizeMessage = { type: "resize", cols: term.cols, rows: term.rows };
        ws.send(JSON.stringify(message));
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      dataSub.dispose();
      ws.close();
      term.dispose();
    };
  }, [props.params.sessionId]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
