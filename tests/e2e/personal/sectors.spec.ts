import { expect, test } from "@playwright/test";

import { ROUTES } from "../support/runtime";

/**
 * Matrices por sector (`F7-05`) en el runtime personal del gate.
 *
 * El servidor personal del gate recibe una `DATABASE_URL` donde no escucha
 * nada, a propósito: estas son las primeras rutas que leen la base, y lo que el
 * gate prueba es que, sin base, se niegan con un estado propio en vez de romper
 * o de dibujar una matriz vacía que parezca una respuesta. La matriz con datos
 * no se captura acá: las capturas del gate nunca muestran datos del owner
 * (ADR 0006).
 */
test.describe("matrices por sector sin base", () => {
  for (const [route, surface] of [
    [ROUTES.sectors, "Las matrices por sector"],
    [ROUTES.sectorMatrix, "La matriz de riesgo sectorial"],
  ] as const) {
    test(`${route} dice que la base no respondió`, async ({ page }) => {
      await page.goto(route);

      await expect(
        page.getByRole("heading", {
          level: 1,
          name: "Base personal no disponible",
        }),
      ).toBeVisible();
      await expect(
        page.getByText(new RegExp(`${surface} necesita leer la base personal`)),
      ).toBeVisible();
    });
  }

  test("la descarga directa falla cerrada cuando la base personal no responde", async ({
    request,
  }) => {
    const response = await request.get(`${ROUTES.sectorMatrix}/export`);
    expect(response.status()).toBe(503);
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(await response.text()).toBe("Export no disponible.");
  });

  test("un sector que no es de la taxonomía es la página de ruta inexistente", async ({
    page,
  }) => {
    // Con la ruta en streaming, `notFound()` llega después de que salió el
    // status: Next responde 200 con la superficie de 404 y `noindex`. Lo que
    // importa es que no haya matriz ni consulta: el código se rechaza antes de
    // tocar la base, y la página dice que la ruta no existe.
    await page.goto("/sectores/crypto");

    await expect(
      page.getByRole("heading", { level: 1, name: "Esa ruta no existe" }),
    ).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/u,
    );
  });
});
