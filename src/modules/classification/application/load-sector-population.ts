import type { IdentityGraph } from "@/modules/identity/domain/identity-graph";
import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";
import {
  isEffectiveAt,
  isKnownAt,
} from "@/modules/temporal/domain/temporal-version";
import type { UniverseRepository } from "@/modules/universe/application/universe-repository";

import {
  resolveSectorPopulation,
  type SectorPopulation,
} from "../domain/resolve-sector-population";
import { SP500_SECTOR_TAXONOMY_ID } from "../domain/sector-taxonomy";

import type { ClassificationRepository } from "./classification-repository";

export type LoadSectorPopulationDependencies = {
  readonly universe: UniverseRepository;
  readonly classifications: ClassificationRepository;
};

/**
 * La población de un sector al corte, leída de los repositorios
 * ([ADR 0025](../../../../docs/architecture/adr/0025-declared-sector-classification.md)).
 *
 * El emisor de cada security sale de su versión vigente al mismo corte: una
 * reorganización cambia el emisor sin cambiar el instrumento, y la clasificación
 * es del emisor. Devuelve también el grafo, porque quien pide una población casi
 * siempre necesita después el ticker de cada miembro.
 */
export async function loadSectorPopulation(
  input: {
    readonly indexId: string;
    readonly code: string | null;
    readonly query: PointInTimeQuery;
  },
  dependencies: LoadSectorPopulationDependencies,
): Promise<{
  readonly population: SectorPopulation;
  readonly graph: IdentityGraph;
}> {
  const [state, classifications] = await Promise.all([
    // Historia completa: el corte puede ser pasado, y con sólo lo vigente un
    // ticker renombrado o un emisor reorganizado se leerían con el valor de hoy.
    dependencies.universe.loadState({
      indexId: input.indexId,
      versions: "all",
    }),
    dependencies.classifications.loadClassifications({
      taxonomyId: SP500_SECTOR_TAXONOMY_ID,
    }),
  ]);

  const issuers = state.graph.securities
    .filter(
      (version) =>
        isEffectiveAt(version, input.query.effectiveAt) &&
        isKnownAt(version, input.query),
    )
    .map((version) => ({
      securityId: version.securityId,
      issuerLegalEntityId: version.issuerLegalEntityId,
    }));

  return {
    graph: state.graph,
    population: resolveSectorPopulation({
      indexId: input.indexId,
      memberships: state.memberships,
      issuers,
      classifications,
      query: input.query,
      code: input.code,
    }),
  };
}
