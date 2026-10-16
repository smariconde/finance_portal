import { assertAiTransferable } from "@/modules/ai/domain/ai-transfer";
import type { LadderResult } from "@/modules/ai/application/run-model-ladder";
import type { AiTask } from "@/modules/ai/domain/ai-task";
import { AI_MODEL_LADDER_VERSION } from "@/modules/ai/domain/model-ladder";
import {
  locateLatestAnnualReport,
  type SecAnnualReport,
} from "@/modules/fundamentals/domain/sec-annual-report";
import {
  extractGeographicRevenue,
  SEC_10K_GEOGRAPHIC_REVENUE_VERSION,
} from "@/modules/fundamentals/domain/sec-10k-geographic-revenue";
import type { SourceRegistryEntry } from "@/modules/ingestion/domain/source-registry-entry";
import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";

import {
  FISCAL_YEAR_END_TOLERANCE_DAYS,
  type AnnualFundamentals,
} from "../domain/annual-fundamentals";
import {
  lineRecordsOf,
  type OperationsMixDeclaration,
  type OperationsMixEvidenceRecord,
  type OperationsMixLineRecord,
  type OperationsMixProposal,
} from "../domain/operations-mix";
import {
  OPERATIONS_MIX_POLICY_VERSION,
  OPERATIONS_MIX_PROMPT_VERSION,
  OPERATIONS_MIX_TASK,
  type OperationsMixInput,
  type OperationsMixOutput,
} from "../domain/operations-mix-task";

import type {
  OperationsMixRepository,
  StoredOperationsMix,
} from "./operations-mix-repository";

/**
 * Propone el mix de operaciones de una empresa (`F5-05`,
 * [ADR 0034](../../../../docs/architecture/adr/0034-operations-weighted-country-risk.md),
 * decisiones 3 a 7).
 *
 * Antes de gastar comprueba que haga falta: el owner no lo declaró, hay un 10-K
 * al corte con su tabla geográfica, se conocen los ingresos de ese ejercicio, y
 * no se preguntó ya por el mismo 10-K con la misma tarea, prompt y policy —a
 * menos que se pida de nuevo a propósito—. Recién entonces comprueba que la evidencia pueda viajar
 * a un modelo y corre la escalera.
 *
 * Toda respuesta se guarda con `apply`, también la abstención. Un dry run llama
 * al modelo y no escribe: como cualquier dry run de este proyecto, gasta.
 */
export const SEC_SOURCE_ID = "sec-edgar";

export type ReleaseKeys = {
  readonly releaseId: string;
  readonly keys: readonly string[];
};

export type ProposeOperationsMixRequest = {
  readonly legalEntityId: string;
  readonly cik: string;
  readonly companyName: string;
  /** CIK donde buscar el 10-K: el vigente y después los antecesores del linaje. */
  readonly annualReportCiks: readonly string[];
  readonly query: PointInTimeQuery;
  readonly declarations: readonly OperationsMixDeclaration[];
  readonly apply: boolean;
  readonly again: boolean;
};

export type ProposeOperationsMixDependencies = {
  readonly countryRelease: (
    query: PointInTimeQuery,
  ) => Promise<ReleaseKeys | null>;
  readonly regionRelease: (
    query: PointInTimeQuery,
  ) => Promise<ReleaseKeys | null>;
  readonly annualFundamentals: (
    legalEntityId: string,
    query: PointInTimeQuery,
  ) => Promise<AnnualFundamentals | null>;
  readonly loadSubmissions: (cik: string) => Promise<unknown>;
  readonly loadAnnualReport: (report: SecAnnualReport) => Promise<string>;
  readonly registry: readonly SourceRegistryEntry[];
  readonly runLadder: (
    task: AiTask<OperationsMixInput, OperationsMixOutput>,
    input: OperationsMixInput,
  ) => Promise<LadderResult<OperationsMixOutput>>;
  readonly repository: OperationsMixRepository;
  readonly now: () => string;
  readonly sha256: (text: string) => string;
};

export type OperationsMixSkipReason =
  | "declared_by_owner"
  | "country_release_missing"
  | "no_annual_report"
  | "report_date_unknown"
  | "revenue_unknown"
  | "already_asked"
  | "geographic_table_not_found";

export type ProposeOperationsMixResult =
  | {
      readonly status: "skipped";
      readonly reason: OperationsMixSkipReason;
      readonly annualReport: SecAnnualReport | null;
      /** Con `already_asked`: lo que se guardó la vez anterior. */
      readonly previous: StoredOperationsMix | null;
    }
  | {
      readonly status: "asked";
      readonly stored: StoredOperationsMix;
      readonly ladder: LadderResult<OperationsMixOutput>;
      readonly annualReport: SecAnnualReport;
      readonly written: boolean;
    };

