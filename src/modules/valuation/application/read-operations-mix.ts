import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";

import type { OperationsMixDeclaration } from "../domain/operations-mix";
import {
  operationsMixDecisionOfDeclaration,
  operationsMixDecisionOfProposal,
  type OperationsMixDecision,
} from "../domain/qualitative-decisions";

import type { OperationsMixRepository } from "./operations-mix-repository";

/**
 * El mix de operaciones que una evaluación al corte puede usar (`F5-05`,
 * ADR 0034, decisión 6): la declaración del owner gana siempre —es el lock— y,
 * sin ella, la propuesta aceptada más reciente que ya existía al corte. Leerlo
 * nunca llama a un modelo.
 *
 * Devuelve la decisión entera, con las líneas transcriptas y la evidencia
 * resumida, porque es lo que la corrida congela en su snapshot (`F5-06`); los
 * pesos se derivan de ella con `operationsMixReadingOf`.
 */
export async function readOperationsMix(
  request: {
    readonly legalEntityId: string;
    readonly cik: string | null;
    readonly query: PointInTimeQuery;
    readonly declarations: readonly OperationsMixDeclaration[];
  },
  repository: Pick<OperationsMixRepository, "acceptedAsKnown">,
): Promise<OperationsMixDecision | null> {
  const declaration =
    request.cik === null
      ? undefined
      : request.declarations.find((candidate) => candidate.cik === request.cik);

  if (declaration !== undefined) {
    return operationsMixDecisionOfDeclaration(declaration);
  }

  const accepted = await repository.acceptedAsKnown(
    request.legalEntityId,
    request.query.knownAt ?? request.query.effectiveAt,
  );

  return accepted === null ? null : operationsMixDecisionOfProposal(accepted);
}
