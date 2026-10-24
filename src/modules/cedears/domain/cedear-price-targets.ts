import type { IdentityGraph } from "@/modules/identity/domain/identity-graph";
import { securityTickersAt } from "@/modules/identity/domain/resolve-identity";
import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";
import {
  isEffectiveAt,
  isKnownAt,
} from "@/modules/temporal/domain/temporal-version";
import type { StoredCedearRegistry } from "./plan-cedear-registry";
import { resolveCedearAccess } from "./resolve-cedear-access";

/** A local listing is necessary: the underlying ticker never supplies it. */
export function cedearPriceTargets(
  graph: IdentityGraph,
  registry: StoredCedearRegistry,
  underlyingSecurityId: string,
  query: PointInTimeQuery,
) {
  const access = resolveCedearAccess(registry, underlyingSecurityId, query);
  if (access.status !== "program") return [];
  return access.programs.flatMap(({ program, ratio }) => {
    if (program.status !== "active" || ratio === null) return [];
    const listings = graph.listings.filter(
      (row) =>
        row.securityId === program.depositarySecurityId &&
        row.mic === "XBUE" &&
        row.quoteCurrency === "ARS" &&
        row.status === "active" &&
        isEffectiveAt(row, query.effectiveAt) &&
        isKnownAt(row, query),
    );
    const ids = new Set(listings.map((row) => row.listingId));
    const tickers = securityTickersAt(
      graph,
      program.depositarySecurityId,
      query,
    ).filter((row) => ids.has(row.listingId));
    if (tickers.length !== 1) return [];
    return [
      {
        securityId: program.depositarySecurityId,
        symbol: `${tickers[0]!.symbol}.BA`,
        localSymbol: tickers[0]!.symbol,
      },
    ];
  });
}
