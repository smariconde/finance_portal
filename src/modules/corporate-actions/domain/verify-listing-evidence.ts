import type { Venue } from "@/modules/universe/domain/venue-map";

import type {
  ListingDivergence,
  RecordedEntity,
  RecordedListing,
} from "./detect-listing-divergences";
import type {
  SecListingFiling,
  SecListingIndex,
} from "./parse-sec-listing-index";

/**
 * Evidencia fechada de un evento de listing en el índice de presentaciones del
 * filer (`sec-listing-evidence-1.0.0`, ADR 0013).
 *
 * Las reglas salen del cable medido el 2026-09-15, no de la documentación:
 *
 * - **traspaso de mercado** (Kraft Heinz de Nasdaq a NYSE; Fiserv de NYSE a
 *   Nasdaq, que además pasó de FI a FISV): el emisor presenta el `8-A12B` que
 *   registra la clase en el mercado nuevo y el `25` que la retira del viejo con
 *   minutos de diferencia, y el mercado nuevo presenta el `CERT` que certifica la
 *   admisión. Un `8-A12B` con su `CERT` y **sin** `25` es una emisión de deuda
 *   —los dos emisores lo hicieron—, así que las tres piezas son obligatorias;
 * - **delisting** (Hologic, Electronic Arts, AvalonBay): el mercado presenta el
 *   `25-NSE` y el emisor un 8-K con ítem 3.01 el mismo día, en cualquier orden.
 *   Un `25-NSE` sin 3.01 retira otra clase —Kraft Heinz tuvo uno en 2025 por
 *   deuda y sus acciones siguieron cotizando—, así que el aviso es obligatorio;
 * - **renombre** (Franklin Templeton, Vivmark): `formerNames` fecha el borde en
 *   que EDGAR dejó de usar el nombre anterior, y el nombre vigente del índice
 *   tiene que coincidir con el de la tabla;
 * - **cambio de ticker en el mismo mercado** (BK→BNY, MMC→MRSH, SATS→ECHO): el
 *   índice no deja ninguna presentación estructurada que lo feche. Se rechaza con
 *   nombre en vez de tomar la fecha de la corrida.
 *
 * El mercado que actuó sale del CIK de quien presentó, que el accession publica:
 * el `25-NSE` de un emisor listado en Nasdaq lo presenta Nasdaq.
 *
 * Toda pieza tiene que haberse aceptado **después** de la versión registrada. Una
 * evidencia anterior dice que lo registrado ya estaba desactualizado al
 * registrarse, y corregir un listing es otra regla que ningún caso real pidió.
 */
export const LISTING_EVIDENCE_RULE_VERSION = "sec-listing-evidence-1.0.0";

/**
 * CIK de EDGAR de cada mercado → MIC (`sec-exchange-filers-1.0.0`). Verificados el
 * 2026-09-15 contra el nombre que la SEC publica para cada CIK: `0001354457` es
 * «Nasdaq Stock Market LLC» y `0000876661` «NEW YORK STOCK EXCHANGE LLC». Un
 * mercado que no está acá no se ubica: su evidencia no se lee por descarte.
 */
export const SEC_EXCHANGE_FILERS_VERSION = "sec-exchange-filers-1.0.0";

const EXCHANGE_FILER_BY_MIC: ReadonlyMap<string, string> = new Map([
  ["XNAS", "0001354457"],
  ["XNYS", "0000876661"],
]);

export function exchangeFilerCik(mic: string): string | null {
  return EXCHANGE_FILER_BY_MIC.get(mic) ?? null;
}

/** Las tres piezas de un traspaso caen dentro de este margen entre sí. */
export const TRANSFER_EVIDENCE_SPAN_DAYS = 10;
/** El aviso 3.01 de un delisting cae dentro de este margen del `25-NSE`. */
export const DELISTING_NOTICE_WINDOW_DAYS = 3;
/** Hasta dónde se busca el aviso previo de un traspaso; su ausencia sólo marca. */
export const TRANSFER_NOTICE_LOOKBACK_DAYS = 90;

const DAY_MS = 86_400_000;

export type ListingCandidate =
  | ListingDivergence
  | {
      /** El owner pidió verificar una salida que la tabla todavía no muestra. */
      readonly kind: "check_requested";
      readonly cik: string;
      readonly legalEntityId: string;
      readonly listing: RecordedListing;
    };

export type ListingEvidenceRejectionCode =
  | "subject_mismatch"
  /** El índice reciente no alcanza la versión registrada y hay historia sin leer. */
  | "evidence_window_not_covered"
  /** Más de un listing del emisor en el mismo mercado: la evidencia no dice cuál. */
  | "ambiguous_listing"
  | "venue_without_exchange_filer"
  | "recorded_symbol_missing"
  | "transfer_withdrawal_not_found"
  | "transfer_registration_not_found"
  | "transfer_certification_not_found"
  | "delisting_strike_not_found"
  | "delisting_notice_not_found"
  | "symbol_change_without_dated_evidence"
  | "current_name_not_confirmed"
  | "former_name_not_found"
  | "former_name_after_download";

