import type { LadderResult } from "@/modules/ai/application/run-model-ladder";
import type { AiTask } from "@/modules/ai/domain/ai-task";
import { assertAiTransferable } from "@/modules/ai/domain/ai-transfer";
import { isTransientAiAnswer } from "@/modules/ai/domain/task-answer";
import { SEC_10K_REIT_AFFO_VERSION } from "@/modules/fundamentals/domain/sec-10k-reit-affo";
import { tenKVisibleText } from "@/modules/fundamentals/domain/sec-10k-sections";
import {
  locateLatestAnnualReport,
  type SecAnnualReport,
} from "@/modules/fundamentals/domain/sec-annual-report";
import type { SourceRegistryEntry } from "@/modules/ingestion/domain/source-registry-entry";
import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";

import type { MonetaryFact } from "../domain/valuation-facts";
import {
  REIT_AFFO_POLICY_VERSION,
  REIT_AFFO_PROMPT_VERSION,
  REIT_AFFO_TASK,
  type ReitAffoInput,
  type ReitAffoOutput,
} from "../domain/reit-affo-task";

import type {
  ReitAffoRepository,
  StoredReitAffo,
} from "./reit-affo-repository";
import { readReitAffoFromReport } from "./read-reit-affo-filing";

export type ProposeReitAffoRequest = {
  readonly legalEntityId: string;
  readonly cik: string;
  readonly companyName: string;
  /** Dated classification from the filing, never inferred from the ticker. */
  readonly propertyBasis: "equity_property" | "mortgage" | "hybrid" | null;
  readonly propertyBasisSourceDocumentId: string | null;
  readonly propertyBasisQuote: string | null;
  readonly fiscalYearEnd: string;
  readonly commonIncome: MonetaryFact;
  readonly query: PointInTimeQuery;
  readonly apply: boolean;
  readonly again: boolean;
};

export type ProposeReitAffoDependencies = {
  readonly loadSubmissions: (cik: string) => Promise<unknown>;
  readonly loadAnnualReport: (report: SecAnnualReport) => Promise<string>;
  readonly registry: readonly SourceRegistryEntry[];
  readonly runLadder: (
    task: AiTask<ReitAffoInput, ReitAffoOutput>,
    input: ReitAffoInput,
  ) => Promise<LadderResult<ReitAffoOutput>>;
  readonly repository: ReitAffoRepository;
  readonly now: () => string;
  readonly sha256: (text: string) => string;
};

export type ProposeReitAffoResult =
  | {
      readonly status: "skipped";
      readonly reason:
        | "annual_report_missing"
        | "property_basis_unsupported"
        | "filing_year_mismatch"
        | "xbrl_anchor_missing"
        | "already_asked"
        | "annual_reconciliation_missing";
      readonly previous: StoredReitAffo | null;
    }
  | {
      readonly status: "asked";
      readonly stored: StoredReitAffo;
      readonly ladder: LadderResult<ReitAffoOutput>;
      readonly written: boolean;
    };

