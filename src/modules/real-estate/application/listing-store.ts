import type { CaptureOutcome } from "../domain/capture-request";
import type {
  ListingCapture,
  RealEstatePortal,
} from "../domain/listing-capture";
import type {
  ListingRevision,
  StoredListing,
} from "../domain/listing-revisions";

/**
 * Dónde viven los avisos (`re_listings`, `re_listing_revisions`). La regla de
 * cuándo hay revisión es del dominio (`planListingCapture`); una
 * implementación sólo carga el aviso con su última revisión bajo un lock,
 * aplica el plan y lo escribe en la misma transacción.
 */
export type ListingStore = {
  /** Aplica una captura ya validada. Idempotente: reenviarla es `out_of_order`. */
  readonly applyCapture: (
    capture: ListingCapture,
    recordedAt: string,
  ) => Promise<Exclude<CaptureOutcome, "rejected">>;
  /** El aviso con toda su cadena, de la primera revisión a la última. */
  readonly readListing: (
    source: RealEstatePortal,
    externalId: string,
  ) => Promise<StoredListingHistory | null>;
  /** Los avisos vistos más recientemente, con su última revisión. */
  readonly listRecent: (limit: number) => Promise<readonly StoredListing[]>;
};

export type StoredListingHistory = Omit<StoredListing, "latest"> & {
  readonly revisions: readonly ListingRevision[];
};
