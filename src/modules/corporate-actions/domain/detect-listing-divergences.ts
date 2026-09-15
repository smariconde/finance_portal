import {
  normalizeSymbol,
  type IdentityGraph,
  type LegalEntity,
} from "@/modules/identity/domain/identity-graph";
import type { TemporalVersion } from "@/modules/temporal/domain/temporal-version";
import type { CompanyTickerAssignment } from "@/modules/universe/domain/universe-source-records";
import { resolveVenue, type Venue } from "@/modules/universe/domain/venue-map";

/**
 * Divergencias entre el grafo registrado y la tabla vigente de tickers de la SEC.
 *
 * La tabla no tiene fechas: dice cómo está cada CIK **hoy**. Por eso una
 * divergencia no es un evento sino una **pregunta** —¿qué pasó y cuándo?— que
 * sólo la evidencia fechada del índice del filer responde
 * (`verify-listing-evidence.ts`). Detectar es barato y sin red más allá de la
 * tabla; verificar cuesta un request por CIK, y sólo se paga por los que
 * divergen.
 *
 * Una salida del mercado aparece como `listing_unassigned`: medido el 2026-09-15,
 * la tabla ya no tenía a Hologic, Electronic Arts ni AvalonBay, aunque el índice
 * de `submissions` de las dos últimas todavía publicaba su ticker. Cuándo las sacó
 * la tabla no se puede saber —no tiene historia—, así que la ausencia sólo abre la
 * pregunta; la fecha la pone el `25-NSE`. El owner puede además pedir la
 * verificación de un filer (`check_requested`) sin esperar a que la tabla cambie.
 */
export const LISTING_DIVERGENCE_RULE_VERSION = "listing-divergence-1.0.0";

export type RecordedListing = {
  readonly legalEntityId: string;
  readonly securityId: string;
  readonly listingId: string;
  readonly listingValidFrom: string;
  readonly mic: string;
  readonly quoteCurrency: string;
  readonly country: string;
  readonly primaryListing: boolean;
  /** Ticker vigente del listing, si tiene uno. */
  readonly symbol: {
    readonly listingSymbolId: string;
    readonly symbol: string;
    readonly validFrom: string;
  } | null;
};

export type RecordedEntity = {
  readonly cik: string;
  readonly legalEntityId: string;
  /** Versión vigente de la entidad: la que un renombre cierra o supersede. */
  readonly version: LegalEntity;
  readonly listings: readonly RecordedListing[];
};

export type ListingDivergence =
  | {
      readonly kind: "name_changed";
      readonly cik: string;
      readonly legalEntityId: string;
      readonly assignedName: string;
    }
  | {
      /** El mismo instrumento aparece en otro mercado, con o sin otro símbolo. */
      readonly kind: "listing_moved";
      readonly cik: string;
      readonly legalEntityId: string;
      readonly listing: RecordedListing;
      readonly toVenue: Venue;
      readonly toSymbol: string;
    }
  | {
      readonly kind: "symbol_changed";
      readonly cik: string;
      readonly legalEntityId: string;
      readonly listing: RecordedListing;
      readonly toSymbol: string;
    }
  | {
      /** El listing registrado ya no figura en la tabla y nada lo reemplaza. */
      readonly kind: "listing_unassigned";
      readonly cik: string;
      readonly legalEntityId: string;
      readonly listing: RecordedListing;
    };

function isOpen(version: TemporalVersion): boolean {
  return version.validTo === null && version.supersededAt === null;
}

/**
 * Entidades del grafo con al menos un listing vigente, con su CIK autoritativo.
 * Un antecesor de sucesión no tiene listings: no cotiza y no se reconcilia.
 */
export function collectRecordedEntities(
  graph: IdentityGraph,
): ReadonlyMap<string, RecordedEntity> {
  const cikByEntity = new Map(
    graph.identifierAssignments
      .filter(
        (assignment) =>
          isOpen(assignment) &&
          assignment.identifierType === "cik" &&
          assignment.subjectType === "legal_entity" &&
          assignment.confidence === "authoritative",
      )
      .map((assignment) => [assignment.subjectId, assignment.normalizedValue]),
  );
  const issuerBySecurity = new Map(
    graph.securities
      .filter(isOpen)
      .map((security) => [security.securityId, security.issuerLegalEntityId]),
  );
  const tickerByListing = new Map(
    graph.listingSymbols
      .filter((symbol) => isOpen(symbol) && symbol.symbolType === "ticker")
      .map((symbol) => [symbol.listingId, symbol]),
  );
  const listingsByEntity = new Map<string, RecordedListing[]>();

  for (const listing of graph.listings.filter(isOpen)) {
    const legalEntityId = issuerBySecurity.get(listing.securityId);

    if (legalEntityId === undefined) {
      continue;
    }

    const ticker = tickerByListing.get(listing.listingId);
    const recorded: RecordedListing = {
      legalEntityId,
      securityId: listing.securityId,
      listingId: listing.listingId,
      listingValidFrom: listing.validFrom,
      mic: listing.mic,
      quoteCurrency: listing.quoteCurrency,
      country: listing.country,
      primaryListing: listing.primaryListing,
      symbol:
        ticker === undefined
          ? null
          : {
              listingSymbolId: ticker.listingSymbolId,
              symbol: ticker.symbol,
              validFrom: ticker.validFrom,
            },
    };

    listingsByEntity.set(legalEntityId, [
      ...(listingsByEntity.get(legalEntityId) ?? []),
      recorded,
    ]);
  }

  const entities = new Map<string, RecordedEntity>();

  for (const version of graph.legalEntities.filter(isOpen)) {
    const cik = cikByEntity.get(version.legalEntityId);
    const listings = listingsByEntity.get(version.legalEntityId) ?? [];

    if (cik === undefined || listings.length === 0) {
      continue;
    }

    entities.set(cik, {
      cik,
      legalEntityId: version.legalEntityId,
      version,
      listings: [...listings].sort((left, right) =>
        left.listingId.localeCompare(right.listingId),
      ),
    });
  }

  return entities;
}

