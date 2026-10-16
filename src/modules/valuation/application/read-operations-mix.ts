import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";

import type { OperationsMixReading } from "../domain/cost-of-capital";
import {
  OPERATIONS_MIX_WEIGHTS_VERSION,
  weightsOfDeclaration,
  weightsOfProposal,
  type OperationsMixDeclaration,
} from "../domain/operations-mix";

import type { OperationsMixRepository } from "./operations-mix-repository";

/**
 * El mix de operaciones que una evaluación al corte puede usar (`F5-05`,
 * ADR 0034, decisión 6): la declaración del owner gana siempre —es el lock— y,
 * sin ella, la propuesta aceptada más reciente que ya existía al corte. Leerlo
 * nunca llama a un modelo.
 */
export async function readOperationsMix(
  request: {
    readonly legalEntityId: string;
    readonly cik: string | null;
    readonly query: PointInTimeQuery;
    readonly declarations: readonly OperationsMixDeclaration[];
  },
  repository: Pick<OperationsMixRepository, "acceptedAsKnown">,
): Promise<OperationsMixReading | null> {
  const declaration =
    request.cik === null
      ? undefined
      : request.declarations.find((candidate) => candidate.cik === request.cik);

  if (declaration !== undefined) {
    return {
      source: "owner_declaration",
      proposalId: null,
      weightsVersion: OPERATIONS_MIX_WEIGHTS_VERSION,
      exposures: weightsOfDeclaration(declaration),
    };
  }

  const accepted = await repository.acceptedAsKnown(
    request.legalEntityId,
    request.query.knownAt ?? request.query.effectiveAt,
  );

  return accepted === null
    ? null
    : {
        source: "ai_proposal",
        proposalId: accepted.proposal.proposalId,
        weightsVersion: OPERATIONS_MIX_WEIGHTS_VERSION,
        exposures: weightsOfProposal(accepted.lines),
      };
}
