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

  test("el diario dice que la base de trading no respondió, sin pedir nada", async ({
    page,
  }) => {
    await page.goto(ROUTES.journal);

    await expect(
      page.getByRole("heading", { level: 1, name: "Diario" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: "Base de trading no disponible",
      }),
    ).toBeVisible();
    // Sin base no hay trades ni una sincronización que salga a Schwab.
    await expect(page.getByText("Sincronizando")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /Trades/u })).toHaveCount(0);
  });

  test("el plan no muestra ideas si la base de trading no responde", async ({
    page,
  }) => {
    await page.goto(ROUTES.plan);
    await expect(
      page.getByRole("heading", { level: 1, name: "Plan" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Plan no disponible" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Watchlist" })).toHaveCount(
      0,
    );
  });

  test("el armador de Finviz arma links aunque la base de trading no responda", async ({
    page,
  }) => {
    await page.goto(ROUTES.finviz);
    await expect(
      page.getByRole("heading", { level: 1, name: "Plan" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Finviz", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    // El catálogo es código: sin base sólo faltan las estrategias.
    await expect(
      page.getByText(/La base de trading no respondió\. Referencia/u),
    ).toBeVisible();

    await page.getByLabel("Exchange", { exact: true }).selectOption("nasd");
    await page.getByRole("tab", { name: /Technical/u }).click();
    await page.getByLabel("RSI (14)", { exact: true }).selectOption("os30");
    const open = page.getByRole("link", { name: /Abrir en Finviz/u }).first();
    await expect(open).toHaveAttribute(
      "href",
      "https://finviz.com/screener/stocks?v=341&f=exch_nasd,ta_rsi_os30",
    );
    await expect(open).toHaveAttribute("rel", "noopener noreferrer");
    await expect(page).toHaveURL(
      /\/plan\/finviz\?v=341&f=exch_nasd,ta_rsi_os30$/u,
    );

    // Un link viejo del Flask vuelve con la clave nueva y nombra lo Elite.
    await page
      .getByLabel("Link del screener de Finviz")
      .fill(
        "https://finviz.com/screener.ashx?v=111&f=ind_semiconductors,exch_nasd|nyse",
      );
    await page.getByRole("button", { name: "Importar link" }).click();
    await expect(open).toHaveAttribute(
      "href",
      "https://finviz.com/screener/stocks?v=111&f=industry_semiconductors",
    );
    await expect(page.getByText("exch_nasd|nyse")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Guardar estrategia" }),
    ).toHaveCount(0);
  });

  test("las estadísticas dicen que la base no respondió", async ({ page }) => {
    await page.goto(ROUTES.journalStats);

    await expect(
      page.getByRole("heading", { level: 1, name: "Diario" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Estadísticas" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: "Base de trading no disponible",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Curva realizada|Cortes/u }),
    ).toHaveCount(0);
  });

  test("un trade del diario dice que la base no respondió, sin pedir nada", async ({
    page,
  }) => {
    await page.goto(ROUTES.journalTrade);

    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Base de trading no disponible",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Plan y anotación" }),
    ).toHaveCount(0);
  });

  test("un segmento que no es un trade es 404 y no se repite", async ({
    page,
  }) => {
    await page.goto("/diario/%3Cscript%3Esentinel-ref");

    expect(await page.locator("#contenido").innerText()).not.toContain(
      "sentinel-ref",
    );
    await expect(
      page.getByRole("heading", { name: "Plan y anotación" }),
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