function daysApart(left: string, right: string): number {
  return Math.abs(Date.parse(left) - Date.parse(right)) / 86_400_000;
}

/** Los ingresos del ejercicio que cierra el 10-K, en USD, o `null`. */
export function revenueForReport(
  series: AnnualFundamentals | null,
  reportDate: string,
): { readonly fiscalYearEnd: string; readonly value: string } | null {
  const year = series?.fiscalYears.find(
    (candidate) =>
      daysApart(candidate.fiscalYearEnd, reportDate) <=
      FISCAL_YEAR_END_TOLERANCE_DAYS,
  );
  const revenue = year?.items.revenue;

  if (
    year === undefined ||
    revenue === undefined ||
    revenue.currency !== "USD"
  ) {
    return null;
  }

  return { fiscalYearEnd: year.fiscalYearEnd, value: revenue.value };
}

export async function proposeOperationsMix(
  request: ProposeOperationsMixRequest,
  dependencies: ProposeOperationsMixDependencies,
): Promise<ProposeOperationsMixResult> {
  const { query } = request;
  const skip = (
    reason: OperationsMixSkipReason,
    annualReport: SecAnnualReport | null = null,
    previous: StoredOperationsMix | null = null,
  ): ProposeOperationsMixResult => ({
    status: "skipped",
    reason,
    annualReport,
    previous,
  });

  if (
    request.declarations.some((declaration) => declaration.cik === request.cik)
  ) {
    return skip("declared_by_owner");
  }

  const [countries, regions] = await Promise.all([
    dependencies.countryRelease(query),
    dependencies.regionRelease(query),
  ]);

  if (countries === null || regions === null) {
    return skip("country_release_missing");
  }

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
    previous.proposal.accessionNumber === annualReport.accessionNumber &&
    previous.proposal.taskVersion === OPERATIONS_MIX_TASK.taskVersion &&
    previous.proposal.promptVersion === OPERATIONS_MIX_PROMPT_VERSION &&
    previous.proposal.policyVersion === OPERATIONS_MIX_POLICY_VERSION
  ) {
    return skip("already_asked", annualReport, previous);
  }

  const extract = extractGeographicRevenue(
    await dependencies.loadAnnualReport(annualReport),
  );

  if (extract === null) {
    return skip("geographic_table_not_found", annualReport);
  }

  const evidence: OperationsMixEvidenceRecord[] = [
    {
      evidenceId: "E1",
      sourceId: SEC_SOURCE_ID,
      section: extract.section.section,
      documentUrl: annualReport.url,
      accessionNumber: annualReport.accessionNumber,
      documentAcceptedAt: annualReport.acceptedAt,
      sha256: dependencies.sha256(extract.section.text),
      byteLength: extract.section.byteLength,
      truncated: extract.section.truncated,
      excerpt: extract.section.text,
    },
  ];

  // Antes de reservar nada: cada pieza tiene que poder viajar a un modelo.
  assertAiTransferable(
    evidence.map((item) => item.sourceId),
    dependencies.registry,
  );

  const ladder = await dependencies.runLadder(OPERATIONS_MIX_TASK, {
    companyName: request.companyName,
    countryKeys: countries.keys,
    regionKeys: regions.keys,
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
  const lines: OperationsMixLineRecord[] =
    accepted === null ? [] : lineRecordsOf(accepted.output.lines);
  const proposal: OperationsMixProposal = {
    proposalId: ladder.taskRunId,
    legalEntityId: request.legalEntityId,
    cik: request.cik,
    accessionNumber: annualReport.accessionNumber,
    fiscalYearEnd: revenue.fiscalYearEnd,
    taskVersion: OPERATIONS_MIX_TASK.taskVersion,
    promptVersion: OPERATIONS_MIX_PROMPT_VERSION,
    policyVersion: OPERATIONS_MIX_POLICY_VERSION,
    ladderVersion: AI_MODEL_LADDER_VERSION,
    extractVersion: SEC_10K_GEOGRAPHIC_REVENUE_VERSION,
    countryReleaseId: countries.releaseId,
    regionReleaseId: regions.releaseId,
    outcome:
      ladder.outcome === "accepted"
        ? "accepted"
        : ladder.outcome === "abstained"
          ? "abstained"
          : "stopped",
    unit: accepted?.output.unit ?? null,
    printedTotal: accepted?.output.totalAmount ?? null,
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
  const stored: StoredOperationsMix = { proposal, lines, evidence };

  if (request.apply) {
    await dependencies.repository.record(stored);
  }

  return {
    status: "asked",
    stored,
    ladder,
    annualReport,
    written: request.apply,
  };
}
