import { assertAiTransferable } from "@/modules/ai/domain/ai-transfer";
import type { LadderResult } from "@/modules/ai/application/run-model-ladder";
import type { AiTask } from "@/modules/ai/domain/ai-task";
import { AI_MODEL_LADDER_VERSION } from "@/modules/ai/domain/model-ladder";
import {
  locateLatestAnnualReport,
  type SecAnnualReport,
} from "@/modules/fundamentals/domain/sec-annual-report";
import {
  extractTenKOutlook,
  SEC_10K_OUTLOOK_VERSION,
} from "@/modules/fundamentals/domain/sec-10k-outlook";
import type { SourceRegistryEntry } from "@/modules/ingestion/domain/source-registry-entry";
import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";

import type { AnnualFundamentals } from "../domain/annual-fundamentals";
import type {
  MarketExpectationsEvidenceRecord,
  MarketExpectationsRecord,
} from "../domain/market-expectations";
import {
  MARKET_EXPECTATIONS_POLICY_VERSION,
  MARKET_EXPECTATIONS_PROMPT_VERSION,
  MARKET_EXPECTATIONS_TASK,
  type MarketExpectationsInput,
  type MarketExpectationsOutput,
} from "../domain/market-expectations-task";

import type {
  MarketExpectationsRepository,
  StoredMarketExpectations,
} from "./market-expectations-repository";
import { revenueForReport, SEC_SOURCE_ID } from "./propose-operations-mix";

/**
 * Pide la lectura de expectativas de una empresa (`F6-11`,
 * [ADR 0050](../../../../docs/architecture/adr/0050-market-expectations-reading.md)).
 *
 * Antes de gastar comprueba que haga falta: hay un 10-K al corte, se conoce su
 * ejercicio en los fundamentals guardados, el 10-K tiene al menos el Item 1 o
 * el MD&A, y no se preguntó ya por el mismo 10-K con la misma tarea, prompt y
 * policy —a menos que se pida de nuevo a propósito—. Recién entonces comprueba
 * que la evidencia pueda viajar a un modelo y corre la escalera.
 *
 * Toda respuesta se guarda con `apply`, también la abstención. Un dry run
 * llama al modelo y no escribe: como cualquier dry run de este proyecto, gasta.
 */
export type ProposeMarketExpectationsRequest = {
  readonly legalEntityId: string;
  readonly cik: string;
  readonly companyName: string;
  /** CIK donde buscar el 10-K: el vigente y después los antecesores del linaje. */
  readonly annualReportCiks: readonly string[];
  readonly query: PointInTimeQuery;
  readonly apply: boolean;
  readonly again: boolean;
};

export type ProposeMarketExpectationsDependencies = {
  readonly annualFundamentals: (
    legalEntityId: string,
    query: PointInTimeQuery,
  ) => Promise<AnnualFundamentals | null>;
  readonly loadSubmissions: (cik: string) => Promise<unknown>;
  readonly loadAnnualReport: (report: SecAnnualReport) => Promise<string>;
  readonly registry: readonly SourceRegistryEntry[];
  readonly runLadder: (
    task: AiTask<MarketExpectationsInput, MarketExpectationsOutput>,
    input: MarketExpectationsInput,
  ) => Promise<LadderResult<MarketExpectationsOutput>>;
  readonly repository: MarketExpectationsRepository;
  readonly now: () => string;
  readonly sha256: (text: string) => string;
};

export type MarketExpectationsSkipReason =
  | "no_annual_report"
  | "report_date_unknown"
  | "fiscal_year_unknown"
  | "already_asked"
  | "outlook_sections_not_found";

export type ProposeMarketExpectationsResult =
  | {
      readonly status: "skipped";
      readonly reason: MarketExpectationsSkipReason;
      readonly annualReport: SecAnnualReport | null;
      /** Con `already_asked`: lo que se guardó la vez anterior. */
      readonly previous: StoredMarketExpectations | null;
    }
  | {
      readonly status: "asked";
      readonly stored: StoredMarketExpectations;
      readonly ladder: LadderResult<MarketExpectationsOutput>;
      readonly annualReport: SecAnnualReport;
      readonly written: boolean;
    };

