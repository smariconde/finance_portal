import { defineConfig } from "drizzle-kit";

/**
 * La base de trading tiene su propio schema y su propia cadena de migraciones
 * (ADR 0076). `pnpm db:trading:generate` usa este archivo; `pnpm db:generate`
 * sigue usando `drizzle.config.ts`.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/trading/schema.ts",
  out: "./drizzle-trading",
  strict: true,
  verbose: true,
});
