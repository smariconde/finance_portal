import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  // Every Neon branch already includes Postgres (ADR 0057).
  auth: false,
});
