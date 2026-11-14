import { expect, test } from "@playwright/test";

import { ROUTES, SENTINEL_VALUES } from "../support/runtime";

/**
 * La cuenta Schwab (`F11-03`, `F11-04`) en el runtime personal del gate. La base de
 * trading apunta a un puerto cerrado y las credenciales son centinelas: lo que
 * se prueba es que, sin base, la página lo dice en vez de mostrar «sin
 * conectar», y que el callback se niega sin repetir lo que recibió. Nunca se
 * habla con Schwab.
 */
test.describe("cuenta Schwab sin base de trading", () => {
  test("dice que la base de trading no respondió", async ({ page }) => {
    await page.goto(ROUTES.account);

    await expect(
      page.getByRole("heading", { level: 1, name: "Cuenta" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: "Base de trading no disponible",
      }),
    ).toBeVisible();
    await expect(page.getByText("Sin conectar", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("button", { name: /Conectar con Schwab/u }),
    ).toHaveCount(0);
    // Sin conexión leída no hay cuenta en vivo (`F11-04`): ni saldos, ni
    // posiciones, ni un pedido a Schwab.
    await expect(
      page.getByRole("heading", { level: 2, name: /Posiciones|Cuenta ·/u }),
    ).toHaveCount(0);
  });

  test("el callback falla cerrado con una referencia y sin el código", async ({
    request,
  }) => {
    const response = await request.get(
      "/cuenta/schwab/callback?code=C0.sentinel-code&state=sentinel-state",
      { maxRedirects: 0 },
    );

    expect(response.status()).toBe(303);
    expect(response.headers()["cache-control"]).toContain("no-store");
    const location = response.headers().location ?? "";
    expect(location).toMatch(/\/cuenta\?schwab=error&ref=[0-9a-f-]{36}$/u);
    expect(location).not.toContain("sentinel-code");
    expect(location).not.toContain("sentinel-state");
    for (const value of SENTINEL_VALUES) {
      expect(JSON.stringify(response.headers())).not.toContain(value);
    }
  });

  test("un resultado inventado en el query no se muestra", async ({ page }) => {
    await page.goto(`${ROUTES.account}?schwab=%3Cscript%3E&ref=no-es-uuid`);

    await expect(page.getByRole("status")).toHaveCount(0);
    // El estado del router de Next serializa la URL; lo que importa es que la
    // página no la muestre.
    expect(await page.locator("#contenido").innerText()).not.toContain(
      "no-es-uuid",
    );
  });
});
