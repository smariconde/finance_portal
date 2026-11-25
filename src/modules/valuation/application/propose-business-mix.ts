import type { LadderResult } from "@/modules/ai/application/run-model-ladder";
import type { AiTask } from "@/modules/ai/domain/ai-task";
import { assertAiTransferable } from "@/modules/ai/domain/ai-transfer";
import { AI_MODEL_LADDER_VERSION } from "@/modules/ai/domain/model-ladder";
import { isTransientAiAnswer } from "@/modules/ai/domain/task-answer";
import {
  buildAnnualReportUrl,
  locateLatestAnnualReport,
  type SecAnnualReport,
} from "@/modules/fundamentals/domain/sec-annual-report";
import {
  extractTenKSections,
  SEC_10K_SECTIONS_VERSION,
} from "@/modules/fundamentals/domain/sec-10k-sections";
import {
  businessLinesText,
  readBusinessLines,
  SEC_XBRL_BUSINESS_LINES_VERSION,
  type BusinessLines,
} from "@/modules/fundamentals/domain/sec-xbrl-business-lines";
import { readXbrlInstance } from "@/modules/fundamentals/domain/sec-xbrl-instance";
import type { SourceRegistryEntry } from "@/modules/ingestion/domain/source-registry-entry";
import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";

import type { AnnualFundamentals } from "../domain/annual-fundamentals";
import type {
  BusinessMixDeclaration,
  BusinessMixEvidenceRecord,
  BusinessMixLineRecord,
  BusinessMixProposal,
} from "../domain/business-mix";
import {
  BUSINESS_MIX_POLICY_VERSION,
  BUSINESS_MIX_PROMPT_VERSION,
  BUSINESS_MIX_TASK,
  type BusinessMixInput,
  type BusinessMixOutput,
} from "../domain/business-mix-task";
import { formatDecimal, parseDecimal } from "../domain/decimal-policy";

import type {
  BusinessMixRepository,
  StoredBusinessMix,
} from "./business-mix-repository";
import { instanceDocumentOf } from "./read-captive-finance-filing";
import { revenueForReport, type ReleaseKeys } from "./propose-operations-mix";

/**
 * Propone la mezcla de negocios de una empresa (`F6-48`,
 * [ADR 0086](../../../../docs/architecture/adr/0086-business-mix-beta.md),
 * decisiones 1 a 6).
 *
 * Antes de gastar comprueba que haga falta: el owner no la declaró, hay un 10-K
 * al corte, se conocen los ingresos de ese ejercicio, no se preguntó ya por el
 * mismo 10-K con la misma tarea, prompt y policy, y el instance XBRL publica un
 * eje con dos líneas o más. Recién entonces comprueba que la evidencia pueda
 * viajar a un modelo y corre la escalera.
 *
 * Toda respuesta se guarda con `apply`, también la abstención. Un dry run llama
 * al modelo y no escribe: como cualquier dry run de este proyecto, gasta.
 */
export const SEC_SOURCE_ID = "sec-edgar";

/** Los totales de la tabla de betas no son una industria. */
const NOT_AN_INDUSTRY = new Set([
  "total-market",
  "total-market-without-financials",
]);

export type ProposeBusinessMixRequest = {
  readonly legalEntityId: string;
  readonly cik: string;
  readonly companyName: string;
  /** CIK donde buscar el 10-K: el vigente y después los antecesores del linaje. */
  readonly annualReportCiks: readonly string[];
  readonly query: PointInTimeQuery;
  readonly declarations: readonly BusinessMixDeclaration[];
  readonly apply: boolean;
  readonly again: boolean;
};

export type ProposeBusinessMixDependencies = {
  readonly betasRelease: (
    query: PointInTimeQuery,
  ) => Promise<ReleaseKeys | null>;
  readonly annualFundamentals: (
    legalEntityId: string,
    query: PointInTimeQuery,
  ) => Promise<AnnualFundamentals | null>;
  readonly loadSubmissions: (cik: string) => Promise<unknown>;
  readonly loadAnnualReport: (report: SecAnnualReport) => Promise<string>;
  /** El instance XBRL del 10-K: un pedido SEC más, nunca se guarda. */
  readonly loadInstance: (url: string) => Promise<string>;
  readonly registry: readonly SourceRegistryEntry[];
  readonly runLadder: (
    task: AiTask<BusinessMixInput, BusinessMixOutput>,
    input: BusinessMixInput,
  ) => Promise<LadderResult<BusinessMixOutput>>;
  readonly repository: BusinessMixRepository;
  readonly now: () => string;
  readonly sha256: (text: string) => string;
};

