import { test } from "@playwright/test";

import { expectNoAccessibilityViolations } from "../support/accessibility";
import { ROUTES } from "../support/runtime";

/**
 * La negativa también es una superficie del producto (`UI-02`).
 *
 * Un estado de error accesible sólo a medias es el más caro de todos: es la
 * pantalla que alguien lee cuando ya está bloqueado.
 */
for (const [name, route] of Object.entries(ROUTES)) {
  test(`sin findings bloqueantes de axe en ${name} con runtime trabado`, async ({
    page,
  }) => {
    await page.goto(route);
    await expectNoAccessibilityViolations(page);
  });
}
