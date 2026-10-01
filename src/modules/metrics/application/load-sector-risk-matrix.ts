import type { CedearRegistryRepository } from "@/modules/cedears/application/cedear-registry-repository";
import { resolveCedearAccess } from "@/modules/cedears/domain/resolve-cedear-access";
import type { ClassificationRepository } from "@/modules/classification/application/classification-repository";
import { loadSectorPopulation } from "@/modules/classification/application/load-sector-population";
import {
  listSectors,
  SP500_SECTOR_TAXONOMY_ID,
} from "@/modules/classification/domain/sector-taxonomy";
import { securityTickersAt } from "@/modules/identity/domain/resolve-identity";
import type { PriceRepository } from "@/modules/prices/application/price-repository";
import {
  findDeclaredBenchmark,
  SP500_TOTAL_RETURN_BENCHMARK_ID,
} from "@/modules/prices/domain/declared-benchmarks";
import {
  subtractCalendarYears,
  subtractDays,
} from "@/modules/temporal/domain/calendar-date";
import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";
import {
  isEffectiveAt,
  isKnownAt,
} from "@/modules/temporal/domain/temporal-version";
import type { UniverseRepository } from "@/modules/universe/application/universe-repository";

import {
  buildSectorRiskMatrix,
  type CedearMark,
  type SectorMemberSeries,
  type SectorRiskMatrix,
} from "../domain/sector-risk-matrix";
import { SORTINO_WINDOW_YEARS } from "../domain/sortino";
import {
  assessSectorRiskQuality,
  type SectorRiskQuality,
} from "../domain/sector-risk-quality";

/**
 * Lectura de la matriz de riesgo de un sector (`F7-05`,
 * [ADR 0029](../../../../docs/architecture/adr/0029-reference-series-sector-risk-matrix.md)).
 *
 * Todo se lee al mismo corte: el cierre del `as_of`. La población, el ticker, el
 * emisor y el programa CEDEAR se resuelven con lo que se sabía ese día, y las
 * series se leen hasta ese día y no más. Las filas de precios son crudas e
 * inmutables, así que leerlas hasta el `as_of` reproduce exactamente lo que se
 * habría calculado entonces.
 *
 * La consulta está acotada (`TM-07`): un techo de miembros y una ventana de
 * fechas por serie. Superar el techo es un error, no un truncado.
 */
export const MAX_MATRIX_MEMBERS = 150;

/** Cuántos días hacia atrás se busca el cierre que funciona como `as_of`. */
export const AS_OF_LOOKBACK_DAYS = 10;

/** Días antes del inicio de 5 años que se leen para encontrar su base. */
const BASE_LOOKBACK_DAYS = 14;

export type SectorRiskMatrixErrorCode =
  /** El código no es un sector de la taxonomía declarada. */
  | "sector_unknown"
  /** No hay serie de referencia guardada: sin ella no hay contra qué comparar. */
  | "no_reference_series"
  /** La población supera el techo de la consulta. */
  | "population_too_large";

export class SectorRiskMatrixError extends Error {
  readonly code: SectorRiskMatrixErrorCode;

  constructor(code: SectorRiskMatrixErrorCode, message: string) {
    super(message);
    this.name = "SectorRiskMatrixError";
    this.code = code;
  }
}

export type LoadSectorRiskMatrixDependencies = {
  readonly universe: UniverseRepository;
  readonly classifications: ClassificationRepository;
  readonly prices: PriceRepository;
  readonly cedears: CedearRegistryRepository;
  /** Reloj inyectado: sólo decide la fecha pedida por defecto. */
  readonly today: () => string;
};

export type SectorRiskMatrixReading = {
  readonly matrix: SectorRiskMatrix;
  readonly quality: SectorRiskQuality;
  /** Fecha pedida; `matrix.asOf` es el cierre que se usó. */
  readonly requestedAsOf: string;
  readonly population: {
    readonly ruleVersion: string;
    readonly indexId: string;
    /** Miembros del índice al `as_of` sin sector: no entran en ninguna matriz. */
    readonly unclassified: number;
  };
  /** Series leídas: la matriz sólo sabe lo que estaba guardado. */
  readonly seriesWithoutRows: number;
};

const LOAD_CONCURRENCY = 8;

async function mapInBatches<TItem, TResult>(
  items: readonly TItem[],
  map: (item: TItem) => Promise<TResult>,
): Promise<TResult[]> {
  const results: TResult[] = [];

  for (let index = 0; index < items.length; index += LOAD_CONCURRENCY) {
    results.push(
      ...(await Promise.all(
        items.slice(index, index + LOAD_CONCURRENCY).map(map),
      )),
    );
  }

  return results;
}

