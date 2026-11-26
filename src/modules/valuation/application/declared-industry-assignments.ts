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
        {
          // SIC 3600 es el encabezado del grupo 36 y no tiene fila en el
          // mapeo; ninguna industria del grupo es aeroespacial (`F6-52`).
          cik: "0000040545",
          ticker: "GE",
          industryKey: "aerospace-defense",
          decidedBy: "owner",
          decidedOn: "2026-11-25",
          rationale:
            "Decisión del owner el 2026-11-25. Desde la escisión de GE HealthCare (2023) y GE Vernova (2024), GE es GE Aerospace: motores de aviación comercial y de defensa y sus servicios. Su SIC 3600 quedó de la General Electric diversificada.",
        },
        {
          // SIC 4832 es radiodifusión: «broadcasting» le daba la beta y la
          // estructura de radio y TV (0,32 y D/E 0,86), medido en `F6-55`.
          cik: "0001639920",
          ticker: "SPOT",
          industryKey: "entertainment",
          decidedBy: "owner",
          decidedOn: "2026-11-25",
          rationale:
            "Decisión del owner el 2026-11-25. Spotify es streaming de música, podcasts y audiolibros por suscripción y publicidad: la industria con que Damodaran la clasifica y la fila de su vida de I+D. Su SIC 4832 (radio) la ponía en «broadcasting».",
        },
      ] as const satisfies readonly unknown[]
    ).map((entry) => industryDeclarationSchema.parse(entry)),
  );
