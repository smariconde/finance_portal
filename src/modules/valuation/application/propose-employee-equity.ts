import type { LadderResult } from "@/modules/ai/application/run-model-ladder";
import type { AiTask } from "@/modules/ai/domain/ai-task";
import { assertAiTransferable } from "@/modules/ai/domain/ai-transfer";
import { AI_MODEL_LADDER_VERSION } from "@/modules/ai/domain/model-ladder";
import { isTransientAiAnswer } from "@/modules/ai/domain/task-answer";
import type { SecReportedFact } from "@/modules/fundamentals/domain/parse-sec-company-facts";
import {
  extractEquityCompensation,
  SEC_10K_EQUITY_COMPENSATION_VERSION,
} from "@/modules/fundamentals/domain/sec-10k-equity-compensation";
import {
  locateLatestAnnualReport,
  type SecAnnualReport,
} from "@/modules/fundamentals/domain/sec-annual-report";
import type { SourceRegistryEntry } from "@/modules/ingestion/domain/source-registry-entry";
import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";

import type { EmployeeEquityProposal } from "../domain/employee-equity";
import {
  EMPLOYEE_EQUITY_POLICY_VERSION,
  EMPLOYEE_EQUITY_PROMPT_VERSION,
  EMPLOYEE_EQUITY_TASK,
  type EmployeeEquityInput,
  type EmployeeEquityOutput,
} from "../domain/employee-equity-task";

import type {
  EmployeeEquityRepository,
  StoredEmployeeEquity,
} from "./employee-equity-repository";

/**
 * Transcribe las opciones y unidades de empleados de una empresa (`F4-05`,
 * [ADR 0040](../../../../docs/architecture/adr/0040-failure-probability-employee-options.md),
 * decisión 5).
 *
 * Antes de gastar comprueba que haga falta: hay un 10-K al corte con su nota
 * de compensación en acciones, y no se preguntó ya por el mismo 10-K con la
 * misma tarea, prompt y policy —salvo que se pida de nuevo—. Corrobora con el
 * XBRL **del mismo 10-K** al cierre: el texto y los hechos describen la misma
 * presentación, así que no hace falta razonar sobre otra disponibilidad.
 *
 * Toda respuesta se guarda con `apply`, también la abstención. Un dry run
 * llama al modelo y no escribe: como cualquier dry run de este proyecto, gasta.
 */
export const SEC_SOURCE_ID = "sec-edgar";

export const OPTIONS_OUTSTANDING_CONCEPT = Object.freeze({
  taxonomy: "us-gaap",
  concept:
    "ShareBasedCompensationArrangementByShareBasedPaymentAwardOptionsOutstandingNumber",
});

export const OPTIONS_WEIGHTED_STRIKE_CONCEPT = Object.freeze({
  taxonomy: "us-gaap",
  concept:
    "ShareBasedCompensationArrangementByShareBasedPaymentAwardOptionsOutstandingWeightedAverageExercisePrice",
});

export type ProposeEmployeeEquityRequest = {
  readonly legalEntityId: string;
  readonly cik: string;
  readonly companyName: string;
  /** CIK donde buscar el 10-K: el vigente y después los antecesores del linaje. */
  readonly annualReportCiks: readonly string[];
  readonly query: PointInTimeQuery;
  readonly apply: boolean;
  readonly again: boolean;
};

export type ProposeEmployeeEquityDependencies = {
  readonly loadSubmissions: (cik: string) => Promise<unknown>;
  readonly loadAnnualReport: (report: SecAnnualReport) => Promise<string>;
  /** Los hechos de un concepto del filer; `[]` si nunca lo etiquetó. */
  readonly loadConceptFacts: (
    cik: string,
    concept: { readonly taxonomy: string; readonly concept: string },
  ) => Promise<readonly SecReportedFact[]>;
  readonly registry: readonly SourceRegistryEntry[];
  readonly runLadder: (
    task: AiTask<EmployeeEquityInput, EmployeeEquityOutput>,
    input: EmployeeEquityInput,
  ) => Promise<LadderResult<EmployeeEquityOutput>>;
  readonly repository: EmployeeEquityRepository;
  readonly now: () => string;
  readonly sha256: (text: string) => string;
};

export type EmployeeEquitySkipReason =
  | "no_annual_report"
  | "report_date_unknown"
  | "already_asked"
  | "equity_note_not_found";

export type ProposeEmployeeEquityResult =
  | {
      readonly status: "skipped";
      readonly reason: EmployeeEquitySkipReason;
      readonly annualReport: SecAnnualReport | null;
      readonly previous: StoredEmployeeEquity | null;
    }
  | {
      readonly status: "asked";
      readonly stored: StoredEmployeeEquity;
      readonly ladder: LadderResult<EmployeeEquityOutput>;
      readonly annualReport: SecAnnualReport;
      readonly written: boolean;
    };

