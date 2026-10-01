import { describe, expect, it } from "vitest";

import type { CedearRegistryRepository } from "@/modules/cedears/application/cedear-registry-repository";
import { SP500_SECTOR_TAXONOMY_ID } from "@/modules/classification/domain/sector-taxonomy";
import { subjectClassificationSchema } from "@/modules/classification/domain/subject-classification";
import { InMemoryClassificationRepository } from "@/modules/classification/infrastructure/in-memory-classification-repository";
import {
  DEMO_IDENTITY_GRAPH,
  DEMO_IDENTITY_IDS,
} from "@/modules/identity/infrastructure/demo-identity-fixtures";
import { InMemoryPriceRepository } from "@/modules/prices/infrastructure/in-memory-price-repository";
import { indexMembershipSchema } from "@/modules/universe/domain/index-membership";
import { createInMemoryUniverseRepository } from "@/modules/universe/infrastructure/in-memory-universe-repository";

import {
  loadSectorRiskMatrix,
  SectorRiskMatrixError,
} from "./load-sector-risk-matrix";
import { summarizeSectorCoverage } from "./summarize-sector-coverage";

const SINCE = "2020-01-01T00:00:00.000Z";

function weekdays(from: string, to: string): string[] {
  const dates: string[] = [];

  for (
    let day = new Date(`${from}T00:00:00.000Z`);
    day.toISOString().slice(0, 10) <= to;
    day = new Date(day.getTime() + 86_400_000)
  ) {
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) {
      dates.push(day.toISOString().slice(0, 10));
    }
  }

  return dates;
}

function alternatingCloses(up: number, down: number, to = "2026-09-25") {
  let price = 100;

  return weekdays("2021-08-02", to).map((marketDate, index) => {
    if (index > 0) {
      price *= 1 + (index % 2 === 1 ? up : down);
    }

    return { marketDate, close: price.toFixed(12) };
  });
}

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

/** El registro devuelve los programas del grafo de demo: FixtureCo, 10:1. */
const cedears: CedearRegistryRepository = {
  storage: "in-memory-fixture",
  loadRegistry: async () => ({
    programs: DEMO_IDENTITY_GRAPH.depositaryPrograms,
    ratios: DEMO_IDENTITY_GRAPH.depositaryRatios,
  }),
  applyRegistryPlan: () => Promise.reject(new Error("read-only double")),
};

async function setup(options: { withReference?: boolean } = {}) {
  const prices = new InMemoryPriceRepository();
  const security = DEMO_IDENTITY_IDS.fixtureCoClassA;

  await prices.writeSeries(
    [
      ...alternatingCloses(0.02, -0.01),
      // Un derrumbe posterior al as_of: no puede mover nada.
      { marketDate: "2026-09-28", close: "1" },
    ].map((close) => ({ securityId: security, currency: "USD", ...close })),
    [],
  );

  if (options.withReference !== false) {
    await prices.writeBenchmarkSeries(
      alternatingCloses(0.015, -0.01).map((close) => ({
        benchmarkId: "sp500-total-return",
        currency: "USD",
        ...close,
      })),
    );
  }

  return {
    universe: createInMemoryUniverseRepository({
      graph: DEMO_IDENTITY_GRAPH,
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
    cedears,
    today: () => "2026-09-28",
  };
}

describe("loadSectorRiskMatrix", () => {
  it("defaults the as_of to the reference's latest close and reads everything at that cutoff", async () => {
    const reading = await loadSectorRiskMatrix(
      { sectorCode: "communication-services", asOf: null },
      await setup(),
    );
    const { matrix } = reading;

    expect(matrix.asOf).toBe("2026-09-25");
    expect(matrix.sector).toMatchObject({
      code: "communication-services",
      label: "Communication Services",
    });
    expect(matrix.points).toHaveLength(1);

    const [point] = matrix.points;

    expect(point).toMatchObject({
      ticker: "FXCO",
      mic: "XNAS",
      issuerLegalEntityId: DEMO_IDENTITY_IDS.fixtureCoEntity,
      quadrant: "beats_both",
      cedear: {
        status: "program",
        programStatus: "active",
        // El 10:1 de 2021 pasó a 20:1 en septiembre de 2024.
        ratio: { depositaryUnits: "20", underlyingUnits: "1" },
      },
    });
    // El derrumbe del 2026-09-28 quedó afuera: √126 es la forma cerrada.
    expect(
      point!.sortino2y.status === "computed" && Number(point!.sortino2y.value),
    ).toBeCloseTo(Math.sqrt(126), 6);
    expect(reading.population.unclassified).toBe(0);
    expect(reading.quality).toMatchObject({
      ruleVersion: "sector-risk-quality-1.0.0",
      status: "ready",
      score: 100,
      population: 1,
      comparable: 1,
      seriesWithoutRows: 0,
    });
  });

  it("labels a point with the ticker it had at an earlier as_of", async () => {
    const { matrix } = await loadSectorRiskMatrix(
      { sectorCode: "communication-services", asOf: "2024-05-31" },
      await setup(),
    );

    expect(matrix.points[0]!.ticker).toBe("FIXA");
    expect(matrix.points[0]!.cedear).toMatchObject({
      ratio: { depositaryUnits: "10", underlyingUnits: "1" },
    });
    expect(matrix.points[0]!.sortino5y).toMatchObject({
      status: "null",
      reason: "insufficient_history",
    });
  });

  it("moves a weekend request to the last close before it, and says so", async () => {
    const reading = await loadSectorRiskMatrix(
      { sectorCode: "communication-services", asOf: "2026-09-20" },
      await setup(),
    );

    expect(reading.requestedAsOf).toBe("2026-09-20");
    expect(reading.matrix.asOf).toBe("2026-09-18");
  });

  it("refuses a date with no reference close in the days before it", async () => {
    await expect(
      loadSectorRiskMatrix(
        { sectorCode: "communication-services", asOf: "2019-01-15" },
        await setup(),
      ),
    ).rejects.toMatchObject({ code: "no_reference_series" });
  });

  it("returns an empty sector as an empty matrix, with its label", async () => {
    const { matrix } = await loadSectorRiskMatrix(
      { sectorCode: "utilities", asOf: null },
      await setup(),
    );

    expect(matrix.sector.label).toBe("Utilities");
    expect(matrix.points).toEqual([]);
    expect(matrix.fit).toMatchObject({ status: "null", n: 0 });
  });

  it("refuses a code that is not a declared sector", async () => {
    await expect(
      loadSectorRiskMatrix({ sectorCode: "crypto", asOf: null }, await setup()),
    ).rejects.toMatchObject({ code: "sector_unknown" });
  });

  it("refuses to pick an as_of without a stored reference", async () => {
    await expect(
      loadSectorRiskMatrix(
        { sectorCode: "communication-services", asOf: null },
        await setup({ withReference: false }),
      ),
    ).rejects.toBeInstanceOf(SectorRiskMatrixError);
  });
});

describe("summarizeSectorCoverage", () => {
  it("counts each sector's members and how many have recent closes", async () => {
    const dependencies = await setup();
    const summary = await summarizeSectorCoverage(dependencies);

    expect(summary.referenceLatest).toBe("2026-09-25");
    expect(summary.sectors).toHaveLength(11);
    expect(
      summary.sectors.find(
        (sector) => sector.code === "communication-services",
      ),
    ).toEqual({
      code: "communication-services",
      label: "Communication Services",
      members: 1,
      withRecentCloses: 1,
    });
    expect(
      summary.sectors.find((sector) => sector.code === "energy"),
    ).toMatchObject({ members: 1, withRecentCloses: 0 });
  });
});
