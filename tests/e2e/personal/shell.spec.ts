import { expect, test, type Page } from "@playwright/test";

import { ROUTES } from "../support/runtime";

/**
 * Abre la navegación cuando el viewport la sirve como drawer.
 *
 * En escritorio la sidebar es persistente; por debajo de `md` es un drawer
 * cerrado, así que sus enlaces no existen en el DOM hasta abrirlo. Sin esto, los
 * mismos tests probarían cosas distintas en cada proyecto y el fallo de mobile
 * parecería un defecto de la navegación.
 */
async function openNavigation(page: Page) {
  const sidebarIsPersistent = await page.evaluate(
    // El mismo umbral que `useIsMobile`; preguntarle al ancho evita depender de
    // si el drawer está a mitad de una transición.
    () => window.innerWidth >= 768,
  );

  if (sidebarIsPersistent) {
    await expect(page.locator("[data-slot='sidebar']").first()).toBeVisible();
    return;
  }

  // Después de elegir una ruta el drawer se cierra con una transición. Abrirlo
  // de nuevo antes de que termine deja el click sobre el backdrop y el test
  // falla por una carrera, no por la navegación.
  await expect(page.locator("[data-slot='sheet-overlay']")).toHaveCount(0);
  await page.locator("[data-slot='sidebar-trigger']").click();
  await expect(
    page.getByRole("link", { name: "Inicio", exact: true }),
  ).toBeVisible();
}

/**
 * Shell y navegación sobre un runtime personal (`F1-07`, `UI-02`).
 *
 * Prueba lo que el owner hace para llegar a cualquier parte: orientarse, saltar
 * al contenido, moverse por teclado y leer la página en un ancho de teléfono.
 */