export type EvidenceFiling = Pick<
  SecListingFiling,
  "accessionNumber" | "form" | "filingDate" | "reportDate" | "submitterCik"
> & { readonly acceptedAt: string; readonly items: readonly string[] | null };

export type VerifiedListingChange =
  | {
      readonly kind: "listing_transfer";
      readonly cik: string;
      readonly legalEntityId: string;
      readonly listing: RecordedListing;
      readonly toVenue: Venue;
      readonly toSymbol: string;
      /** Instante en que la evidencia quedó completa: cierre, apertura y conocimiento. */
      readonly effectiveAt: string;
      readonly evidence: {
        readonly withdrawal: EvidenceFiling;
        readonly registration: EvidenceFiling;
        readonly certification: EvidenceFiling;
        readonly notice: EvidenceFiling | null;
      };
    }
  | {
      readonly kind: "delisting";
      readonly cik: string;
      readonly legalEntityId: string;
      readonly listing: RecordedListing;
      readonly effectiveAt: string;
      readonly reason: "change_in_control_completed" | "not_stated";
      readonly evidence: {
        readonly strike: EvidenceFiling;
        readonly notice: EvidenceFiling;
      };
    }
  | {
      readonly kind: "rename";
      readonly cik: string;
      readonly legalEntityId: string;
      readonly entity: RecordedEntity;
      readonly newName: string;
      /** `to` del nombre anterior en `formerNames`. */
      readonly effectiveAt: string;
      /** La descarga del índice: un nombre no tiene aceptación propia. */
      readonly availableAt: string;
      /**
       * `closure` si el renombre es posterior a la versión registrada; si no, la
       * versión registrada ya nació con un nombre vencido y se supersede.
       */
      readonly mode: "closure" | "correction";
    };

export type ListingVerification =
  | { readonly status: "verified"; readonly change: VerifiedListingChange }
  | {
      readonly status: "rejected";
      readonly candidate: ListingCandidate;
      readonly code: ListingEvidenceRejectionCode;
    }
  /** Verificación pedida sin evento que la respalde: no es un rechazo. */
  | { readonly status: "no_event"; readonly candidate: ListingCandidate };

function toEvidence(filing: SecListingFiling): EvidenceFiling {
  return {
    accessionNumber: filing.accessionNumber,
    form: filing.form,
    filingDate: filing.filingDate,
    reportDate: filing.reportDate,
    submitterCik: filing.submitterCik,
    acceptedAt: filing.acceptedAt!,
    items: filing.items,
  };
}

function acceptedMs(filing: SecListingFiling): number {
  return Date.parse(filing.acceptedAt!);
}

/** La más reciente primero; ante el mismo instante decide el accession. */
function latest(filings: readonly SecListingFiling[]): SecListingFiling | null {
  return (
    [...filings].sort(
      (left, right) =>
        acceptedMs(right) - acceptedMs(left) ||
        right.accessionNumber.localeCompare(left.accessionNumber),
    )[0] ?? null
  );
}

function isEightK(form: string): boolean {
  return form === "8-K" || form === "8-K/A";
}

function hasItem(filing: SecListingFiling, item: string): boolean {
  return filing.items?.includes(item) ?? false;
}

