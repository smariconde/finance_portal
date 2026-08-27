import { expect, test } from "@playwright/test";

import { ROUTES, SENTINEL_VALUES } from "../support/runtime";

/**
 * Runtime trabado (`F1-07`, `TM-01`, `TM-02`, `TM-04`).
 *
 * Este servidor corre **el mismo build** que el personal; sólo cambia su
 * entorno. Que responda una negativa es lo que prueba que la frontera vive en el
 * request y no en el artefacto
 * ([ADR 0005](../../../docs/architecture/adr/0005-request-time-runtime-boundary.md)).
 */
test.describe("negativa del runtime trabado", () => {
  test("niega la corrida de referencia en vez de servirla", async ({
    page,
  }) => {
    await page.goto(ROUTES.reference);

    await expect(
      page.getByRole("heading", { level: 1, name: "Runtime trabado" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        /La corrida de referencia del motor no se sirve porque este entorno no pudo probar que es privado/,
      ),
    ).toBeVisible();
  });

  test("no filtra ningún dato de la corrida que el modo personal sí sirve", async ({
    page,
  }) => {
    const response = await page.goto(ROUTES.reference);
    const html = (await response?.text()) ?? "";

    // Un runtime trabado no tiene una versión reducida del producto: nada del
    // contenido de la corrida puede aparecer, ni siquiera en el payload RSC.
    for (const leaked of [
      "FixtureCo",
      "13,55",
      "13.54613115387460161790309586190624",
      "fb0277d0",
      "b0c831f0",
      "Sensibilidad",
      "Hecho reportado",
    ]) {
      expect(html, `filtró "${leaked}"`).not.toContain(leaked);
    }
  });

  test("declara el modo trabado en el shell", async ({ page }) => {
    await page.goto(ROUTES.home);

    // El badge lleva un prefijo `sr-only` que nombra la dimensión, así que su
    // texto accesible completo es el que se afirma.
    await expect(page.getByText("Estado: Trabado")).toBeVisible();
    await expect(
      page.getByText("Runtime trabado · no se sirven datos"),
    ).toBeVisible();
  });

  test("mantiene el diagnóstico disponible, que es la salida del estado", async ({
    page,
  }) => {
    await page.goto(ROUTES.configuration);

    await expect(
      page.getByRole("heading", { level: 1, name: "Configuración" }),
    ).toBeVisible();
    await expect(page.getByText("locked")).toBeVisible();
  });

  test("nombra la configuración que falta, nunca su valor", async ({
    page,
  }) => {
    await page.goto(ROUTES.reference);

    await expect(
      page.getByText("Se muestran los nombres, nunca los valores."),
    ).toBeVisible();
    // `DATABASE_URL` se declara vacía en este servidor, así que el nombre es
    // legítimo y accionable.
    await expect(page.getByText("DATABASE_URL", { exact: true })).toBeVisible();
  });

  test("ningún valor de configuración aparece en el body ni en los headers", async ({
    page,
  }) => {
    for (const route of Object.values(ROUTES)) {
      const response = await page.goto(route);
      const html = (await response?.text()) ?? "";
      const headers = JSON.stringify(response?.headers() ?? {});

      for (const sentinel of SENTINEL_VALUES) {
        expect(html, `${route} filtró un centinela en el body`).not.toContain(
          sentinel,
        );
        expect(
          headers,
          `${route} filtró un centinela en un header`,
        ).not.toContain(sentinel);
      }

      // Los fragmentos de un connection string son lo que un leak parcial
      // dejaría escapar primero.
      expect(html).not.toContain("sentinel-direct-password");
      expect(html).not.toContain("postgresql://");
    }
  });

  test("responde 404 con su propia superficie, también trabado", async ({
    page,
  }) => {
    const response = await page.goto(ROUTES.missing);

    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { level: 1, name: "Esa ruta no existe" }),
    ).toBeVisible();
  });

  test("conserva los headers de seguridad base", async ({ page }) => {
    const response = await page.goto(ROUTES.home);
    const headers = response?.headers() ?? {};

    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBeDefined();
    expect(headers["x-powered-by"]).toBeUndefined();
  });
});
