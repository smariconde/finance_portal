import { createHash, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createInMemoryIngestionRunRepository } from "@/modules/ingestion/infrastructure/in-memory-ingestion-run-repository";
import type { PriceSourceProvider } from "@/modules/prices/application/live-price-source";
import { parseChartPayload } from "@/modules/prices/domain/parse-chart-payload";
import { FIXTURE_CHART_PAYLOAD_WITHOUT_EVENTS } from "@/modules/prices/infrastructure/fixture-chart-payload";

import { InMemoryAdrPairRepository } from "../infrastructure/in-memory-adr-pair-repository";

import { AdrLegIngestionError, ingestAdrLeg } from "./ingest-adr-pair-legs";
import { readImpliedCcl } from "./read-implied-ccl";

const template = parseChartPayload(FIXTURE_CHART_PAYLOAD_WITHOUT_EVENTS);

if (!template.ok) {
  throw new Error("the fixture must parse");
}

/** Una fuente sintética: barras ajustadas, splits y moneda por símbolo. */
function sourceOf(
  bySymbol: Record<
    string,
    {
      readonly currency: string;
      readonly bars: readonly [string, string][];
      readonly splits?: readonly [string, string][];
    }
  >,
): PriceSourceProvider & { readonly requests: string[] } {
  const requests: string[] = [];

  return {
    sourceId: "yahoo-finance",
    requests,
    async load(symbol) {
      requests.push(symbol);
      const entry = bySymbol[symbol]!;

      return {
        sourceId: "yahoo-finance",
        symbol,
        parsed: {
          ...(template as Extract<typeof template, { ok: true }>),
          symbol,
          currency: entry.currency,
          bars: entry.bars.map(([marketDate, close]) => ({
            marketDate,
            close,
          })),
          splits: (entry.splits ?? []).map(([effectiveOn, ratio]) => ({
            effectiveOn,
            ratio,
          })),
          dividends: [],
          // La rueda del 2026-11-02 todavía está en curso al bajar.
          session: {
            marketDate: "2026-11-02",
            regularEnd: "2026-11-02T20:00:00.000Z",
            lastPriceAt: "2026-11-02T18:00:00.000Z",
          },
        },
        byteLength: 256,
        fetchedAt: "2026-11-02T18:30:00.000Z",
        historyYears: 5,
        requestedFrom: "2000-01-01",
      };
    },
  };
}

function setup(source: PriceSourceProvider) {
  let tick = Date.parse("2026-11-02T19:00:00.000Z");
  const ingestionRuns = createInMemoryIngestionRunRepository();
  const recorded = new Map<string, string>();
  const now = () => {
    tick += 1000;
    return new Date(tick).toISOString();
  };
  const repository = new InMemoryAdrPairRepository(
    (runId) => recorded.get(runId) ?? now(),
  );
  const dependencies = {
    source,
    repository,
    ingestionRuns: {
      ...ingestionRuns,
      async append(run: Parameters<typeof ingestionRuns.append>[0]) {
        recorded.set(run.runId, run.recordedAt);
        return ingestionRuns.append(run);
      },
    },
    now,
    newId: () => randomUUID(),
    hashContent: (input: string) =>
      createHash("sha256").update(input).digest("hex"),
  };

  return { repository, dependencies, now };
}

function query(at: string) {
  return {
    effectiveAt: at,
    knownAt: at,
    revisionPolicy: "as_known" as const,
    knowledgeBasis: "public_availability" as const,
    adjustmentPolicy: "as_known" as const,
    sourcePolicyVersion: "source-policy-1.0.0",
  };
}

describe("ingestAdrLeg", () => {
  it("stores raw closes, undoing later splits, and leaves the open session out", async () => {
    const source = sourceOf({
      "YPFD.BA": {
        currency: "ARS",
        // Ajustada por el 10:1 del 2026-08-03: antes, la fuente divide por 10.
        bars: [
          ["2026-07-31", "1500"],
          ["2026-08-03", "1500"],
          ["2026-11-02", "1600"],
        ],
        splits: [["2026-08-03", "10"]],
      },
    });
    const { repository, dependencies } = setup(source);

    const outcome = await ingestAdrLeg("ypf", "local", dependencies);

    expect(outcome).toMatchObject({
      legId: "ypf-local",
      bars: 2,
      barsUnsettled: ["2026-11-02"],
      runStatus: "succeeded",
      summary: { closesInserted: 2, closesConflicting: [] },
    });
    expect(
      (await repository.listLegCloses(["ypf-local"], "2026-12-31")).map(
        (row) => [row.marketDate, row.close],
      ),
    ).toEqual([
      ["2026-07-31", "15000"],
      ["2026-08-03", "1500"],
    ]);

    // La misma respuesta otra vez no escribe nada.
    const again = await ingestAdrLeg("ypf", "local", dependencies);

    expect(again).toMatchObject({
      runStatus: "duplicate",
      summary: { closesInserted: 0, closesDuplicate: 2 },
    });
  });

  it("refuses a leg in the wrong currency before writing", async () => {
    const source = sourceOf({
      GGAL: { currency: "ARS", bars: [["2026-10-30", "50"]] },
    });
    const { repository, dependencies } = setup(source);

    await expect(
      ingestAdrLeg("ggal", "adr", dependencies),
    ).rejects.toBeInstanceOf(AdrLegIngestionError);
    expect(await repository.listLegCloses(["ggal-adr"], "2026-12-31")).toEqual(
      [],
    );
  });
});

describe("readImpliedCcl", () => {
  it("reads only closes recorded by the cutoff", async () => {
    const day = "2026-10-30";
    const source = sourceOf({
      GGAL: { currency: "USD", bars: [[day, "50"]] },
      "GGAL.BA": { currency: "ARS", bars: [[day, "7500"]] },
      BMA: { currency: "USD", bars: [[day, "100"]] },
      "BMA.BA": { currency: "ARS", bars: [[day, "15000"]] },
      TEO: { currency: "USD", bars: [[day, "10"]] },
      "TECO2.BA": { currency: "ARS", bars: [[day, "3200"]] },
    });
    const { repository, dependencies, now } = setup(source);

    for (const pairId of ["ggal", "bma"]) {
      await ingestAdrLeg(pairId, "adr", dependencies);
      await ingestAdrLeg(pairId, "local", dependencies);
    }

    const before = now();

    await ingestAdrLeg("teo", "adr", dependencies);
    await ingestAdrLeg("teo", "local", dependencies);

    const atBefore = await readImpliedCcl(query(before), repository);
    const atAfter = await readImpliedCcl(query(now()), repository);

    // Al primer corte sólo había dos pares: no alcanza para una mediana.
    expect(atBefore).toMatchObject([
      { marketDate: day, value: null, reason: "insufficient_pairs" },
    ]);
    // 7.500 × 10 / 50 = 1.500; 15.000 × 10 / 100 = 1.500; 3.200 × 5 / 10 = 1.600.
    expect(atAfter).toMatchObject([
      {
        marketDate: day,
        value: "1500",
        pairs: ["bma", "ggal", "teo"],
        high: "1600",
      },
    ]);
  });
});
