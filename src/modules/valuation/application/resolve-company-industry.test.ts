import { createHash, randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { LadderResult } from "@/modules/ai/application/run-model-ladder";
import { subjectClassificationSchema } from "@/modules/classification/domain/subject-classification";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import {
  DEFAULT_SOURCE_POLICY_VERSION,
  pointInTimeQuerySchema,
} from "@/modules/temporal/domain/point-in-time-query";

import type { IndustryResolutionOutput } from "../domain/industry-resolution-task";
import { createInMemoryIndustryResolutionRepository } from "../infrastructure/in-memory-industry-resolution-repository";

import {
  resolveCompanyIndustry,
  type ResolveCompanyIndustryDependencies,
  type ResolveCompanyIndustryRequest,
} from "./resolve-company-industry";

const SUBJECT = "00000000-0000-4000-8000-000000000042";
const NOW = "2026-10-15T12:00:00.000Z";
const CIK = "0000000042";
const PREDECESSOR = "0000000041";

const query = pointInTimeQuerySchema.parse({
  effectiveAt: NOW,
  knownAt: NOW,
  revisionPolicy: "as_known",
  adjustmentPolicy: "as_known",
  sourcePolicyVersion: DEFAULT_SOURCE_POLICY_VERSION,
});

function sicAssertion(code: string) {
  return subjectClassificationSchema.parse({
    classificationAssignmentId: randomUUID(),
    subjectType: "legal_entity",
    subjectId: SUBJECT,
    taxonomyId: "sec-sic",
    taxonomyVersion: "sec-submissions-1.0.0",
    code,
    label: `${code} NATIONAL COMMERCIAL BANKS`,
    validFrom: "2026-10-01T00:00:00.000Z",
    validTo: null,
    availableAt: "2026-10-01T00:00:00.000Z",
    supersededAt: null,
    sourceId: "sec-edgar",
    sourceDocumentId: `submissions/CIK${CIK}.json`,
    contentHash: "b".repeat(64),
    recordedAt: "2026-10-01T00:00:00.000Z",
  });
}

function submissions(accession: string | null) {
  return {
    filings: {
      recent: {
        form: accession === null ? [] : ["10-K"],
        accessionNumber: accession === null ? [] : [accession],
        acceptanceDateTime:
          accession === null ? [] : ["2026-02-20T21:00:00.000Z"],
        primaryDocument: accession === null ? [] : ["fix-20251231.htm"],
      },
    },
  };
}

const TEN_K = `<h2>ITEM 1. BUSINESS</h2><p>${"Fixture Bancorp is a regional bank with branches in the Midwest. ".repeat(60)}</p><h2>Item 1A. Risk Factors</h2><p>Risks.</p><h3>Segment Information</h3><p>Consumer and Commercial segments.</p>`;

function accepted(taskRunId: string): LadderResult<IndustryResolutionOutput> {
  return {
    taskRunId,
    outcome: "accepted",
    rung: 1,
    model: "fixture/model-a",
    output: {
      decision: "resolved",
      industryKey: "banks-regional",
      confidence: "high",
      evidenceIds: ["E1"],
      rationale: "A regional bank in the Midwest.",
      abstainReason: null,
    },
    attempts: [],
  };
}

function harness(
  options: {
    sic?: string | null;
    current?: string | null;
    predecessor?: string | null;
    ladder?: (taskRunId: string) => LadderResult<IndustryResolutionOutput>;
  } = {},
) {
  const repository = createInMemoryIndustryResolutionRepository();
  const runLadder = vi.fn(async () =>
    (options.ladder ?? accepted)(randomUUID()),
  );
  const loadSubmissions = vi.fn(async (cik: string) =>
    submissions(
      cik === CIK
        ? options.current === undefined
          ? "0000000042-26-000001"
          : options.current
        : (options.predecessor ?? null),
    ),
  );
  const loadAnnualReport = vi.fn(async () => TEN_K);
  const dependencies: ResolveCompanyIndustryDependencies = {
    loadSicAssertions: async () =>
      options.sic === null ? [] : [sicAssertion(options.sic ?? "6021")],
    industryRelease: async () =>
      new Map([
        ["bank-money-center", "Bank (Money Center)"],
        ["banks-regional", "Banks (Regional)"],
        ["computers-peripherals", "Computers/Peripherals"],
      ]),
    loadSubmissions,
    loadAnnualReport,
    registry: DEMO_SOURCE_REGISTRY,
    runLadder,
    repository,
    now: () => NOW,
    newId: () => randomUUID(),
    sha256: (text) => createHash("sha256").update(text).digest("hex"),
  };
  const request = (
    overrides: Partial<ResolveCompanyIndustryRequest> = {},
  ): ResolveCompanyIndustryRequest => ({
    legalEntityId: SUBJECT,
    cik: CIK,
    companyName: "Fixture Bancorp",
    annualReportCiks: [CIK, PREDECESSOR],
    query,
    declarations: [],
    apply: true,
    again: false,
    ...overrides,
  });

  return {
    repository,
    runLadder,
    loadSubmissions,
    loadAnnualReport,
    dependencies,
    request,
  };
}

describe("resolveCompanyIndustry", () => {
  it("resolves an ambiguous company from its 10-K and publishes the assertion", async () => {
    const { dependencies, request, repository, runLadder } = harness();

    const result = await resolveCompanyIndustry(request(), dependencies);

    expect(result).toMatchObject({
      status: "asked",
      written: true,
      record: {
        outcome: "resolved",
        industryKey: "banks-regional",
        sic: "6021",
        candidates: ["bank-money-center", "banks-regional"],
        citedEvidenceIds: ["E1"],
      },
    });

    const [, input] = runLadder.mock.calls[0]! as unknown as [
      unknown,
      {
        evidence: { evidenceId: string; section: string }[];
        sic: { description: string | null };
      },
    ];

    expect(
      input.evidence.map((item) => [item.evidenceId, item.section]),
    ).toEqual([
      ["E1", "item_1_business"],
      ["E2", "segment_note"],
    ]);
    expect(input.sic.description).toBe("NATIONAL COMMERCIAL BANKS");
    expect(
      (await repository.assertionsForSubject(SUBJECT)).map(
        (item) => item.classification.code,
      ),
    ).toEqual(["banks-regional"]);
  });

  it("does not write anything on a dry run, though it asked", async () => {
    const { dependencies, request, repository, runLadder } = harness();

    const result = await resolveCompanyIndustry(
      request({ apply: false }),
      dependencies,
    );

    expect(result).toMatchObject({ status: "asked", written: false });
    expect(runLadder).toHaveBeenCalledTimes(1);
    expect(await repository.latestForSubject(SUBJECT)).toBeNull();
  });

  it("records an abstention with its reason and asserts nothing", async () => {
    const { dependencies, request, repository } = harness({
      ladder: (taskRunId) => ({
        taskRunId,
        outcome: "abstained",
        reason: "insufficient_evidence",
        detail: null,
        attempts: [],
      }),
    });

    await resolveCompanyIndustry(request(), dependencies);

    expect(
      (await repository.latestForSubject(SUBJECT))?.resolution,
    ).toMatchObject({
      outcome: "abstained",
      reason: "insufficient_evidence",
      industryKey: null,
    });
    expect(await repository.assertionsForSubject(SUBJECT)).toEqual([]);
  });

  it("does not ask twice about the same SIC and the same 10-K, unless told to", async () => {
    const { dependencies, request, runLadder, loadAnnualReport } = harness();

    await resolveCompanyIndustry(request(), dependencies);
    const second = await resolveCompanyIndustry(request(), dependencies);

    expect(second).toMatchObject({
      status: "skipped",
      reason: "already_asked",
    });
    expect(runLadder).toHaveBeenCalledTimes(1);
    // Saltear no baja el documento: sólo `submissions`, para saber si hay uno nuevo.
    expect(loadAnnualReport).toHaveBeenCalledTimes(1);

    await resolveCompanyIndustry(request({ again: true }), dependencies);
    expect(runLadder).toHaveBeenCalledTimes(2);
  });

  it("looks for the 10-K under the predecessor when the successor has none yet", async () => {
    const { dependencies, request, loadSubmissions } = harness({
      current: null,
      predecessor: "0000000041-26-000007",
    });

    const result = await resolveCompanyIndustry(request(), dependencies);

    expect(loadSubmissions.mock.calls.map(([cik]) => cik)).toEqual([
      CIK,
      PREDECESSOR,
    ]);
    expect(result.status === "asked" && result.annualReport?.cik).toBe(
      PREDECESSOR,
    );
  });

  it.each([
    [{ sic: null }, "sic_unknown"],
    [{ sic: "3571" }, "not_ambiguous"],
    [{ current: null, predecessor: null }, "no_annual_report"],
  ] as const)("does not call a model when %o (%s)", async (options, reason) => {
    const { dependencies, request, runLadder } = harness(options);

    expect(await resolveCompanyIndustry(request(), dependencies)).toMatchObject(
      {
        status: "skipped",
        reason,
      },
    );
    expect(runLadder).not.toHaveBeenCalled();
  });

  it("leaves an owner declaration alone", async () => {
    const { dependencies, request, runLadder } = harness();

    const result = await resolveCompanyIndustry(
      request({
        declarations: [
          {
            cik: CIK,
            ticker: "FIX",
            industryKey: "bank-money-center",
            decidedBy: "owner",
            decidedOn: "2026-10-02",
            rationale: "Money-center scale and global markets franchise.",
          },
        ],
      }),
      dependencies,
    );

    expect(result).toMatchObject({
      status: "skipped",
      reason: "declared_by_owner",
    });
    expect(runLadder).not.toHaveBeenCalled();
  });

  it("refuses before any spend when the evidence's source may not reach a model", async () => {
    const { dependencies, request, runLadder } = harness();
    const registry = DEMO_SOURCE_REGISTRY.map((entry) =>
      entry.sourceId === "sec-edgar"
        ? {
            ...entry,
            rights: { ...entry.rights, aiTransfer: "unknown" as const },
          }
        : entry,
    );

    await expect(
      resolveCompanyIndustry(request(), { ...dependencies, registry }),
    ).rejects.toThrow(/aiTransfer/);
    expect(runLadder).not.toHaveBeenCalled();
  });

  describe("web search as the last resort (F5-04)", () => {
    // Resultados sintéticos: ninguno real entra al repositorio.
    const WEB = [
      {
        url: "https://example.com/fixture-bancorp",
        title: "Fixture Bancorp",
        excerpt: "Fixture Bancorp is a regional bank in the Midwest.",
        truncated: false,
      },
    ];
    const abstaining = (
      taskRunId: string,
    ): LadderResult<IndustryResolutionOutput> => ({
      taskRunId,
      outcome: "abstained",
      reason: "insufficient_evidence",
      detail: null,
      attempts: [],
    });

    it("does not search while the 10-K is enough", async () => {
      const { dependencies, request } = harness();
      const searchWeb = vi.fn(async () => WEB);

      const result = await resolveCompanyIndustry(request(), {
        ...dependencies,
        searchWeb,
      });

      expect(searchWeb).not.toHaveBeenCalled();
      expect(result).toMatchObject({ status: "asked", webSearch: null });
    });

    it("asks once more with the results after an abstention for insufficient evidence", async () => {
      const { dependencies, request, runLadder, repository } = harness();
      runLadder
        .mockImplementationOnce(async () => abstaining(randomUUID()))
        .mockImplementationOnce(async () => accepted(randomUUID()));
      const searchWeb = vi.fn(async () => WEB);

      const result = await resolveCompanyIndustry(request(), {
        ...dependencies,
        searchWeb,
      });

      expect(searchWeb).toHaveBeenCalledWith(
        "Fixture Bancorp primary business: bank money center, banks regional",
      );
      expect(runLadder).toHaveBeenCalledTimes(2);
      const second = runLadder.mock.calls[1] as unknown as [
        unknown,
        { evidence: { evidenceId: string; sourceId: string }[] },
      ];
      expect(
        second[1].evidence.map((item) => [item.evidenceId, item.sourceId]),
      ).toEqual([
        ["E1", "sec-edgar"],
        ["E2", "sec-edgar"],
        ["E3", "tavily"],
      ]);
      expect(result).toMatchObject({
        status: "asked",
        record: { outcome: "resolved" },
        webSearch: { trigger: "insufficient_evidence", results: 1 },
      });

      const stored = await repository.latestForSubject(SUBJECT);
      expect(stored?.evidence.at(-1)).toMatchObject({
        evidenceId: "E3",
        sourceId: "tavily",
        section: "web_search",
        documentUrl: "https://example.com/fixture-bancorp",
        accessionNumber: null,
        documentAcceptedAt: null,
      });
    });

    it("resolves from the web alone when there is no 10-K, and keeps the abstention when the search does not come back", async () => {
      const { dependencies, request, loadAnnualReport } = harness({
        current: null,
        predecessor: null,
      });

      const found = await resolveCompanyIndustry(request(), {
        ...dependencies,
        searchWeb: async () => WEB,
      });

      expect(loadAnnualReport).not.toHaveBeenCalled();
      expect(found).toMatchObject({
        status: "asked",
        annualReport: null,
        webSearch: { trigger: "no_annual_report", results: 1 },
      });

      const { dependencies: again, request: retry } = harness({
        current: null,
        predecessor: null,
      });

      expect(
        await resolveCompanyIndustry(retry(), {
          ...again,
          searchWeb: async () => null,
        }),
      ).toMatchObject({ status: "skipped", reason: "no_annual_report" });
    });

    it("refuses before any spend when the web results may not reach a model", async () => {
      const { dependencies, request, runLadder } = harness({
        current: null,
        predecessor: null,
      });
      const registry = DEMO_SOURCE_REGISTRY.map((entry) =>
        entry.sourceId === "tavily"
          ? {
              ...entry,
              rights: { ...entry.rights, aiTransfer: "unknown" as const },
            }
          : entry,
      );

      await expect(
        resolveCompanyIndustry(request(), {
          ...dependencies,
          registry,
          searchWeb: async () => WEB,
        }),
      ).rejects.toThrow(/aiTransfer/);
      expect(runLadder).not.toHaveBeenCalled();
    });
  });
});
