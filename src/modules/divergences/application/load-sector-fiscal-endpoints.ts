import type { ClassificationRepository } from "@/modules/classification/application/classification-repository";
import { loadSectorPopulation } from "@/modules/classification/application/load-sector-population";
import { listSectors } from "@/modules/classification/domain/sector-taxonomy";
import type { IdentityGraph } from "@/modules/identity/domain/identity-graph";
import { securityTickersAt } from "@/modules/identity/domain/resolve-identity";
import type { PriceRepository } from "@/modules/prices/application/price-repository";
import {
  subtractCalendarYears,
  subtractDays,
} from "@/modules/temporal/domain/calendar-date";
import {
  pointInTimeQuerySchema,
  type PointInTimeQuery,
  type PointInTimeQueryInput,
} from "@/modules/temporal/domain/point-in-time-query";
import {
  isEffectiveAt,
  isKnownAt,
} from "@/modules/temporal/domain/temporal-version";
import type { UniverseRepository } from "@/modules/universe/application/universe-repository";
import { SP500_INDEX_ID } from "@/modules/universe/application/live-universe-source";
import {
  buildAnnualFundamentals,
  chooseFiscalYearAnchor,
  type FundamentalRow,
} from "@/modules/valuation/domain/annual-fundamentals";

import {
  selectFiscalEndpoints,
  type FiscalEndpointPair,
} from "../domain/fiscal-endpoints";

/** Bounded reads: a larger sector must be explicitly reconsidered. */
export const MAX_DIVERGENCE_MEMBERS = 150;
const LOAD_CONCURRENCY = 4;
const PRICE_LOOKBACK_YEARS = 7;

export type FiscalFactReaders = {
  readonly readFacts: (
    legalEntityId: string,
    query: PointInTimeQuery,
  ) => Promise<readonly FundamentalRow[]>;
  readonly fiscalYearAnchors: (
    legalEntityIds: readonly string[],
  ) => Promise<readonly string[]>;
};

export type LoadSectorFiscalDependencies = {
  readonly universe: UniverseRepository;
  readonly classifications: ClassificationRepository;
  readonly prices: PriceRepository;
  readonly createFactReaders: (
    graph: IdentityGraph,
    query: PointInTimeQuery,
  ) => FiscalFactReaders;
};

export type SectorFiscalMember = {
  readonly securityId: string;
  readonly issuerLegalEntityId: string;
  readonly ticker: string | null;
  readonly twoYears: FiscalEndpointPair;
  readonly fiveYears: FiscalEndpointPair;
};

export type SectorFiscalReading = {
  readonly sectorCode: string;
  readonly query: PointInTimeQuery;
  readonly populationVersion: string;
  readonly taxonomyVersion: string | null;
  readonly members: readonly SectorFiscalMember[];
};

export class SectorFiscalReadError extends Error {
  constructor(
    readonly code:
      | "sector_unknown"
      | "population_too_large"
      | "adjustment_basis_unsupported",
  ) {
    super(code);
    this.name = "SectorFiscalReadError";
  }
}

/**
 * One sector, one historical query. Facts are selected through the issuer's
 * reporting lineage; prices belong to each security. The same issuer may have
 * multiple securities, so its SEC read is shared but its prices stay separate.
 * This is read-only and opens no provider socket.
 */
