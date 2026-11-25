import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";

import type { BusinessMixDeclaration } from "../domain/business-mix";
import {
  businessMixDecisionOfDeclaration,
  businessMixDecisionOfProposal,
  type BusinessMixDecision,
} from "../domain/qualitative-decisions";

import type { BusinessMixRepository } from "./business-mix-repository";

/**
 * La mezcla de negocios que una evaluación al corte puede usar (`F6-48`,
 * ADR 0086, decisión 6): la declaración del owner gana siempre —es el lock— y,
 * sin ella, la propuesta aceptada más reciente que ya existía al corte. Leerla
 * nunca llama a un modelo.
 *
 * Devuelve la decisión entera, aunque sea de una sola industria: la corrida la
 * congela sólo cuando `businessMixReadingOf` dice que es una mezcla.
 */
export async function readBusinessMix(
  request: {
    readonly legalEntityId: string;
    readonly cik: string | null;
    readonly query: PointInTimeQuery;
    readonly declarations: readonly BusinessMixDeclaration[];
  },
  repository: Pick<BusinessMixRepository, "acceptedAsKnown">,
): Promise<BusinessMixDecision | null> {
  const declaration =
    request.cik === null
      ? undefined
      : request.declarations.find((candidate) => candidate.cik === request.cik);

  if (declaration !== undefined) {
    return businessMixDecisionOfDeclaration(declaration);
  }

  const accepted = await repository.acceptedAsKnown(
    request.legalEntityId,
    request.query.knownAt ?? request.query.effectiveAt,
  );

  return accepted === null ? null : businessMixDecisionOfProposal(accepted);
}
