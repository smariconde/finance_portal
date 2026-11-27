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
    coverage: {
      reporter: ["text", "json", "html"],
    },
    // Los tests viven junto a su unidad en `src/`. Las excepciones son
    // `tests/setup/`, que prueba la infraestructura de la propia suite y no
    // tiene una unidad en `src/` a la que acompañar, y la extensión.
    include: [
      "src/**/*.test.ts",
      "tests/setup/**/*.test.ts",
      // La extensión de captura (ADR 0089): sus adapters son puros.
      "extensions/**/*.test.ts",
    ],
    // El contrato "sin red" deja de depender de que cada archivo se acuerde de
    // espiar `fetch`: acá falla cualquier salida, por cualquier API.
    setupFiles: ["./tests/setup/no-network.ts"],
  },
});
