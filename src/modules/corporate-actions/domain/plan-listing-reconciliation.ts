import {
  legalEntitySchema,
  listingSchema,
  listingSymbolSchema,
  type LegalEntity,
  type Listing,
  type ListingSymbol,
} from "@/modules/identity/domain/identity-graph";
import { computeContentHash } from "@/modules/ingestion/domain/content-hash";

import {
  computeCorporateActionContentHash,
  corporateActionSchema,
  type CorporateAction,
} from "./reporting-succession";
import type { VerifiedListingChange } from "./verify-listing-evidence";

/**
 * Plan de escritura de los eventos de listing verificados de un filer.
 *
 * Como el planner del universo, no escribe: decide qué intervalos **cierra**, qué
 * versiones **supersede** y qué versiones y eventos **abre**, para que la
 * persistencia sea una transacción sin lógica.
 *
 * - **Traspaso:** el listing viejo y su ticker se cierran en el instante en que la
 *   evidencia quedó completa, y en ese mismo instante se abren un listing nuevo
 *   —con otro ID, sobre la **misma** security— y su ticker. La membresía cuelga de
 *   la security y no se toca.
 * - **Delisting:** el listing y su ticker se cierran; la security y su membresía
 *   no. Otro mercado del mismo instrumento seguiría abierto.
 * - **Renombre:** si es posterior a la versión registrada, la cierra y abre la
 *   nueva en el borde que publica EDGAR. Si es anterior, la versión registrada
 *   nació con un nombre vencido: se supersede en el instante de la descarga y la
 *   nueva vale desde el borde. Cerrarla en el pasado fingiría que el grafo lo
 *   sabía cuando la registró.
 *
 * Los hashes cubren contenido, nunca IDs generados ni instantes locales, igual que
 * en la constitución del universo.
 */
export const LISTING_RECONCILIATION_RULE_VERSION =
  "listing-reconciliation-1.0.0";

export type ListingVersionClosure = {
  readonly level: "legal_entity" | "listing" | "listing_symbol";
  readonly subjectId: string;
  readonly validFrom: string;
  readonly validTo: string;
};

export type ListingVersionSupersession = {
  readonly level: "legal_entity";
  readonly subjectId: string;
  readonly validFrom: string;
  readonly supersededAt: string;
};

export type ListingReconciliationRejectionCode =
  /** La misma presentación ya describe un evento del mismo tipo. */
  | "listing_event_already_recorded"
  /** El borde no es posterior al intervalo vigente que tendría que cerrar. */
  | "stale_effective_date"
  /** La versión nueva tendría la misma clave que la que reemplaza. */
  | "version_key_collision";

export type ListingReconciliationPlan = {
  readonly ruleVersion: string;
  readonly cik: string;
  readonly legalEntityId: string;
  readonly status: "planned" | "unchanged";
  readonly closures: readonly ListingVersionClosure[];
  readonly supersessions: readonly ListingVersionSupersession[];
  readonly legalEntities: readonly LegalEntity[];
  readonly listings: readonly Listing[];
  readonly listingSymbols: readonly ListingSymbol[];
  readonly corporateActions: readonly CorporateAction[];
  /** Cambios que el plan escribe, en el orden en que se decidieron. */
  readonly applied: readonly VerifiedListingChange[];
  readonly rejections: readonly {
    readonly change: VerifiedListingChange;
    readonly code: ListingReconciliationRejectionCode;
  }[];
};

const SEC_SOURCE_ID = "sec-edgar";

function withHash<TContent extends Record<string, unknown>>(
  content: TContent,
  recordedAt: string,
): TContent & { contentHash: string; recordedAt: string } {
  return { ...content, contentHash: computeContentHash(content), recordedAt };
}

const NEW_YORK_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Fecha calendaria de un instante en el huso de EDGAR. */
export function newYorkDate(instant: string): string {
  return NEW_YORK_DATE.format(new Date(instant));
}

