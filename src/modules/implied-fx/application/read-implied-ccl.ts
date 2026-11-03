import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";

import { DECLARED_ADR_PAIRS, legIdOf } from "../domain/declared-adr-pairs";
import { computeImpliedCcl, type ImpliedCclPoint } from "../domain/implied-ccl";

import type { AdrPairRepository } from "./adr-pair-repository";

/**
 * El CCL implícito como se conocía al corte (`F9-07`, ADR 0068). Entran las
 * ruedas hasta la fecha efectiva; con `as_known`, sólo los cierres que una
 * corrida ya había registrado al `knownAt`, porque una pata no tiene otra fecha
 * de publicación que la de su descarga.
 */
export async function readImpliedCcl(
  query: PointInTimeQuery,
  repository: AdrPairRepository,
): Promise<readonly ImpliedCclPoint[]> {
  const legIds = DECLARED_ADR_PAIRS.flatMap((pair) => [
    legIdOf(pair.pairId, "adr"),
    legIdOf(pair.pairId, "local"),
  ]);
  const stored = await repository.listLegCloses(
    legIds,
    query.effectiveAt.slice(0, 10),
  );
  const closes =
    query.revisionPolicy === "latest_restated"
      ? stored
      : stored.filter(
          (close) => Date.parse(close.recordedAt) <= Date.parse(query.knownAt),
        );

  return computeImpliedCcl(DECLARED_ADR_PAIRS, closes);
}
