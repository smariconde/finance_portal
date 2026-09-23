import { createHash, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createInMemoryIngestionRunRepository } from "@/modules/ingestion/infrastructure/in-memory-ingestion-run-repository";

import { parseComafiProducts } from "../domain/parse-comafi-products";
import {
  FIXTURE_CEDEAR_ISINS,
  fixtureCedearGraph,
  fixtureComafiProducts,
} from "../infrastructure/fixture-cedear-publications";
import { InMemoryCedearRegistryRepository } from "../infrastructure/in-memory-cedear-registry-repository";

import type { CedearSourceProvider } from "./live-cedear-source";
import {
  cedearRunVerdict,
  recordCedearRegistry,
  UnknownCedearSourceError,
} from "./record-cedear-registry";

function stubSource(
  overrides: Parameters<typeof fixtureComafiProducts>[0] = {},
  fetchedAt = "2026-09-23T03:00:00.000Z",
): CedearSourceProvider {
  return {
    async load(sourceId) {
      const publication = parseComafiProducts(fixtureComafiProducts(overrides));

      if (!publication.ok) {
        throw new Error(publication.code);
      }

      return { sourceId, publication, byteLength: 2048, fetchedAt };
    },
  };
}

function setup() {
  const repository = new InMemoryCedearRegistryRepository(fixtureCedearGraph());
  const ingestionRuns = createInMemoryIngestionRunRepository();
  let tick = 0;

  const deps = (source: CedearSourceProvider, dryRun = false) => ({
    source,
    repository,
    ingestionRuns,
    loadGraph: async () => repository.graph(),
    now: () => {
      tick += 1;
      return new Date(Date.UTC(2026, 8, 23, 3, 0, tick)).toISOString();
    },
    newId: () => randomUUID(),
    hashContent: (input: string) =>
      createHash("sha256").update(input).digest("hex"),
    dryRun,
  });

  return { repository, ingestionRuns, deps };
}

