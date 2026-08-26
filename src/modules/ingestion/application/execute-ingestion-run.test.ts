import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DatasetProvider } from "@/modules/ingestion/application/dataset-provider";
import { executeIngestionRun } from "@/modules/ingestion/application/execute-ingestion-run";
import { createDemoDatasetProvider } from "@/modules/ingestion/infrastructure/demo-dataset-provider";
import { createInMemoryIngestionRunRepository } from "@/modules/ingestion/infrastructure/in-memory-ingestion-run-repository";
import { createInMemorySourceRegistryRepository } from "@/modules/ingestion/infrastructure/in-memory-source-registry-repository";
import {
  DEMO_DATASETS,
  DEMO_PARSER_VERSION,
  DEMO_SOURCE_ID,
} from "@/modules/ingestion/infrastructure/demo-ingestion-fixtures";

const FIXED_NOW = "2026-08-23T10:00:00.000Z";

function createRunIds() {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
  };
}

function createHarness(
  provider: DatasetProvider = createDemoDatasetProvider(() => FIXED_NOW),
) {
  const ingestionRuns = createInMemoryIngestionRunRepository();

  return {
    ingestionRuns,
    dependencies: {
      sourceRegistry: createInMemorySourceRegistryRepository(),
      ingestionRuns,
      provider,
      now: () => FIXED_NOW,
      newRunId: createRunIds(),
    },
  };
}

function command(datasetId: string, overrides: Record<string, unknown> = {}) {
  return {
    sourceId: DEMO_SOURCE_ID,
    datasetId,
    parserVersion: DEMO_PARSER_VERSION,
    ...overrides,
  };
}

// `TM-08`: ninguna ruta de este slice puede abrir red.
const fetchSpy = vi.spyOn(globalThis, "fetch");

