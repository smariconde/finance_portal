import { test } from "@playwright/test";

import { expectNoAccessibilityViolations } from "../support/accessibility";
import { ROUTES } from "../support/runtime";

/**
 * Chequeo automatizado de accesibilidad sobre el runtime personal (`UI-02`).
 *
 * Corre en los cuatro proyectos personales, así que cada ruta se evalúa en
 * escritorio claro, escritorio oscuro y ancho de teléfono. La revisión que
 * `F1-06` dejó pendiente como follow-up deja de depender de que alguien la
 * ejecute a mano.
 */
for (const [name, route] of Object.entries(ROUTES)) {
  test(`sin findings bloqueantes de axe en ${name}`, async ({ page }) => {
    await page.goto(route);
    await expectNoAccessibilityViolations(page);
  });
}
