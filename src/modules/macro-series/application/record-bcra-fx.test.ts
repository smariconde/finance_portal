import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createInMemoryIngestionRunRepository } from "@/modules/ingestion/infrastructure/in-memory-ingestion-run-repository";
import { createInMemorySourceRegistryRepository } from "@/modules/ingestion/infrastructure/in-memory-source-registry-repository";

import { BCRA_FX_PROFILE } from "../domain/bcra-fx-source";
import {
  createFixtureBcraFetch,
  wireNumber,
} from "../infrastructure/fixture-bcra-payloads";
import {
  createFixtureBcraFxFetch,
  fixtureFxDays,
  fxWireNumber,
  type FixtureFxState,
} from "../infrastructure/fixture-bcra-fx-payloads";
import { InMemoryMacroSeriesRepository } from "../infrastructure/in-memory-macro-series-repository";

import { createLiveBcraFxSource } from "./live-bcra-fx-source";
import { createLiveBcraSource } from "./live-bcra-source";
import { readMacroSeries } from "./read-macro-series";
import { readTransformedMacroSeries } from "./read-transformed-macro-series";
import { recordBcraCatalog } from "./record-bcra-catalog";
import { recordBcraSeries } from "./record-bcra-series";

const USD = "bcra-cambiarias-v1:840";

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

function setup() {
  const state: FixtureFxState = {
    currencies: [
      { codigo: "ARS", denominacion: "PESO" },
      { codigo: "USD", denominacion: "DOLAR SINTÉTICO" },
      { codigo: "EUR", denominacion: "EURO SINTÉTICO" },
      { codigo: "BRL", denominacion: "REAL SINTÉTICO" },
      { codigo: "CNY", denominacion: "YUAN SINTÉTICO" },
    ],
    // 1.500 días: la primera descarga son dos páginas, la ventana una.
    quotes: new Map([["USD", fixtureFxDays("2026-11-02", 1500)]]),
  };
  let tick = Date.parse("2026-11-03T12:00:00.000Z");
  const clock = () => {
    tick += 1000;
    return new Date(tick).toISOString();
  };
  const repository = new InMemoryMacroSeriesRepository();
  const ingestionRuns = createInMemoryIngestionRunRepository();
  const sourceRegistry = createInMemorySourceRegistryRepository();
  const fetch = createFixtureBcraFxFetch(state, clock);
  const dependencies = {
    source: createLiveBcraFxSource({ sourceRegistry, fetch, now: clock }),
    repository,
    ingestionRuns,
    now: clock,
    newId: () => randomUUID(),
    profile: BCRA_FX_PROFILE,
  };

  return {
    state,
    fetch,
    repository,
    ingestionRuns,
    sourceRegistry,
    dependencies,
    clock,
  };
}

describe("recording Estadísticas Cambiarias", () => {
  it("records the declared currencies of the master as their own source", async () => {
    const { dependencies, repository, ingestionRuns } = setup();
    const outcome = await recordBcraCatalog(dependencies);

    expect(outcome.runStatus).toBe("succeeded");
    expect(
      outcome.plan.opened.map((definition) => [
        definition.seriesKey,
        definition.description,
        definition.unit,
        definition.currencyCode,
      ]),
    ).toEqual([
      [
        USD,
        "DOLAR SINTÉTICO",
        "Pesos argentinos por dólar estadounidense",
        "ARS",
      ],
      [
        "bcra-cambiarias-v1:978",
        "EURO SINTÉTICO",
        "Pesos argentinos por euro",
        "ARS",
      ],
      [
        "bcra-cambiarias-v1:986",
        "REAL SINTÉTICO",
        "Pesos argentinos por real",
        "ARS",
      ],
      [
        "bcra-cambiarias-v1:156",
        "YUAN SINTÉTICO",
        "Pesos argentinos por yuan renminbi",
        "ARS",
      ],
    ]);
    expect(
      await repository.listOpenDefinitions("bcra-monetarias-v4"),
    ).toHaveLength(0);

    const [run] = await ingestionRuns.list({
      sourceId: "bcra-cambiarias-v1",
      limit: 10,
    });

    expect(run).toMatchObject({
      datasetId: "bcra.fx-currencies",
      parserVersion: "bcra-cambiarias-v1-1.0.0",
    });
    // La fuente no publica metodología: se dice, no se inventa.
    expect(run!.qualityFlags).toContain("methodology_missing");
  });

  it("rejects a declared currency the master lists with two names, without withdrawing it", async () => {
    const { dependencies, state } = setup();
    await recordBcraCatalog(dependencies);
    state.currencies = [
      ...state.currencies,
      { codigo: "EUR", denominacion: "OTRO EURO" },
    ];

    const outcome = await recordBcraCatalog(dependencies);

    expect(outcome.fetched.rejections).toEqual([
      { row: 1, variableId: 978, field: "codigo" },
    ]);
    expect(outcome.plan.withdrawn).toEqual([]);
    expect(outcome.runStatus).toBe("duplicate");
  });

  it("refuses to withdraw a declared currency the master stops listing", async () => {
    const { dependencies, state } = setup();
    await recordBcraCatalog(dependencies);
    state.currencies = state.currencies.filter(
      (currency) => currency.codigo !== "CNY",
    );

    const outcome = await recordBcraCatalog(dependencies);

    // Una de cuatro es más que el décimo que la guarda admite.
    expect(outcome.runStatus).toBe("quarantined");
    expect(outcome.plan.guard).toMatchObject({ withdrawals: 1, refused: true });
  });

  it("downloads the whole history first, then one page, and names a conflicting day", async () => {
    const { dependencies, state, fetch, repository, ingestionRuns } = setup();
    await recordBcraCatalog(dependencies);
    const days = [...state.quotes.get("USD")!];
    days[20] = {
      fecha: days[20]!.fecha,
      quotes: [fxWireNumber("37.35"), fxWireNumber("17.215")],
    };
    days[21] = {
      fecha: days[21]!.fecha,
      quotes: [days[21]!.quotes[0]!, days[21]!.quotes[0]!],
    };
    state.quotes.set("USD", days);
    const before = fetch.requests.length;

    const first = await recordBcraSeries(840, dependencies);

    expect(fetch.requests.length - before).toBe(2);
    expect(first.status === "recorded" && first.plan.counts).toMatchObject({
      new: 1499,
      rejected: 1,
    });
    expect(first.status === "recorded" && first.runStatus).toBe("partial");
    expect(await repository.findSeries(USD)).toMatchObject({
      basis: {
        frequency: "daily",
        unit: "Pesos argentinos por dólar estadounidense",
        currencyCode: "ARS",
      },
    });
    expect(
      new URL(fetch.requests.at(-1)!.url).searchParams.get("fechahasta"),
    ).toBe("2026-11-03");

    const middle = fetch.requests.length;
    const refresh = await recordBcraSeries(840, dependencies);

    expect(fetch.requests.length - middle).toBe(1);
    expect(refresh.status === "recorded" && refresh.runStatus).toBe(
      "duplicate",
    );

    const [run] = await ingestionRuns.list({
      sourceId: "bcra-cambiarias-v1",
      limit: 1,
    });

    expect(run).toMatchObject({
      datasetId: "bcra.fx-quotes",
      selectionVersion: "bcra-fx-revision-window-1.0.0",
      subjectKey: "840",
    });
  });

  it("refuses before the network when the rights row is missing", async () => {
    const { repository, ingestionRuns, clock } = setup();
    const fetch = createFixtureBcraFxFetch(
      { currencies: [], quotes: new Map() },
      clock,
    );
    const source = createLiveBcraFxSource({
      sourceRegistry: createInMemorySourceRegistryRepository([]),
      fetch,
      now: clock,
    });

    await expect(
      recordBcraCatalog({
        source,
        repository,
        ingestionRuns,
        now: clock,
        newId: () => randomUUID(),
        profile: BCRA_FX_PROFILE,
      }),
    ).rejects.toMatchObject({ code: "source_not_registered" });
    expect(fetch.requests).toHaveLength(0);
  });
});

