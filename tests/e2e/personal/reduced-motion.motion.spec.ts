import { expect, test } from "@playwright/test";

import { ROUTES } from "../support/runtime";

/**
 * Movimiento reducido (`UI-03`).
 *
 * La regla del contrato no es "sin animación": es que reducir el movimiento no
 * puede eliminar el feedback. Por eso el spec verifica las dos mitades — que la
 * transición se colapse y que el cambio de estado siga siendo observable — en
 * vez de sólo la primera, que es la que se cumple sola.
 *
 * Corre únicamente en el proyecto `personal-reduced-motion`, que declara
 * `prefers-reduced-motion: reduce`.
 */
test.describe("con prefers-reduced-motion: reduce", () => {
  test("el navegador reporta la preferencia", async ({ page }) => {
    await page.goto(ROUTES.home);

    const reduced = await page.evaluate(
      () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );

    expect(reduced).toBe(true);
  });

  test("la sidebar colapsa su transición", async ({ page }) => {
    await page.goto(ROUTES.home);

    const duration = await page
      .locator("[data-slot='sidebar-container']")
      .first()
      .evaluate((node) => getComputedStyle(node).transitionDuration);

    // `0.01ms` se reporta como `0.00001s`; lo que importa es que no quede una
    // animación perceptible.
    expect(Number.parseFloat(duration)).toBeLessThan(0.05);
  });

  test("el desplazamiento deja de ser suave", async ({ page }) => {
    await page.goto(ROUTES.reference);

    const behavior = await page.evaluate(
      () => getComputedStyle(document.documentElement).scrollBehavior,
    );

    expect(behavior).toBe("auto");
  });

  test("colapsar la navegación sigue produciendo un cambio de estado legible", async ({
    page,
  }) => {
    await page.goto(ROUTES.home);

    const sidebar = page.locator("[data-slot='sidebar']").first();
    const before = await sidebar.getAttribute("data-state");

    await page.locator("[data-slot='sidebar-trigger']").click();

    const after = await sidebar.getAttribute("data-state");

    // Sin movimiento, el estado es lo único que queda: si también desapareciera,
    // el control dejaría de dar feedback.
    expect(before).not.toBe(after);
    expect([before, after]).toContain("collapsed");
  });

  test("el foco sigue siendo visible sin depender de una transición", async ({
    page,
  }) => {
    await page.goto(ROUTES.home);
    await page.keyboard.press("Tab");

    const skipLink = page.getByRole("link", { name: "Saltar al contenido" });
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeVisible();
  });
});
