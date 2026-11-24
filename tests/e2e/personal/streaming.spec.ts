import { expect, test } from "@playwright/test";

import { withinMain } from "../support/streaming";

/**
 * La forma exacta del flake de `F6-40`, sin depender del orden de los chunks.
 *
 * En CI el aviso sin base apareció dos veces: visible en `<main>` y oculto en el
 * `<div hidden id="S:0">` que React deja al final del `body` mientras transmite.
 * Este DOM lo fija a mano.
 */
test.describe("contenido en streaming", () => {
  test("un resto oculto fuera de <main> no duplica lo que se busca", async ({
    page,
  }) => {
    await page.setContent(`
      <main><div id="contenido"><p>Las matrices por sector necesita leer la base personal.</p></div></main>
      <div hidden id="S:0"><div id="contenido"><p>Las matrices por sector necesita leer la base personal.</p></div></div>
    `);
    const notice = /Las matrices por sector necesita leer la base personal/u;

    // Sin acotar, el modo estricto ve dos y falla: es lo que pasó en CI.
    await expect(page.getByText(notice)).toHaveCount(2);
    await expect(withinMain(page).getByText(notice)).toBeVisible();
  });
});