/** One submissions read; a known answer skips the 10-K download and model. */
export async function proposeReitAffo(
  request: ProposeReitAffoRequest,
  dependencies: ProposeReitAffoDependencies,
): Promise<ProposeReitAffoResult> {
  const skip = (
    reason: Extract<ProposeReitAffoResult, { status: "skipped" }>["reason"],
    previous: StoredReitAffo | null = null,
  ): ProposeReitAffoResult => ({ status: "skipped", reason, previous });
  if (request.propertyBasis !== "equity_property")
    return skip("property_basis_unsupported");
  const knownAt = request.query.knownAt ?? request.query.effectiveAt;
  const located = locateLatestAnnualReport(
    await dependencies.loadSubmissions(request.cik),
    request.cik,
    knownAt,
  );
  if (located.status !== "found") return skip("annual_report_missing");
  const report = located.report;
  if (report.reportDate !== request.fiscalYearEnd)
    return skip("filing_year_mismatch");
  if (request.propertyBasisSourceDocumentId !== report.accessionNumber)
    return skip("property_basis_unsupported");
  const anchor = request.commonIncome;
  if (
    anchor.sourceId !== "sec-edgar" ||
    anchor.sourceDocumentId !== report.accessionNumber ||
    anchor.observationId === null ||
    anchor.asOf !== request.fiscalYearEnd ||
    anchor.availableAt > knownAt ||
    anchor.currency !== "USD"
  )
    return skip("xbrl_anchor_missing");

  const previous = await dependencies.repository.latestAsKnown(
    request.legalEntityId,
    knownAt,
  );
  if (
    !request.again &&
    previous !== null &&
    previous.proposal.accessionNumber === report.accessionNumber &&
    previous.proposal.taskVersion === REIT_AFFO_TASK.taskVersion &&
    previous.proposal.promptVersion === REIT_AFFO_PROMPT_VERSION &&
    previous.proposal.policyVersion === REIT_AFFO_POLICY_VERSION &&
    previous.proposal.extractVersion === SEC_10K_REIT_AFFO_VERSION &&
    previous.proposal.commonIncomeObservationId === anchor.observationId &&
    previous.proposal.expectedCommonIncome === anchor.value &&
    !isTransientAiAnswer(previous.proposal)
  )
    return skip("already_asked", previous);

  const html = await dependencies.loadAnnualReport(report);
  if (
    request.propertyBasisQuote === null ||
    !tenKVisibleText(html).includes(request.propertyBasisQuote)
  )
    return skip("property_basis_unsupported", previous);
  const filing = readReitAffoFromReport(report, request.fiscalYearEnd, html);
  if (filing.status !== "ready")
    return skip("annual_reconciliation_missing", previous);
  const { extract } = filing;
  assertAiTransferable(["sec-edgar"], dependencies.registry);
  const ladder = await dependencies.runLadder(REIT_AFFO_TASK, {
    companyName: request.companyName,
    fiscalYearEnd: request.fiscalYearEnd,
    evidence: { sourceId: "sec-edgar", text: extract.text },
    expectedCommonIncome: anchor.value,
  });
  const proposedAt = dependencies.now();
  const accepted = ladder.outcome === "accepted";
  const stored: StoredReitAffo = {
    proposal: {
      proposalId: ladder.taskRunId,
      legalEntityId: request.legalEntityId,
      cik: request.cik,
      accessionNumber: report.accessionNumber,
      fiscalYearEnd: request.fiscalYearEnd,
      taskVersion: REIT_AFFO_TASK.taskVersion,
      promptVersion: REIT_AFFO_PROMPT_VERSION,
      policyVersion: REIT_AFFO_POLICY_VERSION,
      extractVersion: SEC_10K_REIT_AFFO_VERSION,
      expectedCommonIncome: anchor.value,
      commonIncomeObservationId: anchor.observationId,
      commonIncomeSourceDocumentId: anchor.sourceDocumentId,
      outcome: accepted
        ? "accepted"
        : ladder.outcome === "abstained"
          ? "abstained"
          : "stopped",
      transcription: accepted ? ladder.output : null,
      reason: accepted
        ? null
        : ladder.outcome === "abstained"
          ? ladder.reason
          : ladder.code,
      acceptedRung: accepted ? ladder.rung : null,
      respondedModel: accepted ? ladder.model : null,
      proposedAt,
      recordedAt: proposedAt,
    },
    evidence: {
      sourceId: "sec-edgar",
      documentUrl: report.url,
      accessionNumber: report.accessionNumber,
      documentAcceptedAt: report.acceptedAt,
      sha256: dependencies.sha256(extract.text),
      byteLength: extract.byteLength,
      truncated: extract.truncated,
      excerpt: extract.text,
    },
  };
  if (request.apply) await dependencies.repository.record(stored);
  return { status: "asked", stored, ladder, written: request.apply };
}
