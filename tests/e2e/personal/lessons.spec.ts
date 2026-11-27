import { expect, test } from "@playwright/test";

import { ROUTES } from "../support/runtime";
import { withinMain } from "../support/streaming";

/**
 * Las lecciones (`F11-10`) en el runtime personal del gate. El contenido es
 * estático y se sirve siempre; el historial por setup sale de la base de
 * trading, que acá apunta a un puerto cerrado, así que tiene que decirlo en vez
 * de mostrar «ningún trade».
 */
test.describe("lecciones", () => {
  test("el índice lista setups y conceptos y nombra la base caída", async ({
    page,
  }) => {
    await page.goto(ROUTES.lessons);

    await expect(
      page.getByRole("heading", { level: 1, name: "Lecciones" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /Gap and go/u })).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Candlestick/u }),
    ).toBeVisible();
    await expect(
      withinMain(page).getByText("Base de trading no disponible"),
    ).toBeVisible();
  });

  test("una regla lleva el cursor a su marca y un término abre su definición", async ({
    page,
  }) => {
    await page.goto(ROUTES.lessonSetup);

    await expect(
      page.getByRole("heading", { level: 1, name: "Breakout" }),
    ).toBeVisible();
    const entry = page.getByRole("button", { name: /^Entrada:.*Marca 2/u });
    await entry.click();
    await expect(entry).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Cierre fuera").first()).toBeVisible();

    const term = page.getByRole("button", { name: "Relative volume" });
    await term.focus();
    await page.keyboard.press("Enter");
    // La definición abre en un popover, fuera de `<main>`.
    await expect(page.getByText(/volumen normal de esa hora/u)).toBeVisible();

    await expect(
      page.getByRole("heading", { level: 2, name: "Tu historial" }),
    ).toBeVisible();
    await expect(
      withinMain(page).getByText("Base de trading no disponible"),
    ).toBeVisible();
    await expect(page.getByText(/Ningún trade con el setup/u)).toHaveCount(0);
  });

  test("un concepto no tiene historial", async ({ page }) => {
    await page.goto(ROUTES.lessonConcept);

    await expect(
      page.getByRole("heading", { level: 1, name: "RSI & MACD" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Tu historial" }),
    ).toHaveCount(0);
  });

  test("una lección que no existe es 404 y no se repite", async ({ page }) => {
    await page.goto("/lecciones/%3Cscript%3Esentinel-lesson");

    await expect(
      page.getByRole("heading", { level: 1, name: /Esa ruta no existe/u }),
    ).toBeVisible();
    expect(await page.locator("#contenido").innerText()).not.toContain(
      "sentinel-lesson",
    );
  });
});
