import path from "node:path";

import type { Page, TestInfo } from "@playwright/test";

/**
 * Capturas de evidencia del gate (`UI-02`).
 *
 * Se regeneran corriendo `pnpm test:e2e`, así que la evidencia visual deja de
 * depender de que alguien se acuerde de sacarlas a mano. Van a
 * `.impeccable/review/`, que está en `.gitignore`: son evidencia para leer en la
 * máquina del owner, no un oráculo del test ni un artefacto del repositorio.
 *
 * La [ADR 0006](../../../docs/architecture/adr/0006-e2e-accessibility-harness.md)
 * fija la regla que las hace seguras: sólo se capturan runtimes cuyo contenido
 * es sintético o la negativa del runtime trabado. Ninguna captura sobre datos
 * reales del owner entra acá, ni siquiera recortada.
 */
const REVIEW_DIRECTORY = path.join(".impeccable", "review");

export async function captureEvidence(
  page: Page,
  testInfo: TestInfo,
  name: string,
) {
  await page.screenshot({
    path: path.join(REVIEW_DIRECTORY, `${testInfo.project.name}-${name}.png`),
    fullPage: true,
    animations: "disabled",
  });
}
