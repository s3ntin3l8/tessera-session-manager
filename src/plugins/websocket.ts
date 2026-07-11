import fp from "fastify-plugin";
import websocket from "@fastify/websocket";

// WebSocket transport for the terminal bridge (src/routes/terminal.ts). Kept
// as its own plugin, matching the template's one-concern-per-plugin layout.
export const websocketPlugin = fp(async (app) => {
  await app.register(websocket, {
    options: {
      // Generous ceiling for paste-heavy terminal input/output; keystrokes
      // and scrollback replay chunks are both far smaller than this.
      maxPayload: 1024 * 1024,
    },
  });
});
