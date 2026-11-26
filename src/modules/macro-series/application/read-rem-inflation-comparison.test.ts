import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createInMemoryIngestionRunRepository } from "@/modules/ingestion/infrastructure/in-memory-ingestion-run-repository";
import { createInMemorySourceRegistryRepository } from "@/modules/ingestion/infrastructure/in-memory-source-registry-repository";

import { declaredIndecExpandedIndicator } from "../domain/declared-indec-expanded-indicators";
import { planArgentinaIndicator } from "../domain/plan-argentina-indicator";
import type { RemForecastVintage } from "../domain/plan-rem-release";
import {
  createFixtureBcraFetch,
  wireNumber,
  type FixtureBcraState,
} from "../infrastructure/fixture-bcra-payloads";
import { InMemoryArgentinaIndicatorRepository } from "../infrastructure/in-memory-argentina-indicator-repository";
import { InMemoryMacroSeriesRepository } from "../infrastructure/in-memory-macro-series-repository";

import { createLiveBcraSource } from "./live-bcra-source";
import { recordBcraCatalog } from "./record-bcra-catalog";
import { recordBcraSeries } from "./record-bcra-series";

import type { RemForecastRepository } from "./rem-forecast-repository";
import { readRemInflationComparison } from "./read-rem-inflation-comparison";

const forecast: RemForecastVintage = {
  roundMonth: "2026-10",
  targetMonth: "2026-10",
  revision: 0,
  medianPercent: "1.8",
  publishedOn: "2026-11-05",
  availableAt: "2026-11-06T03:00:00.000Z",
  recordedAt: "2026-11-12T16:00:00.000Z",
  supersededAt: null,
  sourceRunId: "fixture",
};

describe("REM vs observed national IPC", () => {
  it("waits for the observed IPC, then computes error for the same target month", async () => {
    const indicator = declaredIndecExpandedIndicator("ipc_nacional")!;
    const indicators = new InMemoryArgentinaIndicatorRepository();
    await indicators.apply(
      planArgentinaIndicator({
        indicator,
        currentDefinition: null,
        open: [],
        fetched: [
          { periodOn: "2026-09-01", value: "100" },
          { periodOn: "2026-10-01", value: "102" },
        ],
        observedAt: "2026-11-12T12:00:00.000Z",
        recordedAt: "2026-11-12T16:00:00.000Z",
        runId: "fixture-ipc",
        acceptMassChange: false,
      }),
      indicator.id,
    );
    const forecasts: RemForecastRepository = {
      storage: "personal-postgres",
      open: async () => [forecast],
      asKnown: async () => [forecast],
      latestRoundAsKnown: async () => [forecast],
      publish: async () => ({ status: "duplicate", accepted: 0 }),
    };
    const at = (knownAt: string) =>
      readRemInflationComparison({
        knownAt,
        knowledgeBasis: "public_availability",
        forecasts,
        indicators,
      });
    expect((await at("2026-11-11T23:00:00.000Z"))[0]).toMatchObject({
      actual: { status: "unavailable", reason: "missing_period" },
      error: { status: "unavailable", reason: "missing_actual" },
    });
    expect((await at("2026-11-13T00:00:00.000Z"))[0]).toMatchObject({
      actual: { status: "computed", monthlyPercent: "2" },
      error: { status: "computed", errorPp: "0.2" },
    });
  });

  it("falls back to the BCRA's monthly inflation for a month the INDEC API lacks (F9-24)", async () => {
    const indicator = declaredIndecExpandedIndicator("ipc_nacional")!;
    const indicators = new InMemoryArgentinaIndicatorRepository();
    // The INDEC API stops at September.
    await indicators.apply(
      planArgentinaIndicator({
        indicator,
        currentDefinition: null,
        open: [],
        fetched: [
          { periodOn: "2026-08-01", value: "100" },
          { periodOn: "2026-09-01", value: "102" },
        ],
        observedAt: "2026-11-07T00:00:00.000Z",
        recordedAt: "2026-11-07T00:00:00.000Z",
        runId: "fixture-ipc",
        acceptMassChange: false,
      }),
      indicator.id,
    );
    // The BCRA already republished October.
    const state: FixtureBcraState = {
      catalog: [
        {
          idVariable: 27,
          periodicidad: "M",
          tipoSerie: "Tasa",
          unidadExpresion: "En porcentaje",
          ultFechaInformada: "2026-10-31",
          ultValorInformado: wireNumber("2.3"),
        },
      ],
      methodology: [{ id: 27, detalle: "Inflación mensual sintética." }],
      series: new Map([
        [
          27,
          [
            { fecha: "2026-10-31", valor: wireNumber("2.3") },
            { fecha: "2026-09-30", valor: wireNumber("2.1") },
          ],
        ],
      ]),
    };
    let tick = Date.parse("2026-11-13T12:00:00.000Z");
    const clock = () => {
      tick += 1000;
      return new Date(tick).toISOString();
    };
    const macro = new InMemoryMacroSeriesRepository();
    const bcra = {
      source: createLiveBcraSource({
        sourceRegistry: createInMemorySourceRegistryRepository(),
        fetch: createFixtureBcraFetch(state, clock, new Map()),
      }),
      repository: macro,
      ingestionRuns: createInMemoryIngestionRunRepository(),
      now: clock,
      newId: () => randomUUID(),
    };
    await recordBcraCatalog(bcra);
    await recordBcraSeries(27, bcra);

    const forecasts: RemForecastRepository = {
      storage: "personal-postgres",
      open: async () => [forecast],
      asKnown: async () => [forecast],
      latestRoundAsKnown: async () => [forecast],
      publish: async () => ({ status: "duplicate", accepted: 0 }),
    };
    const knownAt = "2026-11-20T00:00:00.000Z";
    const [row] = await readRemInflationComparison({
      knownAt,
      knowledgeBasis: "public_availability",
      forecasts,
      indicators,
      macro,
    });
    expect(row).toMatchObject({
      actual: {
        status: "computed",
        source: "bcra_monthly",
        monthlyPercent: "2.3",
        version: "rem-observed-ipc-1.0.0",
      },
      error: { status: "computed", errorPp: "0.5" },
    });

    // Without the BCRA, the row waits as before.
    const [indecOnly] = await readRemInflationComparison({
      knownAt,
      knowledgeBasis: "public_availability",
      forecasts,
      indicators,
    });
    expect(indecOnly!.actual).toMatchObject({ status: "unavailable" });

    // Once the INDEC has October, its index wins.
    const open = await indicators.allObservations(indicator.id);
    await indicators.apply(
      planArgentinaIndicator({
        indicator,
        currentDefinition: null,
        open,
        fetched: [
          { periodOn: "2026-08-01", value: "100" },
          { periodOn: "2026-09-01", value: "102" },
          { periodOn: "2026-10-01", value: "104.346" },
        ],
        observedAt: "2026-11-21T00:00:00.000Z",
        recordedAt: "2026-11-21T00:00:00.000Z",
        runId: "fixture-ipc-2",
        acceptMassChange: false,
      }),
      indicator.id,
    );
    const [later] = await readRemInflationComparison({
      knownAt: "2026-11-22T00:00:00.000Z",
      knowledgeBasis: "public_availability",
      forecasts,
      indicators,
      macro,
    });
    expect(later!.actual).toMatchObject({
      status: "computed",
      source: "indec_index",
      monthlyPercent: "2.3",
    });
  });
});