describe("executeIngestionRun", () => {
  beforeEach(() => {
    fetchSpy.mockClear();
  });

  it("accepts a complete synthetic batch and reports it as publishable", async () => {
    const { dependencies, ingestionRuns } = createHarness();

    const outcome = await executeIngestionRun(
      command(DEMO_DATASETS.annual),
      dependencies,
    );

    expect(outcome.run.status).toBe("succeeded");
    expect(outcome.run.counts).toStrictEqual({
      fetched: 5,
      accepted: 5,
      rejected: 0,
      duplicate: 0,
    });
    expect(outcome.publishable).toBe(true);
    expect(outcome.records).toHaveLength(5);
    expect(outcome.run.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(outcome.run.failure).toBeNull();
    await expect(
      ingestionRuns.list({ sourceId: DEMO_SOURCE_ID }),
    ).resolves.toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("preserves missing values instead of coercing them to zero", async () => {
    const { dependencies } = createHarness();

    const outcome = await executeIngestionRun(
      command(DEMO_DATASETS.annual),
      dependencies,
    );

    expect(
      outcome.records
        .filter((record) => record.rawValue === null)
        .map((record) => record.rawValueStatus)
        .sort(),
    ).toStrictEqual(["license_restricted", "not_provided"]);
  });

  it("records an empty response without publishing or failing", async () => {
    const { dependencies } = createHarness();

    const outcome = await executeIngestionRun(
      command(DEMO_DATASETS.empty),
      dependencies,
    );

    expect(outcome.run.status).toBe("empty");
    expect(outcome.run.failure).toBeNull();
    expect(outcome.publishable).toBe(false);
    expect(outcome.records).toHaveLength(0);
    expect(outcome.run.qualityFlags).toContain("empty_response");
  });

  it("accepts a partial batch and reports the rejected rows without echoing values", async () => {
    const { dependencies } = createHarness();

    const outcome = await executeIngestionRun(
      command(DEMO_DATASETS.partial),
      dependencies,
    );

    expect(outcome.run.status).toBe("partial");
    expect(outcome.run.counts).toStrictEqual({
      fetched: 3,
      accepted: 2,
      rejected: 1,
      duplicate: 0,
    });
    expect(outcome.publishable).toBe(true);
    expect(outcome.rejections).toStrictEqual([
      { index: 1, code: "schema_invalid", fields: ["availableAt"] },
    ]);
  });

  it("quarantines a batch that no record survives", async () => {
    const { dependencies } = createHarness();

    const outcome = await executeIngestionRun(
      command(DEMO_DATASETS.broken),
      dependencies,
    );

    expect(outcome.run.status).toBe("quarantined");
    expect(outcome.run.counts.accepted).toBe(0);
    expect(outcome.publishable).toBe(false);
    expect(outcome.records).toHaveLength(0);
    expect(outcome.run.qualityFlags).toContain("parser_broken");
    expect(outcome.rejections).toHaveLength(2);
  });

  it("records a provider outage as a retryable failure with a redacted message", async () => {
    const { dependencies } = createHarness();

    const outcome = await executeIngestionRun(
      command(DEMO_DATASETS.unavailable),
      dependencies,
    );

    expect(outcome.run.status).toBe("failed");
    expect(outcome.run.failure).toStrictEqual({
      code: "provider_error",
      message: "La fuente sintética simula una caída del proveedor.",
      retryable: true,
    });
    expect(outcome.run.contentHash).toBeNull();
    expect(outcome.providerCalled).toBe(true);
  });

  it("blocks a source without approved rights before contacting the provider", async () => {
    const provider = createDemoDatasetProvider(() => FIXED_NOW);
    const fetchDataset = vi.spyOn(provider, "fetchDataset");
    const { dependencies } = createHarness(provider);

    const outcome = await executeIngestionRun(
      {
        sourceId: "sec-edgar",
        datasetId: "sec.companyfacts",
        parserVersion: "sec-1.0.0",
      },
      dependencies,
    );

    expect(outcome.run.status).toBe("failed");
    expect(outcome.run.failure?.code).toBe("rights_not_approved");
    expect(outcome.run.failure?.retryable).toBe(false);
    expect(outcome.run.qualityFlags).toContain("rights_blocked");
    expect(outcome.providerCalled).toBe(false);
    expect(fetchDataset).not.toHaveBeenCalled();
  });

  it("rejects a source that is not in the registry", async () => {
    const { dependencies } = createHarness();

    const outcome = await executeIngestionRun(
      {
        sourceId: "unregistered-source",
        datasetId: "demo.fundamentals.annual",
        parserVersion: "fixture-1.0.0",
      },
      dependencies,
    );

    expect(outcome.run.failure?.code).toBe("source_not_registered");
  });

  it("rejects a dataset the source does not declare", async () => {
    const { dependencies } = createHarness();

    const outcome = await executeIngestionRun(
      command("demo.fundamentals.unknown"),
      dependencies,
    );

    expect(outcome.run.failure?.code).toBe("dataset_not_registered");
  });

  it("replays an identical request without contacting the provider again", async () => {
    const provider = createDemoDatasetProvider(() => FIXED_NOW);
    const fetchDataset = vi.spyOn(provider, "fetchDataset");
    const { dependencies, ingestionRuns } = createHarness(provider);

    const first = await executeIngestionRun(
      command(DEMO_DATASETS.annual),
      dependencies,
    );
    const second = await executeIngestionRun(
      command(DEMO_DATASETS.annual),
      dependencies,
    );

    expect(second.run.runId).toBe(first.run.runId);
    expect(second.replayedFrom).toBe(first.run.runId);
    expect(second.providerCalled).toBe(false);
    expect(fetchDataset).toHaveBeenCalledTimes(1);
    await expect(
      ingestionRuns.list({ sourceId: DEMO_SOURCE_ID }),
    ).resolves.toHaveLength(1);
  });

  it("retries a failed run instead of replaying it", async () => {
    const provider = createDemoDatasetProvider(() => FIXED_NOW);
    const fetchDataset = vi.spyOn(provider, "fetchDataset");
    const { dependencies } = createHarness(provider);

    await executeIngestionRun(command(DEMO_DATASETS.unavailable), dependencies);
    const retry = await executeIngestionRun(
      command(DEMO_DATASETS.unavailable),
      dependencies,
    );

    expect(retry.replayedFrom).toBeNull();
    expect(fetchDataset).toHaveBeenCalledTimes(2);
  });

  it("marks an unchanged batch as duplicate instead of republishing it", async () => {
    const { dependencies } = createHarness();

    const first = await executeIngestionRun(
      command(DEMO_DATASETS.annual, { requestedAsOf: "2026-08-22" }),
      dependencies,
    );
    // Otra solicitud (as-of distinto) sobre contenido idéntico.
    const second = await executeIngestionRun(
      command(DEMO_DATASETS.annual, { requestedAsOf: "2026-08-23" }),
      dependencies,
    );

    expect(first.run.status).toBe("succeeded");
    expect(second.run.status).toBe("duplicate");
    expect(second.run.contentHash).toBe(first.run.contentHash);
    expect(second.run.replayOfRunId).toBe(first.run.runId);
    expect(second.publishable).toBe(false);
    expect(second.records).toHaveLength(0);
  });

  it("paginates deterministically through a cursor", async () => {
    const { dependencies } = createHarness();

    const firstPage = await executeIngestionRun(
      command(DEMO_DATASETS.annual, { maxRecords: 2 }),
      dependencies,
    );

    expect(firstPage.run.counts.fetched).toBe(2);
    expect(firstPage.run.nextCursor).toBe("offset:2");

    const secondPage = await executeIngestionRun(
      command(DEMO_DATASETS.annual, {
        maxRecords: 2,
        cursor: firstPage.run.nextCursor,
      }),
      dependencies,
    );

    expect(secondPage.run.cursor).toBe("offset:2");
    expect(secondPage.run.nextCursor).toBe("offset:4");
    expect(secondPage.run.idempotencyKey).not.toBe(
      firstPage.run.idempotencyKey,
    );
  });

  it("produces the same content hash for the same fixture and parser", async () => {
    const first = await executeIngestionRun(
      command(DEMO_DATASETS.annual),
      createHarness().dependencies,
    );
    const second = await executeIngestionRun(
      command(DEMO_DATASETS.annual),
      createHarness().dependencies,
    );

    expect(second.run.contentHash).toBe(first.run.contentHash);
  });
});
