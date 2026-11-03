import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createInMemoryIngestionRunRepository } from "@/modules/ingestion/infrastructure/in-memory-ingestion-run-repository";
import { createInMemorySourceRegistryRepository } from "@/modules/ingestion/infrastructure/in-memory-source-registry-repository";

import {
  createFixtureBcraFetch,
  wireNumber,
  type FixtureBcraState,
} from "../infrastructure/fixture-bcra-payloads";
import { InMemoryMacroSeriesRepository } from "../infrastructure/in-memory-macro-series-repository";

import { createLiveBcraSource } from "./live-bcra-source";
import { readTransformedMacroSeries } from "./read-transformed-macro-series";
import { recordBcraCatalog } from "./record-bcra-catalog";
import { recordBcraSeries } from "./record-bcra-series";

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

const point = (fecha: string, value: string) => ({
  fecha,
  valor: wireNumber(value),
});

async function setup() {
  const state: FixtureBcraState = {
    catalog: [
      { idVariable: 15, ultFechaInformada: "2026-03-31" },
      { idVariable: 21, moneda: "MEyML", ultFechaInformada: "2026-03-31" },
      {
        idVariable: 27,
        periodicidad: "M",
        tipoSerie: "Tasa",
        unidadExpresion: "En porcentaje",
        ultFechaInformada: "2026-02-28",
        ultValorInformado: wireNumber("10"),
      },
      {
        idVariable: 5,
        tipoSerie: "Tipo de cambio",
        unidadExpresion: "Pesos argentinos por dólar estadounidense",
        ultFechaInformada: "2026-03-31",
      },
    ],
    methodology: [
      { id: 15, detalle: "Base monetaria sintética." },
      { id: 21, detalle: "Depósitos sintéticos en ambas monedas." },
      { id: 27, detalle: "Inflación mensual sintética." },
      { id: 5, detalle: "Mayorista sintético." },
    ],
    series: new Map([
      [
        15,
        [
          point("2026-03-31", "121"),
          point("2026-02-27", "121"),
          point("2026-01-30", "110"),
        ],
      ],
      [21, [point("2026-03-31", "2500")]],
      [27, [point("2026-02-28", "10"), point("2026-01-31", "10")]],
      [5, [point("2026-03-31", "1250")]],
    ]),
  };
  let tick = Date.parse("2026-04-01T12:00:00.000Z");
  const clock = () => {
    tick += 1000;
    return new Date(tick).toISOString();
  };
  const repository = new InMemoryMacroSeriesRepository();
  const dependencies = {
    source: createLiveBcraSource({
      sourceRegistry: createInMemorySourceRegistryRepository(),
      fetch: createFixtureBcraFetch(state, clock, new Map()),
    }),
    repository,
    ingestionRuns: createInMemoryIngestionRunRepository(),
    now: clock,
    newId: () => randomUUID(),
  };

  await recordBcraCatalog(dependencies);

  for (const variableId of [15, 21, 27, 5]) {
    await recordBcraSeries(variableId, dependencies);
  }

  const firstCutoff = clock();

  return {
    state,
    repository,
    dependencies,
    firstCutoff,
    advance: (days: number) => {
      tick += days * 86_400_000;
    },
    clock,
  };
}

describe("readTransformedMacroSeries", () => {
  it("never deflates with inflation published after the cutoff", async () => {
    const { state, repository, dependencies, firstCutoff, advance, clock } =
      await setup();

    const before = await readTransformedMacroSeries(
      { variableId: 15, kind: "real_cpi" },
      query(firstCutoff),
      repository,
    );

    expect(before.status === "read" && before.transformation).toMatchObject({
      status: "computed",
      baseOn: "2026-02",
      points: [
        { periodOn: "2026-01-30", value: "121" },
        { periodOn: "2026-02-27", value: "121" },
        {
          periodOn: "2026-03-31",
          value: null,
          reason: "reference_not_published",
        },
      ],
    });

    advance(14);
    state.series.set(27, [point("2026-03-31", "0"), ...state.series.get(27)!]);
    await recordBcraSeries(27, dependencies);
    const after = await readTransformedMacroSeries(
      { variableId: 15, kind: "real_cpi" },
      query(clock()),
      repository,
    );

    expect(after.status === "read" && after.transformation).toMatchObject({
      baseOn: "2026-03",
      points: [
        { value: "121" },
        { value: "121" },
        { value: "121", referenceOn: "2026-03" },
      ],
    });

    // El corte viejo sigue leyendo lo que se sabía entonces.
    const replay = await readTransformedMacroSeries(
      { variableId: 15, kind: "real_cpi" },
      query(firstCutoff),
      repository,
    );

    expect(replay).toEqual(before);
  });

  it("converts a two-currency amount to dollars and refuses to deflate it", async () => {
    const { repository, firstCutoff } = await setup();

    const dollars = await readTransformedMacroSeries(
      { variableId: 21, kind: "usd_wholesale" },
      query(firstCutoff),
      repository,
    );
    const real = await readTransformedMacroSeries(
      { variableId: 21, kind: "real_cpi" },
      query(firstCutoff),
      repository,
    );

    expect(dollars.status === "read" && dollars.transformation).toMatchObject({
      status: "computed",
      unit: "En millones de USD",
      points: [{ periodOn: "2026-03-31", value: "2" }],
    });
    expect(real.status === "read" && real.transformation).toEqual({
      status: "not_transformable",
      kind: "real_cpi",
      reason: "includes_foreign_currency",
    });
  });

  it("names a reference that was never recorded", async () => {
    const { repository, firstCutoff } = await setup();

    expect(
      await readTransformedMacroSeries(
        { variableId: 15, kind: "real_cer" },
        query(firstCutoff),
        repository,
      ),
    ).toEqual({
      status: "no_definition_at_cutoff",
      seriesKey: "bcra-monetarias-v4:30",
    });
  });
});
