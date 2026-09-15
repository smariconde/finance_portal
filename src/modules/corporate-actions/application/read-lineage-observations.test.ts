import { describe, expect, it, vi } from "vitest";

import type { ObservationRepository } from "@/modules/observations/application/observation-repository";
import { createInMemoryObservationRepository } from "@/modules/observations/infrastructure/in-memory-observation-repository";
import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";

import type { LegalEntityRelationship } from "../domain/reporting-succession";
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
