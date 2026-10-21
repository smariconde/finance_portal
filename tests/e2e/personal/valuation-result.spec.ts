import { expect, test } from "@playwright/test";

import { ROUTES } from "../support/runtime";

/**
 * Resultado de una valuación (`F6-03`) en el runtime personal del gate.
 *
 * Igual que las matrices, la página lee la base y el servidor del gate apunta a
 * un puerto donde no escucha nada: lo que se prueba es que se niega con un
 * estado propio, que el ticker se valida antes de tocar la base y que una URL
 * por ticker es una sola. El resultado con datos no se captura acá (ADR 0006).
 */
test.describe("resultado de la valuación sin base", () => {
  test("dice que la base no respondió", async ({ page }) => {
    await page.goto(ROUTES.valuationResult);

    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Base personal no disponible",
      }),
    ).toBeVisible();
    await expect(
      page.getByText(
        /El resultado de la valuación necesita leer la base personal/u,
      ),
    ).toBeVisible();
  });

  test("un ticker en minúsculas lleva a su URL canónica", async ({ page }) => {
    await page.goto("/valuacion/aapl");

    await expect(page).toHaveURL(/\/valuacion\/AAPL$/u);
  });

  test("un segmento que no es un ticker es la página de ruta inexistente y no se repite", async ({
    page,
  }) => {
    await page.goto("/valuacion/%3Cb%3Eno%3C%2Fb%3E");

    await expect(
      page.getByRole("heading", { level: 1, name: "Esa ruta no existe" }),
    ).toBeVisible();
    await expect(page.locator("b", { hasText: "no" })).toHaveCount(0);
    await expect(page).not.toHaveTitle(/<b>/u);
  });
});