describe("recordCedearRegistry", () => {
  it("writes nothing and records no run in a dry run", async () => {
    const { repository, ingestionRuns, deps } = setup();
    const outcome = await recordCedearRegistry(
      { sourceId: "comafi-cedear" },
      deps(stubSource(), true),
    );

    expect(outcome.plan.counts.programsOpened).toBe(3);
    expect(outcome.summary).toBeNull();
    expect(outcome.runId).toBeNull();
    expect((await repository.loadRegistry({})).programs).toEqual([]);
    expect(await ingestionRuns.list({ sourceId: "comafi-cedear" })).toEqual([]);
  });

  it("records the run and applies the plan", async () => {
    const { repository, ingestionRuns, deps } = setup();
    const outcome = await recordCedearRegistry(
      { sourceId: "comafi-cedear" },
      deps(stubSource()),
    );

    // Tres filas se rechazan por nombre: la corrida es parcial, no fallida.
    expect(outcome.runStatus).toBe("partial");
    expect(outcome.summary?.applied).toMatchObject({
      legalEntities: 1,
      securities: 3,
      identifierAssignments: 6,
      programs: 3,
      ratios: 3,
    });

    const [run] = await ingestionRuns.list({ sourceId: "comafi-cedear" });

    expect(run).toMatchObject({
      sourceId: "comafi-cedear",
      datasetId: "comafi.cedear-programs",
      parserVersion: "comafi-products-1.0.0",
      // En alcance: tres resueltas y tres rechazadas. Las tres de afuera del
      // universo se leyeron bien y no son de este registro.
      counts: { fetched: 6, accepted: 3, rejected: 3, duplicate: 0 },
      qualityFlags: ["availability_is_observation"],
    });

    // Cada fila cita la corrida que la observó.
    const registry = await repository.loadRegistry({});

    for (const program of registry.programs) {
      expect(program.sourceDocumentId).toBe(outcome.runId);
    }
  });

  it("records the same publication again as a duplicate that writes nothing", async () => {
    const { deps } = setup();
    await recordCedearRegistry(
      { sourceId: "comafi-cedear" },
      deps(stubSource()),
    );
    const again = await recordCedearRegistry(
      { sourceId: "comafi-cedear" },
      deps(stubSource({}, "2026-09-30T03:00:00.000Z")),
    );

    expect(again.runStatus).toBe("duplicate");
    expect(again.summary).toBeNull();
    expect(again.plan.counts.unchanged).toBe(3);
  });

  it("applies a withdrawal when the rest of the publication resolves", async () => {
    const { repository, deps } = setup();
    await recordCedearRegistry(
      { sourceId: "comafi-cedear" },
      deps(stubSource()),
    );
    const outcome = await recordCedearRegistry(
      { sourceId: "comafi-cedear" },
      deps(
        stubSource(
          { omit: [FIXTURE_CEDEAR_ISINS.alpha] },
          "2026-09-30T03:00:00.000Z",
        ),
      ),
    );

    expect(outcome.runStatus).toBe("partial");
    expect(outcome.summary?.applied.programSupersessions).toBe(1);
    expect(
      (await repository.loadRegistry({})).programs.filter(
        (program) => program.supersededAt === null,
      ),
    ).toHaveLength(2);
  });

  it("quarantines a publication where nothing in scope resolves", async () => {
    // Todo lo que queda en alcance se rechaza: eso se parece más a una
    // publicación rota que a tres bajas, y no se aplica nada.
    const { repository, deps } = setup();
    await recordCedearRegistry(
      { sourceId: "comafi-cedear" },
      deps(stubSource()),
    );
    const outcome = await recordCedearRegistry(
      { sourceId: "comafi-cedear" },
      deps(
        stubSource(
          {
            omit: [
              FIXTURE_CEDEAR_ISINS.alpha,
              FIXTURE_CEDEAR_ISINS.beta,
              FIXTURE_CEDEAR_ISINS.gammaA,
            ],
          },
          "2026-09-30T03:00:00.000Z",
        ),
      ),
    );

    expect(outcome.runStatus).toBe("quarantined");
    expect(outcome.summary).toBeNull();
    expect(
      (await repository.loadRegistry({})).programs.filter(
        (program) => program.supersededAt === null,
      ),
    ).toHaveLength(3);
  });

  it("refuses a source that is not a declared issuer", async () => {
    const { deps } = setup();

    await expect(
      recordCedearRegistry({ sourceId: "byma-cedear" }, deps(stubSource())),
    ).rejects.toBeInstanceOf(UnknownCedearSourceError);
  });
});

describe("cedearRunVerdict", () => {
  const plan = (
    counts: { resolved: number; rejected: number },
    refused = false,
  ) =>
    ({
      counts: { ...counts },
      refusal: refused
        ? { code: "withdrawal_guard", withdrawn: 9, open: 10 }
        : null,
    }) as unknown as Parameters<typeof cedearRunVerdict>[0];

  it("quarantines a refused plan without accepting anything", () => {
    expect(
      cedearRunVerdict(plan({ resolved: 5, rejected: 1 }, true), false),
    ).toEqual({
      status: "quarantined",
      counts: { fetched: 6, accepted: 0, rejected: 6, duplicate: 0 },
    });
  });

  it("calls a publication with nothing in scope empty", () => {
    expect(cedearRunVerdict(plan({ resolved: 0, rejected: 0 }), false)).toEqual(
      {
        status: "empty",
        counts: { fetched: 0, accepted: 0, rejected: 0, duplicate: 0 },
      },
    );
  });

  it("separates a clean run, a partial one and a duplicate", () => {
    expect(
      cedearRunVerdict(plan({ resolved: 4, rejected: 0 }), false).status,
    ).toBe("succeeded");
    expect(
      cedearRunVerdict(plan({ resolved: 4, rejected: 2 }), false).status,
    ).toBe("partial");
    expect(cedearRunVerdict(plan({ resolved: 4, rejected: 2 }), true)).toEqual({
      status: "duplicate",
      counts: { fetched: 6, accepted: 0, rejected: 0, duplicate: 6 },
    });
  });
});