export type BusinessMixSkipReason =
  | "declared_by_owner"
  | "betas_release_missing"
  | "no_annual_report"
  | "report_date_unknown"
  | "revenue_unknown"
  | "already_asked"
  | "instance_unavailable"
  | "no_business_lines"
  | "item_1_not_found";

export type ProposeBusinessMixResult =
  | {
      readonly status: "skipped";
      readonly reason: BusinessMixSkipReason;
      readonly annualReport: SecAnnualReport | null;
      /** Con `already_asked`: lo que se guardó la vez anterior. */
      readonly previous: StoredBusinessMix | null;
      /** Con `no_business_lines` en adelante: lo que publicó el XBRL. */
      readonly lines: BusinessLines | null;
    }
  | {
      readonly status: "asked";
      readonly stored: StoredBusinessMix;
      readonly ladder: LadderResult<BusinessMixOutput>;
      readonly annualReport: SecAnnualReport;
      readonly lines: BusinessLines;
      readonly written: boolean;
    };

/** Las líneas elegidas, con el monto del XBRL y la industria de la respuesta. */
function lineRecordsOf(
  output: BusinessMixOutput,
  offered: BusinessLines,
): BusinessMixLineRecord[] {
  const byId = new Map(offered.lines.map((line) => [line.lineId, line]));

  return output.lines.map((line, index) => {
    const source = byId.get(line.lineId);

    if (source === undefined) {
      throw new Error(`line ${line.lineId} was not offered`);
    }

    return {
      ordinal: index + 1,
      lineId: source.lineId,
      axis: source.axis,
      member: source.member,
      concept: source.concept,
      amount: formatDecimal(parseDecimal(source.amount, "amount"), "amount"),
      industryKey: line.industryKey,
      quote: line.quote,
      evidenceId: line.evidenceId,
    };
  });
}

