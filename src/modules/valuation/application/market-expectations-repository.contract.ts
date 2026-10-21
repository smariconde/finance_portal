import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type {
  MarketExpectationsEvidenceRecord,
  MarketExpectationsReadingBody,
  MarketExpectationsRecord,
} from "../domain/market-expectations";

import type {
  MarketExpectationsRepository,
  StoredMarketExpectations,
} from "./market-expectations-repository";

/**
 * Contrato del repositorio de lecturas de expectativas (`F6-11`), escrito una
 * vez y corrido contra el doble en memoria y contra PostgreSQL. Cada caso usa
 * un sujeto propio, así que la base de integración no necesita vaciarse.
 */
export type MarketExpectationsRepositoryContractHarness = {
  readonly createRepository: () => MarketExpectationsRepository;
};

const ACCESSION = "0000000042-26-000002";
const QUOTE = "Services net sales increased 14% during 2025.";

export const FIXTURE_READING: MarketExpectationsReadingBody = {
  drivers: [
    {
      driver: "revenue_growth",
      outlook: "moderate",
      signals: [
        {
          direction: "higher",
          summary: "Services grew 14%.",
          quote: QUOTE,
          evidenceId: "E2",
        },
      ],
    },
    { driver: "operating_margin", outlook: "not_addressed", signals: [] },
    {
      driver: "competitive_advantage",
      outlook: "wide",
      signals: [
        {
          direction: "higher",
          summary: "A large installed base.",
          quote: "installed base of active devices",
          evidenceId: "E1",
        },
      ],
    },
  ],
  risks: [],
  confidence: "medium",
  rationale: "Synthetic.",
};

function record(
  subjectId: string,
  overrides: Partial<MarketExpectationsRecord> = {},
): MarketExpectationsRecord {
  return {
    readingId: randomUUID(),
    legalEntityId: subjectId,
    cik: "0000000042",
    accessionNumber: ACCESSION,
    fiscalYearEnd: "2025-09-27",
    taskVersion: "market-expectations-reading-1.0.0",
    promptVersion: "market-expectations-prompt-1.0.0",
    policyVersion: "market-expectations-policy-1.0.0",
    ladderVersion: "ai-model-ladder-1.1.0",
    extractVersion: "sec-10k-outlook-1.0.0",
    outcome: "accepted",
    reading: FIXTURE_READING,
    reason: null,
    acceptedRung: 1,
    respondedModel: "fixture/model-a",
    proposedAt: "2026-10-21T12:00:00.000Z",
    recordedAt: "2026-10-21T12:00:00.000Z",
    ...overrides,
  };
}

function evidence(evidenceId: string): MarketExpectationsEvidenceRecord {
  return {
    evidenceId,
    sourceId: "sec-edgar",
    section: evidenceId === "E1" ? "item_1_business" : "item_7_mdna",
    documentUrl: "https://www.sec.gov/Archives/edgar/data/42/x.htm",
    accessionNumber: ACCESSION,
    documentAcceptedAt: "2025-10-31T10:00:00.000Z",
    sha256: "a".repeat(64),
    byteLength: 100,
    truncated: false,
    excerpt: `Synthetic ${evidenceId}. ${QUOTE} installed base of active devices`,
  };
}

function stored(
  subjectId: string,
  overrides: Partial<MarketExpectationsRecord> = {},
): StoredMarketExpectations {
  return {
    record: record(subjectId, overrides),
    evidence: [evidence("E1"), evidence("E2")],
  };
}

export function describeMarketExpectationsRepositoryContract(
  name: string,
  harness: MarketExpectationsRepositoryContractHarness,
): void {
  describe(`market expectations repository contract (${name})`, () => {
    it("records a reading with its evidence and reads it back", async () => {
      const repository = harness.createRepository();
      const subject = randomUUID();
      const written = stored(subject);

      await repository.record(written);

      expect(await repository.latestForSubject(subject)).toEqual(written);
      expect(
        await repository.acceptedForFiscalYear(subject, "2025-09-27"),
      ).toEqual(written);
    });

    it("keeps abstentions, but only an accepted reading reaches a run", async () => {
      const repository = harness.createRepository();
      const subject = randomUUID();
      const accepted = stored(subject);
      const abstained = stored(subject, {
        outcome: "abstained",
        reading: null,
        reason: "insufficient_evidence",
        acceptedRung: null,
        respondedModel: null,
        proposedAt: "2026-10-21T13:00:00.000Z",
        recordedAt: "2026-10-21T13:00:00.000Z",
      });

      await repository.record(accepted);
      await repository.record(abstained);

      expect(
        (await repository.latestForSubject(subject))?.record.readingId,
      ).toBe(abstained.record.readingId);
      expect(
        (await repository.acceptedForFiscalYear(subject, "2025-09-27"))?.record
          .readingId,
      ).toBe(accepted.record.readingId);
    });

    it("does not show a reading of another fiscal year", async () => {
      const repository = harness.createRepository();
      const subject = randomUUID();

      await repository.record(stored(subject));

      expect(
        await repository.acceptedForFiscalYear(subject, "2024-09-28"),
      ).toBeNull();
    });

    it("refuses evidence from another 10-K and a reading without evidence", async () => {
      const repository = harness.createRepository();
      const subject = randomUUID();
      const written = stored(subject);

      await expect(
        repository.record({
          ...written,
          evidence: [
            { ...evidence("E1"), accessionNumber: "0000000042-25-000009" },
          ],
        }),
      ).rejects.toThrow();
      await expect(
        repository.record({ ...written, evidence: [] }),
      ).rejects.toThrow();
    });
  });
}
