import { describe, it, expect } from "vitest";
import { fixtureCedearGraph } from "@/modules/cedears/infrastructure/fixture-cedear-publications";
import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";
import { resolveIdentity } from "./resolve-identity";
import { usMarketGraph } from "./us-market-graph";

describe("US ticker workflow scope", () => {
  it("retains ambiguity in the full graph and explicitly selects the US listing", () => {
    const original = fixtureCedearGraph();
    const localId = "00000000-0000-4000-8000-111111111111";
    const graph = {
      ...original,
      listings: [
        ...original.listings,
        {
          ...original.listings[1]!,
          listingId: localId,
          mic: "XBUE",
          country: "AR",
          quoteCurrency: "ARS",
        },
      ],
      listingSymbols: [
        ...original.listingSymbols,
        {
          ...original.listingSymbols[0]!,
          listingId: localId,
          listingSymbolId: "00000000-0000-4000-8000-222222222222",
        },
      ],
    };
    const query = pointInTimeQuerySchema.parse({
      effectiveAt: "2026-10-24T12:00:00.000Z",
      knownAt: "2026-10-24T12:00:00.000Z",
      revisionPolicy: "as_known",
      sourcePolicyVersion: "source-policy-1.0.0",
    });
    expect(resolveIdentity(graph, { symbol: "FXA" }, query).status).toBe(
      "ambiguous",
    );
    expect(
      resolveIdentity(usMarketGraph(graph), { symbol: "FXA" }, query),
    ).toMatchObject({
      status: "resolved",
      securityId: original.listings[0]!.securityId,
    });
    expect(
      resolveIdentity(graph, { symbol: "FXA", mic: "XBUE" }, query),
    ).toMatchObject({ status: "resolved", listingId: localId });
  });
});
