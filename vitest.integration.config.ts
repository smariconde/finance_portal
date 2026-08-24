import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

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
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["./tests/integration/global-setup.ts"],
    setupFiles: ["./tests/integration/setup.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
