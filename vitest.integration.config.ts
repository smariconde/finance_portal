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
    // Una sola base compartida: dos archivos en paralelo verían las corridas y
    // observaciones del otro y probarían interferencia en vez de contrato.
    fileParallelism: false,
    globalSetup: ["./tests/integration/global-setup.ts"],
    setupFiles: ["./tests/integration/setup.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