export async function proposeBusinessMix(
  request: ProposeBusinessMixRequest,
  dependencies: ProposeBusinessMixDependencies,
): Promise<ProposeBusinessMixResult> {
  const { query } = request;
  const skip = (
    reason: BusinessMixSkipReason,
    annualReport: SecAnnualReport | null = null,
    previous: StoredBusinessMix | null = null,
    lines: BusinessLines | null = null,
  ): ProposeBusinessMixResult => ({
    status: "skipped",
    reason,
    annualReport,
    previous,
    lines,
  });

  if (
    request.declarations.some((declaration) => declaration.cik === request.cik)
  ) {
    return skip("declared_by_owner");
  }

  const betas = await dependencies.betasRelease(query);

  if (betas === null) return skip("betas_release_missing");

  let annualReport: SecAnnualReport | null = null;

  for (const cik of request.annualReportCiks) {
    const located = locateLatestAnnualReport(
      await dependencies.loadSubmissions(cik),
      cik,
      query.knownAt ?? dependencies.now(),
    );

    if (located.status === "found") {
      annualReport = located.report;
      break;
    }
  }

  if (annualReport === null) return skip("no_annual_report");
  if (annualReport.reportDate === null) {
    return skip("report_date_unknown", annualReport);
  }

  const revenue = revenueForReport(
    await dependencies.annualFundamentals(request.legalEntityId, query),
    annualReport.reportDate,
  );

  if (revenue === null) return skip("revenue_unknown", annualReport);

  const previous = await dependencies.repository.latestForSubject(
    request.legalEntityId,
  );

  if (
    !request.again &&
    previous !== null &&
    !isTransientAiAnswer(previous.proposal) &&
    previous.proposal.accessionNumber === annualReport.accessionNumber &&
    previous.proposal.taskVersion === BUSINESS_MIX_TASK.taskVersion &&
    previous.proposal.promptVersion === BUSINESS_MIX_PROMPT_VERSION &&
    previous.proposal.policyVersion === BUSINESS_MIX_POLICY_VERSION
  ) {
    return skip("already_asked", annualReport, previous);
  }

  const document = instanceDocumentOf(annualReport.primaryDocument);

  if (document === null) return skip("instance_unavailable", annualReport);

  const instanceUrl = buildAnnualReportUrl(
    annualReport.cik,
    annualReport.accessionNumber,
    document,
  );
  const instance = readXbrlInstance(
    await dependencies.loadInstance(instanceUrl),
  );

  if (instance.status !== "read") {
    return skip("instance_unavailable", annualReport);
  }

  const lines = readBusinessLines(instance.instance, {
    cik: annualReport.cik,
    fiscalYearEnd: annualReport.reportDate,
  });

  if (lines === null) return skip("no_business_lines", annualReport);

  const business = extractTenKSections(
    await dependencies.loadAnnualReport(annualReport),
  ).business;

  if (business === null) {
    return skip("item_1_not_found", annualReport, null, lines);
  }

  const linesText = businessLinesText(lines);
  const evidence: BusinessMixEvidenceRecord[] = [
    {
      evidenceId: "E1",
      sourceId: SEC_SOURCE_ID,
      section: "item_1_business",
      documentUrl: annualReport.url,
      accessionNumber: annualReport.accessionNumber,
      documentAcceptedAt: annualReport.acceptedAt,
      sha256: dependencies.sha256(business.text),
      byteLength: business.byteLength,
      truncated: business.truncated,
      excerpt: business.text,
    },
    {
      evidenceId: "E2",
      sourceId: SEC_SOURCE_ID,
      section: "xbrl_business_lines",
      documentUrl: instanceUrl,
      accessionNumber: annualReport.accessionNumber,
      documentAcceptedAt: annualReport.acceptedAt,
      sha256: dependencies.sha256(linesText),
      byteLength: new TextEncoder().encode(linesText).byteLength,
      truncated: false,
      excerpt: linesText,
    },
  ];

  // Antes de reservar nada: cada pieza tiene que poder viajar a un modelo.
  assertAiTransferable(
    evidence.map((item) => item.sourceId),
    dependencies.registry,
  );

  const ladder = await dependencies.runLadder(BUSINESS_MIX_TASK, {
    companyName: request.companyName,
    industryKeys: betas.keys.filter((key) => !NOT_AN_INDUSTRY.has(key)),
    lines: lines.lines,
    evidence: evidence.map((item) => ({
      evidenceId: item.evidenceId,
      sourceId: item.sourceId,
      section: item.section,
      text: item.excerpt,
    })),
    expectedRevenue: revenue.value,
  });

  const proposedAt = dependencies.now();
  const accepted = ladder.outcome === "accepted" ? ladder : null;
  const proposal: BusinessMixProposal = {
    proposalId: ladder.taskRunId,
    legalEntityId: request.legalEntityId,
    cik: request.cik,
    accessionNumber: annualReport.accessionNumber,
    fiscalYearEnd: revenue.fiscalYearEnd,
    taskVersion: BUSINESS_MIX_TASK.taskVersion,
    promptVersion: BUSINESS_MIX_PROMPT_VERSION,
    policyVersion: BUSINESS_MIX_POLICY_VERSION,
    ladderVersion: AI_MODEL_LADDER_VERSION,
    linesVersion: SEC_XBRL_BUSINESS_LINES_VERSION,
    sectionsVersion: SEC_10K_SECTIONS_VERSION,
    betasReleaseId: betas.releaseId,
    outcome:
      ladder.outcome === "accepted"
        ? "accepted"
        : ladder.outcome === "abstained"
          ? "abstained"
          : "stopped",
    axis: accepted?.output.axis ?? null,
    expectedRevenue: revenue.value,
    confidence: accepted?.output.confidence ?? null,
    rationale: accepted?.output.rationale ?? null,
    reason:
      ladder.outcome === "accepted"
        ? null
        : ladder.outcome === "abstained"
          ? ladder.reason
          : ladder.code,
    acceptedRung: accepted?.rung ?? null,
    respondedModel: accepted?.model ?? null,
    proposedAt,
    recordedAt: proposedAt,
  };
  const stored: StoredBusinessMix = {
    proposal,
    lines: accepted === null ? [] : lineRecordsOf(accepted.output, lines),
    evidence,
  };

  if (request.apply) {
    await dependencies.repository.record(stored);
  }

  return {
    status: "asked",
    stored,
    ladder,
    annualReport,
    lines,
    written: request.apply,
  };
}