export function planListingReconciliation(input: {
  readonly cik: string;
  readonly legalEntityId: string;
  readonly changes: readonly VerifiedListingChange[];
  /** Eventos ya registrados sobre estas presentaciones o sujetos. */
  readonly corporateActions: readonly CorporateAction[];
  readonly recordedAt: string;
  readonly newId: () => string;
}): ListingReconciliationPlan {
  const { cik, legalEntityId, changes, recordedAt, newId } = input;
  const closures: ListingVersionClosure[] = [];
  const supersessions: ListingVersionSupersession[] = [];
  const legalEntities: LegalEntity[] = [];
  const listings: Listing[] = [];
  const listingSymbols: ListingSymbol[] = [];
  const corporateActions: CorporateAction[] = [];
  const applied: VerifiedListingChange[] = [];
  const rejections: ListingReconciliationPlan["rejections"][number][] = [];

  const alreadyRecorded = (actionType: string, sourceDocumentId: string) =>
    input.corporateActions.some(
      (action) =>
        action.sourceId === SEC_SOURCE_ID &&
        action.sourceDocumentId === sourceDocumentId &&
        action.actionType === actionType,
    ) ||
    corporateActions.some(
      (action) =>
        action.sourceDocumentId === sourceDocumentId &&
        action.actionType === actionType,
    );

  const closeListing = (
    change: Extract<
      VerifiedListingChange,
      { kind: "listing_transfer" | "delisting" }
    >,
  ): boolean => {
    const { listing, effectiveAt } = change;
    const at = Date.parse(effectiveAt);

    if (
      Date.parse(listing.listingValidFrom) >= at ||
      (listing.symbol !== null && Date.parse(listing.symbol.validFrom) >= at)
    ) {
      rejections.push({ change, code: "stale_effective_date" });
      return false;
    }

    closures.push({
      level: "listing",
      subjectId: listing.listingId,
      validFrom: listing.listingValidFrom,
      validTo: effectiveAt,
    });

    if (listing.symbol !== null) {
      closures.push({
        level: "listing_symbol",
        subjectId: listing.symbol.listingSymbolId,
        validFrom: listing.symbol.validFrom,
        validTo: effectiveAt,
      });
    }

    return true;
  };

  const pushAction = (
    content: Omit<
      CorporateAction,
      "corporateActionId" | "contentHash" | "recordedAt"
    >,
  ) => {
    corporateActions.push(
      corporateActionSchema.parse({
        ...content,
        corporateActionId: newId(),
        contentHash: computeCorporateActionContentHash(content),
        recordedAt,
      }),
    );
  };

  for (const change of changes) {
    if (change.kind === "rename") {
      const { version } = change.entity;

      if (change.effectiveAt === version.validFrom) {
        // La clave de la versión es `(entidad, valid_from)`: una corrección con
        // el mismo borde no tiene dónde vivir junto a la que supersede.
        rejections.push({ change, code: "version_key_collision" });
        continue;
      }

      if (change.mode === "closure") {
        closures.push({
          level: "legal_entity",
          subjectId: change.legalEntityId,
          validFrom: version.validFrom,
          validTo: change.effectiveAt,
        });
      } else {
        supersessions.push({
          level: "legal_entity",
          subjectId: change.legalEntityId,
          validFrom: version.validFrom,
          supersededAt: change.availableAt,
        });
      }

      legalEntities.push(
        legalEntitySchema.parse(
          withHash(
            {
              sourceId: SEC_SOURCE_ID,
              // El documento que publica `formerNames`: resoluble como un pin.
              sourceDocumentId: `submissions/CIK${cik}.json`,
              validFrom: change.effectiveAt,
              validTo: null,
              availableAt: change.availableAt,
              supersededAt: null,
              legalEntityId: change.legalEntityId,
              legalName: change.newName,
              entityType: version.entityType,
              jurisdiction: version.jurisdiction,
              status: version.status,
            },
            recordedAt,
          ),
        ),
      );
      applied.push(change);
      continue;
    }

    if (change.kind === "listing_transfer") {
      const document = change.evidence.certification.accessionNumber;

      if (alreadyRecorded("listing_transfer", document)) {
        rejections.push({ change, code: "listing_event_already_recorded" });
        continue;
      }

      if (!closeListing(change)) {
        continue;
      }

      const provenance = {
        sourceId: SEC_SOURCE_ID,
        sourceDocumentId: document,
        validFrom: change.effectiveAt,
        validTo: null,
        availableAt: change.effectiveAt,
        supersededAt: null,
      } as const;
      const listingId = newId();

      listings.push(
        listingSchema.parse(
          withHash(
            {
              ...provenance,
              listingId,
              securityId: change.listing.securityId,
              mic: change.toVenue.mic,
              quoteCurrency: change.toVenue.quoteCurrency,
              country: change.toVenue.country,
              status: "active",
              // Un traspaso mueve el listing que había, así que hereda su rol.
              primaryListing: change.listing.primaryListing,
            },
            recordedAt,
          ),
        ),
      );
      listingSymbols.push(
        listingSymbolSchema.parse(
          withHash(
            {
              ...provenance,
              listingSymbolId: newId(),
              listingId,
              symbol: change.toSymbol,
              symbolType: "ticker",
            },
            recordedAt,
          ),
        ),
      );

      const { withdrawal, registration, notice } = change.evidence;

      pushAction({
        actionType: "listing_transfer",
        subjectType: "security",
        subjectId: change.listing.securityId,
        announcedAt: null,
        effectiveOn: newYorkDate(change.effectiveAt),
        availableAt: change.effectiveAt,
        sourceId: SEC_SOURCE_ID,
        sourceDocumentId: document,
        terms: {
          fromMic: change.listing.mic,
          toMic: change.toVenue.mic,
          fromSymbol: change.listing.symbol!.symbol,
          toSymbol: change.toSymbol,
          withdrawalAccession: withdrawal.accessionNumber,
          registrationAccession: registration.accessionNumber,
          ...(notice === null
            ? {}
            : { noticeAccession: notice.accessionNumber }),
        },
      });
      applied.push(change);
      continue;
    }

    const document = change.evidence.strike.accessionNumber;

    if (alreadyRecorded("delisting", document)) {
      rejections.push({ change, code: "listing_event_already_recorded" });
      continue;
    }

    if (!closeListing(change)) {
      continue;
    }

    pushAction({
      actionType: "delisting",
      subjectType: "listing",
      subjectId: change.listing.listingId,
      announcedAt: null,
      effectiveOn: newYorkDate(change.effectiveAt),
      availableAt: change.effectiveAt,
      sourceId: SEC_SOURCE_ID,
      sourceDocumentId: document,
      terms: {
        mic: change.listing.mic,
        ...(change.listing.symbol === null
          ? {}
          : { symbol: change.listing.symbol.symbol }),
        noticeAccession: change.evidence.notice.accessionNumber,
        reason: change.reason,
      },
    });
    applied.push(change);
  }

  return {
    ruleVersion: LISTING_RECONCILIATION_RULE_VERSION,
    cik,
    legalEntityId,
    status: applied.length === 0 ? "unchanged" : "planned",
    closures,
    supersessions,
    legalEntities,
    listings,
    listingSymbols,
    corporateActions,
    applied,
    rejections,
  };
}
