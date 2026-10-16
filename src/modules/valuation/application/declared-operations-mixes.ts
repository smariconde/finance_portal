import {
  operationsMixDeclarationSchema,
  type OperationsMixDeclaration,
} from "../domain/operations-mix";

/**
 * Mixes de operaciones declarados por el owner (`F5-05`, ADR 0034, decisión 6).
 *
 * Es el lock de la metodología: con una fila vigente para un CIK no se le
 * pregunta al modelo y ninguna propuesta se lee. Vacía hasta que el owner
 * decida: un mix que el agente escribiera acá sería la adivinanza que la regla
 * prohíbe. Agregar una es un diff revisable, con motivo escrito.
 */
export const DECLARED_OPERATIONS_MIXES: readonly OperationsMixDeclaration[] =
  Object.freeze(
    ([] as const satisfies readonly unknown[]).map((entry) =>
      operationsMixDeclarationSchema.parse(entry),
    ),
  );

export function declaredOperationsMix(
  cik: string,
  declarations: readonly OperationsMixDeclaration[] = DECLARED_OPERATIONS_MIXES,
): OperationsMixDeclaration | null {
  return declarations.find((declaration) => declaration.cik === cik) ?? null;
}
