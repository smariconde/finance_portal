import { createHash, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createInMemoryIngestionRunRepository } from "@/modules/ingestion/infrastructure/in-memory-ingestion-run-repository";

import { parseChartPayload } from "../domain/parse-chart-payload";
import {
  FIXTURE_CHART_PAYLOAD,
  FIXTURE_CHART_SYMBOL,
} from "../infrastructure/fixture-chart-payload";
import { InMemoryPriceRepository } from "../infrastructure/in-memory-price-repository";

import { buildRows, ingestPrices } from "./ingest-prices";
import type { PriceSourceProvider } from "./live-price-source";

const SECURITY = "11111111-1111-4111-8111-111111111111";

function parsedFixture() {
  const parsed = parseChartPayload(FIXTURE_CHART_PAYLOAD);

  if (!parsed.ok) {
    throw new Error("the fixture must parse");
  }

  return parsed;
}

function stubSource(): PriceSourceProvider {
  return {
    sourceId: "yahoo-finance",
    async load(symbol) {
      return {
        sourceId: "yahoo-finance",
        symbol,
        parsed: parsedFixture(),
        byteLength: 1024,
        fetchedAt: "2026-09-22T12:00:00.000Z",
      };
    },
  };
}

function deps(repository: InMemoryPriceRepository, source = stubSource()) {
  let tick = 0;

  return {
    source,
    repository,
    ingestionRuns: createInMemoryIngestionRunRepository(),
    now: () => {
      tick += 1;
      return new Date(Date.UTC(2026, 8, 22, 12, 0, tick)).toISOString();
    },
    newId: () => randomUUID(),
    hashContent: (input: string) =>
      createHash("sha256").update(input).digest("hex"),
  };
}

describe("buildRows", () => {
  it("stores the raw close, not the one the source publishes", () => {
    // La fixture trae la serie ajustada por un 10:1 del 2024-06-10: los cierres
    // previos se publican como 100 y 102,5 y lo que se operó fue 1.000 y 1.025.
    const { closes, barsRestatedBySource } = buildRows(
      SECURITY,
      parsedFixture(),
    );

    expect(closes.map((close) => [close.marketDate, close.close])).toEqual([
      ["2024-06-05", "1000"],
      ["2024-06-06", "1025"],
      ["2024-06-10", "10.4"],
      ["2024-06-11", "10.55"],
    ]);
    expect(barsRestatedBySource).toBe(2);
  });

  it("keeps the split and the dividend as dated, unapplied events", () => {
    const { events } = buildRows(SECURITY, parsedFixture());

    expect(events).toEqual([
      {
        securityId: SECURITY,
        eventType: "split",
        effectiveOn: "2024-06-10",
        value: "10",
        currency: null,
      },
      {
        securityId: SECURITY,
        eventType: "dividend",
        effectiveOn: "2024-06-05",
        value: "0.25",
        currency: "USD",
      },
    ]);
  });
});

describe("ingestPrices", () => {
  it("publishes the series and reports what it wrote", async () => {
    const repository = new InMemoryPriceRepository();

    const outcome = await ingestPrices(
      { securityId: SECURITY, symbol: FIXTURE_CHART_SYMBOL },
      deps(repository),
    );

    expect(outcome.summary!.closesInserted).toBe(4);
    expect(outcome.summary!.closesConflicting).toEqual([]);
    expect(outcome.summary!.eventsInserted).toBe(2);
    expect(outcome.barsWithoutClose).toBe(1);
    expect(outcome.unadjustRuleVersion).toBe("price-unadjust-1.0.0");
    expect(await repository.loadSeries({ securityId: SECURITY })).toHaveLength(
      4,
    );
  });

  it("is idempotent: ingesting the same series twice publishes nothing", async () => {
    // Es la propiedad que hace barata la re-descarga, y sólo vale porque lo que
    // se guarda es crudo: la serie ajustada cambiaría con el próximo split.
    const repository = new InMemoryPriceRepository();
    const command = { securityId: SECURITY, symbol: FIXTURE_CHART_SYMBOL };
    const dependencies = deps(repository);

    await ingestPrices(command, dependencies);
    const second = await ingestPrices(command, dependencies);

    expect(second.summary!.closesInserted).toBe(0);
    expect(second.summary!.closesDuplicate).toBe(4);
    expect(second.summary!.eventsInserted).toBe(0);
    expect(second.summary!.eventsDuplicate).toBe(2);
  });

  it("reports a changed past instead of overwriting it", async () => {
    // Una fila cruda es inmutable. Si la fuente devuelve otro cierre para una
    // rueda ya guardada, eso es un hallazgo —cambió de opinión sobre el
    // pasado—, no una actualización que haya que aplicar en silencio.
    const repository = new InMemoryPriceRepository();

    await ingestPrices(
      { securityId: SECURITY, symbol: FIXTURE_CHART_SYMBOL },
      deps(repository),
    );

    const revised: PriceSourceProvider = {
      sourceId: "yahoo-finance",
      async load(symbol) {
        const parsed = parsedFixture();

        return {
          sourceId: "yahoo-finance",
          symbol,
          parsed: {
            ...parsed,
            bars: parsed.bars.map((bar) =>
              bar.marketDate === "2024-06-11"
                ? { ...bar, close: "99.99" }
                : bar,
            ),
          },
          byteLength: 1024,
          fetchedAt: "2026-09-23T12:00:00.000Z",
        };
      },
    };

    const outcome = await ingestPrices(
      { securityId: SECURITY, symbol: FIXTURE_CHART_SYMBOL },
      deps(repository, revised),
    );

    expect(outcome.summary!.closesConflicting).toEqual(["2024-06-11"]);
    expect(outcome.summary!.closesInserted).toBe(0);

    const stored = await repository.loadSeries({ securityId: SECURITY });
    const untouched = stored.find((close) => close.marketDate === "2024-06-11");

    expect(untouched?.close).toBe("10.55");
  });

  it("refuses a read that exceeds its ceiling instead of truncating", async () => {
    const repository = new InMemoryPriceRepository();

    await ingestPrices(
      { securityId: SECURITY, symbol: FIXTURE_CHART_SYMBOL },
      deps(repository),
    );

    await expect(
      repository.loadSeries({ securityId: SECURITY, limit: 2 }),
    ).rejects.toThrow(/exceeded its limit/u);
  });
});
