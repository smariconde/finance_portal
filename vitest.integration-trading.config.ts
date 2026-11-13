import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Integración de la base de trading (ADR 0076). Va aparte de
 * `vitest.integration.config.ts` porque es otra base con otra cadena de
 * migraciones: `pnpm test:integration` sigue pidiendo sólo `DATABASE_TEST_URL`,
 * y esta suite pide sólo `TRADING_DATABASE_TEST_URL`.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./tests/setup/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["tests/integration-trading/**/*.test.ts"],
    fileParallelism: false,
    globalSetup: ["./tests/integration-trading/global-setup.ts"],
    setupFiles: ["./tests/integration-trading/setup.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
