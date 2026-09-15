import type { SecFiling } from "@/modules/fundamentals/domain/parse-sec-submissions";
import {
  indexSecFilings,
  resolveSecAvailability,
} from "@/modules/fundamentals/domain/sec-fact-rules";

import {
  SUCCESSION_EVIDENCE_RULE_VERSION,
  type DeclaredSuccession,
} from "./reporting-succession";

/**
 * Verificación de una sucesión declarada contra el índice de presentaciones de
 * los dos filers.
 *
 * Las reglas salen del cable medido el 2026-09-14 sobre ExxonMobil (CIK 34088 →
 * 2115436), no de la documentación:
 *
 * - la presentación citada existe en el índice del **sucesor**, es un `8-K12B` o
 *   un `8-K12G3` y tiene aceptación publicada: su `available_at` es esa aceptación
 *   y no se infiere de la fecha de filing;
 * - la vigencia es la fecha del evento que declara (`reportDate`); si falta, no se
 *   supone la fecha de filing;
 * - el sucesor **no** tiene reportes periódicos aceptados antes de la sucesión. Lo
 *   que sí puede tener son reportes **de períodos** anteriores: el 10-Q del
 *   segundo trimestre de 2026 cerró el 30 de junio, se aceptó el 3 de agosto y sus
 *   hechos están sólo en el `companyfacts` del sucesor. Un CIK con reportes propios
 *   previos no es un sucesor recién creado, y unir su historia la duplicaría;
 * - el antecesor presentó al menos un reporte periódico antes de la sucesión: si
 *   no, no hay historia que unir y la declaración probablemente nombra otro CIK.
 *
 * Que el antecesor siga figurando después —co-registrante del 10-Q conjunto,
 * emisor de deuda— no es un rechazo: la partición del linaje ya lo excluye, y si
 * reporta un período posterior a la vigencia queda marcado.
 */
const SUCCESSION_FORMS: ReadonlySet<string> = new Set(
  ["8-K12B", "8-K12G3"].flatMap((form) => [form, `${form}/A`]),
);

const PERIODIC_FORMS: ReadonlySet<string> = new Set(
  ["10-K", "10-Q", "10-KT", "10-QT", "20-F", "40-F"].flatMap((form) => [
    form,
    `${form}/A`,
  ]),
);

/** Presentación con la que un sucesor asume el registro del antecesor. */
export function isSuccessionForm(form: string): boolean {
  return SUCCESSION_FORMS.has(form);
}

/** Reporte periódico con estados financieros. */
export function isPeriodicReportForm(form: string): boolean {
  return PERIODIC_FORMS.has(form);
}

export const PREDECESSOR_REPORTS_AFTER_SUCCESSION_FLAG =
  "predecessor_reports_after_succession";

export type SecFilerIndex = {
  readonly cik: string;
  readonly entityName: string | null;
  readonly filings: readonly SecFiling[];
};

export type SuccessionEvidenceRejectionCode =
  /** El índice descargado es de otro CIK que el declarado. */
  | "subject_mismatch"
  | "evidence_filing_not_found"
  /** Dos filas describen la misma accession de forma distinta. */
  | "evidence_filing_conflicting"
  | "evidence_form_not_succession"
  | "evidence_not_accepted"
  | "effective_date_missing"
  /** La fecha del evento es posterior a la fecha de filing que la declara. */
  | "effective_date_after_filing"
  | "successor_reported_before_succession"
  | "predecessor_without_periodic_reports"
  | "predecessor_name_missing";

export type VerifiedSuccessionEvidence = {
  readonly ruleVersion: string;
  readonly predecessorCik: string;
  readonly successorCik: string;
  readonly predecessorName: string;
  readonly successorName: string | null;
  readonly successionFiling: {
    readonly accessionNumber: string;
    readonly form: string;
    readonly filingDate: string;
    readonly acceptedAt: string;
  };
  readonly effectiveOn: string;
  readonly availableAt: string;
  /** Último reporte periódico del antecesor conocible antes de la sucesión. */
  readonly lastPredecessorReport: {
    readonly accessionNumber: string;
    readonly form: string;
    readonly reportDate: string | null;
  };
  readonly qualityFlags: readonly string[];
};

