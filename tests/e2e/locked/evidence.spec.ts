import { test } from "@playwright/test";

import { captureEvidence } from "../support/evidence";
import { ROUTES } from "../support/runtime";

/**
 * Evidencia renderizada de la negativa (`UI-02`).
 *
 * La pantalla que ve alguien que no puede entrar también forma parte del
 * producto y también se revisa.
 */
for (const [name, route] of Object.entries(ROUTES)) {
  test(`captura ${name} con runtime trabado`, async ({ page }, testInfo) => {
    await page.goto(route);
    await captureEvidence(page, testInfo, name);
  });
}
