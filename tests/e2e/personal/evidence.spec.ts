import { test } from "@playwright/test";

import { captureEvidence } from "../support/evidence";
import { ROUTES } from "../support/runtime";

/**
 * Evidencia renderizada del runtime personal (`UI-02`).
 *
 * Cierra el follow-up que `F1-06` dejó abierto: la revisión desktop/mobile a
 * 1440×900 y 390×844 en tema claro y oscuro se regenera con el gate en vez de
 * ejecutarse a mano.
 */
for (const [name, route] of Object.entries(ROUTES)) {
  test(`captura ${name}`, async ({ page }, testInfo) => {
    await page.goto(route);
    await captureEvidence(page, testInfo, name);
  });
}
