import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In prod this frontend is built and served same-origin by the Fastify
// backend (see src/plugins/static.ts) — no proxy needed there. In dev, Vite
// runs on its own port with HMR, so /api and /ws are proxied through to the
// backend dev server instead. Override the target with BACKEND_URL if the
// backend isn't on its default .env port (3450).
const backendUrl = process.env.BACKEND_URL || "http://localhost:3450";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": backendUrl,
      "/ws": { target: backendUrl, ws: true },
    },
  },
});
