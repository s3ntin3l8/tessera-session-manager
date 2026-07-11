import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { PtyManager } from "../services/pty-manager.js";

// Decorates app.pty with the session manager (see src/services/pty-manager.ts
// for what it actually does and why). Attach-clients it spawns are only
// killed on process shutdown here — never on browser disconnect, which is
// the whole point of the tool.
export const ptyPlugin = fp(async (app: FastifyInstance) => {
  const manager = new PtyManager({ sessionsDir: app.config.SESSIONS_DIR });

  app.decorate("pty", manager);

  app.addHook("onClose", () => {
    manager.killAll();
  });
});

declare module "fastify" {
  interface FastifyInstance {
    pty: PtyManager;
  }
}
