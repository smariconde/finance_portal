import { computeContentHash } from "@/modules/ingestion/domain/content-hash";

import {
  LISTING_CAPTURE_VERSION,
  type ListingCapture,
  type PageKind,
  type ParseBasis,
  type RealEstatePortal,
} from "./listing-capture";

/**
 * Un aviso es una cadena de revisiones append-only, y hay revisión **sólo
 * cuando algo cambia** (ADR 0089, Decisión 3): precio, moneda, superficie,
 * estado o cualquier otro hecho publicado, que el hash del contenido cubre.
 * Volver a ver un aviso igual mueve `lastSeenAt` y nada más.
 *
 * Una revisión guarda el **estado completo** del aviso en ese instante, no un
 * diff: leer el aviso a una fecha es tomar la revisión vigente, sin
 * reconstruir. Lo que cambió se deriva comparando dos revisiones.
 *
 * Una tarjeta de búsqueda muestra menos que la ficha y a veces redondea. Si
 * pudiera reescribir todo, una ficha de 85,5 m² y una tarjeta de 85 m² se
 * alternarían revisión tras revisión. Por eso, una vez vista la ficha, una
 * tarjeta sólo actualiza el precio, que es lo que de verdad cambia y lo que la
 * tarjeta muestra bien. Mientras no se vio la ficha, la tarjeta es lo que hay.
 */
export const LISTING_REVISION_VERSION = "listing-revision-1.0.0";

/** Lo que el aviso publica, sin lo que identifica o describe la captura. */
export type ListingFacts = Omit<
  ListingCapture,
  | "source"
  | "externalId"
  | "canonicalUrl"
  | "pageKind"
  | "parseBasis"
  | "capturedAt"
>;

export type ListingStatus = "active" | "removed";

/**
 * La única evidencia de una baja (`F13-05`): la ficha visitada dice
 * «finalizado» o responde `404`. No aparecer en un barrido no es una baja.
 */
export type RemovalEvidence = "portal_finished" | "http_404";

export type ListingRevision = {
  /** Empieza en 1. */
  readonly revision: number;
  /** El instante de la captura que la produjo: el portal no fecha sus cambios. */
  readonly observedAt: string;
  readonly pageKind: PageKind;
  readonly parseBasis: ParseBasis;
  readonly status: ListingStatus;
  /** `null` exactamente cuando el aviso está activo. */
  readonly removalEvidence: RemovalEvidence | null;
  /** Si los hechos que no son el precio vienen de una ficha. */
  readonly detailSeen: boolean;
  readonly facts: ListingFacts;
  /** SHA-256 de los hechos en forma canónica. */
  readonly contentHash: string;
};

export type StoredListing = {
  readonly source: RealEstatePortal;
  readonly externalId: string;
  readonly canonicalUrl: string;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  /** La última revisión de la cadena. */
  readonly latest: ListingRevision;
};

export type ListingChange =
  "price" | "currency" | "surface" | "status" | "content";

export type ListingCapturePlan =
  | {
      readonly kind: "new_listing";
      readonly listing: Omit<StoredListing, "latest">;
      readonly revision: ListingRevision;
    }
  | {
      readonly kind: "revision";
      readonly canonicalUrl: string;
      readonly lastSeenAt: string;
      readonly revision: ListingRevision;
      readonly changes: readonly ListingChange[];
    }
  | {
      /** Visto igual: sólo se mueve `lastSeenAt`. */
      readonly kind: "seen";
      readonly canonicalUrl: string;
      readonly lastSeenAt: string;
    }
  | {
      /**
       * Una captura que llega después de una revisión más nueva —la cola
       * local reintenta tarde—. No reescribe la cadena: a lo sumo adelanta el
       * primer avistaje.
       */
      readonly kind: "out_of_order";
      readonly firstSeenAt: string;
    };

export class ListingRevisionError extends Error {
  constructor(
    readonly code:
      | "capture_for_another_listing"
      | "removal_before_latest_revision"
      | "already_removed",
  ) {
    super(code);
    this.name = "ListingRevisionError";
  }
}

/** Los conjuntos se ordenan: el orden en que el portal los lista no es un hecho. */
export function factsOf(capture: ListingCapture): ListingFacts {
  const {
    source: _source,
    externalId: _externalId,
    canonicalUrl: _canonicalUrl,
    pageKind: _pageKind,
    parseBasis: _parseBasis,
    capturedAt: _capturedAt,
    ...facts
  } = capture;
  void [_source, _externalId, _canonicalUrl, _pageKind, _parseBasis];
  void _capturedAt;
  return {
    ...facts,
    amenities: [...facts.amenities].sort(),
    legalFlags: [...facts.legalFlags].sort(),
  };
}

export function listingContentHash(facts: ListingFacts): string {
  return computeContentHash({
    contract: LISTING_CAPTURE_VERSION,
    rule: LISTING_REVISION_VERSION,
    facts,
  });
}