export type SuccessionEvidenceResult =
  | { readonly ok: true; readonly evidence: VerifiedSuccessionEvidence }
  | {
      readonly ok: false;
      readonly ruleVersion: string;
      readonly code: SuccessionEvidenceRejectionCode;
    };

function reject(
  code: SuccessionEvidenceRejectionCode,
): SuccessionEvidenceResult {
  return { ok: false, ruleVersion: SUCCESSION_EVIDENCE_RULE_VERSION, code };
}

/**
 * Instante desde el que una presentación era conocible, con la regla de la
 * ADR 0010. Una fila sin fecha defendible no cuenta como reporte previo ni
 * posterior: no se la ubica en el tiempo.
 */
function knowableAt(filing: SecFiling): number | null {
  const availability = resolveSecAvailability(filing);

  return availability === null ? null : Date.parse(availability.availableAt);
}

export function verifySuccessionEvidence(input: {
  readonly declaration: DeclaredSuccession;
  readonly successor: SecFilerIndex;
  readonly predecessor: SecFilerIndex;
}): SuccessionEvidenceResult {
  const { declaration, successor, predecessor } = input;

  if (
    successor.cik !== declaration.successorCik ||
    predecessor.cik !== declaration.predecessorCik
  ) {
    return reject("subject_mismatch");
  }

  const successorIndex = indexSecFilings(successor.filings);

  if (successorIndex.conflicting.has(declaration.successionAccession)) {
    return reject("evidence_filing_conflicting");
  }

  const filing = successorIndex.byAccession.get(
    declaration.successionAccession,
  );

  if (filing === undefined) {
    return reject("evidence_filing_not_found");
  }

  if (!SUCCESSION_FORMS.has(filing.form)) {
    return reject("evidence_form_not_succession");
  }

  if (filing.acceptedAt === null) {
    return reject("evidence_not_accepted");
  }

  if (filing.reportDate === null) {
    return reject("effective_date_missing");
  }

  if (filing.reportDate > filing.filingDate) {
    return reject("effective_date_after_filing");
  }

  const successionMs = Date.parse(filing.acceptedAt);

  const successorPriorReport = [...successorIndex.byAccession.values()].find(
    (candidate) => {
      if (!PERIODIC_FORMS.has(candidate.form)) {
        return false;
      }

      const at = knowableAt(candidate);

      return at !== null && at < successionMs;
    },
  );

  if (successorPriorReport !== undefined) {
    return reject("successor_reported_before_succession");
  }

  const predecessorReports = [
    ...indexSecFilings(predecessor.filings).byAccession.values(),
  ].filter((candidate) => PERIODIC_FORMS.has(candidate.form));

  const priorReports = predecessorReports
    .map((candidate) => ({ candidate, at: knowableAt(candidate) }))
    .filter(
      (entry): entry is { candidate: SecFiling; at: number } =>
        entry.at !== null && entry.at <= successionMs,
    )
    .sort(
      (left, right) =>
        right.at - left.at ||
        right.candidate.accessionNumber.localeCompare(
          left.candidate.accessionNumber,
        ),
    );

  const lastReport = priorReports[0]?.candidate;

  if (lastReport === undefined) {
    return reject("predecessor_without_periodic_reports");
  }

  if (predecessor.entityName === null) {
    return reject("predecessor_name_missing");
  }

  const effectiveOn = filing.reportDate;
  const qualityFlags = predecessorReports.some(
    (candidate) =>
      candidate.reportDate !== null && candidate.reportDate >= effectiveOn,
  )
    ? [PREDECESSOR_REPORTS_AFTER_SUCCESSION_FLAG]
    : [];

  return {
    ok: true,
    evidence: {
      ruleVersion: SUCCESSION_EVIDENCE_RULE_VERSION,
      predecessorCik: declaration.predecessorCik,
      successorCik: declaration.successorCik,
      predecessorName: predecessor.entityName,
      successorName: successor.entityName,
      successionFiling: {
        accessionNumber: filing.accessionNumber,
        form: filing.form,
        filingDate: filing.filingDate,
        acceptedAt: new Date(successionMs).toISOString(),
      },
      effectiveOn,
      availableAt: new Date(successionMs).toISOString(),
      lastPredecessorReport: {
        accessionNumber: lastReport.accessionNumber,
        form: lastReport.form,
        reportDate: lastReport.reportDate,
      },
      qualityFlags,
    },
  };
}
