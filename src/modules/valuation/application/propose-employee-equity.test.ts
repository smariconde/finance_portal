import { createHash, randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { LadderResult } from "@/modules/ai/application/run-model-ladder";
import type { SecReportedFact } from "@/modules/fundamentals/domain/parse-sec-company-facts";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import {
  DEFAULT_SOURCE_POLICY_VERSION,
  pointInTimeQuerySchema,
} from "@/modules/temporal/domain/point-in-time-query";

import {
  employeeEquityOutputSchema,
  type EmployeeEquityOutput,
} from "../domain/employee-equity-task";
import { createInMemoryEmployeeEquityRepository } from "../infrastructure/in-memory-employee-equity-repository";

import {
  OPTIONS_OUTSTANDING_CONCEPT,
  proposeEmployeeEquity,
  xbrlValueAtYearEnd,
  type ProposeEmployeeEquityDependencies,
  type ProposeEmployeeEquityRequest,
} from "./propose-employee-equity";

const SUBJECT = "00000000-0000-4000-8000-000000000042";
const NOW = "2026-10-20T12:00:00.000Z";
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

const NOTE =
  "Note 9 – Share-Based Compensation. A summary of option activity: (Shares in Thousands) Shares at December 31, 2024 1,100 $40.00 Options granted 100 45.00 Options exercised (200) 30.00 Shares at December 31, 2025 1,000 $42.50 with an average life of 4.0 years. Restricted stock units: Balance as of December 31, 2025 300 vested granted.";
const TEN_K = `<html><body><p>${"Prose about the business. ".repeat(40)}</p><div>${NOTE}</div></body></html>`;

const ANSWER: EmployeeEquityOutput = employeeEquityOutputSchema.parse({
  decision: "proposed",
  scale: "thousands",
  optionsStatus: "outstanding",
  optionsCount: "1,000",
  optionsCountQuote: "Shares at December 31, 2025 1,000 $42.50",
  optionsStrike: "$42.50",
  optionsStrikeQuote: "Shares at December 31, 2025 1,000 $42.50",
  optionsLifeBasis: "remaining_years",
  optionsLife: "4.0",
  optionsLifeQuote: "with an average life of 4.0 years",
  optionsRanges: [],
  unitsStatus: "outstanding",
  units: [
    {
      kind: "restricted",
      count: "300",
      quote: "Balance as of December 31, 2025 300",
    },
  ],
  confidence: "high",
  rationale: "Year-end balances.",
  abstainReason: null,
});

function fact(overrides: Partial<SecReportedFact>): SecReportedFact {
  return {
    taxonomy: "us-gaap",
    concept: OPTIONS_OUTSTANDING_CONCEPT.concept,
    unit: "shares",
    start: null,
    end: "2025-12-31",
    value: "1000000",
    accessionNumber: ACCESSION,
    form: "10-K",
    filed: "2026-02-20",
    fiscalYear: 2025,
    fiscalPeriod: "FY",
    ...overrides,
  };
}

function accepted(): LadderResult<EmployeeEquityOutput> {
  return {
    taskRunId: randomUUID(),
    outcome: "accepted",
    rung: 1,
    model: "fixture/model-a",
    output: ANSWER,
    attempts: [],
  };
}

function setup(
  overrides: Partial<ProposeEmployeeEquityDependencies> = {},
  annualReport: unknown = submissions(ACCESSION),
) {
  const repository = createInMemoryEmployeeEquityRepository();
  const runLadder = vi.fn(async () => accepted());
  const loadConceptFacts = vi.fn(
    async (_cik: string, concept: { concept: string }) =>
      concept.concept === OPTIONS_OUTSTANDING_CONCEPT.concept
        ? [
            fact({}),
            fact({ accessionNumber: "0000000042-25-000001", value: "9" }),
          ]
        : [fact({ unit: "USD/shares", value: "42.5" })],
  );
  const dependencies: ProposeEmployeeEquityDependencies = {
    loadSubmissions: async () => annualReport,
    loadAnnualReport: async () => TEN_K,
    loadConceptFacts,
    registry: DEMO_SOURCE_REGISTRY,
    runLadder,
    repository,
    now: () => NOW,
    sha256: (text) => createHash("sha256").update(text).digest("hex"),
    ...overrides,
  };

  return { dependencies, repository, runLadder, loadConceptFacts };
}

const request = (
  overrides: Partial<ProposeEmployeeEquityRequest> = {},
): ProposeEmployeeEquityRequest => ({
  legalEntityId: SUBJECT,
  cik: CIK,
  companyName: "Synthetic Co",
  annualReportCiks: [CIK],
  query,
  apply: true,
  again: false,
  ...overrides,
});

describe("proposeEmployeeEquity", () => {
  it("asks with the note and the XBRL of the same 10-K, and records it", async () => {
    const { dependencies, repository, runLadder } = setup();
    const result = await proposeEmployeeEquity(request(), dependencies);

    expect(result.status).toBe("asked");
    expect(runLadder).toHaveBeenCalledTimes(1);

    const input = (runLadder.mock.calls[0] as unknown[])[1] as {
      fiscalYearEnd: string;
      evidence: { text: string };
      xbrl: unknown;
    };

    expect(input.fiscalYearEnd).toBe("2025-12-31");
    expect(input.evidence.text).toContain("Shares at December 31, 2025 1,000");
    // El 9 de otra presentación no corrobora nada.
    expect(input.xbrl).toStrictEqual({
      optionsOutstanding: "1000000",
      weightedStrike: "42.5",
    });

    const stored = await repository.latestForSubject(SUBJECT);

    expect(stored?.proposal).toMatchObject({
      outcome: "accepted",
      transcription: ANSWER,
      xbrlOptionsOutstanding: "1000000",
      xbrlWeightedStrike: "42.5",
      accessionNumber: ACCESSION,
      extractVersion: "sec-10k-equity-compensation-1.0.0",
    });
    expect(stored?.evidence.excerpt).toContain("Share-Based Compensation");
  });

  it("records an abstention too", async () => {
    const { dependencies, repository } = setup({
      runLadder: async () => ({
        taskRunId: randomUUID(),
        outcome: "abstained",
        reason: "insufficient_evidence",
        detail: null,
        attempts: [],
      }),
    });

    await proposeEmployeeEquity(request(), dependencies);

    expect(
      (await repository.latestForSubject(SUBJECT))?.proposal,
    ).toMatchObject({
      outcome: "abstained",
      transcription: null,
      reason: "insufficient_evidence",
    });
  });

  it("asks but writes nothing in a dry run", async () => {
    const { dependencies, repository, runLadder } = setup();
    const result = await proposeEmployeeEquity(
      request({ apply: false }),
      dependencies,
    );

    expect(runLadder).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: "asked", written: false });
    expect(await repository.latestForSubject(SUBJECT)).toBeNull();
  });

  it("does not ask twice about the same 10-K unless told to", async () => {
    const { dependencies, runLadder } = setup();

    await proposeEmployeeEquity(request(), dependencies);
    const second = await proposeEmployeeEquity(request(), dependencies);

    expect(second).toMatchObject({
      status: "skipped",
      reason: "already_asked",
    });
    expect(runLadder).toHaveBeenCalledTimes(1);

    await proposeEmployeeEquity(request({ again: true }), dependencies);

    expect(runLadder).toHaveBeenCalledTimes(2);
  });

  it("skips without spending when there is no 10-K or no note", async () => {
    const none = setup({}, submissions(null));

    expect(
      await proposeEmployeeEquity(request(), none.dependencies),
    ).toMatchObject({
      status: "skipped",
      reason: "no_annual_report",
    });

    const noNote = setup({
      loadAnnualReport: async () =>
        `<html><body>${"Prose about the business. ".repeat(80)}</body></html>`,
    });

    expect(
      await proposeEmployeeEquity(request(), noNote.dependencies),
    ).toMatchObject({ status: "skipped", reason: "equity_note_not_found" });
    expect(none.runLadder).not.toHaveBeenCalled();
    expect(noNote.runLadder).not.toHaveBeenCalled();
    expect(noNote.loadConceptFacts).not.toHaveBeenCalled();
  });

  it("refuses before reserving when the source may not travel to a model", async () => {
    const { dependencies, runLadder } = setup({
      registry: DEMO_SOURCE_REGISTRY.map((entry) =>
        entry.sourceId === "sec-edgar"
          ? { ...entry, rights: { ...entry.rights, aiTransfer: "restricted" } }
          : entry,
      ),
    });

    await expect(
      proposeEmployeeEquity(request(), dependencies),
    ).rejects.toThrow();
    expect(runLadder).not.toHaveBeenCalled();
  });
});

describe("xbrlValueAtYearEnd", () => {
  const report = {
    accessionNumber: ACCESSION,
    reportDate: "2025-12-31",
  } as Parameters<typeof xbrlValueAtYearEnd>[1];

  it("is null when the filing does not publish the fact", () => {
    expect(xbrlValueAtYearEnd([], report, "shares")).toBeNull();
    expect(
      xbrlValueAtYearEnd([fact({ end: "2024-12-31" })], report, "shares"),
    ).toBeNull();
  });

  it("does not choose between two values for the same close", () => {
    expect(
      xbrlValueAtYearEnd(
        [fact({ value: "1000000" }), fact({ value: "1000001" })],
        report,
        "shares",
      ),
    ).toBeNull();
  });
});