const SURFACE_FIELDS = ["coveredAreaM2", "totalAreaM2", "landAreaM2"] as const;

export function changesBetween(
  previous: ListingRevision,
  next: Pick<ListingRevision, "facts" | "status" | "contentHash">,
): readonly ListingChange[] {
  const changes: ListingChange[] = [];
  if (
    previous.facts.priceAmount !== next.facts.priceAmount ||
    previous.facts.priceStatus !== next.facts.priceStatus
  )
    changes.push("price");
  if (previous.facts.priceCurrency !== next.facts.priceCurrency)
    changes.push("currency");
  if (
    SURFACE_FIELDS.some((field) => previous.facts[field] !== next.facts[field])
  )
    changes.push("surface");
  if (previous.status !== next.status) changes.push("status");
  if (changes.length === 0 && previous.contentHash !== next.contentHash)
    changes.push("content");
  return changes;
}

function laterOf(a: string, b: string): string {
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

function earlierOf(a: string, b: string): string {
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

/** Qué hace una captura con el aviso que ya está guardado, si lo hay. */
export function planListingCapture(input: {
  readonly existing: StoredListing | null;
  readonly capture: ListingCapture;
}): ListingCapturePlan {
  const { existing, capture } = input;
  const captured = factsOf(capture);

  if (existing === null) {
    const revision: ListingRevision = {
      revision: 1,
      observedAt: capture.capturedAt,
      pageKind: capture.pageKind,
      parseBasis: capture.parseBasis,
      status: "active",
      removalEvidence: null,
      detailSeen: capture.pageKind === "listing_detail",
      facts: captured,
      contentHash: listingContentHash(captured),
    };
    return {
      kind: "new_listing",
      listing: {
        source: capture.source,
        externalId: capture.externalId,
        canonicalUrl: capture.canonicalUrl,
        firstSeenAt: capture.capturedAt,
        lastSeenAt: capture.capturedAt,
      },
      revision,
    };
  }

  if (
    existing.source !== capture.source ||
    existing.externalId !== capture.externalId
  ) {
    throw new ListingRevisionError("capture_for_another_listing");
  }

  const latest = existing.latest;
  if (Date.parse(capture.capturedAt) <= Date.parse(latest.observedAt)) {
    return {
      kind: "out_of_order",
      firstSeenAt: earlierOf(existing.firstSeenAt, capture.capturedAt),
    };
  }

  const isDetail = capture.pageKind === "listing_detail";
  const facts: ListingFacts =
    isDetail || !latest.detailSeen
      ? captured
      : {
          ...latest.facts,
          priceAmount: captured.priceAmount,
          priceStatus: captured.priceStatus,
          priceCurrency: captured.priceCurrency,
        };
  const next = {
    facts,
    // Verlo publicado otra vez lo vuelve activo; una baja sólo la escribe
    // `planListingRemoval` con su evidencia.
    status: "active" as const,
    contentHash: listingContentHash(facts),
  };
  const changes = changesBetween(latest, next);

  const lastSeenAt = laterOf(existing.lastSeenAt, capture.capturedAt);
  if (changes.length === 0) {
    return { kind: "seen", canonicalUrl: capture.canonicalUrl, lastSeenAt };
  }
  return {
    kind: "revision",
    canonicalUrl: capture.canonicalUrl,
    lastSeenAt,
    changes,
    revision: {
      revision: latest.revision + 1,
      observedAt: capture.capturedAt,
      pageKind: capture.pageKind,
      parseBasis: capture.parseBasis,
      removalEvidence: null,
      detailSeen: latest.detailSeen || isDetail,
      ...next,
    },
  };
}

/**
 * La baja de un aviso, sólo con evidencia de la ficha visitada. Los hechos
 * quedan como estaban: lo que se dio de baja es lo último que se vio.
 */
export function planListingRemoval(input: {
  readonly existing: StoredListing;
  readonly evidence: RemovalEvidence;
  readonly observedAt: string;
  readonly pageKind: PageKind;
  readonly parseBasis: ParseBasis;
}): ListingRevision {
  const latest = input.existing.latest;
  if (latest.status === "removed")
    throw new ListingRevisionError("already_removed");
  if (Date.parse(input.observedAt) <= Date.parse(latest.observedAt))
    throw new ListingRevisionError("removal_before_latest_revision");
  return {
    ...latest,
    revision: latest.revision + 1,
    observedAt: input.observedAt,
    pageKind: input.pageKind,
    parseBasis: input.parseBasis,
    status: "removed",
    removalEvidence: input.evidence,
  };
}

/** La revisión vigente a un instante, o `null` si el aviso todavía no se vio. */
export function listingRevisionAt(
  revisions: readonly ListingRevision[],
  knownAt: string,
): ListingRevision | null {
  const at = Date.parse(knownAt);
  let current: ListingRevision | null = null;
  for (const revision of revisions) {
    if (Date.parse(revision.observedAt) > at) continue;
    if (current === null || revision.revision > current.revision)
      current = revision;
  }
  return current;
}
