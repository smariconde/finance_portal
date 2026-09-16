import { describe, expect, it, vi } from "vitest";

import type { ObservationRepository } from "@/modules/observations/application/observation-repository";
import { createInMemoryObservationRepository } from "@/modules/observations/infrastructure/in-memory-observation-repository";
import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";

import { planSplitRecording } from "../domain/plan-split-recording";
import type { LegalEntityRelationship } from "../domain/reporting-succession";
import { SPLIT_ADJUSTMENT_VERSION } from "../domain/split-adjustment";
import { evaluateSplitEvidence } from "../domain/verify-split-evidence";
import {
  buildSplitFixtureClaims,
  buildSplitFixtureDocuments,
  buildSplitFixtureObservations,
  buildSplitFixtureSensitiveObservations,
  SPLIT_FILER_ENTITY_ID,
} from "../infrastructure/fixture-split";
import { createInMemoryCorporateActionRepository } from "../infrastructure/in-memory-corporate-action-repository";
import {
  LineageReadLimitError,
  readLineageObservations,
} from "./read-lineage-observations";

const OLD = "00000000-0000-4000-8000-0000000000a1";
const NEW = "00000000-0000-4000-8000-0000000000a3";

const RELATIONSHIP: LegalEntityRelationship = {
  relationshipId: "00000000-0000-4000-8000-0000000000e1",
  relationshipType: "reporting_successor",
  predecessorLegalEntityId: OLD,
  successorLegalEntityId: NEW,
  corporateActionId: "00000000-0000-4000-8000-0000000000c1",
  effectiveOn: "2025-07-01",
  decidedBy: "owner",
  decisionRuleVersion: "sec-succession-evidence-1.0.0",
  validFrom: "2025-07-01T04:00:00.000Z",
  validTo: null,
  availableAt: "2025-07-01T15:10:00.000Z",
  supersededAt: null,
  sourceId: "sec-edgar",
  sourceDocumentId: "0000000900-25-000001",
  contentHash: "a".repeat(64),
  recordedAt: "2025-09-10T12:00:00.000Z",
};

const QUERY = pointInTimeQuerySchema.parse({
  effectiveAt: "2026-06-01T00:00:00.000Z",
  revisionPolicy: "as_known",
  knownAt: "2026-06-01T00:00:00.000Z",
  sourcePolicyVersion: "source-policy-1.0.0",
});

describe("readLineageObservations", () => {
  it("an acquisition never requests facts from the acquired legal entity", async () => {
    const observations = createInMemoryObservationRepository();
    const list = vi.spyOn(observations, "list");
    const result = await readLineageObservations(
      { legalEntityId: NEW, metricIds: ["us-gaap:Revenues"] },
      QUERY,
      {
        corporateActions: createInMemoryCorporateActionRepository({
          relationships: [{ ...RELATIONSHIP, relationshipType: "acquired_by" }],
        }),
        observations,
      },
    );
    expect(list.mock.calls.map(([query]) => query.subjectId)).toEqual([NEW]);
    expect(result.lineage.segments).toHaveLength(1);
  });
  it("lee cada segmento del linaje por su propio sujeto", async () => {
    const observations = createInMemoryObservationRepository();
    const list = vi.spyOn(observations, "list");

    const selection = await readLineageObservations(
      { legalEntityId: NEW, metricIds: ["us-gaap:Revenues"] },
      QUERY,
      {
        corporateActions: createInMemoryCorporateActionRepository({
          relationships: [RELATIONSHIP],
        }),
        observations,
      },
    );

    expect(list.mock.calls.map(([query]) => query.subjectId)).toStrictEqual([
      NEW,
      OLD,
    ]);
    expect(selection.lineage.segments).toHaveLength(2);
  });

  it("con latest_adjusted aplica los splits registrados del filer", async () => {
    const evidence = evaluateSplitEvidence({
      legalEntityId: SPLIT_FILER_ENTITY_ID,
      claims: buildSplitFixtureClaims(),
      observations: buildSplitFixtureSensitiveObservations(),
      documents: buildSplitFixtureDocuments(),
    });
    const { corporateActions: splits } = planSplitRecording({
      legalEntityId: SPLIT_FILER_ENTITY_ID,
      evidence,
      corporateActions: [],
      recordedAt: "2025-09-15T12:00:00.000Z",
      newId: () => "00000000-0000-4000-8000-00000000a5a2",
    });
    const corporateActions = createInMemoryCorporateActionRepository({
      corporateActions: splits,
    });
    const listCorporateActions = vi.spyOn(
      corporateActions,
      "listCorporateActions",
    );
    const latest = pointInTimeQuerySchema.parse({
      effectiveAt: "2026-06-01T00:00:00.000Z",
      revisionPolicy: "latest_restated",
      adjustmentPolicy: "latest_adjusted",
      sourcePolicyVersion: "source-policy-1.0.0",
    });

    const selection = await readLineageObservations(
      {
        legalEntityId: SPLIT_FILER_ENTITY_ID,
        metricIds: ["us-gaap:EarningsPerShareBasic"],
        periodType: "annual",
      },
      latest,
      {
        corporateActions,
        observations: createInMemoryObservationRepository(
          buildSplitFixtureObservations(),
        ),
      },
    );

    expect(listCorporateActions.mock.calls[0]?.[0]).toStrictEqual({
      subjectIds: [SPLIT_FILER_ENTITY_ID],
      actionTypes: ["split", "reverse_split"],
    });
    expect(selection.adjustment).toStrictEqual({
      policy: "latest_adjusted",
      ruleVersion: SPLIT_ADJUSTMENT_VERSION,
    });
    expect(
      selection.rows.map((row) => [row.observation.asOf, row.value]),
    ).toStrictEqual([
      ["2021-12-31", "0.4"],
      ["2022-12-31", "0.48"],
      ["2023-12-31", "0.78"],
      ["2024-12-31", "0.9"],
    ]);
  });

  it("falla en vez de truncar un segmento que llena el techo", async () => {
    const saturated = {
      ...createInMemoryObservationRepository(),
      list: vi.fn(async () => Array.from({ length: 1000 })),
    } as unknown as ObservationRepository;

    await expect(
      readLineageObservations(
        { legalEntityId: NEW, metricIds: ["us-gaap:Revenues"] },
        QUERY,
        {
          corporateActions: createInMemoryCorporateActionRepository(),
          observations: saturated,
        },
      ),
    ).rejects.toBeInstanceOf(LineageReadLimitError);
  });

  it("exige métricas: un linaje sin filtro multiplica la lectura sin techo", async () => {
    await expect(
      readLineageObservations({ legalEntityId: NEW, metricIds: [] }, QUERY, {
        corporateActions: createInMemoryCorporateActionRepository(),
        observations: createInMemoryObservationRepository(),
      }),
    ).rejects.toThrow();
  });
});
