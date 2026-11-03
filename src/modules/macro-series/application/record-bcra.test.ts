import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createInMemoryIngestionRunRepository } from "@/modules/ingestion/infrastructure/in-memory-ingestion-run-repository";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { createInMemorySourceRegistryRepository } from "@/modules/ingestion/infrastructure/in-memory-source-registry-repository";
import { sourceRegistryEntrySchema } from "@/modules/ingestion/domain/source-registry-entry";

import { seriesPageUrl } from "../domain/bcra-monetary-source";
import {
  createFixtureBcraFetch,
  fixtureDailyPoints,
  wireNumber,
  type FixtureBcraState,
} from "../infrastructure/fixture-bcra-payloads";
import { InMemoryMacroSeriesRepository } from "../infrastructure/in-memory-macro-series-repository";

import { BcraSourceError, createLiveBcraSource } from "./live-bcra-source";
import { readMacroSeries } from "./read-macro-series";
import { recordBcraCatalog } from "./record-bcra-catalog";
import { recordBcraSeries } from "./record-bcra-series";

const KEY = "bcra-monetarias-v4:30";

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

function setup(registry = createInMemorySourceRegistryRepository()) {
  const state: FixtureBcraState = {
    catalog: [
      { idVariable: 1, unidadExpresion: "En millones de USD", moneda: "ME" },
      {
        idVariable: 30,
        tipoSerie: "Índice",
        unidadExpresion: "Índice base 2.2.02=1",
        ultFechaInformada: "2026-11-02",
        ultValorInformado: wireNumber("3500"),
      },
    ],
    methodology: [
      { id: 1, detalle: "Saldo diario de reservas, sintético." },
      { id: 30, detalle: "Coeficiente sintético." },
    ],
    // 3.500 puntos: la primera descarga son dos páginas, la ventana una.
    series: new Map([[30, fixtureDailyPoints("2026-11-15", 3500)]]),
  };
  let tick = Date.parse("2026-11-02T12:00:00.000Z");
  const clock = () => {
    tick += 1000;
    return new Date(tick).toISOString();
  };
  const overrides = new Map<string, { status: number; body: string }>();
  const fetch = createFixtureBcraFetch(state, clock, overrides);
  const repository = new InMemoryMacroSeriesRepository();
  const ingestionRuns = createInMemoryIngestionRunRepository();
  const source = createLiveBcraSource({ sourceRegistry: registry, fetch });
  const dependencies = {
    source,
    repository,
    ingestionRuns,
    now: clock,
    newId: () => randomUUID(),
  };

  return {
    state,
    fetch,
    overrides,
    repository,
    ingestionRuns,
    dependencies,
    clock,
  };
}

describe("recordBcraCatalog", () => {
  it("records every definition once and writes nothing for the same catalog", async () => {
    const { dependencies, repository, fetch } = setup();
    const first = await recordBcraCatalog(dependencies);
    const second = await recordBcraCatalog(dependencies);

    expect(first.runStatus).toBe("succeeded");
    expect(first.plan.opened).toHaveLength(2);
    expect(fetch.requests).toHaveLength(4);
    expect(second.runStatus).toBe("duplicate");
    expect(
      await repository.listOpenDefinitions("bcra-monetarias-v4"),
    ).toHaveLength(2);
  });

  it("writes nothing in a dry run", async () => {
    const { dependencies, repository, ingestionRuns } = setup();
    const outcome = await recordBcraCatalog({ ...dependencies, dryRun: true });

    expect(outcome.runId).toBeNull();
    expect(
      await repository.listOpenDefinitions("bcra-monetarias-v4"),
    ).toHaveLength(0);
    expect(
      await ingestionRuns.list({ sourceId: "bcra-monetarias-v4", limit: 10 }),
    ).toHaveLength(0);
  });

  it("refuses before the network when the rights row does not approve the source", async () => {
    const entry = DEMO_SOURCE_REGISTRY.find(
      (candidate) => candidate.sourceId === "bcra-monetarias-v4",
    )!;
    const registry = createInMemorySourceRegistryRepository([
      ...DEMO_SOURCE_REGISTRY.filter((candidate) => candidate !== entry),
      sourceRegistryEntrySchema.parse({
        ...entry,
        approvalStatus: "rights_review_pending",
      }),
    ]);
    const { dependencies, fetch } = setup(registry);

    await expect(recordBcraCatalog(dependencies)).rejects.toMatchObject({
      code: "rights_not_approved",
    });
    expect(fetch.requests).toHaveLength(0);
  });
});

