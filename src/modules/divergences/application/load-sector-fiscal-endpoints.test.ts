import { describe, expect, it, vi } from "vitest";

import { SP500_SECTOR_TAXONOMY_ID } from "@/modules/classification/domain/sector-taxonomy";
import { subjectClassificationSchema } from "@/modules/classification/domain/subject-classification";
import { InMemoryClassificationRepository } from "@/modules/classification/infrastructure/in-memory-classification-repository";
import {
  DEMO_IDENTITY_GRAPH,
  DEMO_IDENTITY_IDS,
} from "@/modules/identity/infrastructure/demo-identity-fixtures";
import { InMemoryPriceRepository } from "@/modules/prices/infrastructure/in-memory-price-repository";
import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";
import { indexMembershipSchema } from "@/modules/universe/domain/index-membership";
import { createInMemoryUniverseRepository } from "@/modules/universe/infrastructure/in-memory-universe-repository";
import type { FundamentalRow } from "@/modules/valuation/domain/annual-fundamentals";

import { loadSectorFiscalEndpoints } from "./load-sector-fiscal-endpoints";

const SINCE = "2020-01-01T00:00:00.000Z";
const KNOWN = "2026-02-01T00:00:00.000Z";

const query = pointInTimeQuerySchema.parse({
  effectiveAt: KNOWN,
  knownAt: KNOWN,
  revisionPolicy: "as_known",
  adjustmentPolicy: "as_known",
  sourcePolicyVersion: "source-policy-1.0.0",
});

function membership(securityId: string, suffix: string) {
  return indexMembershipSchema.parse({
    indexMembershipId: `66666666-6666-4666-8666-${suffix.padStart(12, "0")}`,
    indexId: "sp500",
    securityId,
    validFrom: SINCE,
    validTo: null,
    availableAt: SINCE,
    supersededAt: null,
    sourceId: "datahub-sp500-pddl",
    sourceDocumentId: null,
    contentHash: "a".repeat(64),
    recordedAt: SINCE,
  });
}

function classification(subjectId: string, code: string, label: string) {
  return subjectClassificationSchema.parse({
    classificationAssignmentId: `77777777-7777-4777-8777-${subjectId.slice(-12)}`,
    subjectType: "legal_entity",
    subjectId,
    taxonomyId: SP500_SECTOR_TAXONOMY_ID,
    taxonomyVersion: "a".repeat(40),
    code,
    label,
    validFrom: SINCE,
    validTo: null,
    availableAt: SINCE,
    supersededAt: null,
    sourceId: "datahub-sp500-pddl",
    sourceDocumentId: null,
    contentHash: "b".repeat(64),
    recordedAt: SINCE,
  });
}

function row(
  end: string,
  concept: string,
  periodType: "annual" | "instant",
  value: string,
): FundamentalRow {
  const unit = concept.includes("Shares")
    ? "shares"
    : concept.includes("EarningsPerShare")
      ? "monetary_per_share"
      : "USD";
  return {
    observationId: `${concept}-${end}`,
    subjectId: DEMO_IDENTITY_IDS.fixtureCoEntity,
    concept: `us-gaap:${concept}`,
    periodType,
    asOf: end,
    periodStart: periodType === "annual" ? `${end.slice(0, 4)}-01-01` : null,
    unit,
    currency: unit === "USD" || unit === "monetary_per_share" ? "USD" : null,
    value,
    availableAt: "2026-01-20T00:00:00.000Z",
    recordedAt: "2026-01-21T00:00:00.000Z",
    sourceDocumentId: null,
  };
}

function facts(): FundamentalRow[] {
  return ["2025-12-31", "2023-12-31", "2020-12-31"].flatMap((end) => [
    row(end, "NetIncomeLoss", "annual", "1000"),
    row(end, "EarningsPerShareDiluted", "annual", "10"),
    row(
      end,
      "WeightedAverageNumberOfDilutedSharesOutstanding",
      "annual",
      "120",
    ),
    row(end, "CommonStockSharesOutstanding", "instant", "100"),
  ]);
}

