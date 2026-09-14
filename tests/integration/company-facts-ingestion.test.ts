import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  COMPANY_FACTS_PIPELINE,
  ingestCompanyFacts,
} from "@/modules/fundamentals/application/ingest-company-facts";
import {
  buildCompanyFactsUrl,
  buildSubmissionsUrl,
  createLiveCompanyFactsSource,
} from "@/modules/fundamentals/application/live-company-facts-source";
import {
  buildFixtureCompanyFactsText,
  buildFixtureFilerGraph,
  buildFixtureSubmissions,
  buildFixtureSubmissionsHistory,
  FIXTURE_ACCEPTED_AT,
  FIXTURE_ACCESSIONS,
  FIXTURE_FILER_CIK,
  FIXTURE_FILER_ENTITY_ID,
  FIXTURE_HISTORY_FILE,
} from "@/modules/fundamentals/infrastructure/fixture-sec-filer";
import { createGraphIdentityResolver } from "@/modules/identity/application/identity-resolver";
import type { EgressFetch } from "@/modules/ingestion/application/egress-fetch";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { publishObservations } from "@/modules/observations/application/publish-observations";
import {
  computeSourceDocumentContentHash,
  sourceDocumentSchema,
  type SourceDocumentContent,
} from "@/modules/observations/domain/source-document";
import { queryObservations } from "@/modules/observations/domain/select-observations";
import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";
import { createPostgresIngestionRunRepository } from "@/server/db/postgres-ingestion-run-repository";
import { createPostgresObservationRepository } from "@/server/db/postgres-observation-repository";
import { createPostgresSourceDocumentRepository } from "@/server/db/postgres-source-document-repository";
import { createPostgresSourceRegistryRepository } from "@/server/db/postgres-source-registry-repository";
import * as schema from "@/server/db/schema";

const databaseTestUrl = process.env.DATABASE_TEST_URL!.trim();
const CLOCK = "2026-09-14T15:00:00.000Z";
const SUBJECT = {
  subjectType: "legal_entity" as const,
  subjectId: FIXTURE_FILER_ENTITY_ID,
};

type PostgresErrorShape = { code?: string; constraint_name?: string };

async function expectConstraintViolation(
  operation: () => Promise<unknown>,
  constraintName: string,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    const cause = ((error as { cause?: unknown }).cause ??
      error) as PostgresErrorShape;
    expect(cause.constraint_name).toBe(constraintName);
    return;
  }

  throw new Error(`Expected ${constraintName} to reject the statement.`);
}

const secEntry = DEMO_SOURCE_REGISTRY.find(
  (entry) => entry.sourceId === "sec-edgar",
)!;