test.describe("shell del portal", () => {
  test("declara el modo efectivo del runtime que sirve la página", async ({
    page,
  }) => {
    await page.goto(ROUTES.home);

    // El header y el footer leen el mismo modo. Si el artefacto horneara el
    // modo del build, este servidor no podría afirmarlo por su cuenta.
    await expect(page.getByText(/^Estado: Personal · /)).toBeVisible();
    await expect(
      page.getByText(
        "Portal personal · código público · datos reales protegidos",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: "Inicio" }),
    ).toBeVisible();
  });

  test("el skip link es el primer destino de tabulación y lleva al contenido", async ({
    page,
  }) => {
    await page.goto(ROUTES.home);
    await page.keyboard.press("Tab");

    const skipLink = page.getByRole("link", { name: "Saltar al contenido" });
    await expect(skipLink).toBeFocused();
    // Oculto hasta recibir foco: si estuviera siempre visible sería ruido, y si
    // no apareciera al enfocarlo no serviría para nada.
    await expect(skipLink).toBeVisible();

    await skipLink.press("Enter");
    await expect(page.locator("#contenido")).toBeAttached();
    expect(page.url()).toContain("#contenido");
  });

  test("navega a las tres superficies reales y marca la actual", async ({
    page,
  }) => {
    await page.goto(ROUTES.home);
    await openNavigation(page);

    await page.getByRole("link", { name: "Valuación" }).click();
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Corrida de referencia del motor",
      }),
    ).toBeVisible();

    // En mobile el drawer se cierra al elegir una ruta, así que hay que volver a
    // abrirlo para leer la marca de ruta actual.
    await openNavigation(page);
    await expect(page.getByRole("link", { name: "Valuación" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await page.getByRole("link", { name: "Configuración" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Configuración" }),
    ).toBeVisible();
  });

  test("las herramientas planificadas se anuncian como no disponibles", async ({
    page,
  }) => {
    await page.goto(ROUTES.home);
    await openNavigation(page);

    for (const label of ["Empresas", "Matrices", "Argentina", "Agro"]) {
      const item = page.getByRole("button", { name: new RegExp(label) });
      // El estado se anuncia con `aria-disabled` para conservar el tooltip que
      // etiqueta el control cuando la sidebar está colapsada.
      await expect(item).toHaveAttribute("aria-disabled", "true");
      await expect(item).toHaveCSS("pointer-events", "none");
    }
  });

  test("el buscador global existe como forma, no como capacidad", async ({
    page,
  }) => {
    await page.goto(ROUTES.home);

    // Sin abrir el drawer: mientras está abierto es modal y deja el resto de la
    // página fuera del árbol de accesibilidad, que es lo correcto.
    await expect(page.getByRole("searchbox")).toBeDisabled();
  });

  test("cada superficie tiene un único h1 y no saltea niveles de encabezado", async ({
    page,
  }) => {
    for (const route of [ROUTES.home, ROUTES.configuration, ROUTES.reference]) {
      await page.goto(route);

      const levels = await page
        .locator("h1, h2, h3, h4, h5, h6")
        .evaluateAll((nodes) =>
          nodes.map((node) => Number(node.tagName.slice(1))),
        );

      expect(
        levels.filter((level) => level === 1),
        route,
      ).toHaveLength(1);
      expect(levels[0], route).toBe(1);

      for (const [index, level] of levels.entries()) {
        if (index === 0) continue;
        // Un salto de h2 a h4 rompe la lectura con lector de pantalla aunque se
        // vea idéntico.
        expect(
          level - levels[index - 1],
          `${route} en el índice ${index}`,
        ).toBeLessThanOrEqual(1);
      }
    }
  });

  test("la navegación por teclado recorre la página sin trampas de foco", async ({
    page,
  }) => {
    await page.goto(ROUTES.home);

    const reached: string[] = [];

    for (let step = 0; step < 25; step += 1) {
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(() => {
        const element = document.activeElement;
        if (!element) return null;
        return (
          element.getAttribute("aria-label") ??
          element.textContent?.trim().slice(0, 40) ??
          element.tagName
        );
      });

      if (focused) reached.push(focused);
    }

    expect(reached).toContain("Saltar al contenido");
    // Ningún control retiene el foco: 25 pulsaciones recorren varios destinos
    // distintos. El umbral es bajo a propósito —en el ancho de teléfono la
    // navegación vive en un drawer cerrado y hay menos controles en la página—;
    // lo que descarta una trampa de foco es que el recorrido avance, no cuántos
    // destinos tenga.
    expect(new Set(reached).size).toBeGreaterThan(3);
    expect(reached.at(-1)).not.toBe(reached[0]);

    const sidebarIsPersistent = await page
      .locator("[data-slot='sidebar']")
      .first()
      .isVisible();

    if (sidebarIsPersistent) {
      // En escritorio la navegación forma parte del recorrido de la página.
      expect(reached.some((label) => label.includes("Valuación"))).toBe(true);
    }
  });

  test("en mobile el drawer de navegación contiene el foco y devuelve el control", async ({
    page,
  }) => {
    await page.goto(ROUTES.home);

    const sidebar = page.locator("[data-slot='sidebar']").first();
    test.skip(
      await sidebar.isVisible(),
      "La sidebar es persistente en este viewport; no hay drawer que probar.",
    );

    await openNavigation(page);

    // Un drawer modal debe atrapar el foco mientras está abierto: eso no es una
    // trampa, es lo que evita tabular hacia contenido que quedó tapado.
    const insideDrawer = await page.evaluate(() =>
      Boolean(
        document
          .querySelector("[data-slot='sidebar'][data-mobile='true']")
          ?.contains(document.activeElement),
      ),
    );
    expect(insideDrawer).toBe(true);

    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("link", { name: "Inicio", exact: true }),
    ).toBeHidden();

    // Y devolverlo al control que lo abrió, no al principio del documento.
    await expect(page.locator("[data-slot='sidebar-trigger']")).toBeFocused();
  });

  test("el foco siempre queda visible", async ({ page }) => {
    await page.goto(ROUTES.home);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");

    const outline = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element) return null;
      const style = getComputedStyle(element);
      return {
        outlineWidth: style.outlineWidth,
        outlineStyle: style.outlineStyle,
        boxShadow: style.boxShadow,
      };
    });

    expect(outline).not.toBeNull();
    const hasRing =
      (outline?.outlineStyle !== "none" &&
        Number.parseFloat(outline?.outlineWidth ?? "0") > 0) ||
      (outline?.boxShadow !== "none" && (outline?.boxShadow ?? "").length > 0);
    expect(hasRing).toBe(true);
  });

  test("ninguna superficie desborda horizontalmente en el viewport activo", async ({
    page,
  }, testInfo) => {
    for (const route of [
      ROUTES.home,
      ROUTES.configuration,
      ROUTES.reference,
      ROUTES.missing,
    ]) {
      await page.goto(route);

      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );

      // Las tablas anchas desplazan dentro de su contenedor; el body nunca.
      expect(
        overflow,
        `${route} en ${testInfo.project.name}`,
      ).toBeLessThanOrEqual(1);
    }
  });

  test("responde 404 con una superficie propia y navegable", async ({
    page,
  }) => {
    const response = await page.goto(ROUTES.missing);

    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { level: 1, name: "Esa ruta no existe" }),
    ).toBeVisible();
    // Conserva el shell: el error no deja al owner sin salida.
    await expect(
      page.getByRole("link", { name: "Volver al inicio" }),
    ).toBeVisible();

    await page.getByRole("link", { name: "Volver al inicio" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Inicio" }),
    ).toBeVisible();
  });
});
