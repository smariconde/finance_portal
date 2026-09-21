import { randomUUID } from "node:crypto";

import { eq, inArray, sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createGraphIdentityResolver } from "@/modules/identity/application/identity-resolver";
import {
  DEMO_IDENTITY_GRAPH,
  DEMO_IDENTITY_IDS,
} from "@/modules/identity/infrastructure/demo-identity-fixtures";
import { executeIngestionRun } from "@/modules/ingestion/application/execute-ingestion-run";
import {
  createDemoDatasetProvider,
  createDemoRestatedDatasetProvider,
} from "@/modules/ingestion/infrastructure/demo-dataset-provider";
import {
  DEMO_DATASETS,
  DEMO_PARSER_VERSION,
  DEMO_SOURCE_ID,
} from "@/modules/ingestion/infrastructure/demo-ingestion-fixtures";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { runPointInTimeAudit } from "@/modules/observations/application/point-in-time-audit-reader";
import { publishObservations } from "@/modules/observations/application/publish-observations";
import {
  computeSourceDocumentContentHash,
  sourceDocumentSchema,
  type SourceDocument,
} from "@/modules/observations/domain/source-document";
import { createPostgresIngestionRunRepository } from "@/server/db/postgres-ingestion-run-repository";
import { createPostgresObservationRepository } from "@/server/db/postgres-observation-repository";
import { createPostgresPointInTimeAuditReader } from "@/server/db/postgres-point-in-time-audit-reader";
import { createPostgresSourceDocumentRepository } from "@/server/db/postgres-source-document-repository";
import { createPostgresSourceRegistryRepository } from "@/server/db/postgres-source-registry-repository";
import * as schema from "@/server/db/schema";

const databaseTestUrl = process.env.DATABASE_TEST_URL!.trim();
const RUN_CLOCK = "2026-08-24T10:00:00.000Z";
const PUBLISH_CLOCK = "2026-08-24T10:05:00.000Z";
const LATER_PUBLISH_CLOCK = "2026-08-24T11:00:00.000Z";

const fixtureEntry = DEMO_SOURCE_REGISTRY.find(
  (entry) => entry.sourceId === DEMO_SOURCE_ID,
)!;

/**
 * El verificador del gate sobre PostgreSQL (`F2-07`).
 *
 * Lo que se prueba acá y no en el dominio es la lectura: que las cadenas
 * lleguen enteras aunque la paginación las parta, y que una fila alterada en la
 * base —algo que el schema permite y el dominio nunca produce— sea nombrada.
 */
