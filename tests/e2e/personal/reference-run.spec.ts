import { expect, test, type Page } from "@playwright/test";

import { ROUTES } from "../support/runtime";

/**
 * Corrida de referencia servida por un runtime personal (`F1-07`).
 *
 * La ruta existe para probar que el motor reproduce el mismo resultado en esta
 * instalación, así que el gate verifica precisamente eso sobre la página
 * renderizada: los hashes que `F1-05` dejó como evidencia, el valor por acción,
 * y que la evidencia que sostiene el número llegue completa al HTML.
 *
 * Los localizadores se anclan a la card o a la tabla que corresponde y no a un
 * texto suelto: varios valores —`13,55` entre ellos— aparecen a propósito en más
 * de un lugar de la página, y afirmar sobre el primero que aparezca probaría
 * cualquier cosa menos lo que dice el nombre del test.
 */
const INPUT_HASH =
  "fb0277d045ff984530436950619bee955b0ccf263466062643e0d2812bce8c25";
const RESULT_HASH =
  "b0c831f0b0d6fa09a87e9d3878b9966d1db74d7e30bb0067e1e88e5d15e24169";

function cardWithHeading(page: Page, name: string | RegExp) {
  return page
    .locator("[data-slot='card']")
    .filter({ has: page.getByRole("heading", { name }) })
    .first();
}

/** La única tabla de la página con `<caption>` es la matriz de sensibilidad. */
function sensitivityMatrix(page: Page) {
  return page
    .locator("table")
    .filter({ has: page.locator("caption") })
    .first();
}

test.beforeEach(async ({ page }) => {
  await page.goto(ROUTES.reference);
});