describe("recordBcraSeries", () => {
  it("asks nothing for a variable whose definition was never recorded", async () => {
    const { dependencies, fetch } = setup();
    const outcome = await recordBcraSeries(30, dependencies);

    expect(outcome.status).toBe("definition_not_recorded");
    expect(fetch.requests).toHaveLength(0);
  });

  it("downloads the whole history first, then only the latest page", async () => {
    const { dependencies, fetch, state, repository } = setup();
    await recordBcraCatalog(dependencies);
    const before = fetch.requests.length;

    const first = await recordBcraSeries(30, dependencies);

    expect(first.status === "recorded" && first.fetched.coverage).toBe(
      "complete",
    );
    expect(first.status === "recorded" && first.plan.counts.new).toBe(3500);
    expect(first.status === "recorded" && first.runStatus).toBe("succeeded");
    expect(fetch.requests.length - before).toBe(2);
    expect(await repository.findSeries(KEY)).toMatchObject({
      basis: {
        frequency: "daily",
        unit: "Índice base 2.2.02=1",
        currencyCode: "ML",
      },
    });

    // La fuente corrige un punto reciente y otro viejo, fuera de la ventana.
    const points = [...state.series.get(30)!];
    points[10] = { ...points[10]!, valor: wireNumber("9999.5") };
    points[3400] = { ...points[3400]!, valor: wireNumber("1") };
    state.series.set(30, points);
    const middle = fetch.requests.length;

    const refresh = await recordBcraSeries(30, dependencies);

    expect(fetch.requests.length - middle).toBe(1);
    expect(refresh.status === "recorded" && refresh.fetched.coverage).toBe(
      "window",
    );
    expect(refresh.status === "recorded" && refresh.plan.counts).toMatchObject({
      revised: 1,
      unchanged: 2999,
      withdrawn: 0,
    });
    expect(refresh.status === "recorded" && refresh.plan.windowStartsOn).toBe(
      points[2999]!.fecha,
    );

    const again = await recordBcraSeries(30, dependencies);

    expect(again.status === "recorded" && again.runStatus).toBe("duplicate");

    // `--full` sí ve la corrección vieja.
    const full = await recordBcraSeries(30, { ...dependencies, full: true });

    expect(full.status === "recorded" && full.plan.counts.revised).toBe(1);
  });

  it("keeps the earlier value readable at a cutoff before the revision", async () => {
    const { dependencies, state, repository } = setup();
    await recordBcraCatalog(dependencies);
    const first = await recordBcraSeries(30, dependencies);
    const firstSeen =
      first.status === "recorded" ? first.fetched.observedAt : "";
    const points = [...state.series.get(30)!];
    const date = points[10]!.fecha;
    const original = points[10]!.valor!;
    points[10] = { ...points[10]!, valor: wireNumber("9999.5") };
    state.series.set(30, points);
    const refresh = await recordBcraSeries(30, dependencies);
    const revisedAt =
      refresh.status === "recorded" ? refresh.fetched.observedAt : "";

    // El punto es del 5 de noviembre: con el corte efectivo en la observación
    // sería «publicado por adelantado», como el CER. Se lee a fin de año.
    const known = (at: string) => ({
      ...query(at),
      effectiveAt: "2026-12-31T00:00:00.000Z",
    });
    const before = await readMacroSeries(KEY, known(firstSeen), repository);
    const after = await readMacroSeries(KEY, known(revisedAt), repository);
    const early = await readMacroSeries(KEY, query(firstSeen), repository);

    expect(early.status === "read" && early.aheadOfEffective).toBe(13);
    const at = (reading: typeof before) =>
      reading.status === "read"
        ? reading.points.find((point) => point.periodOn === date)?.value
        : undefined;

    expect(at(before)).toBe(original.replace(/\.?0+$/u, ""));
    expect(at(after)).toBe("9999.5");
    expect(after.status === "read" && after.definition.unit).toBe(
      "Índice base 2.2.02=1",
    );
  });

  it("refuses a series whose definition changed its unit after the first download", async () => {
    const { dependencies, state, fetch } = setup();
    await recordBcraCatalog(dependencies);
    await recordBcraSeries(30, dependencies);
    state.catalog = state.catalog.map((row) =>
      row.idVariable === 30
        ? { ...row, unidadExpresion: "Índice base 2016=100" }
        : row,
    );
    await recordBcraCatalog(dependencies);
    const before = fetch.requests.length;

    const outcome = await recordBcraSeries(30, dependencies);

    expect(outcome).toMatchObject({
      status: "definition_basis_changed",
      pinned: { unit: "Índice base 2.2.02=1" },
      current: { unit: "Índice base 2016=100" },
    });
    expect(fetch.requests.length).toBe(before);
  });

  it("quarantines a run whose window changes by a thousand and writes nothing", async () => {
    const { dependencies, state, repository } = setup();
    await recordBcraCatalog(dependencies);
    await recordBcraSeries(30, dependencies);
    state.series.set(
      30,
      state.series.get(30)!.map((point) => ({
        ...point,
        valor: `${point.valor!.split(".")[0]}000.00000000000`,
      })),
    );

    const outcome = await recordBcraSeries(30, dependencies);

    expect(outcome.status === "recorded" && outcome.runStatus).toBe(
      "quarantined",
    );
    expect(
      (await repository.listObservations(KEY)).every(
        (observation) => observation.revision === 0,
      ),
    ).toBe(true);
  });

  it("stops on a 429 with its Retry-After and never retries", async () => {
    const { dependencies, overrides, fetch } = setup();
    await recordBcraCatalog(dependencies);
    overrides.set(seriesPageUrl(30, 0), { status: 429, body: "" });
    const before = fetch.requests.length;

    const failure = await recordBcraSeries(30, dependencies).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(BcraSourceError);
    expect(failure).toMatchObject({ code: "rate_limited", retryAfter: "60" });
    expect(fetch.requests.length - before).toBe(1);
  });

  it("refuses a page that changed shape and publishes nothing", async () => {
    const { dependencies, overrides, repository } = setup();
    await recordBcraCatalog(dependencies);
    overrides.set(seriesPageUrl(30, 0), {
      status: 200,
      body: '{"status":200,"metadata":{"resultset":{"count":1,"offset":0,"limit":3000}},"results":[{"idVariable":30,"detalle":[{"fecha":"2026-11-15","valor":1.0,"revision":2}]}]}',
    });

    await expect(recordBcraSeries(30, dependencies)).rejects.toMatchObject({
      code: "payload_rejected",
    });
    expect(await repository.listObservations(KEY)).toHaveLength(0);
  });
});
