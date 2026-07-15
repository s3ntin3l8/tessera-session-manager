import { defineConfig } from "vitest/config";

// Frontend's first unit-test setup (Phase 4d) — deliberately minimal, for
// pure logic modules only (e.g. reorder.ts) rather than component tests, so
// no jsdom/testing-library is pulled in yet. Mirrors the root vitest.config.ts's
// shape (`test` script → `vitest run`), not its globals/coverage setup, since
// those aren't needed until this file has more than one thing to configure.
export default defineConfig({
  test: {
    environment: "node",
  },
});
