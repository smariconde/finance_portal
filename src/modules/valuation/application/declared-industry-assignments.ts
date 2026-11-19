import {
  industryDeclarationSchema,
  type IndustryDeclaration,
} from "../domain/industry-mapping";

/**
 * Industrias declaradas por el owner para empresas cuyo SIC es ambiguo (`F3-05`).
 *
 * Una fila resuelve una ambigüedad con motivo escrito, como una sucesión o la
 * muestra del gate. Sólo el owner decide: una industria que el agente eligiera
 * por su cuenta sería la adivinanza que la regla prohíbe. Agregar una es un
 * diff revisable, y la evaluación dice que la industria salió de una
 * declaración.
 */
export const DECLARED_INDUSTRY_ASSIGNMENTS: readonly IndustryDeclaration[] =
  Object.freeze(
    (
      [
        {
          // SIC 7389 sólo admite servicios, financieras no bancarias e
          // información; la IA se abstuvo en los cuatro peldaños (`F6-33`).
          cik: "0001099590",
          ticker: "MELI",
          industryKey: "retail-general",
          decidedBy: "owner",
          decidedOn: "2026-11-19",
          rationale:
            "Decisión delegada por el owner el 2026-11-19. Marketplace y retail online: la misma industria que la IA eligió para AMZN (SIC 5961). La release de enero de 2026 no tiene «Retail (Online)», y «financiera no bancaria» describiría sólo a Mercado Pago, no al comercio.",
        },
      ] as const satisfies readonly unknown[]
    ).map((entry) => industryDeclarationSchema.parse(entry)),
  );
