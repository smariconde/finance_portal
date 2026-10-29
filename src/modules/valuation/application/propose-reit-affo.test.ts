import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import {
  DEFAULT_SOURCE_POLICY_VERSION,
  pointInTimeQuerySchema,
} from "@/modules/temporal/domain/point-in-time-query";

import { createInMemoryReitAffoRepository } from "../infrastructure/in-memory-reit-affo-repository";

import { proposeReitAffo } from "./propose-reit-affo";

const accession = "0001193125-26-051453";
const knownAt = "2026-02-14T00:00:00.000Z";
const query = pointInTimeQuerySchema.parse({
  effectiveAt: knownAt,
  knownAt,
  revisionPolicy: "as_known",
  adjustmentPolicy: "as_known",
  knowledgeBasis: "public_availability",
  sourcePolicyVersion: DEFAULT_SOURCE_POLICY_VERSION,
});
const request = {
  legalEntityId: "00000000-0000-4000-8000-000000000001",
  cik: "0001045609",
  companyName: "Fixture REIT",
  propertyBasis: "equity_property" as const,
  propertyBasisSourceDocumentId: accession,
  propertyBasisQuote: "Our consolidated properties are owned and managed.",
  fiscalYearEnd: "2025-12-31",
  query,
  commonIncome: {
    value: "8000000",
    currency: "USD",
    unit: "monetary" as const,
    asOf: "2025-12-31",
    availableAt: "2026-02-12T17:00:00.000Z",
    sourceId: "sec-edgar",
    sourceDocumentId: accession,
    observationId: "00000000-0000-4000-8000-000000000002",
    qualityFlags: [],
  },
  apply: true,
  again: false,
};
const submissions = {
  filings: {
    recent: {
      form: ["10-K"],
      accessionNumber: [accession],
      acceptanceDateTime: ["2026-02-12T17:00:00.000Z"],
      primaryDocument: ["pld-20251231.htm"],
      reportDate: ["2025-12-31"],
    },
  },
};
const html = `<p>Our consolidated properties are owned and managed.</p>
<p>Reconciliation of net income to FFO and AFFO for the year ended December 31, 2025 (in millions)</p>
<p>Net income attributable to common 8</p><p>depreciation 6</p><p>gains 2</p><p>impairments 1</p><p>JV 0</p>
<p>FFO 13</p><p>Recurring capital expenditures including tenant improvements and leasing commissions: capex 2</p>
<p>straight-line rent 1</p><p>AFFO 10</p>`;

function dependencies() {
  return {
    loadSubmissions: vi.fn().mockResolvedValue(submissions),
    loadAnnualReport: vi.fn().mockResolvedValue(html),
    registry: DEMO_SOURCE_REGISTRY,
    runLadder: vi.fn().mockResolvedValue({
      taskRunId: "00000000-0000-4000-8000-000000000003",
      outcome: "abstained" as const,
      reason: "different_definition",
      detail: null,
      attempts: [],
    }),
    repository: createInMemoryReitAffoRepository(),
    now: () => "2026-02-13T12:00:00.000Z",
    sha256: (text: string) => createHash("sha256").update(text).digest("hex"),
  };
}

describe("propose REIT AFFO", () => {
  it("refuses mortgage and unclassified REITs before reading SEC", async () => {
    const deps = dependencies();
    expect(
      await proposeReitAffo({ ...request, propertyBasis: "mortgage" }, deps),
    ).toMatchObject({
      status: "skipped",
      reason: "property_basis_unsupported",
    });
    expect(
      await proposeReitAffo({ ...request, propertyBasis: null }, deps),
    ).toMatchObject({
      status: "skipped",
      reason: "property_basis_unsupported",
    });
    expect(deps.loadSubmissions).not.toHaveBeenCalled();
  });

  it("records a dated abstention once and skips the document and AI next time", async () => {
    const deps = dependencies();
    const first = await proposeReitAffo(request, deps);
    expect(first.status).toBe("asked");
    expect(first.status === "asked" && first.stored.proposal.outcome).toBe(
      "abstained",
    );
    const second = await proposeReitAffo(request, deps);
    expect(second).toMatchObject({
      status: "skipped",
      reason: "already_asked",
      accessionNumber: accession,
    });
    expect(deps.loadSubmissions).toHaveBeenCalledTimes(2);
    expect(deps.loadAnnualReport).toHaveBeenCalledTimes(1);
    expect(deps.runLadder).toHaveBeenCalledTimes(1);
  });

  it("refuses an XBRL anchor from another accession before loading the 10-K", async () => {
    const deps = dependencies();
    const result = await proposeReitAffo(
      {
        ...request,
        commonIncome: {
          ...request.commonIncome,
          sourceDocumentId: "0001193125-26-051454",
        },
      },
      deps,
    );
    expect(result).toMatchObject({
      status: "skipped",
      reason: "xbrl_anchor_missing",
    });
    expect(deps.loadAnnualReport).not.toHaveBeenCalled();
    expect(deps.runLadder).not.toHaveBeenCalled();
  });

  it("refuses a PLD-like FFO-only filing without model spend", async () => {
    const deps = dependencies();
    deps.loadAnnualReport.mockResolvedValue(
      "<p>Our consolidated properties are owned and managed.</p><p>Reconciliation of net income to FFO 2025; recurring capex 2.</p>",
    );
    const result = await proposeReitAffo(request, deps);
    expect(result).toMatchObject({
      status: "skipped",
      reason: "annual_reconciliation_missing",
      accessionNumber: accession,
    });
    expect(deps.runLadder).not.toHaveBeenCalled();
  });
});
