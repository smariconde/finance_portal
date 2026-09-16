import type { CompanyFactsSourceFailureCode } from "@/modules/fundamentals/application/company-facts-source";
import type { SecFilingRowRejection } from "@/modules/fundamentals/domain/parse-sec-submissions";

import type { SecFilerIndex } from "../domain/verify-succession-evidence";

/**
 * Puerto de la evidencia de una sucesión: el índice de presentaciones de los dos
 * filers. El orquestador recibe los índices ya parseados y la verificación vive
 * en el dominio, así que probar la regla no exige red.
 */
export type SuccessionEvidenceDocument = {
  readonly kind: "submissions" | "submissions_history";
  readonly cik: string;
  /** Origen y path, sin query (`TM-02`). */
  readonly url: string;
  readonly fetchedAt: string;
  readonly byteLength: number;
  readonly parserVersion: string;
};

export type SecFilerDownload = SecFilerIndex & {
  readonly filingRejections: readonly SecFilingRowRejection[];
  /** Descarga del índice reciente: desde cuándo esta instalación conoce al filer. */
  readonly fetchedAt: string;
};

export type SuccessionEvidenceDownload = {
  readonly successor: SecFilerDownload;
  readonly predecessor: SecFilerDownload;
  readonly documents: readonly SuccessionEvidenceDocument[];
};

export type SuccessionEvidenceRequest = {
  readonly predecessorCik: string;
  readonly successorCik: string;
  readonly successionAccession: string;
};

/**
 * Fallo de la fuente, con los mismos códigos cerrados que companyfacts: los dos
 * leen los mismos documentos de la SEC por el mismo egress.
 */
export class SuccessionEvidenceSourceError extends Error {
  readonly code: CompanyFactsSourceFailureCode;
  readonly document: SuccessionEvidenceDocument["kind"];
  readonly retryable: boolean;

  constructor(
    code: CompanyFactsSourceFailureCode,
    document: SuccessionEvidenceDocument["kind"],
    options: { readonly retryable?: boolean; readonly detail?: string } = {},
  ) {
    super(
      options.detail === undefined
        ? `SEC ${document} failed with ${code}.`
        : `SEC ${document} failed with ${code}: ${options.detail}.`,
    );
    this.name = "SuccessionEvidenceSourceError";
    this.code = code;
    this.document = document;
    this.retryable = options.retryable ?? false;
  }
}

export interface SuccessionEvidenceSource {
  load(request: SuccessionEvidenceRequest): Promise<SuccessionEvidenceDownload>;
}
