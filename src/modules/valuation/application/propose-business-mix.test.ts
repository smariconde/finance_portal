import { createHash, randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { LadderResult } from "@/modules/ai/application/run-model-ladder";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import {
  DEFAULT_SOURCE_POLICY_VERSION,
  pointInTimeQuerySchema,
} from "@/modules/temporal/domain/point-in-time-query";

import type { AnnualFundamentals } from "../domain/annual-fundamentals";
import type { BusinessMixOutput } from "../domain/business-mix-task";
import { createInMemoryBusinessMixRepository } from "../infrastructure/in-memory-business-mix-repository";

import {
  proposeBusinessMix,
  type ProposeBusinessMixDependencies,
  type ProposeBusinessMixRequest,
} from "./propose-business-mix";

const SUBJECT = "00000000-0000-4000-8000-000000000042";
const NOW = "2026-11-24T12:00:00.000Z";
const CIK = "0000000042";
const ACCESSION = "0000000042-26-000001";

const query = pointInTimeQuerySchema.parse({
  effectiveAt: NOW,
  knownAt: NOW,
  revisionPolicy: "as_known",
  adjustmentPolicy: "as_known",
  sourcePolicyVersion: DEFAULT_SOURCE_POLICY_VERSION,
});

const SUBMISSIONS = {
  filings: {
    recent: {
      form: ["10-K"],
      accessionNumber: [ACCESSION],
      acceptanceDateTime: ["2026-02-20T21:00:00.000Z"],
      primaryDocument: ["fix-20251231.htm"],
      reportDate: ["2025-12-31"],
    },
  },
};

const SERVICES =
  "Services earns revenue from performance and brand advertising sold on our platforms.";
const CLOUD =
  "Cloud sells enterprise infrastructure and platform services to businesses.";
const TEN_K = `<html><body><p>Item 1. Business</p><p>${SERVICES} ${CLOUD} ${"More prose about the business. ".repeat(80)}</p><p>Item 1A. Risk Factors</p><p>Risks.</p></body></html>`;

function context(id: string, member: string | null): string {
  const segment =
    member === null
      ? ""
      : `<segment><xbrldi:explicitMember dimension="us-gaap:StatementBusinessSegmentsAxis">${member}</xbrldi:explicitMember></segment>`;
  return `<context id="${id}"><entity><identifier scheme="http://www.sec.gov/CIK">${CIK}</identifier>${segment}</entity><period><startDate>2025-01-01</startDate><endDate>2025-12-31</endDate></period></context>`;
}

function instance(lines: readonly [string, string][]): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<xbrl xmlns="http://www.xbrl.org/2003/instance" xmlns:fix="http://fix.example/2025" xmlns:gaap="http://fasb.org/us-gaap/2025" xmlns:iso4217="http://www.xbrl.org/2003/iso4217" xmlns:xbrldi="http://xbrl.org/2006/xbrldi">
<unit id="usd"><measure>iso4217:USD</measure></unit>
${context("total", null)}
${lines.map(([member], index) => context(`c${index}`, `fix:${member}`)).join("\n")}
${lines.map(([, amount], index) => `<gaap:Revenues contextRef="c${index}" unitRef="usd" decimals="-6">${amount}</gaap:Revenues>`).join("\n")}
</xbrl>`;
}

const TWO_LINES: [string, string][] = [
  ["ServicesMember", "300000000"],
  ["CloudMember", "100000000"],
];

function series(value = "400000000"): AnnualFundamentals {
  return {
    version: "annual-fundamentals-1.11.0",
    fiscalYears: [
      {
        fiscalYearEnd: "2025-12-31",
        items: {
          revenue: {
            item: "revenue",
            concept: "Revenues",
            value,
            unit: "USD",
            currency: "USD",
            asOf: "2025-12-31",
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

const OUTPUT: BusinessMixOutput = {
  decision: "proposed",
  axis: "StatementBusinessSegmentsAxis",
  lines: [
    {
      lineId: "L1",
      industryKey: "advertising",
      quote: SERVICES,
      evidenceId: "E1",
    },
    {
      lineId: "L2",
      industryKey: "software-system-and-application",
      quote: CLOUD,
      evidenceId: "E1",
    },
  ],
  confidence: "high",
  rationale: "Advertising and cloud.",
  abstainReason: null,
};

function harness(options: { lines?: [string, string][] } = {}) {
  const repository = createInMemoryBusinessMixRepository();
  const runLadder = vi.fn<ProposeBusinessMixDependencies["runLadder"]>(
    async (task, input) => {
      expect(task.judge(OUTPUT, input)).toEqual({ verdict: "accept" });
      return {
        taskRunId: randomUUID(),
        outcome: "accepted",
        rung: 1,
        model: "fixture/model-a",
        output: OUTPUT,
        attempts: [],
      } satisfies LadderResult<BusinessMixOutput>;
    },
  );
  const loadInstance = vi.fn(async () => instance(options.lines ?? TWO_LINES));
  const dependencies: ProposeBusinessMixDependencies = {
    betasRelease: async () => ({
      releaseId: "00000000-0000-4000-8000-0000000000b1",
      keys: [
        "advertising",
        "software-system-and-application",
        "total-market",
        "total-market-without-financials",
      ],
    }),
    annualFundamentals: async () => series(),
    loadSubmissions: async () => SUBMISSIONS,
    loadAnnualReport: async () => TEN_K,
    loadInstance,
    registry: DEMO_SOURCE_REGISTRY,
    runLadder,
    repository,
    now: () => NOW,
    sha256: (text) => createHash("sha256").update(text).digest("hex"),
  };

  return { dependencies, repository, runLadder, loadInstance };
}

function request(
  overrides: Partial<ProposeBusinessMixRequest> = {},
): ProposeBusinessMixRequest {
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

describe("proposeBusinessMix", () => {
  it("offers the XBRL lines with Item 1 and records the amounts from XBRL", async () => {
    const { dependencies, repository, runLadder, loadInstance } = harness();

    const result = await proposeBusinessMix(request(), dependencies);

    expect(result.status).toBe("asked");
    expect(loadInstance).toHaveBeenCalledWith(
      "https://www.sec.gov/Archives/edgar/data/42/000000004226000001/fix-20251231_htm.xml",
    );
    const input = runLadder.mock.calls[0]![1];
    // Los totales de la tabla no son una industria que se pueda elegir.
    expect(input.industryKeys).toEqual([
      "advertising",
      "software-system-and-application",
    ]);
    expect(input.evidence.map((item) => item.section)).toEqual([
      "item_1_business",
      "xbrl_business_lines",
    ]);
    // Los montos no viajan a la respuesta: los pone el XBRL.
    const stored = await repository.latestForSubject(SUBJECT);
    expect(
      stored?.lines.map((line) => [line.member, line.amount, line.industryKey]),
    ).toEqual([
      ["ServicesMember", "300000000", "advertising"],
      ["CloudMember", "100000000", "software-system-and-application"],
    ]);
    expect(stored?.proposal).toMatchObject({
      outcome: "accepted",
      axis: "StatementBusinessSegmentsAxis",
      linesVersion: "sec-xbrl-business-lines-1.0.0",
    });
  });

  it("does not ask again about the same 10-K, nor when the owner declared", async () => {
    const { dependencies, runLadder, loadInstance } = harness();

    await proposeBusinessMix(request(), dependencies);
    const again = await proposeBusinessMix(request(), dependencies);

    expect(again).toMatchObject({ status: "skipped", reason: "already_asked" });
    expect(runLadder).toHaveBeenCalledTimes(1);
    expect(loadInstance).toHaveBeenCalledTimes(1);

    const declared = await proposeBusinessMix(
      request({
        declarations: [
          {
            cik: CIK,
            businesses: [{ industryKey: "advertising", weight: "1" }],
            rationale: "The owner decided this company is one business.",
            declaredOn: "2026-11-24",
          },
        ],
      }),
      dependencies,
    );
    expect(declared).toMatchObject({ reason: "declared_by_owner" });
  });

  it("names a filing with a single business line before spending", async () => {
    const { dependencies, runLadder } = harness({
      lines: [["ReportableSegmentMember", "400000000"]],
    });

    expect(await proposeBusinessMix(request(), dependencies)).toMatchObject({
      status: "skipped",
      reason: "no_business_lines",
    });
    expect(runLadder).not.toHaveBeenCalled();
  });
});