/**
 * El valor del concepto que el propio 10-K publica al cierre, sin
 * dimensiones; `null` si no lo publica. Dos valores distintos para el mismo
 * cierre en la misma presentación no se eligen: es `null`, y la policy no
 * corrobora con un número dudoso.
 */
export function xbrlValueAtYearEnd(
  facts: readonly SecReportedFact[],
  report: SecAnnualReport,
  unit: string,
): string | null {
  const values = new Set(
    facts
      .filter(
        (fact) =>
          fact.accessionNumber === report.accessionNumber &&
          fact.end === report.reportDate &&
          fact.unit === unit,
      )
      .map((fact) => fact.value),
  );

  return values.size === 1 ? [...values][0]! : null;
}

export async function proposeEmployeeEquity(
  request: ProposeEmployeeEquityRequest,
  dependencies: ProposeEmployeeEquityDependencies,
): Promise<ProposeEmployeeEquityResult> {
  const skip = (
    reason: EmployeeEquitySkipReason,
    annualReport: SecAnnualReport | null = null,
    previous: StoredEmployeeEquity | null = null,
  ): ProposeEmployeeEquityResult => ({
    status: "skipped",
    reason,
    annualReport,
    previous,
  });

  let annualReport: SecAnnualReport | null = null;
  let reportCik: string | null = null;

  for (const cik of request.annualReportCiks) {
    const located = locateLatestAnnualReport(
      await dependencies.loadSubmissions(cik),
      cik,
      request.query.knownAt ?? dependencies.now(),
    );

    if (located.status === "found") {
      annualReport = located.report;
      reportCik = cik;
      break;
    }
  }

  if (annualReport === null || reportCik === null) {
    return skip("no_annual_report");
  }
  if (annualReport.reportDate === null) {
    return skip("report_date_unknown", annualReport);
  }

  const fiscalYearEnd = annualReport.reportDate;
  const previous = await dependencies.repository.latestForSubject(
    request.legalEntityId,
  );

  if (
    !request.again &&
    previous !== null &&
    !isTransientAiAnswer(previous.proposal) &&
    previous.proposal.accessionNumber === annualReport.accessionNumber &&
    previous.proposal.taskVersion === EMPLOYEE_EQUITY_TASK.taskVersion &&
    previous.proposal.promptVersion === EMPLOYEE_EQUITY_PROMPT_VERSION &&
    previous.proposal.policyVersion === EMPLOYEE_EQUITY_POLICY_VERSION
  ) {
    return skip("already_asked", annualReport, previous);
  }

  const extract = extractEquityCompensation(
    await dependencies.loadAnnualReport(annualReport),
  );

  if (extract === null) return skip("equity_note_not_found", annualReport);

  // Antes de reservar nada: la evidencia tiene que poder viajar a un modelo.
  assertAiTransferable([SEC_SOURCE_ID], dependencies.registry);

  const [countFacts, strikeFacts] = await Promise.all([
    dependencies.loadConceptFacts(reportCik, OPTIONS_OUTSTANDING_CONCEPT),
    dependencies.loadConceptFacts(reportCik, OPTIONS_WEIGHTED_STRIKE_CONCEPT),
  ]);
  const xbrl = {
    optionsOutstanding: xbrlValueAtYearEnd(countFacts, annualReport, "shares"),
    weightedStrike: xbrlValueAtYearEnd(strikeFacts, annualReport, "USD/shares"),
  };

  const ladder = await dependencies.runLadder(EMPLOYEE_EQUITY_TASK, {
    companyName: request.companyName,
    fiscalYearEnd,
    evidence: { sourceId: SEC_SOURCE_ID, text: extract.section.text },
    xbrl,
  });

  const proposedAt = dependencies.now();
  const accepted = ladder.outcome === "accepted";
  const proposal: EmployeeEquityProposal = {
    proposalId: ladder.taskRunId,
    legalEntityId: request.legalEntityId,
    cik: request.cik,
    accessionNumber: annualReport.accessionNumber,
    fiscalYearEnd,
    taskVersion: EMPLOYEE_EQUITY_TASK.taskVersion,
    promptVersion: EMPLOYEE_EQUITY_PROMPT_VERSION,
    policyVersion: EMPLOYEE_EQUITY_POLICY_VERSION,
    ladderVersion: AI_MODEL_LADDER_VERSION,
    extractVersion: SEC_10K_EQUITY_COMPENSATION_VERSION,
    xbrlOptionsOutstanding: xbrl.optionsOutstanding,
    xbrlWeightedStrike: xbrl.weightedStrike,
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
  };
  const stored: StoredEmployeeEquity = {
    proposal,
    evidence: {
      sourceId: SEC_SOURCE_ID,
      documentUrl: annualReport.url,
      accessionNumber: annualReport.accessionNumber,
      documentAcceptedAt: annualReport.acceptedAt,
      sha256: dependencies.sha256(extract.section.text),
      byteLength: extract.section.byteLength,
      truncated: extract.section.truncated,
      excerpt: extract.section.text,
    },
  };

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
