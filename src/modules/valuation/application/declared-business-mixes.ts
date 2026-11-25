import {
  businessMixDeclarationSchema,
  type BusinessMixDeclaration,
} from "../domain/business-mix";

/**
 * Mezclas de negocios declaradas por el owner (`F6-48`, ADR 0086, decisión 6).
 *
 * Es el lock: con una fila vigente para un CIK no se le pregunta al modelo y
 * ninguna propuesta se lee. Los pesos son los del valor —ya multiplicados por
 * el EV/Sales que el owner haya elegido—, como fracciones exactas que suman 1.
 * Vacía hasta que el owner decida: una mezcla que el agente escribiera acá
 * sería la adivinanza que la regla prohíbe. Agregar una es un diff revisable,
 * con motivo escrito.
 */
export const DECLARED_BUSINESS_MIXES: readonly BusinessMixDeclaration[] =
  Object.freeze(
    ([] as const satisfies readonly unknown[]).map((entry) =>
      businessMixDeclarationSchema.parse(entry),
    ),
  );
