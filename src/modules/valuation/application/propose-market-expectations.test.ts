import { createHash, randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { LadderResult } from "@/modules/ai/application/run-model-ladder";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import {
  DEFAULT_SOURCE_POLICY_VERSION,
  pointInTimeQuerySchema,
} from "@/modules/temporal/domain/point-in-time-query";

import type { AnnualFundamentals } from "../domain/annual-fundamentals";
import type { MarketExpectationsOutput } from "../domain/market-expectations-task";
import { createInMemoryMarketExpectationsRepository } from "../infrastructure/in-memory-market-expectations-repository";

import { FIXTURE_READING } from "./market-expectations-repository.contract";
import {
  proposeMarketExpectations,
  type ProposeMarketExpectationsDependencies,
  type ProposeMarketExpectationsRequest,
} from "./propose-market-expectations";

const SUBJECT = "00000000-0000-4000-8000-000000000043";
const NOW = "2026-10-21T12:00:00.000Z";
const CIK = "0000000043";
const ACCESSION = "0000000043-25-000001";

const query = pointInTimeQuerySchema.parse({
  effectiveAt: NOW,
  knownAt: NOW,
  revisionPolicy: "as_known",
  adjustmentPolicy: "as_known",
  sourcePolicyVersion: DEFAULT_SOURCE_POLICY_VERSION,
});

function submissions(accession: string | null) {
  return {
    filings: {
      recent: {
        form: accession === null ? [] : ["10-K"],
        accessionNumber: accession === null ? [] : [accession],
        acceptanceDateTime:
          accession === null ? [] : ["2025-10-31T10:00:00.000Z"],
        primaryDocument: accession === null ? [] : ["fix-20250927.htm"],
        reportDate: accession === null ? [] : ["2025-09-27"],
      },
    },
  };
}

const prose = (text: string) => `${text} `.repeat(120);
const TEN_K = `<html><body>
<h2>Item 1. Business</h2><p>${prose("The Company designs phones.")}</p>
<h2>Item 1A. Risk Factors</h2><p>${prose("Competition is intense.")}</p>
<h2>Item 1B. Unresolved Staff Comments</h2><p>None.</p>
<h2>Item 7. Management's Discussion and Analysis of Financial Condition</h2><p>${prose("Services net sales increased 14% during 2025.")}</p>
<h2>Item 7A. Quantitative and Qualitative Disclosures</h2><p>Rates.</p>
</body></html>`;

function series(): AnnualFundamentals {
  return {
    version: "annual-fundamentals-1.3.0",
    fiscalYears: [
      {
        fiscalYearEnd: "2025-09-27",
        items: {
          revenue: {
            item: "revenue",
            concept: "Revenues",
            value: "416161000000",
            unit: "USD",
            currency: "USD",
            asOf: "2025-09-27",
            observationId: randomUUID(),
            availableAt: "2025-10-31T10:00:00.000Z",
            recordedAt: "2025-11-01T00:00:00.000Z",
            sourceDocumentId: null,
          },
        },
      },
    ],
  } as AnnualFundamentals;
}

const OUTPUT: MarketExpectationsOutput = {
  decision: "read",
  drivers: FIXTURE_READING.drivers,
  risks: [],
  confidence: "medium",
  rationale: "Synthetic.",
  abstainReason: null,
};

function harness(
  options: {
    accession?: string | null;
    tenK?: string;
    ladder?: (taskRunId: string) => LadderResult<MarketExpectationsOutput>;
  } = {},
) {
  const repository = createInMemoryMarketExpectationsRepository();
  const runLadder = vi.fn<ProposeMarketExpectationsDependencies["runLadder"]>(
    async () =>
      (
        options.ladder ??
        ((taskRunId) => ({
          taskRunId,
          outcome: "accepted",
          rung: 1,
          model: "fixture/model-a",
          output: OUTPUT,
          attempts: [],
        }))
      )(randomUUID()),
  );
  const dependencies: ProposeMarketExpectationsDependencies = {
    annualFundamentals: async () => series(),
    loadSubmissions: async () =>
      submissions(
        options.accession === undefined ? ACCESSION : options.accession,
      ),
    loadAnnualReport: async () => options.tenK ?? TEN_K,
    registry: DEMO_SOURCE_REGISTRY,
    runLadder,
    repository,
    now: () => NOW,
    sha256: (text) => createHash("sha256").update(text).digest("hex"),
  };

  return { dependencies, repository, runLadder };
}

function request(
  overrides: Partial<ProposeMarketExpectationsRequest> = {},
): ProposeMarketExpectationsRequest {
  return {
    legalEntityId: SUBJECT,
    cik: CIK,
    companyName: "Fixture Corp",
    annualReportCiks: [CIK],
    query,
    apply: true,
    again: false,
    ...overrides,
  };
}

describe("proposeMarketExpectations", () => {
  it("sends business, MD&A and risks, and records the accepted reading under the 10-K's fiscal year", async () => {
    const { dependencies, repository, runLadder } = harness();

    const result = await proposeMarketExpectations(request(), dependencies);

    expect(result.status).toBe("asked");
    expect(runLadder).toHaveBeenCalledTimes(1);

    const input = runLadder.mock.calls[0]![1];

    expect(input.evidence.map((item) => item.section)).toEqual([
      "item_1_business",
      "item_7_mdna",
      "item_1a_risk_factors",
    ]);
    expect(input.fiscalYearEnd).toBe("2025-09-27");

    const stored = await repository.acceptedForFiscalYear(
      SUBJECT,
      "2025-09-27",
    );

    expect(stored?.record).toMatchObject({
      accessionNumber: ACCESSION,
      outcome: "accepted",
      extractVersion: "sec-10k-outlook-1.0.0",
    });
    expect(stored?.evidence).toHaveLength(3);
  });

  it("does not ask twice about the same 10-K unless asked again", async () => {
    const { dependencies, runLadder } = harness();

    await proposeMarketExpectations(request(), dependencies);
    const second = await proposeMarketExpectations(request(), dependencies);

    expect(second).toMatchObject({
      status: "skipped",
      reason: "already_asked",
    });
    expect(runLadder).toHaveBeenCalledTimes(1);

    await proposeMarketExpectations(request({ again: true }), dependencies);
    expect(runLadder).toHaveBeenCalledTimes(2);
  });

  it("records an abstention too, and a dry run writes nothing", async () => {
    const abstaining = harness({
      ladder: (taskRunId) => ({
        taskRunId,
        outcome: "abstained",
        reason: "insufficient_evidence",
        detail: null,
        attempts: [],
      }),
    });

    await proposeMarketExpectations(request(), abstaining.dependencies);
    expect(
      (await abstaining.repository.latestForSubject(SUBJECT))?.record,
    ).toMatchObject({ outcome: "abstained", reason: "insufficient_evidence" });

    const dry = harness();
    const result = await proposeMarketExpectations(
      request({ apply: false }),
      dry.dependencies,
    );

    expect(result.status === "asked" && result.written).toBe(false);
    expect(await dry.repository.latestForSubject(SUBJECT)).toBeNull();
  });

  it("names what stops it before spending", async () => {
    const noReport = harness({ accession: null });
    const noSections = harness({
      tenK: "<html><body><p>No items here.</p></body></html>",
    });

    expect(
      await proposeMarketExpectations(request(), noReport.dependencies),
    ).toMatchObject({ status: "skipped", reason: "no_annual_report" });
    expect(
      await proposeMarketExpectations(request(), noSections.dependencies),
    ).toMatchObject({
      status: "skipped",
      reason: "outlook_sections_not_found",
    });
    expect(noReport.runLadder).not.toHaveBeenCalled();
    expect(noSections.runLadder).not.toHaveBeenCalled();
  });
});