describe("PostgreSQL SEC company facts ingestion", () => {
  let client: Sql;
  let database: PostgresJsDatabase<typeof schema>;
  let companyFacts = { status: 200, body: buildFixtureCompanyFactsText() };

  const fetch: EgressFetch = async ({ url }) => {
    const text =
      url === buildSubmissionsUrl(FIXTURE_FILER_CIK)
        ? JSON.stringify(buildFixtureSubmissions())
        : url === `https://data.sec.gov/submissions/${FIXTURE_HISTORY_FILE}`
          ? JSON.stringify(buildFixtureSubmissionsHistory())
          : companyFacts.body;
    const status =
      url === buildCompanyFactsUrl(FIXTURE_FILER_CIK)
        ? companyFacts.status
        : 200;
    const body = new TextEncoder().encode(text);

    return { status, body, byteLength: body.byteLength, fetchedAt: CLOCK };
  };

  function dependencies() {
    return {
      sourceRegistry: createPostgresSourceRegistryRepository(database),
      ingestionRuns: createPostgresIngestionRunRepository(database),
      sourceDocuments: createPostgresSourceDocumentRepository(database),
      observations: createPostgresObservationRepository(database),
      identity: createGraphIdentityResolver(buildFixtureFilerGraph),
      source: createLiveCompanyFactsSource({ fetch }),
      now: () => CLOCK,
      newId: () => randomUUID(),
    };
  }

  async function clean() {
    await database
      .delete(schema.observations)
      .where(eq(schema.observations.sourceId, "sec-edgar"));
    await database
      .delete(schema.sourceDocuments)
      .where(eq(schema.sourceDocuments.sourceId, "sec-edgar"));
    await database
      .delete(schema.ingestionRuns)
      .where(eq(schema.ingestionRuns.sourceId, "sec-edgar"));
  }

  beforeAll(async () => {
    client = postgres(databaseTestUrl, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
    });
    database = drizzle(client, { schema });
    await createPostgresSourceRegistryRepository(database).upsert(secEntry);
  });

  beforeEach(async () => {
    companyFacts = { status: 200, body: buildFixtureCompanyFactsText() };
    await clean();
  });

  afterAll(async () => {
    if (database) {
      await clean();
    }
    await client?.end();
  });

  it("persists the run, its filings and the point-in-time chain", async () => {
    const outcome = await ingestCompanyFacts(
      { cik: FIXTURE_FILER_CIK, mode: "personal" },
      dependencies(),
    );

    expect(outcome.run.status).toBe("succeeded");

    const [run] = await database
      .select()
      .from(schema.ingestionRuns)
      .where(eq(schema.ingestionRuns.runId, outcome.run.runId));

    expect(run).toMatchObject({
      subjectKey: FIXTURE_FILER_CIK,
      selectionVersion: "sec-core-concepts-1.0.0",
      parserVersion: COMPANY_FACTS_PIPELINE.parserVersion,
      acceptedCount: 7,
    });

    const documents = await database
      .select()
      .from(schema.sourceDocuments)
      .where(eq(schema.sourceDocuments.sourceId, "sec-edgar"));

    expect(documents).toHaveLength(4);
    expect(
      documents.find(
        (document) =>
          document.sourceDocumentId === FIXTURE_ACCESSIONS.amendment,
      ),
    ).toMatchObject({
      documentType: "10-K/A",
      publishedOn: "2010-05-12",
      periodEndOn: "2009-12-31",
      fiscalYear: 2009,
      fiscalPeriod: "FY",
      availabilityRule: "sec_acceptance",
    });

    const stored = await createPostgresObservationRepository(database).list({
      ...SUBJECT,
      metricIds: ["us-gaap:Assets", "us-gaap:Revenues"],
    });
    const at = (knownAt: string) =>
      queryObservations(
        stored,
        { ...SUBJECT, metricIds: ["us-gaap:Assets"] },
        pointInTimeQuerySchema.parse({
          effectiveAt: "2011-01-01T00:00:00.000Z",
          revisionPolicy: "as_known",
          knownAt,
          sourcePolicyVersion: "source-policy-1.0.0",
        }),
      )[0]?.rawValue;

    // `TM-06` sobre la base real: la enmienda no se filtra hacia atrás.
    expect(at("2010-05-12T20:05:13.000Z")).toBe("412000000");
    expect(at(FIXTURE_ACCEPTED_AT.amendment)).toBe("396500000");
    // El acumulado de seis meses llega a PostgreSQL con su propio tipo.
    expect(stored.map((observation) => observation.periodType)).toContain(
      "year_to_date",
    );
  });

  it("records a repeated download as a duplicate without a new publishable run", async () => {
    const first = await ingestCompanyFacts(
      { cik: FIXTURE_FILER_CIK, mode: "personal" },
      dependencies(),
    );
    const second = await ingestCompanyFacts(
      { cik: FIXTURE_FILER_CIK, mode: "personal" },
      dependencies(),
    );

    expect(second.run).toMatchObject({
      status: "duplicate",
      replayOfRunId: first.run.runId,
    });
    expect(second.publication).toMatchObject({
      published: 0,
      duplicates: 7,
      rejections: {},
    });
    expect(second.sourceDocuments?.unchanged).toHaveLength(4);
  });

  it("quarantines a broken document on the real database and keeps the last batch", async () => {
    await ingestCompanyFacts(
      { cik: FIXTURE_FILER_CIK, mode: "personal" },
      dependencies(),
    );
    const repository = createPostgresObservationRepository(database);
    const before = await repository.list(SUBJECT);

    companyFacts = {
      status: 200,
      body: '{"cik": 42, "facts": {"us-gaap": 1}}',
    };
    const broken = await ingestCompanyFacts(
      { cik: FIXTURE_FILER_CIK, mode: "personal" },
      dependencies(),
    );

    expect(broken.run.status).toBe("quarantined");
    const [stored] = await database
      .select()
      .from(schema.ingestionRuns)
      .where(eq(schema.ingestionRuns.runId, broken.run.runId));
    expect(stored).toMatchObject({
      status: "quarantined",
      fetchedCount: 0,
      acceptedCount: 0,
      qualityFlags: ["companyfacts_payload_schema_invalid"],
    });
    await expect(repository.list(SUBJECT)).resolves.toStrictEqual(before);
  });

  it("never rewrites a recorded filing and refuses one knowable before acceptance", async () => {
    const outcome = await ingestCompanyFacts(
      { cik: FIXTURE_FILER_CIK, mode: "personal" },
      dependencies(),
    );
    const documents = createPostgresSourceDocumentRepository(database);
    const [original] = await documents.findByIds({
      sourceId: "sec-edgar",
      sourceDocumentIds: [FIXTURE_ACCESSIONS.annual],
    });
    const content: SourceDocumentContent = {
      ...original!,
      documentType: "10-K/A",
    };

    const recording = await documents.record([
      sourceDocumentSchema.parse({
        ...content,
        contentHash: computeSourceDocumentContentHash(content),
        ingestionRunId: outcome.run.runId,
        recordedAt: CLOCK,
      }),
    ]);

    expect(recording.conflicts).toStrictEqual([FIXTURE_ACCESSIONS.annual]);
    await expect(
      documents.findByIds({
        sourceId: "sec-edgar",
        sourceDocumentIds: [FIXTURE_ACCESSIONS.annual],
      }),
    ).resolves.toMatchObject([{ documentType: "10-K" }]);

    await expectConstraintViolation(
      () =>
        database.insert(schema.sourceDocuments).values({
          sourceId: "sec-edgar",
          sourceDocumentId: "0000000042-99-000001",
          documentType: "10-K",
          subjectType: "legal_entity",
          subjectId: FIXTURE_FILER_ENTITY_ID,
          acceptedAt: new Date("2010-02-23T22:10:40.000Z"),
          availableAt: new Date("2010-02-23T22:10:39.000Z"),
          availabilityRule: "sec_acceptance",
          contentHash: "a".repeat(64),
          ingestionRunId: outcome.run.runId,
        }),
      "source_documents_available_after_accepted_check",
    );
  });

  it("publishes a batch larger than one insert statement in a single commit", async () => {
    const outcome = await ingestCompanyFacts(
      { cik: FIXTURE_FILER_CIK, mode: "personal" },
      dependencies(),
    );
    const base = Date.parse("2000-01-01T00:00:00.000Z");
    const records = Array.from({ length: 1_203 }, (_, index) => {
      const asOf = new Date(base + index * 86_400_000)
        .toISOString()
        .slice(0, 10);

      return {
        externalId: `${FIXTURE_FILER_CIK}:us-gaap:Liabilities:USD:instant:${asOf}:bulk`,
        concept: "us-gaap:Liabilities",
        subjectKey: FIXTURE_FILER_CIK,
        metricId: "us-gaap:Liabilities",
        asOf,
        periodStart: null,
        periodEnd: null,
        periodType: "instant" as const,
        unit: "monetary",
        currency: "USD",
        rawValue: String(1_000 + index),
        rawValueStatus: "stored" as const,
        availableAt: "2010-01-01T00:00:00.000Z",
        sourceDocumentId: null,
        qualityFlags: [],
      };
    });

    const publication = await publishObservations(
      outcome.run,
      records,
      {
        fetchedAt: CLOCK,
        mode: "personal",
        documentSubject: {
          identifierType: "cik",
          identifierValue: FIXTURE_FILER_CIK,
          scope: "sec:filer",
          resolvedAt: CLOCK,
        },
      },
      {
        identity: createGraphIdentityResolver(buildFixtureFilerGraph),
        observations: createPostgresObservationRepository(database),
        now: () => CLOCK,
        newObservationId: () => randomUUID(),
      },
    );

    expect(publication.published).toHaveLength(1_203);
    await expect(
      createPostgresObservationRepository(database).list({
        ...SUBJECT,
        metricIds: ["us-gaap:Liabilities"],
        limit: 1000,
      }),
    ).resolves.toHaveLength(1000);
  });
});