export function verifyListingCandidate(input: {
  readonly candidate: ListingCandidate;
  readonly entity: RecordedEntity;
  readonly index: SecListingIndex;
  /** Descarga del índice. */
  readonly fetchedAt: string;
}): ListingVerification {
  const { candidate, entity, index, fetchedAt } = input;
  const reject = (code: ListingEvidenceRejectionCode): ListingVerification => ({
    status: "rejected",
    candidate,
    code,
  });

  if (index.cik !== candidate.cik || entity.cik !== candidate.cik) {
    return reject("subject_mismatch");
  }

  if (candidate.kind === "symbol_changed") {
    return reject("symbol_change_without_dated_evidence");
  }

  if (candidate.kind === "name_changed") {
    if (index.entityName !== candidate.assignedName) {
      return reject("current_name_not_confirmed");
    }

    const former = [...index.formerNames]
      .filter((entry) => entry.name === entity.version.legalName)
      .sort((left, right) => right.to.localeCompare(left.to))[0];

    if (former === undefined) {
      return reject("former_name_not_found");
    }

    if (Date.parse(former.to) > Date.parse(fetchedAt)) {
      return reject("former_name_after_download");
    }

    return {
      status: "verified",
      change: {
        kind: "rename",
        cik: candidate.cik,
        legalEntityId: entity.legalEntityId,
        entity,
        newName: candidate.assignedName,
        effectiveAt: former.to,
        availableAt: new Date(Date.parse(fetchedAt)).toISOString(),
        mode:
          Date.parse(former.to) > Date.parse(entity.version.validFrom)
            ? "closure"
            : "correction",
      },
    };
  }

  const { listing } = candidate;
  const recordedFromMs = Date.parse(listing.listingValidFrom);

  if (
    index.coverage.hasHistoryFiles &&
    (index.coverage.oldestAcceptedAt === null ||
      Date.parse(index.coverage.oldestAcceptedAt) > recordedFromMs)
  ) {
    return reject("evidence_window_not_covered");
  }

  if (listing.symbol === null) {
    return reject("recorded_symbol_missing");
  }

  const sameVenue = entity.listings.filter(
    (candidateListing) => candidateListing.mic === listing.mic,
  );

  if (sameVenue.length > 1) {
    return reject("ambiguous_listing");
  }

  // Sólo cuenta lo aceptado después de lo que el grafo registró.
  const after = index.filings.filter(
    (filing) =>
      filing.acceptedAt !== null && acceptedMs(filing) > recordedFromMs,
  );

  if (candidate.kind === "listing_moved") {
    const newExchange = exchangeFilerCik(candidate.toVenue.mic);

    if (newExchange === null) {
      return reject("venue_without_exchange_filer");
    }

    const withdrawal = latest(after.filter((filing) => filing.form === "25"));

    if (withdrawal === null) {
      return reject("transfer_withdrawal_not_found");
    }

    const nearWithdrawal = (filing: SecListingFiling) =>
      Math.abs(acceptedMs(filing) - acceptedMs(withdrawal)) <=
      TRANSFER_EVIDENCE_SPAN_DAYS * DAY_MS;
    const registration = latest(
      after.filter(
        (filing) => filing.form === "8-A12B" && nearWithdrawal(filing),
      ),
    );

    if (registration === null) {
      return reject("transfer_registration_not_found");
    }

    const certification = latest(
      after.filter(
        (filing) =>
          filing.form === "CERT" &&
          filing.submitterCik === newExchange &&
          nearWithdrawal(filing),
      ),
    );

    if (certification === null) {
      return reject("transfer_certification_not_found");
    }

    // El aviso previo del emisor puede ser anterior a lo registrado: KHC lo
    // presentó antes de que el universo se constituyera. Sólo marca.
    const notice = latest(
      index.filings.filter(
        (filing) =>
          filing.acceptedAt !== null &&
          isEightK(filing.form) &&
          hasItem(filing, "3.01") &&
          acceptedMs(filing) <= acceptedMs(withdrawal) &&
          acceptedMs(withdrawal) - acceptedMs(filing) <=
            TRANSFER_NOTICE_LOOKBACK_DAYS * DAY_MS,
      ),
    );
    const effectiveMs = Math.max(
      acceptedMs(withdrawal),
      acceptedMs(registration),
      acceptedMs(certification),
    );

    return {
      status: "verified",
      change: {
        kind: "listing_transfer",
        cik: candidate.cik,
        legalEntityId: entity.legalEntityId,
        listing,
        toVenue: candidate.toVenue,
        toSymbol: candidate.toSymbol,
        effectiveAt: new Date(effectiveMs).toISOString(),
        evidence: {
          withdrawal: toEvidence(withdrawal),
          registration: toEvidence(registration),
          certification: toEvidence(certification),
          notice: notice === null ? null : toEvidence(notice),
        },
      },
    };
  }

  // `listing_unassigned` o `check_requested`: ¿salió del mercado?
  const exchange = exchangeFilerCik(listing.mic);

  if (exchange === null) {
    return reject("venue_without_exchange_filer");
  }

  const strike = latest(
    after.filter(
      (filing) => filing.form === "25-NSE" && filing.submitterCik === exchange,
    ),
  );

  if (strike === null) {
    return candidate.kind === "check_requested"
      ? { status: "no_event", candidate }
      : reject("delisting_strike_not_found");
  }

  const notice = [...index.filings]
    .filter(
      (filing) =>
        filing.acceptedAt !== null &&
        isEightK(filing.form) &&
        hasItem(filing, "3.01") &&
        Math.abs(acceptedMs(filing) - acceptedMs(strike)) <=
          DELISTING_NOTICE_WINDOW_DAYS * DAY_MS,
    )
    .sort(
      (left, right) =>
        Math.abs(acceptedMs(left) - acceptedMs(strike)) -
          Math.abs(acceptedMs(right) - acceptedMs(strike)) ||
        left.accessionNumber.localeCompare(right.accessionNumber),
    )[0];

  if (notice === undefined) {
    return reject("delisting_notice_not_found");
  }

  return {
    status: "verified",
    change: {
      kind: "delisting",
      cik: candidate.cik,
      legalEntityId: entity.legalEntityId,
      listing,
      // AvalonBay: el `25-NSE` a las 14:53 y el aviso a las 20:01. El delisting
      // queda confirmado —y se conoce— cuando están las dos piezas.
      effectiveAt: new Date(
        Math.max(acceptedMs(strike), acceptedMs(notice)),
      ).toISOString(),
      reason:
        hasItem(notice, "2.01") && hasItem(notice, "5.01")
          ? "change_in_control_completed"
          : "not_stated",
      evidence: { strike: toEvidence(strike), notice: toEvidence(notice) },
    },
  };
}