export async function loadSectorRiskMatrix(
  request: { readonly sectorCode: string; readonly asOf: string | null },
  dependencies: LoadSectorRiskMatrixDependencies,
): Promise<SectorRiskMatrixReading> {
  const sector = listSectors().find(
    (candidate) => candidate.code === request.sectorCode,
  );

  if (sector === undefined) {
    throw new SectorRiskMatrixError(
      "sector_unknown",
      "The code is not a sector of the declared taxonomy.",
    );
  }

  const benchmark = findDeclaredBenchmark(SP500_TOTAL_RETURN_BENCHMARK_ID)!;

  // El `as_of` es un cierre de mercado: el último de la referencia en o antes
  // de la fecha pedida. Un sábado o un feriado no deja a todos los puntos en
  // `no_close_at_as_of`; se usa la rueda anterior y la página dice cuál.
  const requestedAsOf = request.asOf ?? dependencies.today();
  const recent = await dependencies.prices.loadBenchmarkSeries({
    benchmarkId: benchmark.benchmarkId,
    from: subtractDays(requestedAsOf, AS_OF_LOOKBACK_DAYS),
    to: requestedAsOf,
  });
  const asOf = recent.at(-1)?.marketDate ?? null;

  if (asOf === null) {
    throw new SectorRiskMatrixError(
      "no_reference_series",
      `No reference level is stored in the ${AS_OF_LOOKBACK_DAYS} days up to the requested date.`,
    );
  }

  const from = subtractDays(
    subtractCalendarYears(asOf, Math.max(...SORTINO_WINDOW_YEARS)),
    BASE_LOOKBACK_DAYS,
  );
  const cutoff = `${asOf}T23:59:59.999Z`;
  const query = pointInTimeQuerySchema.parse({
    effectiveAt: cutoff,
    revisionPolicy: "as_known",
    knownAt: cutoff,
    sourcePolicyVersion: "source-policy-1.0.0",
  });

  const { population, graph } = await loadSectorPopulation(
    { indexId: benchmark.indexId, code: request.sectorCode, query },
    dependencies,
  );

  if (population.members.length > MAX_MATRIX_MEMBERS) {
    throw new SectorRiskMatrixError(
      "population_too_large",
      `The sector has ${population.members.length} members; the ceiling is ${MAX_MATRIX_MEMBERS}.`,
    );
  }

  const [registry, referenceCloses] = await Promise.all([
    dependencies.cedears.loadRegistry({}),
    dependencies.prices.loadBenchmarkSeries({
      benchmarkId: benchmark.benchmarkId,
      from,
      to: asOf,
    }),
  ]);

  const legalNames = new Map(
    graph.legalEntities
      .filter(
        (entity) =>
          isEffectiveAt(entity, query.effectiveAt) && isKnownAt(entity, query),
      )
      .map((entity) => [entity.legalEntityId, entity.legalName]),
  );

  let seriesWithoutRows = 0;
  const members = await mapInBatches(
    population.members,
    async (member): Promise<SectorMemberSeries> => {
      const [closes, events] = await Promise.all([
        dependencies.prices.loadSeries({
          securityId: member.securityId,
          from,
          to: asOf,
        }),
        dependencies.prices.loadEvents({ securityId: member.securityId }),
      ]);

      if (closes.length === 0) {
        seriesWithoutRows += 1;
      }

      const [ticker] = securityTickersAt(graph, member.securityId, query);
      const access = resolveCedearAccess(registry, member.securityId, query);
      const [first] = access.status === "program" ? access.programs : [];
      const cedear: CedearMark =
        access.status === "program" && first !== undefined
          ? {
              status: "program",
              sourceId: first.program.sourceId,
              programs: access.programs.length,
              programStatus: first.program.status,
              ratio:
                first.ratio === null
                  ? null
                  : {
                      depositaryUnits: first.ratio.depositaryUnits,
                      underlyingUnits: first.ratio.underlyingUnits,
                    },
            }
          : {
              status: "none_known",
              reason:
                access.status === "none_known"
                  ? access.reason
                  : "not_effective_at_cutoff",
            };

      return {
        securityId: member.securityId,
        issuerLegalEntityId: member.issuerLegalEntityId,
        issuerName: legalNames.get(member.issuerLegalEntityId) ?? null,
        ticker: ticker?.symbol ?? null,
        mic: ticker?.mic ?? null,
        cedear,
        closes,
        events,
      };
    },
  );

  const [anyMember] = population.members;

  const matrix = buildSectorRiskMatrix({
    asOf,
    sector: {
      code: sector.code,
      label: sector.label,
      taxonomyId: SP500_SECTOR_TAXONOMY_ID,
      taxonomyVersion: anyMember?.taxonomyVersion ?? null,
    },
    reference: {
      benchmarkId: benchmark.benchmarkId,
      label: benchmark.label,
      closes: referenceCloses,
    },
    members,
  });

  return {
    requestedAsOf,
    matrix,
    quality: assessSectorRiskQuality({
      matrix,
      populationSecurityIds: population.members.map(
        (member) => member.securityId,
      ),
      requestedAsOf,
      seriesWithoutRows,
    }),
    population: {
      ruleVersion: population.ruleVersion,
      indexId: population.indexId,
      unclassified: population.unclassified.length,
    },
    seriesWithoutRows,
  };
}