type AssignedListing = {
  readonly venue: Venue | null;
  readonly symbol: string;
  readonly name: string;
};

function key(mic: string | null, symbol: string): string {
  return `${mic ?? "?"}:${normalizeSymbol(symbol)}`;
}

export function detectListingDivergences(input: {
  readonly graph: IdentityGraph;
  readonly assignments: readonly CompanyTickerAssignment[];
}): {
  readonly ruleVersion: string;
  readonly entities: ReadonlyMap<string, RecordedEntity>;
  readonly divergences: readonly ListingDivergence[];
} {
  const entities = collectRecordedEntities(input.graph);
  const assignedByCik = new Map<string, AssignedListing[]>();

  for (const assignment of input.assignments) {
    const cik = assignment.cik.padStart(10, "0");

    if (!entities.has(cik)) {
      continue;
    }

    assignedByCik.set(cik, [
      ...(assignedByCik.get(cik) ?? []),
      {
        venue: resolveVenue(assignment.exchange),
        symbol: assignment.ticker,
        name: assignment.name,
      },
    ]);
  }

  const divergences: ListingDivergence[] = [];

  for (const [cik, entity] of [...entities].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const assigned = assignedByCik.get(cik) ?? [];
    const base = { cik, legalEntityId: entity.legalEntityId };
    const names = [...new Set(assigned.map((row) => row.name))];

    // Con más de un nombre para el mismo CIK la tabla no decide cuál es el
    // vigente: no hay divergencia que preguntar, hay una fuente ambigua.
    if (names.length === 1 && names[0] !== entity.version.legalName) {
      divergences.push({
        ...base,
        kind: "name_changed",
        assignedName: names[0]!,
      });
    }

    const assignedKeys = new Set(
      assigned.map((row) => key(row.venue?.mic ?? null, row.symbol)),
    );
    const recordedKeys = new Set(
      entity.listings.map((listing) =>
        key(listing.mic, listing.symbol?.symbol ?? ""),
      ),
    );
    let pendingListings = entity.listings.filter(
      (listing) =>
        listing.symbol === null ||
        !assignedKeys.has(key(listing.mic, listing.symbol.symbol)),
    );
    let pendingAssigned = assigned.filter(
      (row) =>
        row.venue !== null && !recordedKeys.has(key(row.venue.mic, row.symbol)),
    );

    const pair = (listing: RecordedListing, row: AssignedListing) => {
      pendingListings = pendingListings.filter(
        (candidate) => candidate !== listing,
      );
      pendingAssigned = pendingAssigned.filter(
        (candidate) => candidate !== row,
      );
    };

    // 1. Mismo símbolo en otro mercado: el instrumento se mudó.
    for (const listing of [...pendingListings]) {
      if (listing.symbol === null) {
        continue;
      }

      const matches = pendingAssigned.filter(
        (row) =>
          normalizeSymbol(row.symbol) ===
          normalizeSymbol(listing.symbol!.symbol),
      );

      if (matches.length === 1) {
        divergences.push({
          ...base,
          kind: "listing_moved",
          listing,
          toVenue: matches[0]!.venue!,
          toSymbol: matches[0]!.symbol,
        });
        pair(listing, matches[0]!);
      }
    }

    // 2. Mismo mercado, otro símbolo, uno a uno: cambió el ticker.
    for (const listing of [...pendingListings]) {
      const sameVenueListings = pendingListings.filter(
        (candidate) => candidate.mic === listing.mic,
      );
      const sameVenueAssigned = pendingAssigned.filter(
        (row) => row.venue!.mic === listing.mic,
      );

      if (sameVenueListings.length === 1 && sameVenueAssigned.length === 1) {
        divergences.push({
          ...base,
          kind: "symbol_changed",
          listing,
          toSymbol: sameVenueAssigned[0]!.symbol,
        });
        pair(listing, sameVenueAssigned[0]!);
      }
    }

    // 3. Uno de cada lado, con mercado y símbolo distintos: mudanza con ticker
    //    nuevo, la forma en que Fiserv pasó de FI en NYSE a FISV en Nasdaq.
    if (pendingListings.length === 1 && pendingAssigned.length === 1) {
      divergences.push({
        ...base,
        kind: "listing_moved",
        listing: pendingListings[0]!,
        toVenue: pendingAssigned[0]!.venue!,
        toSymbol: pendingAssigned[0]!.symbol,
      });
      pair(pendingListings[0]!, pendingAssigned[0]!);
    }

    for (const listing of pendingListings) {
      divergences.push({ ...base, kind: "listing_unassigned", listing });
    }
  }

  return {
    ruleVersion: LISTING_DIVERGENCE_RULE_VERSION,
    entities,
    divergences,
  };
}