export async function proposeMarketExpectations(
  request: ProposeMarketExpectationsRequest,
  dependencies: ProposeMarketExpectationsDependencies,
): Promise<ProposeMarketExpectationsResult> {
  const { query } = request;
  const skip = (
    reason: MarketExpectationsSkipReason,
    annualReport: SecAnnualReport | null = null,
    previous: StoredMarketExpectations | null = null,
  ): ProposeMarketExpectationsResult => ({
    status: "skipped",
    reason,
    annualReport,
    previous,
  });

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

  // El ejercicio del 10-K como lo fechan los fundamentals: es la clave con la
  // que una corrida de ese año base encuentra la lectura.
  const fiscalYear = revenueForReport(
    await dependencies.annualFundamentals(request.legalEntityId, query),
    annualReport.reportDate,
  );

  if (fiscalYear === null) return skip("fiscal_year_unknown", annualReport);

  const previous = await dependencies.repository.latestForSubject(
    request.legalEntityId,
  );

  if (
    !request.again &&
    previous !== null &&
    previous.record.accessionNumber === annualReport.accessionNumber &&
    previous.record.taskVersion === MARKET_EXPECTATIONS_TASK.taskVersion &&
    previous.record.promptVersion === MARKET_EXPECTATIONS_PROMPT_VERSION &&
    previous.record.policyVersion === MARKET_EXPECTATIONS_POLICY_VERSION
  ) {
    return skip("already_asked", annualReport, previous);
  }

  const outlook = extractTenKOutlook(
    await dependencies.loadAnnualReport(annualReport),
  );

  if (outlook.business === null && outlook.mdna === null) {
    return skip("outlook_sections_not_found", annualReport);
  }

  const report = annualReport;
  const evidence: MarketExpectationsEvidenceRecord[] = [
    outlook.business,
    outlook.mdna,
    outlook.risks,
  ]
    .filter((section) => section !== null)
    .map((section, index) => ({
      evidenceId: `E${index + 1}`,
      sourceId: SEC_SOURCE_ID,
      section: section.section,
      documentUrl: report.url,
      accessionNumber: report.accessionNumber,
      documentAcceptedAt: report.acceptedAt,
      sha256: dependencies.sha256(section.text),
      byteLength: section.byteLength,
      truncated: section.truncated,
      excerpt: section.text,
    }));

  // Antes de reservar nada: cada pieza tiene que poder viajar a un modelo.
  assertAiTransferable(
    evidence.map((item) => item.sourceId),
    dependencies.registry,
  );

  const ladder = await dependencies.runLadder(MARKET_EXPECTATIONS_TASK, {
    companyName: request.companyName,
    fiscalYearEnd: fiscalYear.fiscalYearEnd,
    evidence: evidence.map((item) => ({
      evidenceId: item.evidenceId,
      sourceId: item.sourceId,
      section: item.section,
      text: item.excerpt,
    })),
  });

  const proposedAt = dependencies.now();
  const accepted = ladder.outcome === "accepted" ? ladder : null;
  const record: MarketExpectationsRecord = {
    readingId: ladder.taskRunId,
    legalEntityId: request.legalEntityId,
    cik: request.cik,
    accessionNumber: report.accessionNumber,
    fiscalYearEnd: fiscalYear.fiscalYearEnd,
    taskVersion: MARKET_EXPECTATIONS_TASK.taskVersion,
    promptVersion: MARKET_EXPECTATIONS_PROMPT_VERSION,
    policyVersion: MARKET_EXPECTATIONS_POLICY_VERSION,
    ladderVersion: AI_MODEL_LADDER_VERSION,
    extractVersion: SEC_10K_OUTLOOK_VERSION,
    outcome:
      ladder.outcome === "accepted"
        ? "accepted"
        : ladder.outcome === "abstained"
          ? "abstained"
          : "stopped",
    reading:
      accepted === null
        ? null
        : {
            drivers: accepted.output.drivers,
            risks: accepted.output.risks,
            // La policy convierte `low` en abstención: acá sólo llegan dos.
            confidence:
              accepted.output.confidence === "high" ? "high" : "medium",
            rationale: accepted.output.rationale,
          },
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
  const stored: StoredMarketExpectations = { record, evidence };

  if (request.apply) {
    await dependencies.repository.record(stored);
  }

  return {
    status: "asked",
    stored,
    ladder,
    annualReport: report,
    written: request.apply,
  };
}
