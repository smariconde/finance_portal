import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/**
 * Chequeo automatizado de accesibilidad (`UI-02`).
 *
 * El umbral que rompe el gate es cero findings `serious` o `critical`. Es un
 * piso mecánico, no un certificado: axe no evalúa jerarquía de lectura, calidad
 * del copy ni si una tabla dice algo verdadero. La revisión de Impeccable y el
 * walkthrough de `F1-08` siguen siendo necesarios.
 */
const BLOCKING_IMPACTS = new Set(["serious", "critical"]);

export async function expectNoAccessibilityViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

  const blocking = results.violations.filter((violation) =>
    BLOCKING_IMPACTS.has(violation.impact ?? ""),
  );

  // El mensaje nombra la regla y el nodo: un fallo tiene que ser accionable sin
  // volver a correr el gate con un reporter distinto.
  const summary = blocking.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => node.target.join(" ")),
  }));

  expect(summary, `Findings bloqueantes de axe en ${page.url()}`).toEqual([]);

  return results;
}
