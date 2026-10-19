import { createHash, randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { LadderResult } from "@/modules/ai/application/run-model-ladder";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import {
  DEFAULT_SOURCE_POLICY_VERSION,
  pointInTimeQuerySchema,
} from "@/modules/temporal/domain/point-in-time-query";

import type { AnnualFundamentals } from "../domain/annual-fundamentals";
import { operationsMixDeclarationSchema } from "../domain/operations-mix";
import type { OperationsMixOutput } from "../domain/operations-mix-task";
import { createInMemoryOperationsMixRepository } from "../infrastructure/in-memory-operations-mix-repository";

import {
  proposeOperationsMix,
  revenueForReport,
  type ProposeOperationsMixDependencies,
  type ProposeOperationsMixRequest,
} from "./propose-operations-mix";

const SUBJECT = "00000000-0000-4000-8000-000000000042";
const NOW = "2026-10-16T12:00:00.000Z";
const CIK = "0000000042";
const ACCESSION = "0000000042-26-000001";

const query = pointInTimeQuerySchema.parse({
  effectiveAt: NOW,
  knownAt: NOW,
  revisionPolicy: "as_known",
  adjustmentPolicy: "as_known",
  sourcePolicyVersion: DEFAULT_SOURCE_POLICY_VERSION,
});

function submissions(accession: string | null, reportDate = "2025-12-31") {
  return {
    filings: {
      recent: {
        form: accession === null ? [] : ["10-K"],
        accessionNumber: accession === null ? [] : [accession],
        acceptanceDateTime:
          accession === null ? [] : ["2026-02-20T21:00:00.000Z"],
        primaryDocument: accession === null ? [] : ["fix-20251231.htm"],
        reportDate: accession === null ? [] : [reportDate],
      },
    },
  };
}

const TABLE =
  "Revenue by Geographic Area Revenues attributed to countries based on the location of the customer (in millions): 2025 2024 United States $ 300 $ 280 Japan 1,000 900 Other 100 95 Total $ 1,400 $ 1,275";
const TEN_K = `<html><body><p>${"Prose about the business. ".repeat(40)}</p><div>${TABLE}</div></body></html>`;

function series(
  fiscalYearEnd = "2025-12-31",
  value = "1400000000",
): AnnualFundamentals {
  return {
    version: "annual-fundamentals-1.1.0",
    fiscalYears: [
      {
        fiscalYearEnd,
        items: {
          revenue: {
            item: "revenue",
            concept: "Revenues",
            value,
            unit: "USD",
            currency: "USD",
            asOf: fiscalYearEnd,
            observationId: randomUUID(),
            availableAt: "2026-02-20T21:00:00.000Z",
            recordedAt: "2026-02-21T00:00:00.000Z",
            sourceDocumentId: null,
          },
        },
      },
    ],
  };
}

const OUTPUT: OperationsMixOutput = {
  decision: "proposed",
  unit: "millions",
  lines: [
    {
      label: "United States",
      amount: "$ 300",
      quote: "United States $ 300 $ 280",
      evidenceId: "E1",
      basis: "name_match",
      exposureKeys: ["united-states"],
      definitionQuote: null,
    },
    {
      label: "Japan",
      amount: "1,000",
      quote: "Japan 1,000 900",
      evidenceId: "E1",
      basis: "name_match",
      exposureKeys: ["japan"],
      definitionQuote: null,
    },
    {
      label: "Other",
      amount: "100",
      quote: "Other 100 95",
      evidenceId: "E1",
      basis: "rest_of_world",
      exposureKeys: [],
      definitionQuote: null,
    },
  ],
  totalAmount: "$ 1,400",
  totalQuote: "Total $ 1,400",
  totalEvidenceId: "E1",
  confidence: "high",
  rationale: "Copied the 2025 column.",
  abstainReason: null,
};

function accepted(taskRunId: string): LadderResult<OperationsMixOutput> {
  return {
    taskRunId,
    outcome: "accepted",
    rung: 2,
    model: "fixture/model-b",
    output: OUTPUT,
    attempts: [],
  };
}

function harness(
  options: {
    accession?: string | null;
    reportDate?: string;
    fundamentals?: AnnualFundamentals | null;
    tenK?: string;
    ladder?: (taskRunId: string) => LadderResult<OperationsMixOutput>;
  } = {},
) {
  const repository = createInMemoryOperationsMixRepository();
  const runLadder = vi.fn<ProposeOperationsMixDependencies["runLadder"]>(
    async () => (options.ladder ?? accepted)(randomUUID()),
  );
  const loadAnnualReport = vi.fn(async () => options.tenK ?? TEN_K);
  const dependencies: ProposeOperationsMixDependencies = {
    countryRelease: async () => ({
      releaseId: "00000000-0000-4000-8000-0000000000c1",
      keys: ["united-states", "japan"],
    }),
    regionRelease: async () => ({
      releaseId: "00000000-0000-4000-8000-0000000000c2",
      keys: ["asia", "north-america"],
    }),
    annualFundamentals: async () =>
      options.fundamentals === undefined ? series() : options.fundamentals,
    loadSubmissions: async () =>
      submissions(
        options.accession === undefined ? ACCESSION : options.accession,
        options.reportDate,
      ),
    loadAnnualReport,
    registry: DEMO_SOURCE_REGISTRY,
    runLadder,
    repository,
    now: () => NOW,
    sha256: (text) => createHash("sha256").update(text).digest("hex"),
  };

  return { dependencies, repository, runLadder, loadAnnualReport };
}

function request(
  overrides: Partial<ProposeOperationsMixRequest> = {},
): ProposeOperationsMixRequest {
  return {
    legalEntityId: SUBJECT,
    cik: CIK,
    companyName: "Fixture Corp",
    annualReportCiks: [CIK],
    query,
    declarations: [],
    apply: true,
    again: false,
    ...overrides,
  };
}

describe("proposeOperationsMix", () => {
  it("asks once with the cut table and the year's revenue, and records the accepted lines", async () => {
    const { dependencies, repository, runLadder } = harness();

    const result = await proposeOperationsMix(request(), dependencies);

    expect(result.status).toBe("asked");
    if (result.status !== "asked") return;
    expect(runLadder).toHaveBeenCalledTimes(1);
    const input = runLadder.mock.calls[0]![1];
    expect(input.expectedRevenue).toBe("1400000000");
    expect(input.evidence[0]!.text).toContain("Japan 1,000");
    expect(result.stored.proposal).toMatchObject({
      outcome: "accepted",
      accessionNumber: ACCESSION,
      fiscalYearEnd: "2025-12-31",
      acceptedRung: 2,
    });
    expect(result.stored.lines.map((line) => line.amount)).toEqual([
      "300",
      "1000",
      "100",
    ]);
    expect(await repository.latestForSubject(SUBJECT)).toEqual(result.stored);
  });

  it("does not ask again about the same 10-K unless told to", async () => {
    const { dependencies, runLadder } = harness();

    await proposeOperationsMix(request(), dependencies);
    const second = await proposeOperationsMix(request(), dependencies);
    const forced = await proposeOperationsMix(
      request({ again: true }),
      dependencies,
    );

    expect(second).toMatchObject({
      status: "skipped",
      reason: "already_asked",
    });
    expect(forced.status).toBe("asked");
    expect(runLadder).toHaveBeenCalledTimes(2);
  });

  it("records an abstention with its evidence and no lines", async () => {
    const { dependencies, repository } = harness({
      ladder: (taskRunId) => ({
        taskRunId,
        outcome: "abstained",
        reason: "ladder_exhausted",
        detail: null,
        attempts: [],
      }),
    });

    await proposeOperationsMix(request(), dependencies);

    expect(await repository.latestForSubject(SUBJECT)).toMatchObject({
      proposal: { outcome: "abstained", reason: "ladder_exhausted" },
      lines: [],
    });
  });

  it("writes nothing in a dry run, though it asks", async () => {
    const { dependencies, repository, runLadder } = harness();

    const result = await proposeOperationsMix(
      request({ apply: false }),
      dependencies,
    );

    expect(result).toMatchObject({ status: "asked", written: false });
    expect(runLadder).toHaveBeenCalledTimes(1);
    expect(await repository.latestForSubject(SUBJECT)).toBeNull();
  });

  it.each([
    [
      "an owner declaration, which is a lock",
      {},
      {
        declarations: [
          operationsMixDeclarationSchema.parse({
            cik: CIK,
            exposures: [{ exposureKeys: ["united-states"], weight: "1" }],
            rationale: "The owner read the filing and declared it.",
            declaredOn: "2026-10-16",
          }),
        ],
      },
      "declared_by_owner",
    ],
    ["no 10-K by the cutoff", { accession: null }, {}, "no_annual_report"],
    [
      "no fundamentals for the 10-K's year",
      { fundamentals: series("2024-12-31") },
      {},
      "revenue_unknown",
    ],
    [
      "a 10-K with no geographic revenue table",
      { tenK: `<p>${"We operate only in the Southeast. ".repeat(50)}</p>` },
      {},
      "geographic_table_not_found",
    ],
  ])("skips without spending on %s", async (_, options, overrides, reason) => {
    const { dependencies, runLadder } = harness(options);

    const result = await proposeOperationsMix(request(overrides), dependencies);

    expect(result).toMatchObject({ status: "skipped", reason });
    expect(runLadder).not.toHaveBeenCalled();
  });
});

describe("revenueForReport", () => {
  it("matches a 52/53-week year within a week of the report date", () => {
    expect(revenueForReport(series("2025-09-27"), "2025-09-30")).toEqual({
      fiscalYearEnd: "2025-09-27",
      value: "1400000000",
    });
    expect(revenueForReport(series("2025-09-20"), "2025-09-30")).toBeNull();
  });
});
