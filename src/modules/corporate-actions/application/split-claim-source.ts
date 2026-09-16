import type { CompanyFactsSourceFailureCode } from "@/modules/fundamentals/application/company-facts-source";
import type {
  SecFactRowRejection,
  SecReportedFact,
} from "@/modules/fundamentals/domain/parse-sec-company-facts";

/**
 * Puerto de la primera evidencia de un split: los ratios que un filer declaró.
 *
 * La segunda evidencia —la re-expresión— no sale de acá: ya está publicada como
 * observaciones del filer, así que verificar un split no vuelve a descargar
 * `companyfacts`. Lo único que falta es el concepto de ratio, que la selección de
 * ingesta no incluye, y `companyconcept` lo sirve en un documento de pocos KB.
 */
export type SplitClaimDocument = {
  readonly kind: "companyconcept";
  readonly cik: string;
  /** Origen y path, sin query (`TM-02`). */
  readonly url: string;
  readonly fetchedAt: string;
  readonly byteLength: number;
  readonly parserVersion: string;
};

export type SplitClaimDownload =
  | {
      readonly status: "claims";
      readonly cik: string;
      readonly claims: readonly SecReportedFact[];
      readonly rejections: readonly SecFactRowRejection[];
      readonly points: number;
      readonly fetchedAt: string;
      readonly documents: readonly SplitClaimDocument[];
    }
  | {
      /** El filer nunca etiquetó el concepto: la SEC responde `404`. */
      readonly status: "no_claims";
      readonly cik: string;
      readonly fetchedAt: string;
      readonly documents: readonly SplitClaimDocument[];
    };

/** Mismos códigos cerrados que companyfacts: la misma fuente por el mismo egress. */
export class SplitClaimSourceError extends Error {
  readonly code: CompanyFactsSourceFailureCode;
  readonly retryable: boolean;

  constructor(
    code: CompanyFactsSourceFailureCode,
    options: { readonly retryable?: boolean; readonly detail?: string } = {},
  ) {
    super(
      options.detail === undefined
        ? `SEC companyconcept failed with ${code}.`
        : `SEC companyconcept failed with ${code}: ${options.detail}.`,
    );
    this.name = "SplitClaimSourceError";
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

export interface SplitClaimSource {
  load(request: { readonly cik: string }): Promise<SplitClaimDownload>;
}
