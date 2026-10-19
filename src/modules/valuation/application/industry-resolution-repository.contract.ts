import { createHash, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  planIndustryAssertion,
  type IndustryEvidenceRecord,
  type IndustryResolutionRecord,
} from "../domain/industry-resolution";

import type { IndustryResolutionRepository } from "./industry-resolution-repository";

/**
 * Contrato del repositorio de resoluciones (`F5-03`), escrito una vez y corrido
 * contra el doble en memoria y contra PostgreSQL. Cada caso usa un sujeto
 * propio, así que la base de integración no necesita vaciarse.
 */
export type IndustryResolutionRepositoryContractHarness = {
  readonly createRepository: () => IndustryResolutionRepository;
};

function record(
  subjectId: string,
  overrides: Partial<IndustryResolutionRecord> = {},
): IndustryResolutionRecord {
  return {
    resolutionId: randomUUID(),
    legalEntityId: subjectId,
    cik: "0000000042",
    sic: "6021",
    candidates: ["bank-money-center", "banks-regional"],
    taskVersion: "industry-resolution-1.0.0",
    promptVersion: "industry-resolution-prompt-1.0.0",
    ladderVersion: "ai-model-ladder-1.0.0",
    sectionsVersion: "sec-10k-sections-1.0.0",
    outcome: "resolved",
    industryKey: "banks-regional",
    confidence: "high",
    rationale: "A regional bank in the Midwest.",
    reason: null,
    acceptedRung: 1,
    respondedModel: "fixture/model-a",
    citedEvidenceIds: ["E1"],
    resolvedAt: "2026-10-15T12:00:00.000Z",
    recordedAt: "2026-10-15T12:00:00.000Z",
    ...overrides,
  };
}

function evidence(): IndustryEvidenceRecord[] {
  return [
    {
      evidenceId: "E1",
      sourceId: "sec-edgar",
      section: "item_1_business",
      documentUrl:
        "https://www.sec.gov/Archives/edgar/data/42/000000004226000001/fix-20251231.htm",
      accessionNumber: "0000000042-26-000001",
      documentAcceptedAt: "2026-02-20T21:00:00.000Z",
      sha256: "a".repeat(64),
      byteLength: 31,
      truncated: false,
      excerpt: "Fixture Bancorp, a regional bank",
    },
  ];
}

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

export function describeIndustryResolutionRepositoryContract(
  label: string,
  harness: IndustryResolutionRepositoryContractHarness,
): void {
  describe(`industry resolution repository contract (${label})`, () => {
    async function recordResolved(
      repository: IndustryResolutionRepository,
      resolution: IndustryResolutionRecord,
    ) {
      const plan = planIndustryAssertion({
        resolution,
        industryLabel: `Label of ${resolution.industryKey}`,
        stored: (
          await repository.assertionsForSubject(resolution.legalEntityId)
        ).map((item) => item.classification),
        newId: () => randomUUID(),
        hashContent: hash,
      });

      await repository.record({ resolution, evidence: evidence(), plan });
    }

    it("records a resolution with its evidence and publishes its assertion", async () => {
      const repository = harness.createRepository();
      const subject = randomUUID();
      const resolution = record(subject);

      await recordResolved(repository, resolution);

      expect(await repository.latestForSubject(subject)).toEqual({
        resolution,
        evidence: evidence(),
      });
      expect(await repository.findResolution(resolution.resolutionId)).toEqual({
        resolution,
        evidence: evidence(),
      });
      expect(await repository.findResolution(randomUUID())).toBeNull();
      expect(await repository.assertionsForSubject(subject)).toEqual([
        expect.objectContaining({
          classification: expect.objectContaining({
            code: "banks-regional",
            availableAt: "2026-10-15T12:00:00.000Z",
            supersededAt: null,
          }),
          reading: {
            resolutionId: resolution.resolutionId,
            industryKey: "banks-regional",
            availableAt: "2026-10-15T12:00:00.000Z",
            respondedModel: "fixture/model-a",
            evidenceIds: ["E1"],
          },
        }),
      ]);
    });

    it("keeps a web search result as evidence without a filing (F5-04)", async () => {
      const repository = harness.createRepository();
      const subject = randomUUID();
      const resolution = record(subject);
      // Sintético: ningún resultado real de búsqueda entra al repositorio.
      const withWeb: IndustryEvidenceRecord[] = [
        ...evidence(),
        {
          evidenceId: "E3",
          sourceId: "tavily",
          section: "web_search",
          documentUrl: "https://example.com/fixture-bancorp",
          accessionNumber: null,
          documentAcceptedAt: null,
          sha256: "b".repeat(64),
          byteLength: 40,
          truncated: false,
          excerpt: "Fixture Bancorp is a regional bank in Ohio",
        },
      ];

      await repository.record({ resolution, evidence: withWeb, plan: null });

      expect(await repository.findResolution(resolution.resolutionId)).toEqual({
        resolution,
        evidence: withWeb,
      });
    });

    it("records an abstention without asserting anything", async () => {
      const repository = harness.createRepository();
      const subject = randomUUID();

      await repository.record({
        resolution: record(subject, {
          outcome: "abstained",
          industryKey: null,
          confidence: null,
          rationale: null,
          reason: "insufficient_evidence",
          acceptedRung: null,
          respondedModel: null,
          citedEvidenceIds: [],
        }),
        evidence: evidence(),
        plan: null,
      });

      expect(
        (await repository.latestForSubject(subject))?.resolution.outcome,
      ).toBe("abstained");
      expect(await repository.assertionsForSubject(subject)).toEqual([]);
    });

    it("supersedes the open assertion when a later resolution changes the industry", async () => {
      const repository = harness.createRepository();
      const subject = randomUUID();

      await recordResolved(repository, record(subject));
      await recordResolved(
        repository,
        record(subject, {
          industryKey: "bank-money-center",
          resolvedAt: "2026-11-01T00:00:00.000Z",
          recordedAt: "2026-11-01T00:00:00.000Z",
        }),
      );

      const assertions = await repository.assertionsForSubject(subject);
      const byCode = Object.fromEntries(
        assertions.map((item) => [
          item.classification.code,
          item.classification,
        ]),
      );

      expect(assertions).toHaveLength(2);
      expect(byCode["banks-regional"]?.supersededAt).toBe(
        "2026-11-01T00:00:00.000Z",
      );
      expect(byCode["bank-money-center"]?.supersededAt).toBeNull();
      expect(
        (await repository.latestForSubject(subject))?.resolution.industryKey,
      ).toBe("bank-money-center");
    });

    it("refuses to record the same resolution twice and leaves nothing half-written", async () => {
      const repository = harness.createRepository();
      const subject = randomUUID();
      const resolution = record(subject);

      await recordResolved(repository, resolution);
      await expect(
        repository.record({ resolution, evidence: evidence(), plan: null }),
      ).rejects.toThrow();
      expect(await repository.assertionsForSubject(subject)).toHaveLength(1);
    });
  });
}