describe("PostgreSQL point-in-time audit", () => {
  let client: Sql;
  let database: PostgresJsDatabase<typeof schema>;

  async function ingestAndPublish(
    provider: ReturnType<typeof createDemoDatasetProvider>,
    options: { vintage: string | null; publishedAt: string },
  ) {
    const outcome = await executeIngestionRun(
      {
        sourceId: DEMO_SOURCE_ID,
        datasetId: DEMO_DATASETS.annual,
        parserVersion: DEMO_PARSER_VERSION,
        requestedAsOf: "2024-12-31",
        requestedVintage: options.vintage,
      },
      {
        sourceRegistry: createPostgresSourceRegistryRepository(database),
        ingestionRuns: createPostgresIngestionRunRepository(database),
        provider,
        now: () => RUN_CLOCK,
        newRunId: () => randomUUID(),
      },
    );

    await publishObservations(
      outcome.run,
      outcome.records,
      { fetchedAt: outcome.fetchedAt!, mode: "personal" },
      {
        identity: createGraphIdentityResolver(() => DEMO_IDENTITY_GRAPH),
        observations: createPostgresObservationRepository(database),
        now: () => options.publishedAt,
        newObservationId: () => randomUUID(),
      },
    );
  }

  /**
   * Las fixtures de demo citan un documento que ningún repositorio escribe: la
   * ingesta real de la SEC sí lo registra. Sin esta parte, el verificador
   * nombraría la incompletitud del doble de test en vez del contrato.
   */
  async function recordFixtureDocuments(runId: string): Promise<void> {
    const documents: SourceDocument[] = [
      ["fixtureco-fy2023-annual-report", "2024-02-15T21:00:00.000Z"],
      ["fixtureco-fy2024-annual-report", "2025-02-20T21:00:00.000Z"],
      ["fixtureco-fy2024-annual-report-amendment", "2025-05-01T14:00:00.000Z"],
    ].map(([sourceDocumentId, availableAt]) => {
      const content = {
        sourceId: DEMO_SOURCE_ID,
        sourceDocumentId: sourceDocumentId!,
        documentType: "annual-report",
        subjectType: "legal_entity" as const,
        subjectId: DEMO_IDENTITY_IDS.fixtureCoEntity,
        publishedOn: null,
        acceptedAt: availableAt!,
        availableAt: availableAt!,
        availabilityRule: "fixture-acceptance-1.0.0",
        periodEndOn: null,
        fiscalYear: null,
        fiscalPeriod: null,
      };

      return sourceDocumentSchema.parse({
        ...content,
        contentHash: computeSourceDocumentContentHash(content),
        ingestionRunId: runId,
        recordedAt: PUBLISH_CLOCK,
      });
    });

    await createPostgresSourceDocumentRepository(database).record(documents);
  }

  beforeAll(async () => {
    client = postgres(databaseTestUrl, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
    });
    database = drizzle(client, { schema });

    await createPostgresSourceRegistryRepository(database).upsert(fixtureEntry);
    // El verificador recorre la tabla entera: una fila de otro archivo entraría
    // en los conteos y volvería frágil la aserción.
    await database.delete(schema.observations);
    await database
      .delete(schema.ingestionRuns)
      .where(eq(schema.ingestionRuns.sourceId, DEMO_SOURCE_ID));

    await ingestAndPublish(
      createDemoDatasetProvider(() => RUN_CLOCK),
      {
        vintage: null,
        publishedAt: PUBLISH_CLOCK,
      },
    );
    const [anyRun] = await database
      .select({ runId: schema.ingestionRuns.runId })
      .from(schema.ingestionRuns)
      .where(eq(schema.ingestionRuns.sourceId, DEMO_SOURCE_ID))
      .limit(1);
    await recordFixtureDocuments(anyRun!.runId);
    await ingestAndPublish(
      createDemoRestatedDatasetProvider(() => RUN_CLOCK),
      {
        vintage: "2025-05-01",
        publishedAt: LATER_PUBLISH_CLOCK,
      },
    );
  });

  afterAll(async () => {
    if (database) {
      await database.delete(schema.observations);
      await database
        .delete(schema.sourceDocuments)
        .where(eq(schema.sourceDocuments.sourceId, DEMO_SOURCE_ID));
      await database
        .delete(schema.ingestionRuns)
        .where(eq(schema.ingestionRuns.sourceId, DEMO_SOURCE_ID));
      await database
        .delete(schema.sourceRegistry)
        .where(eq(schema.sourceRegistry.sourceId, DEMO_SOURCE_ID));
    }
    if (client) {
      await client.end();
    }
  });

  it("passes over a chain published by the real pipeline", async () => {
    const report = await runPointInTimeAudit(
      createPostgresPointInTimeAuditReader(database),
    );

    expect(report.revisions).toBe(6);
    expect(report.restatedChains).toBeGreaterThan(0);
    expect(report.findings).toEqual([]);
    expect(report.passed).toBe(true);
  });

  it("reads whole chains even when the page holds one at a time", async () => {
    const reader = createPostgresPointInTimeAuditReader(database);
    const paged = await runPointInTimeAudit(reader, { pageSize: 1 });
    const whole = await runPointInTimeAudit(reader);

    expect(paged.chains).toBe(whole.chains);
    expect(paged.revisions).toBe(whole.revisions);
    expect(paged.restatedChains).toBe(whole.restatedChains);
    expect(paged.verdicts).toEqual(whole.verdicts);
  });

  it("names a revision whose availability was moved behind the contract", async () => {
    // El schema no impide mover `available_at`: sólo exige que la supersesión
    // sea posterior. Correrla rompe el acuerdo con el documento que la trajo, y
    // eso es exactamente lo que el gate tiene que ver.
    const [restated] = await database
      .select({ observationId: schema.observations.observationId })
      .from(schema.observations)
      .where(sql`${schema.observations.revisionNumber} > 1`)
      .limit(1);

    expect(restated).toBeDefined();

    const original = await database
      .select({ availableAt: schema.observations.availableAt })
      .from(schema.observations)
      .where(eq(schema.observations.observationId, restated!.observationId));

    await database
      .update(schema.observations)
      .set({ availableAt: new Date("2025-03-15T00:00:00.000Z") })
      .where(eq(schema.observations.observationId, restated!.observationId));

    try {
      const report = await runPointInTimeAudit(
        createPostgresPointInTimeAuditReader(database),
      );

      expect(report.passed).toBe(false);
      expect(report.findings.map((finding) => finding.claim)).toContain(
        "revision_chain_ordered",
      );
    } finally {
      await database
        .update(schema.observations)
        .set({ availableAt: original[0]!.availableAt })
        .where(eq(schema.observations.observationId, restated!.observationId));
    }
  });

  it("leaves every table untouched", async () => {
    const before = await database
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.observations);

    await runPointInTimeAudit(createPostgresPointInTimeAuditReader(database));

    const after = await database
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.observations);

    expect(after[0]!.count).toBe(before[0]!.count);
    expect(
      await database
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.observationPrunes)
        .where(
          inArray(schema.observationPrunes.subjectId, [
            DEMO_IDENTITY_IDS.fixtureCoEntity,
          ]),
        ),
    ).toEqual([{ count: 0 }]);
  });
});