describe("loadSectorFiscalEndpoints", () => {
  it("reads only the chosen sector's issuer and reuses its fiscal facts for both horizons", async () => {
    const prices = new InMemoryPriceRepository();
    await prices.writeSeries(
      ["2025-12-30", "2023-12-29", "2020-12-30"].map((marketDate) => ({
        securityId: DEMO_IDENTITY_IDS.fixtureCoClassA,
        marketDate,
        close: "50",
        currency: "USD",
      })),
      [],
    );
    const readFacts = vi.fn(async () => facts());
    const fiscalYearAnchors = vi.fn(async () => ["2025-12-31"]);
    const readSplits = vi.fn(async () => []);
    const fixtureClass = DEMO_IDENTITY_GRAPH.securities.find(
      (security) => security.securityId === DEMO_IDENTITY_IDS.fixtureCoClassA,
    )!;
    const reading = await loadSectorFiscalEndpoints(
      { sectorCode: "communication-services", query },
      {
        universe: createInMemoryUniverseRepository({
          graph: {
            ...DEMO_IDENTITY_GRAPH,
            securities: [
              ...DEMO_IDENTITY_GRAPH.securities,
              {
                ...fixtureClass,
                securityId: "11111111-1111-4111-8111-111111111112",
                shareClass: "B",
              },
            ],
          },
          memberships: [
            membership(DEMO_IDENTITY_IDS.fixtureCoClassA, "1"),
            membership(DEMO_IDENTITY_IDS.andesCommon, "2"),
          ],
        }),
        classifications: new InMemoryClassificationRepository([
          classification(
            DEMO_IDENTITY_IDS.fixtureCoEntity,
            "communication-services",
            "Communication Services",
          ),
          classification(DEMO_IDENTITY_IDS.andesEntity, "energy", "Energy"),
        ]),
        prices,
        createFactReaders: () => ({
          readFacts,
          fiscalYearAnchors,
          readSplits,
        }),
      },
    );

    expect(reading.members).toHaveLength(1);
    expect(readFacts).toHaveBeenCalledOnce();
    expect(readFacts).toHaveBeenCalledWith(
      DEMO_IDENTITY_IDS.fixtureCoEntity,
      query,
    );
    expect(fiscalYearAnchors).toHaveBeenCalledWith(
      [DEMO_IDENTITY_IDS.fixtureCoEntity],
      query,
    );
    expect(readSplits).toHaveBeenCalledWith([
      DEMO_IDENTITY_IDS.fixtureCoEntity,
    ]);
    expect(reading.members[0]?.twoYears.earlier?.fiscalYearEnd).toBe(
      "2023-12-31",
    );
    expect(reading.members[0]?.fiveYears.earlier?.fiscalYearEnd).toBe(
      "2020-12-31",
    );
    expect(reading.members[0]?.twoYears.latest?.marketCap).toBeNull();
    expect(reading.members[0]?.twoYears.latest?.missing).toContain(
      "multiple_share_classes_unreconciled",
    );
  });

  it("rejects a split-adjusted share basis before reading the sector", async () => {
    const universe = createInMemoryUniverseRepository({
      graph: DEMO_IDENTITY_GRAPH,
      memberships: [],
    });
    const loadState = vi.spyOn(universe, "loadState");
    await expect(
      loadSectorFiscalEndpoints(
        {
          sectorCode: "communication-services",
          query: { ...query, adjustmentPolicy: "latest_adjusted" },
        },
        {
          universe,
          classifications: new InMemoryClassificationRepository([]),
          prices: new InMemoryPriceRepository(),
          createFactReaders: () => ({
            readFacts: async () => [],
            fiscalYearAnchors: async () => [],
            readSplits: async () => [],
          }),
        },
      ),
    ).rejects.toMatchObject({ code: "adjustment_basis_unsupported" });
    expect(loadState).not.toHaveBeenCalled();
  });
});
