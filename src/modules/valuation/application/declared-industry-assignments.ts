import {
  industryDeclarationSchema,
  type IndustryDeclaration,
} from "../domain/industry-mapping";

/**
 * Industrias declaradas por el owner para empresas cuyo SIC es ambiguo (`F3-05`).
 *
 * Una fila resuelve una ambigüedad con motivo escrito, como una sucesión o la
 * muestra del gate. Vacía hasta que el owner decida: una industria que el agente
 * eligiera acá sería la adivinanza que la regla prohíbe. Agregar una es un diff
 * revisable, y la evaluación dice que la industria salió de una declaración.
 */
export const DECLARED_INDUSTRY_ASSIGNMENTS: readonly IndustryDeclaration[] =
  Object.freeze(
    ([] as const satisfies readonly unknown[]).map((entry) =>
      industryDeclarationSchema.parse(entry),
    ),
  );