export async function loadSectorFiscalEndpoints(
  request: {
    readonly sectorCode: string;
    readonly query: PointInTimeQueryInput;
  },
  dependencies: LoadSectorFiscalDependencies,
): Promise<SectorFiscalReading> {
  if (!listSectors().some((sector) => sector.code === request.sectorCode)) {
    throw new SectorFiscalReadError("sector_unknown");
  }
  const query = pointInTimeQuerySchema.parse(request.query);
  if (query.adjustmentPolicy !== "as_known") {
    // Market cap needs the unadjusted share count and the raw historical close.
    throw new SectorFiscalReadError("adjustment_basis_unsupported");
  }

  const { population, graph } = await loadSectorPopulation(
    { indexId: SP500_INDEX_ID, code: request.sectorCode, query },
    dependencies,
  );
  if (population.members.length > MAX_DIVERGENCE_MEMBERS) {
    throw new SectorFiscalReadError("population_too_large");
  }

  const readers = dependencies.createFactReaders(graph, query);
  const commonClassesByIssuer = new Map<string, number>();
  for (const security of graph.securities) {
    if (
      security.securityType !== "common_equity" ||
      !isEffectiveAt(security, query.effectiveAt) ||
      !isKnownAt(security, query)
    )
      continue;
    commonClassesByIssuer.set(
      security.issuerLegalEntityId,
      (commonClassesByIssuer.get(security.issuerLegalEntityId) ?? 0) + 1,
    );
  }
  const to = query.effectiveAt.slice(0, 10);
  const from = subtractDays(
    subtractCalendarYears(to, PRICE_LOOKBACK_YEARS),
    14,
  );
  const issuerReads = new Map<
    string,
    Promise<{
      readonly rows: readonly FundamentalRow[];
      readonly anchor: string | null;
    }>
  >();

  function issuerFacts(legalEntityId: string) {
    let pending = issuerReads.get(legalEntityId);
    if (pending === undefined) {
      pending = (async () => {
        const rows = await readers.readFacts(legalEntityId, query);
        const subjects = [
          ...new Set([legalEntityId, ...rows.map((row) => row.subjectId)]),
        ];
        const anchor = chooseFiscalYearAnchor(
          await readers.fiscalYearAnchors(subjects),
          rows,
        );
        return { rows, anchor };
      })();
      issuerReads.set(legalEntityId, pending);
    }
    return pending;
  }

  const members: SectorFiscalMember[] = [];
  for (
    let index = 0;
    index < population.members.length;
    index += LOAD_CONCURRENCY
  ) {
    const batch = population.members.slice(index, index + LOAD_CONCURRENCY);
    members.push(
      ...(await Promise.all(
        batch.map(async (member) => {
          const [facts, closes, events] = await Promise.all([
            issuerFacts(member.issuerLegalEntityId),
            dependencies.prices.loadSeries({
              securityId: member.securityId,
              from,
              to,
              limit: 2_000,
            }),
            dependencies.prices.loadEvents({
              securityId: member.securityId,
              limit: 500,
            }),
          ]);
          const series =
            facts.anchor === null
              ? null
              : buildAnnualFundamentals(facts.rows, facts.anchor, to);
          const [ticker] = securityTickersAt(graph, member.securityId, query);
          const common = { series, epsRows: facts.rows, closes, events, query };
          const refuseIssuerWideShares = (
            pair: FiscalEndpointPair,
          ): FiscalEndpointPair => {
            if (
              (commonClassesByIssuer.get(member.issuerLegalEntityId) ?? 0) <= 1
            )
              return pair;
            const withoutMarketCap = (
              endpoint: FiscalEndpointPair["latest"],
            ) =>
              endpoint === null
                ? null
                : {
                    ...endpoint,
                    marketCap: null,
                    missing: [
                      ...endpoint.missing,
                      "multiple_share_classes_unreconciled",
                    ],
                  };
            return {
              ...pair,
              latest: withoutMarketCap(pair.latest),
              earlier: withoutMarketCap(pair.earlier),
            };
          };
          return {
            securityId: member.securityId,
            issuerLegalEntityId: member.issuerLegalEntityId,
            ticker: ticker?.symbol ?? null,
            twoYears: refuseIssuerWideShares(
              selectFiscalEndpoints({ ...common, horizonYears: 2 }),
            ),
            fiveYears: refuseIssuerWideShares(
              selectFiscalEndpoints({ ...common, horizonYears: 5 }),
            ),
          };
        }),
      )),
    );
  }

  return {
    sectorCode: request.sectorCode,
    query,
    populationVersion: population.ruleVersion,
    taxonomyVersion: population.members[0]?.taxonomyVersion ?? null,
    members,
  };
}
