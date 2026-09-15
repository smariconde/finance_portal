import type { CompanyFactsSourceFailureCode } from "@/modules/fundamentals/application/company-facts-source";
import type { CompanyTickerAssignment } from "@/modules/universe/domain/universe-source-records";

import type { SecListingIndex } from "../domain/parse-sec-listing-index";

/**
 * Puerto de la evidencia de eventos de listing: la tabla vigente de tickers de la
 * SEC —que dice qué divergió— y el índice de presentaciones de cada filer —que
 * dice qué pasó y cuándo—. Los documentos llegan parseados y la regla vive en el
 * dominio, así que probarla no exige red.
 */
export type ListingEvidenceDocument = {
  readonly kind: "company_tickers" | "submissions";
  readonly cik: string | null;
  /** Origen y path, sin query (`TM-02`). */
  readonly url: string;
  readonly fetchedAt: string;
  readonly byteLength: number;
  readonly parserVersion: string;
};

export class ListingEvidenceSourceError extends Error {
  readonly code: CompanyFactsSourceFailureCode;
  readonly document: ListingEvidenceDocument["kind"];
  readonly retryable: boolean;

  constructor(
    code: CompanyFactsSourceFailureCode,
    document: ListingEvidenceDocument["kind"],
    options: { readonly retryable?: boolean; readonly detail?: string } = {},
  ) {
    super(
      options.detail === undefined
        ? `SEC ${document} failed with ${code}.`
        : `SEC ${document} failed with ${code}: ${options.detail}.`,
    );
    this.name = "ListingEvidenceSourceError";
    this.code = code;
    this.document = document;
    this.retryable = options.retryable ?? false;
  }
}

export interface ListingEvidenceSource {
  loadAssignments(): Promise<{
    readonly assignments: readonly CompanyTickerAssignment[];
    readonly document: ListingEvidenceDocument;
  }>;
  loadIndex(cik: string): Promise<{
    readonly index: SecListingIndex;
    readonly document: ListingEvidenceDocument;
  }>;
}
