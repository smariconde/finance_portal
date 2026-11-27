import "server-only";

import { eq, isNotNull, lte, and } from "drizzle-orm";

import { EARNINGS_CALENDAR_DATASET } from "@/modules/market-calendar/domain/earnings-calendar";
import type { EarningsCalendarView } from "@/modules/market-calendar/domain/calendar-publication";
import {
  isEffectiveAt,
  isKnownAt,
} from "@/modules/temporal/domain/temporal-version";
import { resolvePositionIdentity } from "@/modules/trading/domain/position-context";
import { SP500_INDEX_ID } from "@/modules/universe/application/live-universe-source";
import { getRuntimeDatabase } from "@/server/db/runtime-client";
import { createPostgresCalendarRepository } from "@/server/db/postgres-calendar-repository";
import { valuationJobs } from "@/server/db/schema";
import { getUniverseRepository } from "@/server/persistence/get-universe-repository";
import { getCedearRegistryRepository } from "@/server/persistence/get-cedear-registry-repository";

export async function readEarningsCalendar(
  at: string,
  options: {
    readonly symbols?: readonly string[];
    readonly includeFollowed?: boolean;
    readonly includeMarket?: boolean;
  },
): Promise<EarningsCalendarView> {
  const db = getRuntimeDatabase();
  const snapshot = await createPostgresCalendarRepository(db).read(
    EARNINGS_CALENDAR_DATASET,
    at,
  );
  const reports = snapshot.events
    .flatMap(({ event, previous }) =>
      event.kind === "earnings"
        ? [
            {
              ...event.report,
              previousDate:
                previous?.kind === "earnings" ? previous.report.date : null,
            },
          ]
        : [],
    )
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol),
    );

  if (reports.length === 0 || options.includeMarket)
    return { observedAt: snapshot.observedAt, reports };

  const query = {
    effectiveAt: at,
    knownAt: at,
    revisionPolicy: "as_known",
    sourcePolicyVersion: "source-policy-1.0.0",
    knowledgeBasis: "system_recorded",
    adjustmentPolicy: "as_known",
  } as const;
  const [state, cedears, valuations] = await Promise.all([
    getUniverseRepository().loadState({
      indexId: SP500_INDEX_ID,
      versions: "all",
      limit: 50_000,
    }),
    options.includeFollowed
      ? getCedearRegistryRepository().loadRegistry({})
      : null,
    options.includeFollowed
      ? db
          .selectDistinct({ ticker: valuationJobs.ticker })
          .from(valuationJobs)
          .where(
            and(
              eq(valuationJobs.status, "completed"),
              isNotNull(valuationJobs.valuationRunId),
              lte(valuationJobs.finishedAt, new Date(at)),
            ),
          )
      : [],
  ]);
  const identityOf = (symbol: string) =>
    resolvePositionIdentity(state.graph, symbol, query);
  const tickers = [
    ...(options.symbols ?? []),
    ...valuations.map(({ ticker }) => ticker),
  ];
  const followed = new Set(
    tickers.flatMap((symbol) => {
      const identity = identityOf(symbol);
      return identity.status === "resolved" ? [identity.securityId] : [];
    }),
  );
  for (const program of cedears?.programs ?? []) {
    if (isEffectiveAt(program, at) && isKnownAt(program, query))
      followed.add(program.underlyingSecurityId);
  }
  return {
    observedAt: snapshot.observedAt,
    reports: reports.filter((report) => {
      const identity = identityOf(report.symbol);
      return (
        identity.status === "resolved" && followed.has(identity.securityId)
      );
    }),
  };
}
