import type { ClassificationRepository } from "@/modules/classification/application/classification-repository";
import { loadSectorPopulation } from "@/modules/classification/application/load-sector-population";
import { listSectors } from "@/modules/classification/domain/sector-taxonomy";
import type { PriceRepository } from "@/modules/prices/application/price-repository";
import {
  findDeclaredBenchmark,
  SP500_TOTAL_RETURN_BENCHMARK_ID,
} from "@/modules/prices/domain/declared-benchmarks";
import { subtractDays } from "@/modules/temporal/domain/calendar-date";
import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";
import type { UniverseRepository } from "@/modules/universe/application/universe-repository";

/**
 * Cobertura de precios por sector, a hoy (`F7-05`).
 *
 * Es lo que el índice de matrices muestra antes de entrar a una: cuántas
 * securities del sector tienen cierres recientes. Un sector sin precios se ve
 * como tal, no como una matriz llena de `no_close_at_as_of` que parezca una
 * respuesta.
 */
export const RECENT_CLOSE_DAYS = 14;

export type SectorCoverage = {
  readonly code: string;
  readonly label: string;
  readonly members: number;
  readonly withRecentCloses: number;
};

export type SectorCoverageSummary = {
  readonly today: string;
  readonly sectors: readonly SectorCoverage[];
  /** Último nivel guardado de la referencia; `null` si no hay ninguno. */
  readonly referenceLatest: string | null;
  readonly referenceLabel: string;
};

export async function summarizeSectorCoverage(dependencies: {
  readonly universe: UniverseRepository;
  readonly classifications: ClassificationRepository;
  readonly prices: PriceRepository;
  readonly today: () => string;
}): Promise<SectorCoverageSummary> {
  const today = dependencies.today();
  const cutoff = `${today}T23:59:59.999Z`;
  const query = pointInTimeQuerySchema.parse({
    effectiveAt: cutoff,
    revisionPolicy: "as_known",
    knownAt: cutoff,
    sourcePolicyVersion: "source-policy-1.0.0",
  });
  const benchmark = findDeclaredBenchmark(SP500_TOTAL_RETURN_BENCHMARK_ID)!;
  const since = subtractDays(today, RECENT_CLOSE_DAYS);

  const [{ population }, covered, reference] = await Promise.all([
    loadSectorPopulation(
      { indexId: benchmark.indexId, code: null, query },
      dependencies,
    ),
    dependencies.prices.listSecuritiesWithClosesSince({ from: since }),
    dependencies.prices.loadBenchmarkSeries({
      benchmarkId: benchmark.benchmarkId,
      from: since,
    }),
  ]);
  const coveredIds = new Set(covered);

  return {
    today,
    referenceLatest: reference.at(-1)?.marketDate ?? null,
    referenceLabel: benchmark.label,
    sectors: listSectors().map((sector) => {
      const members = population.members.filter(
        (member) => member.code === sector.code,
      );

      return {
        ...sector,
        members: members.length,
        withRecentCloses: members.filter((member) =>
          coveredIds.has(member.securityId),
        ).length,
      };
    }),
  };
}