test.describe("corrida de referencia", () => {
  test("reproduce el hash de entrada y de resultado registrados en F1-05", async ({
    page,
  }) => {
    const headline = cardWithHeading(page, "Resultado de la corrida");

    // Los hashes viajan completos para lector de pantalla y se comparan carácter
    // por carácter: son la definición operativa de "reproducible".
    await expect(
      headline.getByText(INPUT_HASH, { exact: true }),
    ).toBeAttached();
    await expect(
      headline.getByText(RESULT_HASH, { exact: true }),
    ).toBeAttached();
  });

  test("muestra el valor por acción con su moneda y su valor exacto", async ({
    page,
  }) => {
    const headline = cardWithHeading(page, "Resultado de la corrida");

    await expect(
      headline.getByText("Valor por acción", { exact: true }),
    ).toBeVisible();
    await expect(headline.getByText("13,55", { exact: true })).toBeVisible();
    // El valor redondeado es para leer; el exacto es para auditar. Los dos están.
    await expect(
      headline.getByText("13.54613115387460161790309586190624"),
    ).toBeVisible();
  });

  test("declara el contrato point-in-time junto al resultado", async ({
    page,
  }) => {
    const headline = cardWithHeading(page, "Resultado de la corrida");

    for (const term of [
      "Tiempo efectivo",
      "Corte de conocimiento",
      "Política de revisión",
      "Base de conocimiento",
      "Acciones societarias",
    ]) {
      await expect(headline.getByText(term, { exact: true })).toBeVisible();
    }
  });

  test("dos cortes de conocimiento producen dos corridas con dos hashes", async ({
    page,
  }) => {
    const comparison = cardWithHeading(
      page,
      "El mismo modelo bajo otro corte de conocimiento",
    );

    // El restatement de FY2024 cambia el revenue base y con él el resultado. No
    // es una corrección de la primera corrida: son dos corridas.
    await expect(comparison.getByText("100.000.000")).toBeVisible();
    await expect(comparison.getByText("96.000.000")).toBeVisible();
    await expect(comparison.getByText("14,17")).toBeVisible();
    await expect(comparison.getByText("13,55")).toBeVisible();

    const shortHashes = await comparison
      .locator("code.numeric")
      .allTextContents();
    expect(new Set(shortHashes).size).toBe(2);
  });

  test("la sensibilidad declara sus celdas no definidas en vez de vaciarlas", async ({
    page,
  }) => {
    const undefinedCells = sensitivityMatrix(page)
      .locator("td")
      .filter({ hasText: "No definido" });

    // Las dos celdas donde `WACC <= g + buffer` quedan fuera del modelo: no caen
    // a cero, no quedan vacías y no heredan el valor vecino.
    await expect(undefinedCells).toHaveCount(2);

    for (const cell of await undefinedCells.all()) {
      // Cada una lleva su motivo en la lectura accesible, no sólo el rótulo.
      await expect(cell.locator(".sr-only")).toContainText("sin valor");
    }
  });

  test("la matriz de sensibilidad asocia cada celda con sus dos ejes", async ({
    page,
  }) => {
    const matrix = sensitivityMatrix(page);

    const caption = matrix.locator("caption");
    await expect(caption).toContainText("Unidad: valor por acción");
    await expect(caption).toContainText("Eje vertical: WACC");
    await expect(caption).toContainText("Eje horizontal: crecimiento terminal");

    // Grilla 5 × 5: seis encabezados de columna contando el rótulo del eje, y
    // cinco de fila.
    await expect(matrix.locator('th[scope="col"]')).toHaveCount(6);
    await expect(matrix.locator('th[scope="row"]')).toHaveCount(5);
    await expect(matrix.locator("tbody td")).toHaveCount(25);
  });

  test("el tinte de la grilla nunca es el único canal", async ({ page }) => {
    const computedCells = sensitivityMatrix(page)
      .locator("tbody td")
      .filter({ hasNotText: "No definido" });

    for (const cell of await computedCells.all()) {
      // Cada celda calculada lleva su importe escrito, no sólo un color.
      await expect(cell.locator("span.numeric").first()).not.toBeEmpty();
    }
  });

  test("separa hechos reportados de supuestos y de ausencias declaradas", async ({
    page,
  }) => {
    await expect(page.getByText("Hecho reportado").first()).toBeVisible();
    await expect(page.getByText("Supuesto").first()).toBeVisible();
    await expect(page.getByText("Ausencia declarada").first()).toBeVisible();
  });

  test("ninguna ausencia se presenta como un valor cero", async ({ page }) => {
    const evidence = page
      .locator("table")
      .filter({ hasText: "Hecho reportado" })
      .first();

    const cells = await evidence.locator("td").allTextContents();
    const bareZeros = cells.filter((text) => text.trim() === "0");

    expect(bareZeros).toHaveLength(0);
  });

  test("declara que la empresa es sintética y no emite recomendación", async ({
    page,
  }) => {
    await expect(
      page.getByText("Empresa sintética, no una empresa real"),
    ).toBeVisible();

    const headline = cardWithHeading(page, "Resultado de la corrida");
    await expect(headline).toContainText(
      "No es un precio objetivo ni una recomendación",
    );
  });

  test("marca bear, base y bull como planificados en vez de fabricarlos", async ({
    page,
  }) => {
    const scenarios = page
      .locator("section")
      .filter({
        has: page.getByRole("heading", {
          name: "Escenarios bear, base y bull",
        }),
      })
      .first();

    await expect(scenarios.getByText("Estado: Planificado")).toBeVisible();
  });

  test("las tablas anchas desplazan dentro de su contenedor", async ({
    page,
  }) => {
    const containers = page.locator("[data-slot='table-container']");
    const count = await containers.count();

    expect(count).toBeGreaterThan(0);

    for (let index = 0; index < count; index += 1) {
      const overflowX = await containers
        .nth(index)
        .evaluate((node) => getComputedStyle(node).overflowX);
      expect(["auto", "scroll"]).toContain(overflowX);
    }
  });

  test("una tabla que desborda es alcanzable por teclado", async ({ page }) => {
    const scrollableRegions = page.locator(
      "[data-slot='table-container'][role='region']",
    );

    // La región desplazable sólo aparece cuando la tabla realmente desborda; en
    // ese caso tiene que poder recibir foco para desplazarse sin mouse.
    for (const region of await scrollableRegions.all()) {
      await expect(region).toHaveAttribute("tabindex", "0");
      await expect(region).toHaveAttribute("aria-label", /tabla desplazable/);
    }
  });
});
