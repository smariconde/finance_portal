import { defineConfig, devices } from "@playwright/test";

import {
  DESKTOP_VIEWPORT,
  LOCKED_BASE_URL,
  LOCKED_ENVIRONMENT,
  LOCKED_PORT,
  MOBILE_VIEWPORT,
  PERSONAL_BASE_URL,
  PERSONAL_ENVIRONMENT,
  PERSONAL_PORT,
} from "./tests/e2e/support/runtime";

/**
 * Gate E2E y de accesibilidad
 * ([ADR 0006](docs/architecture/adr/0006-e2e-accessibility-harness.md)).
 *
 * `pnpm test:e2e` compila **una vez** y levanta dos servidores sobre ese mismo
 * artefacto: uno con entorno personal y otro trabado. El build no se hace acá
 * sino en el script, porque Playwright arranca los `webServer` antes del
 * `globalSetup` y `next start` necesita el build ya terminado.
 *
 * Chromium es el único motor, por decisión registrada en la ADR: el consumidor
 * es un único owner sobre un navegador conocido. Ampliarlo es materia de
 * `F9-03`.
 */
const isCi = process.env.CI === "true" || process.env.CI === "1";

export default defineConfig({
  testDir: "./tests/e2e",
  // El gate mide comportamiento sobre un servidor compartido; dos workers
  // escribiendo capturas de la misma ruta se pisarían el archivo.
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCi,
  retries: 0,
  reporter: isCi ? [["github"], ["list"]] : [["list"]],
  outputDir: "./tests/e2e/.output",
  expect: { timeout: 10_000 },
  timeout: 60_000,

  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    // Un gate que dice "sin egress" no puede depender de que ningún test se
    // acuerde de no navegar afuera.
    ignoreHTTPSErrors: false,
  },

  projects: [
    {
      name: "personal-desktop",
      testDir: "./tests/e2e/personal",
      testIgnore: "**/*.motion.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: PERSONAL_BASE_URL,
        viewport: DESKTOP_VIEWPORT,
        colorScheme: "light",
      },
    },
    {
      name: "personal-desktop-dark",
      testDir: "./tests/e2e/personal",
      testIgnore: "**/*.motion.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: PERSONAL_BASE_URL,
        viewport: DESKTOP_VIEWPORT,
        colorScheme: "dark",
      },
    },
    {
      name: "personal-mobile",
      testDir: "./tests/e2e/personal",
      testIgnore: "**/*.motion.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: PERSONAL_BASE_URL,
        viewport: MOBILE_VIEWPORT,
        isMobile: false,
        hasTouch: true,
        colorScheme: "light",
      },
    },
    {
      name: "personal-reduced-motion",
      testDir: "./tests/e2e/personal",
      testMatch: "**/*.motion.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: PERSONAL_BASE_URL,
        viewport: DESKTOP_VIEWPORT,
        // Desde Playwright 1.62 la preferencia viaja en `contextOptions`, no
        // como opción suelta de `use`.
        contextOptions: { reducedMotion: "reduce" },
      },
    },
    {
      name: "locked-desktop",
      testDir: "./tests/e2e/locked",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: LOCKED_BASE_URL,
        viewport: DESKTOP_VIEWPORT,
        colorScheme: "light",
      },
    },
    {
      name: "locked-mobile",
      testDir: "./tests/e2e/locked",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: LOCKED_BASE_URL,
        viewport: MOBILE_VIEWPORT,
        hasTouch: true,
        colorScheme: "dark",
      },
    },
  ],

  webServer: [
    {
      command: `pnpm exec next start --port ${PERSONAL_PORT}`,
      url: PERSONAL_BASE_URL,
      env: PERSONAL_ENVIRONMENT,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `pnpm exec next start --port ${LOCKED_PORT}`,
      url: LOCKED_BASE_URL,
      env: LOCKED_ENVIRONMENT,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
