import { randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { planSecHistoryPrune } from "@/modules/fundamentals/domain/plan-sec-history-prune";
import { SEC_CONCEPT_SELECTION_VERSION } from "@/modules/fundamentals/domain/sec-concept-selection";
import {
  ingestionRunSchema,
  type IngestionRun,
} from "@/modules/ingestion/domain/ingestion-run";
import {
  observationSchema,
  type Observation,
} from "@/modules/observations/domain/observation";
import { observationPrunePlanSchema } from "@/modules/observations/domain/observation-prune";
import { createPostgresIngestionRunRepository } from "@/server/db/postgres-ingestion-run-repository";
import { createPostgresObservationRepository } from "@/server/db/postgres-observation-repository";
import * as schema from "@/server/db/schema";

const databaseTestUrl = process.env.DATABASE_TEST_URL!.trim();

const SOURCE_ID = "sec-edgar";
const FACTS_DATASET = "sec.companyfacts";
const OTHER_DATASET = "sec.submissions";
const PARSER = "sec-companyfacts-1.0.0";
const CIK = "0009990001";
/** Cierre fiscal real de Apple, medido el 2026-09-17. */
const ANCHOR_ON = "2025-09-27";
const EVIDENCE_CONCEPT = "us-gaap:EarningsPerShareDiluted";

const SUBJECT_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const OTHER_SUBJECT_ID = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

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

let sequence = 0;

function hex(seed: number): string {
  return seed.toString(16).padStart(64, "0");
}

function run(overrides: {
  runId: string;
  datasetId: string;
  selectionVersion: string | null;
  selectionAnchorOn: string | null;
  startedAt: string;
}): IngestionRun {
  return ingestionRunSchema.parse({
    runId: overrides.runId,
    sourceId: SOURCE_ID,
    datasetId: overrides.datasetId,
    parserVersion: PARSER,
    idempotencyKey: overrides.runId.replaceAll("-", "").repeat(2),
    requestedAsOf: null,
    requestedVintage: null,
    cursor: null,
    nextCursor: null,
    subjectKey: CIK,
    selectionVersion: overrides.selectionVersion,
    selectionAnchorOn: overrides.selectionAnchorOn,
    status: "succeeded",
    startedAt: overrides.startedAt,
    finishedAt: overrides.startedAt,
    counts: { fetched: 1, accepted: 1, rejected: 0, duplicate: 0 },
    contentHash: hex(1),
    failure: null,
    qualityFlags: [],
    replayOfRunId: null,
    recordedAt: overrides.startedAt,
  });
}

function observation(overrides: {
  asOf: string;
  runId: string;
  datasetId: string;
  concept?: string;
  subjectId?: string;
}): Observation {
  sequence += 1;

  return observationSchema.parse({
    observationId: randomUUID(),
    subjectType: "legal_entity",
    subjectId: overrides.subjectId ?? SUBJECT_ID,
    metricId: overrides.concept ?? "us-gaap:Assets",
    concept: overrides.concept ?? "us-gaap:Assets",
    sourceId: SOURCE_ID,
    datasetId: overrides.datasetId,
    parserVersion: PARSER,
    asOf: overrides.asOf,
    periodStart: null,
    periodEnd: null,
    periodType: "instant",
    unit: "monetary",
    currency: "USD",
    rawValue: "1",
    rawValueStatus: "stored",
    normalizedValue: null,
    transformationId: null,
    valueBasis: "reported",
    availableAt: "2026-01-01T00:00:00.000Z",
    supersededAt: null,
    fetchedAt: "2026-01-01T00:00:00.000Z",
    recordedAt: "2026-01-01T00:00:00.000Z",
    revisionGroupId: hex(sequence),
    revisionNumber: 1,
    restatementOfId: null,
    contentHash: hex(sequence + 5_000_000),
    qualityFlags: [],
    sourceDocumentId: null,
    ingestionRunId: overrides.runId,
  });
}

describe("PostgreSQL observation prune", () => {
  let client: Sql;
  let database: PostgresJsDatabase<typeof schema>;
  let observations: ReturnType<typeof createPostgresObservationRepository>;
  let runs: ReturnType<typeof createPostgresIngestionRunRepository>;
  let anchoredRunId: string;
  let staleRunId: string;
  let otherDatasetRunId: string;

  const PLAN = observationPrunePlanSchema.parse({
    sourceId: SOURCE_ID,
    datasetId: FACTS_DATASET,
    subjectType: "legal_entity",
    subjectId: SUBJECT_ID,
    periodsEndingBefore: "2020-09-13",
    evidencePeriodsEndingBefore: "2019-09-13",
    evidenceConcepts: [EVIDENCE_CONCEPT],
  });

  /**
   * Por el CIK y no por los IDs de esta corrida: dos ejecuciones del archivo
   * dejarían corridas ancladas con el mismo `started_at`, y cuál gana el desempate
   * dejaría de estar determinado.
   */
  async function clean() {
    const doomed = database
      .select({ runId: schema.ingestionRuns.runId })
      .from(schema.ingestionRuns)
      .where(eq(schema.ingestionRuns.subjectKey, CIK));

    await database
      .delete(schema.observationPrunes)
      .where(
        inArray(schema.observationPrunes.subjectId, [
          SUBJECT_ID,
          OTHER_SUBJECT_ID,
        ]),
      );
    await database
      .delete(schema.observations)
      .where(inArray(schema.observations.ingestionRunId, doomed));
    await database
      .delete(schema.ingestionRuns)
      .where(eq(schema.ingestionRuns.subjectKey, CIK));
  }

  beforeAll(async () => {
    client = postgres(databaseTestUrl, {
      max: 2,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
    });
    database = drizzle(client, { schema });
    observations = createPostgresObservationRepository(database);
    runs = createPostgresIngestionRunRepository(database);
  });

  beforeEach(async () => {
    anchoredRunId = randomUUID();
    staleRunId = randomUUID();
    otherDatasetRunId = randomUUID();

    await clean();

    // La corrida vieja quedó sin ancla: es la selección 1.0.0, que fue a buscar
    // toda la historia. La nueva es la que define la ventana.
    await runs.append(
      run({
        runId: staleRunId,
        datasetId: FACTS_DATASET,
        selectionVersion: "sec-core-concepts-1.0.0",
        selectionAnchorOn: null,
        startedAt: "2026-09-14T10:00:00.000Z",
      }),
    );
    await runs.append(
      run({
        runId: anchoredRunId,
        datasetId: FACTS_DATASET,
        selectionVersion: SEC_CONCEPT_SELECTION_VERSION,
        selectionAnchorOn: ANCHOR_ON,
        startedAt: "2026-09-17T10:00:00.000Z",
      }),
    );
    await runs.append(
      run({
        runId: otherDatasetRunId,
        datasetId: OTHER_DATASET,
        selectionVersion: null,
        selectionAnchorOn: null,
        startedAt: "2026-09-17T11:00:00.000Z",
      }),
    );

    await observations.publish({
      ingestionRunId: staleRunId,
      supersessions: [],
      observations: [
        observation({
          asOf: "2009-12-31",
          runId: staleRunId,
          datasetId: FACTS_DATASET,
        }),
        observation({
          asOf: "2020-09-12",
          runId: staleRunId,
          datasetId: FACTS_DATASET,
        }),
        observation({
          asOf: "2020-09-13",
          runId: staleRunId,
          datasetId: FACTS_DATASET,
        }),
        observation({
          asOf: "2025-09-27",
          runId: staleRunId,
          datasetId: FACTS_DATASET,
        }),
        observation({
          asOf: "2019-09-12",
          runId: staleRunId,
          datasetId: FACTS_DATASET,
          concept: EVIDENCE_CONCEPT,
        }),
        observation({
          asOf: "2019-09-13",
          runId: staleRunId,
          datasetId: FACTS_DATASET,
          concept: EVIDENCE_CONCEPT,
        }),
        observation({
          asOf: "2009-12-31",
          runId: staleRunId,
          datasetId: FACTS_DATASET,
          subjectId: OTHER_SUBJECT_ID,
        }),
      ],
    });
    await observations.publish({
      ingestionRunId: otherDatasetRunId,
      supersessions: [],
      observations: [
        observation({
          asOf: "2009-12-31",
          runId: otherDatasetRunId,
          datasetId: OTHER_DATASET,
        }),
      ],
    });
  });

  afterAll(async () => {
    if (database) {
      await clean();
      await client.end({ timeout: 5 });
    }
  });

  function request(overrides: Partial<{ pruneId: string }> = {}) {
    return {
      pruneId: overrides.pruneId ?? randomUUID(),
      ruleVersion: "sec-history-prune-1.0.0",
      plan: PLAN,
      selectionVersion: SEC_CONCEPT_SELECTION_VERSION,
      selectionAnchorOn: ANCHOR_ON,
      anchorRunId: anchoredRunId,
      actor: "owner",
      reason: "ventana de cinco ejercicios",
      executedAt: "2026-09-17T21:00:00.000Z",
    };
  }

  it("borra lo anterior al corte y conserva el ejercicio de evidencia", async () => {
    const counted = await observations.countPruneTargets(PLAN);
    const record = await observations.prune(request());

    expect(counted).toEqual({
      deleted: 3,
      kept: 3,
      deletedMinAsOf: "2009-12-31",
      deletedMaxAsOf: "2020-09-12",
    });
    expect(record.deletedCount).toBe(3);
    expect(record.keptCount).toBe(3);

    const survivors = await observations.list({
      subjectType: "legal_entity",
      subjectId: SUBJECT_ID,
    });

    // Las tres de la ventana más la de otro dataset, que el plan no alcanza.
    expect(survivors.map((row) => row.asOf).sort()).toEqual([
      "2009-12-31",
      "2019-09-13",
      "2020-09-13",
      "2025-09-27",
    ]);
    expect(
      survivors.filter((row) => row.datasetId === FACTS_DATASET),
    ).toHaveLength(3);
  });

  it("no toca otro sujeto de la misma corrida", async () => {
    await observations.prune(request());

    expect(
      await observations.list({
        subjectType: "legal_entity",
        subjectId: OTHER_SUBJECT_ID,
      }),
    ).toHaveLength(1);
  });

  it("deja el registro con su ancla, su corrida y los extremos borrados", async () => {
    const pruneId = randomUUID();

    await observations.prune(request({ pruneId }));

    const [record] = await observations.listPrunes("legal_entity", SUBJECT_ID);

    expect(record).toMatchObject({
      pruneId,
      ruleVersion: "sec-history-prune-1.0.0",
      sourceId: SOURCE_ID,
      datasetId: FACTS_DATASET,
      selectionVersion: SEC_CONCEPT_SELECTION_VERSION,
      selectionAnchorOn: ANCHOR_ON,
      anchorRunId: anchoredRunId,
      periodsEndingBefore: "2020-09-13",
      evidencePeriodsEndingBefore: "2019-09-13",
      evidenceConcepts: [EVIDENCE_CONCEPT],
      deletedCount: 3,
      keptCount: 3,
      deletedMinAsOf: "2009-12-31",
      deletedMaxAsOf: "2020-09-12",
      actor: "owner",
    });
  });

  it("es idempotente: la segunda poda no encuentra nada y lo registra igual", async () => {
    await observations.prune(request());
    const second = await observations.prune(request());

    expect(second.deletedCount).toBe(0);
    expect(second.deletedMinAsOf).toBeNull();
    expect(second.keptCount).toBe(3);
    expect(
      await observations.listPrunes("legal_entity", SUBJECT_ID),
    ).toHaveLength(2);
  });

  it("toma el ancla de la corrida más reciente que la registró", async () => {
    const anchored = await runs.findLatestAnchored(
      SOURCE_ID,
      FACTS_DATASET,
      CIK,
    );

    expect(anchored?.runId).toBe(anchoredRunId);

    const decision = planSecHistoryPrune(
      {
        sourceId: SOURCE_ID,
        datasetId: FACTS_DATASET,
        subjectType: "legal_entity",
        subjectId: SUBJECT_ID,
      },
      {
        runId: anchored!.runId,
        selectionVersion: anchored!.selectionVersion!,
        selectionAnchorOn: anchored!.selectionAnchorOn!,
      },
    );

    expect(decision.status).toBe("planned");

    if (decision.status !== "planned") {
      return;
    }

    // El corte que la ingesta aplicó y el que la poda borra son el mismo.
    expect(decision.plan.periodsEndingBefore).toBe(PLAN.periodsEndingBefore);
    expect(decision.plan.evidencePeriodsEndingBefore).toBe(
      PLAN.evidencePeriodsEndingBefore,
    );
  });

  it("la base rechaza un registro que diga haber borrado dentro de la ventana", async () => {
    await expectConstraintViolation(
      () =>
        database.insert(schema.observationPrunes).values({
          ...request(),
          pruneId: randomUUID(),
          sourceId: SOURCE_ID,
          datasetId: FACTS_DATASET,
          subjectType: "legal_entity",
          subjectId: SUBJECT_ID,
          periodsEndingBefore: "2020-09-13",
          evidencePeriodsEndingBefore: "2019-09-13",
          evidenceConcepts: [EVIDENCE_CONCEPT],
          deletedCount: 1,
          keptCount: 1,
          deletedMinAsOf: "2020-09-13",
          deletedMaxAsOf: "2020-09-13",
          executedAt: new Date("2026-09-17T21:00:00.000Z"),
        }),
      "observation_prunes_within_cut_check",
    );
  });

  it("la base rechaza un corte de evidencia más nuevo que el general", async () => {
    await expectConstraintViolation(
      () =>
        database.insert(schema.observationPrunes).values({
          ...request(),
          pruneId: randomUUID(),
          sourceId: SOURCE_ID,
          datasetId: FACTS_DATASET,
          subjectType: "legal_entity",
          subjectId: SUBJECT_ID,
          periodsEndingBefore: "2019-09-13",
          evidencePeriodsEndingBefore: "2020-09-13",
          evidenceConcepts: [EVIDENCE_CONCEPT],
          deletedCount: 0,
          keptCount: 0,
          deletedMinAsOf: null,
          deletedMaxAsOf: null,
          executedAt: new Date("2026-09-17T21:00:00.000Z"),
        }),
      "observation_prunes_cuts_check",
    );
  });

  it("la base exige que el registro nombre la corrida del ancla", async () => {
    await expect(
      database.insert(schema.observationPrunes).values({
        ...request(),
        pruneId: randomUUID(),
        anchorRunId: randomUUID(),
        sourceId: SOURCE_ID,
        datasetId: FACTS_DATASET,
        subjectType: "legal_entity",
        subjectId: SUBJECT_ID,
        periodsEndingBefore: "2020-09-13",
        evidencePeriodsEndingBefore: "2019-09-13",
        evidenceConcepts: [EVIDENCE_CONCEPT],
        deletedCount: 0,
        keptCount: 0,
        deletedMinAsOf: null,
        deletedMaxAsOf: null,
        executedAt: new Date("2026-09-17T21:00:00.000Z"),
      }),
    ).rejects.toThrow();
  });

  it("borra y registra en la misma transacción", async () => {
    // El borrado corre primero y el registro después: si el registro no entra,
    // las filas tienen que seguir ahí. Una corrida de ancla inexistente rompe la
    // foreign key recién en el insert.
    await expect(
      observations.prune({ ...request(), anchorRunId: randomUUID() }),
    ).rejects.toThrow();

    const survivors = await database
      .select()
      .from(schema.observations)
      .where(
        and(
          eq(schema.observations.subjectId, SUBJECT_ID),
          eq(schema.observations.ingestionRunId, staleRunId),
        ),
      );

    expect(survivors).toHaveLength(6);
    expect(await observations.listPrunes("legal_entity", SUBJECT_ID)).toEqual(
      [],
    );
  });
});
