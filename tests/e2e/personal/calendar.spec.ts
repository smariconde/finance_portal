import { expect, test } from "@playwright/test";

import { expectNoAccessibilityViolations } from "../support/accessibility";
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

    // El título del mes («noviembre 2026»); la marca de Schwab también es `aria-live`.
    const title = page.locator("span[aria-live=polite]", {
      hasText: /^[a-z]+ \d{4}$/u,
    });
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

  /*
   * El día seleccionado lleva el fondo `accent`, y por defecto es hoy: sin
   * esto, axe sólo veía un cierre temprano seleccionado el día que caía en
   * hoy (falló el 2026-11-27). Se busca el próximo de cada uno hacia
   * adelante, dentro de lo declarado.
   */
  for (const [kind, name] of [
    ["un cierre temprano", /cierre temprano/u],
    ["un feriado", /NYSE cerrada/u],
  ] as const) {
    test(`pasa axe con ${kind} seleccionado`, async ({ page }) => {
      await page.goto(ROUTES.calendar);
      const month = page.getByRole("table", {
        name: /Horario regular de la bolsa/u,
      });
      const next = page.getByRole("button", { name: "Mes siguiente" });
      const day = month.getByRole("button", { name }).first();
      for (let step = 0; step < 13 && !(await day.isVisible()); step += 1) {
        await next.click();
      }
      await day.click();
      await expect(day).toHaveAttribute("aria-pressed", "true");
      await expectNoAccessibilityViolations(page);
    });
  }
});
