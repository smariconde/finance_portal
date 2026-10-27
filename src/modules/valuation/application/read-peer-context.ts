import type { ClassificationRepository } from "@/modules/classification/application/classification-repository";
import { SP500_SECTOR_TAXONOMY_ID } from "@/modules/classification/domain/sector-taxonomy";
import type { SubjectClassification } from "@/modules/classification/domain/subject-classification";
import { resolveClassificationAt } from "@/modules/classification/domain/subject-classification";
import type { IdentityGraph } from "@/modules/identity/domain/identity-graph";
import type { PriceRepository } from "@/modules/prices/application/price-repository";
import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";

import type { AnnualFundamentals } from "../domain/annual-fundamentals";
import {
  compareWithMarketPrice,
  type MarketPriceComparison,
} from "../domain/market-implied";
import {
  peerContext,
  peerMetrics,
  peerWindowFrom,
  type BaseNetIncome,
  type PeerContext,
  type PeerEntry,
} from "../domain/peer-context";
import { valuationRunSchema, type ValuationRun } from "../domain/valuation-run";
import { readAnnualFundamentals } from "./assess-company";
import { issuerFactsAt } from "./issuer-facts";
import type { ValuationResultDependencies } from "./read-valuation-result";
import type { ValuationRunRepository } from "./valuation-run-repository";

/** Los métodos que el job registra y que la página sabe leer. */
const PEER_METHODS = ["fcff_base", "normalized_fcff"] as const;

/** Lecturas en paralelo por tanda: acota las conexiones del pool. */
const PEER_READ_CONCURRENCY = 6;

export type PeerContextDependencies = {
  readonly runs: Pick<ValuationRunRepository, "listLatestInWindow">;
  readonly classifications: Pick<
    ClassificationRepository,
    "loadClassifications"
  >;
  readonly prices: Pick<PriceRepository, "loadSeries" | "loadEvents">;
  readonly fundamentals: ValuationResultDependencies["fundamentals"];
};

async function inBatches<T, R>(
  items: readonly T[],
  map: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];

  for (let start = 0; start < items.length; start += PEER_READ_CONCURRENCY) {
    results.push(
      ...(await Promise.all(
        items.slice(start, start + PEER_READ_CONCURRENCY).map(map),
      )),
    );
  }

  return results;
}

/** La ganancia neta del año base de la corrida, como la ve la serie al corte. */
export function baseNetIncome(
  run: Pick<ValuationRun, "input">,
  series: AnnualFundamentals | null,
): BaseNetIncome | null {
  const end = run.input.normalization.facts.baseFiscalYearEnd;
  const item = series?.fiscalYears.find((year) => year.fiscalYearEnd === end)
    ?.items.net_income;

  return item === undefined
    ? null
    : { value: item.value, currency: item.currency };
}

function sectorAt(
  classifications: readonly SubjectClassification[],
  query: PointInTimeQuery,
  legalEntityId: string,
) {
  const resolution = resolveClassificationAt(
    classifications,
    SP500_SECTOR_TAXONOMY_ID,
    query,
    legalEntityId,
  );

  return resolution.classified
    ? ({ status: "classified", code: resolution.classification.code } as const)
    : ({ status: "unclassified", reason: resolution.absence } as const);
}

/**
 * La brecha frente a los pares (`F6-19`). Lee la última corrida de cada
 * empresa en la ventana, su cierre al día de su propia corrida y, sólo para
 * los del sector, su ganancia neta al corte de esa corrida. El sector de todos
 * se lee al corte de la empresa: un par reclasificado después no cambia de
 * grupo en una lectura anterior. Nada se recalcula ni se escribe.
 */
export async function readPeerContext(
  input: {
    readonly run: ValuationRun;
    readonly series: AnnualFundamentals | null;
    /** La comparación con el precio que la página ya leyó (`F6-09`). */
    readonly comparison: MarketPriceComparison;
    readonly graph: IdentityGraph;
    readonly subjectOf: (
      run: ValuationRun,
    ) => { readonly symbol: string | null; readonly legalName: string } | null;
  },
  dependencies: PeerContextDependencies,
): Promise<PeerContext> {
  const { run, graph } = input;
  const knowledge = run.provenance.knowledge;
  const [stored, classifications] = await Promise.all([
    dependencies.runs.listLatestInWindow({
      from: peerWindowFrom(run.asOf),
      to: run.asOf,
      methods: [...PEER_METHODS],
    }),
    dependencies.classifications.loadClassifications({
      taxonomyId: SP500_SECTOR_TAXONOMY_ID,
    }),
  ]);
  const sector = sectorAt(
    classifications,
    knowledge,
    run.subject.legalEntityId,
  );
  const readers = dependencies.fundamentals(
    (subjectId) => issuerFactsAt(graph, subjectId, null, knowledge).cik,
  );

  const comparisonOf = async (peerRun: ValuationRun) => {
    const securityId = peerRun.subject.securityId;
    const [closes, events] = await Promise.all([
      dependencies.prices.loadSeries({
        securityId,
        from: peerRun.asOf,
        to: peerRun.asOf,
        limit: 2,
      }),
      dependencies.prices.loadEvents({ securityId }),
    ]);

    return compareWithMarketPrice({
      run: peerRun,
      closes: closes.map(({ marketDate, close, currency }) => ({
        marketDate,
        close,
        currency,
      })),
      events,
    });
  };

  const peerRuns = stored.flatMap((candidate) => {
    const parsed = valuationRunSchema.safeParse(candidate);
    return parsed.success &&
      parsed.data.subject.legalEntityId !== run.subject.legalEntityId
      ? [parsed.data]
      : [];
  });

  const candidates = await inBatches(
    peerRuns,
    async (peerRun): Promise<PeerEntry> => {
      const peerSector = sectorAt(
        classifications,
        knowledge,
        peerRun.subject.legalEntityId,
      );
      const inSector =
        sector.status === "classified" &&
        peerSector.status === "classified" &&
        peerSector.code === sector.code;
      // La ganancia neta sólo hace falta para el P/E del sector: leer la
      // serie de todo lo valuado sería trabajo que nadie muestra.
      const series = inSector
        ? (
            await readAnnualFundamentals(
              peerRun.subject.legalEntityId,
              peerRun.provenance.knowledge,
              readers,
            )
          ).series
        : null;
      const identity = input.subjectOf(peerRun);

      return {
        legalEntityId: peerRun.subject.legalEntityId,
        symbol: identity?.symbol ?? null,
        legalName: identity?.legalName ?? null,
        sector: peerSector.status === "classified" ? peerSector.code : null,
        method: peerRun.method,
        status: peerRun.status,
        asOf: peerRun.asOf,
        currency: peerRun.currency,
        metrics: peerMetrics({
          run: peerRun,
          comparison: await comparisonOf(peerRun),
          netIncome: inSector ? baseNetIncome(peerRun, series) : null,
        }),
      };
    },
  );

  return peerContext({
    company: run,
    companyMetrics: peerMetrics({
      run,
      comparison: input.comparison,
      netIncome: baseNetIncome(run, input.series),
    }),
    sector,
    candidates,
  });
}
