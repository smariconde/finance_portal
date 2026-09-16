import { describe, expect, it } from "vitest";

import {
  buildSplitFixtureClaims,
  buildSplitFixtureDocuments,
  buildSplitFixtureSensitiveObservations,
  SPLIT_ACCEPTED_AT,
  SPLIT_ACCESSIONS,
  SPLIT_FILER_ENTITY_ID,
} from "../infrastructure/fixture-split";
import {
  planSplitRecording,
  SPLIT_RECORDING_RULE_VERSION,
  SPLIT_SCOPE,
} from "./plan-split-recording";
import {
  corporateActionSchema,
  type CorporateAction,
} from "./reporting-succession";
import { SPLIT_RATIO_QUALIFIED_CONCEPT } from "./share-basis";
import {
  evaluateSplitEvidence,
  SPLIT_EVIDENCE_RULE_VERSION,
} from "./verify-split-evidence";

const RECORDED_AT = "2025-09-15T12:00:00.000Z";

function ids() {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `00000000-0000-4000-8000-${String(0xa100 + sequence).padStart(12, "0")}`;
  };
}

const evidence = evaluateSplitEvidence({
  legalEntityId: SPLIT_FILER_ENTITY_ID,
  claims: buildSplitFixtureClaims(),
  observations: buildSplitFixtureSensitiveObservations(),
  documents: buildSplitFixtureDocuments(),
});

function plan(corporateActions: readonly CorporateAction[] = []) {
  return planSplitRecording({
    legalEntityId: SPLIT_FILER_ENTITY_ID,
    evidence,
    corporateActions,
    recordedAt: RECORDED_AT,
    newId: ids(),
  });
}

describe("planSplitRecording", () => {
  it("abre un evento por split confirmado, sobre la entidad legal del filer", () => {
    const planned = plan();

    expect(planned.status).toBe("planned");
    expect(planned.ruleVersion).toBe(SPLIT_RECORDING_RULE_VERSION);
    expect(planned.evidenceRuleVersion).toBe(SPLIT_EVIDENCE_RULE_VERSION);
    expect(planned.corporateActions).toHaveLength(1);
    expect(planned.corporateActions[0]).toMatchObject({
      actionType: "split",
      subjectType: "legal_entity",
      subjectId: SPLIT_FILER_ENTITY_ID,
      announcedAt: null,
      effectiveOn: "2024-12-31",
      availableAt: SPLIT_ACCEPTED_AT,
      sourceId: "sec-edgar",
      sourceDocumentId: SPLIT_ACCESSIONS.annual2024,
      terms: {
        ratio: "4",
        ratioConcept: SPLIT_RATIO_QUALIFIED_CONCEPT,
        form: "10-K",
        claimedPeriods: "2024-05-20,2024-06-14",
        scope: SPLIT_SCOPE,
        decisionRuleVersion: SPLIT_EVIDENCE_RULE_VERSION,
      },
      recordedAt: RECORDED_AT,
    });
  });

  it("registrar dos veces el mismo split no abre nada", () => {
    const first = plan();
    const again = plan(first.corporateActions);

    expect(again.status).toBe("unchanged");
    expect(again.corporateActions).toStrictEqual([]);
    expect(again.unchanged).toStrictEqual([SPLIT_ACCESSIONS.annual2024]);
  });

  it("el hash no depende del ID generado ni del instante local", () => {
    const first = plan().corporateActions[0]!;
    const later = planSplitRecording({
      legalEntityId: SPLIT_FILER_ENTITY_ID,
      evidence,
      corporateActions: [],
      recordedAt: "2026-01-01T00:00:00.000Z",
      newId: () => "00000000-0000-4000-8000-00000000ffff",
    }).corporateActions[0]!;

    expect(later.contentHash).toBe(first.contentHash);
  });

  it("la misma presentación descripta de otra forma es un conflicto, no una corrección", () => {
    const recorded = plan().corporateActions[0]!;
    const other = corporateActionSchema.parse({
      ...recorded,
      actionType: "split",
      terms: { ...recorded.terms, ratio: "2" },
      contentHash: "b".repeat(64),
    });
    const conflicted = plan([other]);

    expect(conflicted.status).toBe("rejected");
    expect(conflicted.rejection).toBe("conflicting_split");
    expect(conflicted.conflicts).toStrictEqual([SPLIT_ACCESSIONS.annual2024]);
    expect(conflicted.corporateActions).toStrictEqual([]);
  });

  it("un split registrado que hoy no se confirma se nombra y no se borra", () => {
    const recorded = corporateActionSchema.parse({
      ...plan().corporateActions[0]!,
      corporateActionId: "00000000-0000-4000-8000-00000000a999",
      sourceDocumentId: "0000000073-21-000010",
    });
    const planned = plan([recorded]);

    expect(planned.status).toBe("planned");
    expect(planned.notReconfirmed).toStrictEqual(["0000000073-21-000010"]);
  });

  it("una sucesión en la misma presentación no es un split en conflicto", () => {
    const succession = corporateActionSchema.parse({
      corporateActionId: "00000000-0000-4000-8000-00000000a998",
      actionType: "successor_issuer",
      subjectType: "legal_entity",
      subjectId: SPLIT_FILER_ENTITY_ID,
      announcedAt: null,
      effectiveOn: "2024-12-31",
      availableAt: SPLIT_ACCEPTED_AT,
      sourceId: "sec-edgar",
      sourceDocumentId: SPLIT_ACCESSIONS.annual2024,
      terms: { form: "8-K12B" },
      contentHash: "c".repeat(64),
      recordedAt: RECORDED_AT,
    });

    expect(plan([succession]).status).toBe("planned");
  });
});
