import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { EgressFetch } from "@/modules/ingestion/application/egress-fetch";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { createInMemoryIngestionRunRepository } from "@/modules/ingestion/infrastructure/in-memory-ingestion-run-repository";
import { createInMemorySourceRegistryRepository } from "@/modules/ingestion/infrastructure/in-memory-source-registry-repository";

import { findDamodaranDataset } from "../domain/damodaran-datasets";
import {
  fixtureBetaRows,
  fixtureBetasPage,
  fixtureRatingsPage,
} from "../infrastructure/fixture-damodaran-pages";
import { InMemoryReferenceDatasetRepository } from "../infrastructure/in-memory-reference-dataset-repository";

import {
  createLiveDamodaranSource,
  ReferenceSourceError,
} from "./live-damodaran-source";
import { readReferenceDataset } from "./read-reference-dataset";
import { recordReferenceDataset } from "./record-reference-datasets";

const BETAS = findDamodaranDataset("damodaran.betas-us")!;
const FIRST = "2026-10-02T12:00:00.000Z";
const SECOND = "2026-11-02T12:00:00.000Z";

function respond(body: string, fetchedAt: string, status = 200): EgressFetch {
  const bytes = new TextEncoder().encode(body);

  return async () => ({
    status,
    body: bytes,
    byteLength: bytes.byteLength,
    fetchedAt,
  });
}

function setup() {
  const repository = new InMemoryReferenceDatasetRepository();
  const ingestionRuns = createInMemoryIngestionRunRepository();
  const record = (body: string, fetchedAt: string, dryRun = false) =>
    recordReferenceDataset(BETAS, {
      source: createLiveDamodaranSource({
        sourceRegistry: createInMemorySourceRegistryRepository(),
        fetch: respond(body, fetchedAt),
      }),
      repository,
      ingestionRuns,
      now: () => fetchedAt,
      newId: () => randomUUID(),
      dryRun,
    });

  return { repository, ingestionRuns, record };
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

describe("recordReferenceDataset", () => {
  it("writes nothing in a dry run", async () => {
    const { repository, ingestionRuns, record } = setup();
    const outcome = await record(fixtureBetasPage(), FIRST, true);

    expect(outcome.plan.status).toBe("opened");
    expect(outcome.runId).toBeNull();
    expect(await repository.listReleases(BETAS.datasetId)).toEqual([]);
    expect(
      await ingestionRuns.list({ sourceId: "damodaran-current-data" }),
    ).toEqual([]);
  });

  it("opens the first release dated at the observation, not at the page's month", async () => {
    const { repository, record } = setup();
    const outcome = await record(fixtureBetasPage(), FIRST);

    expect(outcome).toMatchObject({
      runStatus: "succeeded",
      publishedLabel: "January 2026",
    });
    const [release] = await repository.listReleases(BETAS.datasetId);
    expect(release).toMatchObject({
      validFrom: FIRST,
      availableAt: FIRST,
      publishedLabel: "January 2026",
      rowCount: 54,
      sourceDocumentId: BETAS.url,
    });
  });

  it("records the same page again as a duplicate run and writes no release", async () => {
    const { repository, record } = setup();
    await record(fixtureBetasPage(), FIRST);
    const again = await record(fixtureBetasPage(), SECOND);

    expect(again).toMatchObject({
      runStatus: "duplicate",
      plan: { status: "unchanged" },
    });
    expect(await repository.listReleases(BETAS.datasetId)).toHaveLength(1);
  });

  it("supersedes at the new observation when the content changes, and keeps the old one readable before it", async () => {
    const { repository, record } = setup();
    await record(fixtureBetasPage(), FIRST);
    const rows = fixtureBetaRows();
    rows[0] = [
      "Industry 01",
      "10",
      "1.40",
      "25.00%",
      "12.50%",
      "0.95",
      "4.00%",
      "1.00",
      "0.5",
      "40.00%",
      "20.00%",
    ];
    const changed = await record(fixtureBetasPage({ rows }), SECOND);

    expect(changed.plan.status).toBe("opened");

    const before = await readReferenceDataset(
      BETAS.datasetId,
      query("2026-10-15T00:00:00.000Z"),
      repository,
    );
    const after = await readReferenceDataset(
      BETAS.datasetId,
      query("2026-11-15T00:00:00.000Z"),
      repository,
    );
    expect(
      before?.rows.find((row) => row.key === "industry-01")?.values.beta,
    ).toBe("1.10");
    expect(
      after?.rows.find((row) => row.key === "industry-01")?.values.beta,
    ).toBe("1.40");
  });

  it("lets the same content come back after another as a new transition", async () => {
    const { repository, record } = setup();
    const rows = fixtureBetaRows();
    rows[0] = [
      "Industry 01",
      "10",
      "1.40",
      "25.00%",
      "12.50%",
      "0.95",
      "4.00%",
      "1.00",
      "0.5",
      "40.00%",
      "20.00%",
    ];

    await record(fixtureBetasPage(), FIRST);
    await record(fixtureBetasPage({ rows }), SECOND);
    const back = await record(fixtureBetasPage(), "2026-12-02T12:00:00.000Z");

    expect(back.runStatus).toBe("succeeded");
    expect(await repository.listReleases(BETAS.datasetId)).toHaveLength(3);
  });

  it("names no parameters before the first observation", async () => {
    const { repository, record } = setup();
    await record(fixtureBetasPage(), FIRST);

    expect(
      await readReferenceDataset(
        BETAS.datasetId,
        query("2026-09-01T00:00:00.000Z"),
        repository,
      ),
    ).toBeNull();
  });
});

describe("createLiveDamodaranSource", () => {
  it("refuses before the network when the rights row does not allow the run", async () => {
    let called = false;
    const blocked = DEMO_SOURCE_REGISTRY.map((entry) =>
      entry.sourceId === "damodaran-current-data"
        ? {
            ...entry,
            rights: { ...entry.rights, automatedAccess: "unknown" as const },
          }
        : entry,
    );
    const source = createLiveDamodaranSource({
      sourceRegistry: createInMemorySourceRegistryRepository(blocked),
      fetch: async (request) => {
        called = true;
        return respond("", FIRST)(request);
      },
    });

    await expect(source.load(BETAS)).rejects.toMatchObject({
      code: "rights_not_approved",
    });
    expect(called).toBe(false);
  });

  it("asks for the declared page under its source and names a bad status or page", async () => {
    const requested: string[] = [];
    const source = createLiveDamodaranSource({
      sourceRegistry: createInMemorySourceRegistryRepository(),
      fetch: async (request) => {
        requested.push(`${request.sourceId} ${request.url}`);
        return respond(fixtureRatingsPage(), FIRST, 503)(request);
      },
    });
    const ratings = findDamodaranDataset("damodaran.synthetic-ratings")!;

    await expect(source.load(ratings)).rejects.toBeInstanceOf(
      ReferenceSourceError,
    );
    expect(requested).toEqual([
      "damodaran-current-data https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/ratings.html",
    ]);

    const broken = createLiveDamodaranSource({
      sourceRegistry: createInMemorySourceRegistryRepository(),
      fetch: respond("<html>maintenance</html>", FIRST),
    });
    await expect(broken.load(ratings)).rejects.toMatchObject({
      code: "payload_rejected",
    });
  });
});
