/**
 * La unidad que se vende y la parcela sobre la que está (ADR 0089, Decisiones
 * 3 y 6). Casi ningún aviso publica la nomenclatura, así que el vínculo es una
 * **afirmación con confianza**, versionada como cadena de revisiones: la
 * vigente es la que no tiene `supersededAt`.
 *
 * Sólo se afirma con una ubicación que alcance para una parcela: la dirección
 * con número que Georef resolvió o un pin propio del portal. Un pin compartido
 * es el centro del barrio y el texto del barrio no ubica nada:
 * `location_imprecise`. El owner puede declarar o corregir el vínculo, y una
 * evidencia más débil nunca reemplaza una más fuerte.
 */
export const PROPERTY_PARCEL_LINK_VERSION = "property-parcel-link-1.0.0";

/** `location-precision-1.0.0` (`F13-06`); acá sólo se lee. */
export type LocationPrecision =
  "address_geocoded" | "portal_pin" | "portal_pin_shared" | "neighborhood_only";

export type ParcelLinkBasis =
  "owner_declared" | "address_geocoded" | "portal_pin";

/** Ordinal, nunca una probabilidad. */
export type ParcelLinkConfidence = "confirmed" | "probable" | "possible";

export const PARCEL_LINK_CONFIDENCE: Readonly<
  Record<ParcelLinkBasis, ParcelLinkConfidence>
> = {
  owner_declared: "confirmed",
  address_geocoded: "probable",
  portal_pin: "possible",
};

const RANK: Readonly<Record<ParcelLinkBasis, number>> = {
  owner_declared: 3,
  address_geocoded: 2,
  portal_pin: 1,
};

export type PropertyParcelLink = {
  readonly propertyId: string;
  /** Empieza en 1. */
  readonly revision: number;
  readonly parcelId: string;
  readonly basis: ParcelLinkBasis;
  readonly confidence: ParcelLinkConfidence;
  readonly availableAt: string;
  readonly supersededAt: string | null;
};

export type PropertyParcelLinkPlan =
  | {
      readonly kind: "link";
      readonly insert: PropertyParcelLink;
      /** La revisión vigente que se cierra en `availableAt`, si había. */
      readonly supersede: number | null;
    }
  | { readonly kind: "unchanged" }
  | {
      readonly kind: "refused";
      readonly code: "location_imprecise" | "weaker_than_current_link";
    };

export class PropertyParcelLinkError extends Error {
  constructor(
    readonly code: "link_for_another_property" | "evidence_not_after_link",
  ) {
    super(code);
    this.name = "PropertyParcelLinkError";
  }
}

export type ParcelLinkEvidence =
  | { readonly kind: "owner_declared" }
  | { readonly kind: "location"; readonly precision: LocationPrecision };

export function planPropertyParcelLink(input: {
  readonly propertyId: string;
  readonly current: PropertyParcelLink | null;
  readonly parcelId: string;
  readonly evidence: ParcelLinkEvidence;
  readonly observedAt: string;
}): PropertyParcelLinkPlan {
  const { current } = input;
  let basis: ParcelLinkBasis;
  if (input.evidence.kind === "owner_declared") basis = "owner_declared";
  else if (
    input.evidence.precision === "address_geocoded" ||
    input.evidence.precision === "portal_pin"
  )
    basis = input.evidence.precision;
  else return { kind: "refused", code: "location_imprecise" };

  if (current !== null) {
    if (
      current.propertyId !== input.propertyId ||
      current.supersededAt !== null
    )
      throw new PropertyParcelLinkError("link_for_another_property");
    if (Date.parse(input.observedAt) <= Date.parse(current.availableAt))
      throw new PropertyParcelLinkError("evidence_not_after_link");
    if (
      current.parcelId === input.parcelId &&
      RANK[basis] <= RANK[current.basis]
    )
      return { kind: "unchanged" };
    if (RANK[basis] < RANK[current.basis])
      return { kind: "refused", code: "weaker_than_current_link" };
  }

  return {
    kind: "link",
    supersede: current?.revision ?? null,
    insert: {
      propertyId: input.propertyId,
      revision: (current?.revision ?? 0) + 1,
      parcelId: input.parcelId,
      basis,
      confidence: PARCEL_LINK_CONFIDENCE[basis],
      availableAt: input.observedAt,
      supersededAt: null,
    },
  };
}

/** El vínculo vigente a un instante. */
export function propertyParcelLinkAt(
  links: readonly PropertyParcelLink[],
  knownAt: string,
): PropertyParcelLink | null {
  const at = Date.parse(knownAt);
  return (
    links.find(
      (link) =>
        Date.parse(link.availableAt) <= at &&
        (link.supersededAt === null || Date.parse(link.supersededAt) > at),
    ) ?? null
  );
}
