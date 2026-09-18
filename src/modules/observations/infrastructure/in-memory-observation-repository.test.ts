import { describe, expect, it } from "vitest";

import {
  observationPrunePlanSchema,
  type ObservationPrunePlan,
} from "../domain/observation-prune";
import { observationSchema, type Observation } from "../domain/observation";
import { createInMemoryObservationRepository } from "./in-memory-observation-repository";

const SUBJECT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_SUBJECT_ID = "44444444-4444-4444-8444-444444444444";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const EVIDENCE = "us-gaap:EarningsPerShareDiluted";

let sequence = 0;

function hex(seed: number): string {
  return seed.toString(16).padStart(64, "0");
}

function observation(overrides: {
  asOf: string;
  concept?: string;
  subjectId?: string;
  sourceId?: string;
  datasetId?: string;
}): Observation {
  sequence += 1;

  return observationSchema.parse({
    observationId: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    subjectType: "legal_entity",
    subjectId: overrides.subjectId ?? SUBJECT_ID,
    metricId: overrides.concept ?? "us-gaap:Assets",
    concept: overrides.concept ?? "us-gaap:Assets",
    sourceId: overrides.sourceId ?? "sec-edgar",
    datasetId: overrides.datasetId ?? "sec.companyfacts",
    parserVersion: "sec-companyfacts-1.0.0",
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
    contentHash: hex(sequence + 1_000_000),
    qualityFlags: [],
    sourceDocumentId: null,
    ingestionRunId: RUN_ID,
  });
}

const PLAN: ObservationPrunePlan = observationPrunePlanSchema.parse({
  sourceId: "sec-edgar",
  datasetId: "sec.companyfacts",
  subjectType: "legal_entity",
  subjectId: SUBJECT_ID,
  periodsEndingBefore: "2020-09-13",
  evidencePeriodsEndingBefore: "2019-09-13",
  evidenceConcepts: [EVIDENCE],
});

const REQUEST = {
  pruneId: "33333333-3333-4333-8333-333333333333",
  ruleVersion: "sec-history-prune-1.0.0",
  plan: PLAN,
  selectionVersion: "sec-core-concepts-2.0.0",
  selectionAnchorOn: "2025-09-27",
  anchorRunId: RUN_ID,
  actor: "owner",
  reason: "ventana de cinco ejercicios",
  executedAt: "2026-09-17T21:00:00.000Z",
};

function seeded() {
  return createInMemoryObservationRepository([
    observation({ asOf: "2015-12-31" }),
    observation({ asOf: "2020-09-12" }),
    observation({ asOf: "2020-09-13" }),
    observation({ asOf: "2025-09-27" }),
    // Evidencia: el ejercicio extra queda de un lado y lo anterior del otro.
    observation({ asOf: "2019-09-13", concept: EVIDENCE }),
    observation({ asOf: "2019-09-12", concept: EVIDENCE }),
    // Fuera del plan: otro sujeto, otra fuente y otro dataset.
    observation({ asOf: "2010-01-01", subjectId: OTHER_SUBJECT_ID }),
    observation({ asOf: "2010-01-01", sourceId: "fixture-provider" }),
    observation({ asOf: "2010-01-01", datasetId: "sec.submissions" }),
  ]);
}

describe("poda en el doble en memoria", () => {
  it("cuenta en seco lo mismo que después borra", async () => {
    const repository = seeded();
    const counted = await repository.countPruneTargets(PLAN);
    const applied = await repository.prune(REQUEST);

    expect(counted.deleted).toBe(3);
    expect(counted.kept).toBe(3);
    expect(applied.deletedCount).toBe(counted.deleted);
    expect(applied.keptCount).toBe(counted.kept);
    expect(applied.deletedMinAsOf).toBe("2015-12-31");
    expect(applied.deletedMaxAsOf).toBe("2020-09-12");
  });

  it("no toca otro sujeto, otra fuente ni otro dataset", async () => {
    const repository = seeded();

    await repository.prune(REQUEST);

    const survivors = await repository.list({
      subjectType: "legal_entity",
      subjectId: OTHER_SUBJECT_ID,
    });

    expect(survivors).toHaveLength(1);

    const own = await repository.list({
      subjectType: "legal_entity",
      subjectId: SUBJECT_ID,
    });

    // Quedan las tres de la ventana más las dos de otra fuente y otro dataset,
    // que el plan no alcanza.
    expect(own.map((row) => row.asOf).sort()).toEqual([
      "2010-01-01",
      "2010-01-01",
      "2019-09-13",
      "2020-09-13",
      "2025-09-27",
    ]);
  });

  it("deja el registro consultable por sujeto", async () => {
    const repository = seeded();

    await repository.prune(REQUEST);

    const [record] = await repository.listPrunes("legal_entity", SUBJECT_ID);

    expect(record).toMatchObject({
      pruneId: REQUEST.pruneId,
      selectionAnchorOn: "2025-09-27",
      anchorRunId: RUN_ID,
      actor: "owner",
      deletedCount: 3,
    });
    expect(
      await repository.listPrunes("legal_entity", OTHER_SUBJECT_ID),
    ).toEqual([]);
  });

  it("registra una poda que no borró nada", async () => {
    const repository = createInMemoryObservationRepository([
      observation({ asOf: "2025-09-27" }),
    ]);
    const record = await repository.prune(REQUEST);

    expect(record.deletedCount).toBe(0);
    expect(record.deletedMinAsOf).toBeNull();
    expect(record.keptCount).toBe(1);
  });
});
