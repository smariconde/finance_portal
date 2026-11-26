import { expect, test } from "@playwright/test";

import { ROUTES } from "../support/runtime";

/**
 * El calendario de mercado (`F12-01`, `market-sessions-1.0.0`). La tabla de la
 * NYSE es código: no abre la base ni la red, así que se lee igual con la base
 * cerrada del gate. Las fechas dependen del día en que corre el gate; se
 * comprueba la forma, no un día puntual.
 */
test.describe("calendario", () => {
  test("muestra hoy, el mes y lo que viene, y navega de mes", async ({
    page,
  }) => {
    await page.goto(ROUTES.calendar);

    await expect(
      page.getByRole("heading", { level: 1, name: "Calendario" }),
    ).toBeVisible();
    const strip = page.getByRole("region", {
      name: "Bolsa de Nueva York, en hora de Buenos Aires",
    });
    await expect(strip.getByText("Hoy", { exact: true })).toBeVisible();

    const month = page.getByRole("table", {
      name: /Horario regular de la bolsa/u,
    });
    await expect(month.getByRole("columnheader")).toHaveCount(5);
    await expect(
      page.getByRole("heading", { level: 2, name: "Lo que viene" }),
    ).toBeVisible();

    const title = page.locator("[aria-live=polite]").first();
    const before = await title.textContent();
    await page.getByRole("button", { name: "Mes siguiente" }).click();
    await expect(title).not.toHaveText(before ?? "");
  });

  test("está en la navegación al lado de Inicio y en la franja de inicio", async ({
    page,
  }) => {
    await page.goto(ROUTES.home);

    const strip = page.getByRole("region", {
      name: "Bolsa de Nueva York, en hora de Buenos Aires",
    });
    await expect(
      strip.getByRole("link", { name: "Calendario" }),
    ).toHaveAttribute("href", "/calendario");

    const sidebar = page.locator("[data-slot='sidebar-header']").first();
    test.skip(
      !(await sidebar.isVisible()),
      "En este viewport la navegación es un drawer cerrado.",
    );
    await expect(
      page
        .getByRole("navigation")
        .getByRole("link", { name: "Calendario", exact: true }),
    ).toHaveAttribute("href", "/calendario");
  });
});