describe("dollars spliced across both BCRA APIs", () => {
  it("reads the monetary series, the wholesale rate and the BCRA quote at one cutoff", async () => {
    const fx = setup();
    fx.state.quotes.set("USD", [
      { fecha: "2002-03-05", quotes: [fxWireNumber("3")] },
      { fecha: "2002-03-04", quotes: [fxWireNumber("2.05")] },
      { fecha: "2001-12-20", quotes: [fxWireNumber("1")] },
    ]);
    await recordBcraCatalog(fx.dependencies);
    await recordBcraSeries(840, fx.dependencies);

    const point = (fecha: string, value: string) => ({
      fecha,
      valor: wireNumber(value),
    });
    const monetary = createLiveBcraSource({
      sourceRegistry: fx.sourceRegistry,
      fetch: createFixtureBcraFetch(
        {
          catalog: [
            { idVariable: 21, moneda: "MEyML" },
            {
              idVariable: 5,
              tipoSerie: "Tipo de cambio",
              unidadExpresion: "Pesos argentinos por dólar estadounidense",
            },
          ],
          methodology: [
            { id: 21, detalle: "Depósitos sintéticos." },
            { id: 5, detalle: "Mayorista sintético." },
          ],
          series: new Map([
            [
              21,
              [
                point("2002-03-05", "25"),
                point("2002-03-04", "20"),
                point("2001-12-20", "10"),
              ],
            ],
            [5, [point("2002-03-05", "2.5"), point("2002-03-04", "2")]],
          ]),
        },
        fx.clock,
      ),
    });
    const monetaryDependencies = {
      ...fx.dependencies,
      source: monetary,
      profile: undefined,
    };
    await recordBcraCatalog(monetaryDependencies);
    await recordBcraSeries(21, monetaryDependencies);
    await recordBcraSeries(5, monetaryDependencies);
    const at = fx.clock();

    const reading = await readTransformedMacroSeries(
      { variableId: 21, kind: "usd_spliced" },
      query(at),
      fx.repository,
    );

    expect(reading.status === "read" && reading.transformation).toMatchObject({
      status: "computed",
      points: [
        {
          periodOn: "2001-12-20",
          value: "10",
          referenceSeries: "before_splice",
        },
        { periodOn: "2002-03-04", value: "10", referenceSeries: "reference" },
        { periodOn: "2002-03-05", value: "10", referenceSeries: "reference" },
      ],
      splice: { on: "2002-03-04", levelGap: "0.025" },
    });

    // La conversión por el mayorista sigue sin empalme.
    const wholesale = await readTransformedMacroSeries(
      { variableId: 21, kind: "usd_wholesale" },
      query(at),
      fx.repository,
    );

    expect(
      wholesale.status === "read" &&
        wholesale.transformation.status === "computed" &&
        wholesale.transformation.points[0]!.reason,
    ).toBe("before_reference_history");
    expect((await readMacroSeries(USD, query(at), fx.repository)).status).toBe(
      "read",
    );
  });
});
