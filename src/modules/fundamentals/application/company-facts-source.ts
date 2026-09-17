import type {
  SecCompanyFactsCounts,
  SecFactRowRejection,
  SecReportedFact,
} from "../domain/parse-sec-company-facts";
import type {
  SecFiling,
  SecFilingRowRejection,
} from "../domain/parse-sec-submissions";
import type {
  SecHistoryWindow,
  SecHistoryWindowSelection,
} from "../domain/sec-history-window";

/**
 * Puerto de la fuente de hechos XBRL de un filer.
 *
 * El orquestador recibe los documentos ya parseados, igual que el universo: la
 * regla de vintages vive en el dominio y probarla no exige red. Este puerto es
 * de dónde salen, y su implementación viva es el único lugar donde los
 * fundamentales tocan la red.
 */
export type CompanyFactsDocumentKind =
  "submissions" | "submissions_history" | "companyfacts";

export type CompanyFactsDocument = {
  readonly kind: CompanyFactsDocumentKind;
  /** Origen y path, sin query (`TM-02`). */
  readonly url: string;
  readonly fetchedAt: string;
  readonly byteLength: number;
  readonly parserVersion: string;
};

export type CompanyFactsDownload =
  | {
      readonly status: "downloaded";
      readonly cik: string;
      readonly filings: readonly SecFiling[];
      readonly filingRejections: readonly SecFilingRowRejection[];
      /** Hechos seleccionados **dentro de la ventana** de historia. */
      readonly facts: readonly SecReportedFact[];
      readonly factRejections: readonly SecFactRowRejection[];
      readonly counts: SecCompanyFactsCounts;
      /** Ventana aplicada (ADR 0017); `null` si no hubo hechos seleccionados. */
      readonly window: SecHistoryWindow | null;
      readonly windowCounts: SecHistoryWindowSelection["counts"];
      /** Descarga de companyfacts: el documento del que salen los valores. */
      readonly fetchedAt: string;
      readonly documents: readonly CompanyFactsDocument[];
    }
  | {
      /** La SEC no tiene hechos XBRL para ese CIK: no es un fallo ni un vacío roto. */
      readonly status: "no_company_facts";
      readonly cik: string;
      readonly fetchedAt: string;
      readonly documents: readonly CompanyFactsDocument[];
    };

export type CompanyFactsSourceFailureCode =
  /** El egress falló o fue bloqueado. */
  | "fetch_failed"
  /** La fuente respondió algo que no es el documento. */
  | "unexpected_status"
  /** El documento no tiene la forma que el parser declara entender. */
  | "payload_schema_invalid"
  /** El documento describe a otro filer que el pedido. */
  | "subject_mismatch"
  /** Harían falta más archivos históricos que el techo por empresa. */
  | "history_budget_exceeded";

/**
 * Fallo de la fuente. Conserva un código cerrado, el documento que falló y si
 * reintentar tiene sentido; el detalle nunca incluye el payload ni la query.
 */
export class CompanyFactsSourceError extends Error {
  readonly code: CompanyFactsSourceFailureCode;
  readonly document: CompanyFactsDocumentKind;
  readonly retryable: boolean;

  constructor(
    code: CompanyFactsSourceFailureCode,
    document: CompanyFactsDocumentKind,
    options: { readonly retryable?: boolean; readonly detail?: string } = {},
  ) {
    super(
      options.detail === undefined
        ? `SEC ${document} failed with ${code}.`
        : `SEC ${document} failed with ${code}: ${options.detail}.`,
    );
    this.name = "CompanyFactsSourceError";
    this.code = code;
    this.document = document;
    this.retryable = options.retryable ?? false;
  }
}

export interface CompanyFactsSource {
  load(cik: string): Promise<CompanyFactsDownload>;
}
