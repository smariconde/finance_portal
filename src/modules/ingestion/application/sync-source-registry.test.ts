import { describe, expect, it, vi } from "vitest";

import { syncDeclaredSourceRegistry } from "@/modules/ingestion/application/sync-source-registry";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { createInMemorySourceRegistryRepository } from "@/modules/ingestion/infrastructure/in-memory-source-registry-repository";

describe("syncDeclaredSourceRegistry", () => {
  it("creates every declared source on an empty store", async () => {
    const repository = createInMemorySourceRegistryRepository([]);
    const summary = await syncDeclaredSourceRegistry(
      DEMO_SOURCE_REGISTRY,
      repository,
    );

    expect(summary.created).toEqual(
      DEMO_SOURCE_REGISTRY.map((entry) => entry.sourceId),
    );
    expect(summary.updated).toEqual([]);
    expect(await repository.findBySourceId("sec-edgar")).not.toBeNull();
  });

  it("writes nothing on a second run", async () => {
    const repository = createInMemorySourceRegistryRepository([]);
    await syncDeclaredSourceRegistry(DEMO_SOURCE_REGISTRY, repository);

    const upsert = vi.spyOn(repository, "upsert");
    const summary = await syncDeclaredSourceRegistry(
      DEMO_SOURCE_REGISTRY,
      repository,
    );

    expect(summary.unchanged).toEqual(
      DEMO_SOURCE_REGISTRY.map((entry) => entry.sourceId),
    );
    expect(upsert).not.toHaveBeenCalled();
  });

  it("ignores recordedAt, so a rewritten row is not a change", async () => {
    // `recordedAt` es cuándo se escribió la fila, no parte de lo que declara.
    // Incluirlo haría que cada corrida se viera como un cambio.
    const [first, ...rest] = DEMO_SOURCE_REGISTRY;
    const repository = createInMemorySourceRegistryRepository([
      { ...first, recordedAt: "2020-01-01T00:00:00.000Z" },
      ...rest,
    ]);

    const summary = await syncDeclaredSourceRegistry(
      DEMO_SOURCE_REGISTRY,
      repository,
    );

    expect(summary.updated).toEqual([]);
    expect(summary.unchanged).toContain(first.sourceId);
  });

  it("restores a right that was granted outside the declaration", async () => {
    // El punto del control: un derecho no debería poder concederse con un
    // `UPDATE` a la base. La declaración revisada es la que vale.
    const declared = DEMO_SOURCE_REGISTRY.find(
      (entry) => entry.sourceId === "alpaca-market-data",
    )!;
    const repository = createInMemorySourceRegistryRepository([
      {
        ...declared,
        approvalStatus: "approved_personal",
        // La fila fabricada es internamente válida —el schema exige fecha de
        // revisión para aprobar— y aun así no está declarada. Ese es el caso: no
        // se trata de datos corruptos sino de una aprobación que nadie revisó.
        rightsReviewedAt: "2026-09-05T00:00:00.000Z",
        rights: { ...declared.rights, automatedAccess: "allowed" },
      },
    ]);

    const summary = await syncDeclaredSourceRegistry([declared], repository);
    const stored = await repository.findBySourceId("alpaca-market-data");

    expect(summary.updated).toEqual(["alpaca-market-data"]);
    expect(stored?.approvalStatus).toBe("rights_review_pending");
    expect(stored?.rights.automatedAccess).toBe("unknown");
  });

  it("does not remove a stored source that the declaration no longer names", async () => {
    // La sincronización es en un solo sentido y no borra: quitar una fuente del
    // código no debe hacer desaparecer la evidencia de que alguna vez existió.
    const repository =
      createInMemorySourceRegistryRepository(DEMO_SOURCE_REGISTRY);

    await syncDeclaredSourceRegistry(
      DEMO_SOURCE_REGISTRY.filter((entry) => entry.sourceId !== "sec-edgar"),
      repository,
    );

    expect(await repository.findBySourceId("sec-edgar")).not.toBeNull();
  });
});
