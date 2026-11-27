import {
  createDecimalOperations,
  ONE,
} from "@/modules/numeric/domain/decimal-policy";

import type {
  Amenity,
  Condition,
  LegalFlag,
  ListingCurrency,
  Operation,
  PageKind,
  ParseBasis,
  PropertyType,
  RealEstatePortal,
} from "./listing-capture";
import {
  changesBetween,
  type ListingChange,
  type ListingRevision,
} from "./listing-revisions";

/**
 * Cómo se lee un aviso en la ficha mínima (`F13-02`): rótulos en español y el
 * historial de precio revisión por revisión (`listing-view-1.0.0`). La
 * variación es el cociente contra el precio publicado anterior **en la misma
 * moneda**; un cambio de moneda o un «consultar precio» de por medio no tiene
 * variación, tiene nombre.
 */
export const LISTING_VIEW_VERSION = "listing-view-1.0.0";

export const PORTAL_LABELS: Readonly<Record<RealEstatePortal, string>> = {
  "remax-ar": "RE/MAX",
  zonaprop: "Zonaprop",
  argenprop: "Argenprop",
  "mercadolibre-inmuebles": "Mercado Libre",
};

export const PROPERTY_TYPE_LABELS: Readonly<Record<PropertyType, string>> = {
  house: "Casa",
  apartment: "Departamento",
  ph: "PH",
  land: "Terreno",
  parking: "Cochera",
  office: "Oficina",
  retail: "Local",
};

export const OPERATION_LABELS: Readonly<Record<Operation, string>> = {
  sale: "Venta",
  rent: "Alquiler",
};

export const CONDITION_LABELS: Readonly<Record<Condition, string>> = {
  new: "A estrenar",
  good: "Buen estado",
  to_renovate: "A reciclar",
  unknown: "Sin dato",
};

export const LEGAL_FLAG_LABELS: Readonly<Record<LegalFlag, string>> = {
  credit_eligible: "Apto crédito",
  deed: "Escritura",
  boleto_only: "Sólo boleto",
  succession: "Sucesión",
  possession: "Posesión",
};

export const AMENITY_LABELS: Readonly<Record<Amenity, string>> = {
  pool: "Pileta",
  gym: "Gimnasio",
  sum: "SUM",
  security: "Seguridad",
  grill: "Parrilla",
  elevator: "Ascensor",
  balcony: "Balcón",
  garden: "Jardín",
};

export const PAGE_KIND_LABELS: Readonly<Record<PageKind, string>> = {
  listing_detail: "Ficha",
  search_result: "Listado",
};

export const PARSE_BASIS_LABELS: Readonly<Record<ParseBasis, string>> = {
  json_ld: "JSON-LD",
  embedded_state: "estado embebido",
  dom: "HTML",
};

export const CHANGE_LABELS: Readonly<Record<ListingChange, string>> = {
  price: "Precio",
  currency: "Moneda",
  surface: "Superficie",
  status: "Estado",
  content: "Datos",
};

/** Dónde se ve el aviso en el portal: el segmento de `/inmuebles/[aviso]`. */
export function listingSlug(
  source: RealEstatePortal,
  externalId: string,
): string {
  return `${source}.${externalId}`;
}

export function parseListingSlug(
  slug: string,
): { readonly source: RealEstatePortal; readonly externalId: string } | null {
  const dot = slug.indexOf(".");
  if (dot <= 0) return null;
  const source = slug.slice(0, dot);
  const externalId = slug.slice(dot + 1);
  if (!(source in PORTAL_LABELS)) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(externalId)) return null;
  return { source: source as RealEstatePortal, externalId };
}

export type PriceHistoryEntry = {
  readonly revision: number;
  readonly observedAt: string;
  readonly pageKind: PageKind;
  readonly priceAmount: string | null;
  readonly priceCurrency: ListingCurrency | null;
  /** Variación contra el precio publicado anterior, como fracción. */
  readonly change: string | null;
  /** Por qué no hay variación cuando hay un precio anterior. */
  readonly changeGap: "first" | "on_request" | "currency_changed" | null;
  /** Qué cambió en esta revisión; vacío en la primera. */
  readonly changes: readonly ListingChange[];
};

const decimals = createDecimalOperations(
  (code, message) => new Error(`${code}: ${message}`),
);

/** El historial, de la revisión más reciente a la primera. */
export function priceHistory(
  revisions: readonly ListingRevision[],
): readonly PriceHistoryEntry[] {
  const entries: PriceHistoryEntry[] = [];
  let lastPublished: { amount: string; currency: ListingCurrency } | null =
    null;

  revisions.forEach((revision, index) => {
    const previous = index === 0 ? null : revisions[index - 1];
    const { priceAmount, priceCurrency } = revision.facts;
    let change: string | null = null;
    let changeGap: PriceHistoryEntry["changeGap"] = null;

    if (priceAmount === null || priceCurrency === null) {
      changeGap = index === 0 ? "first" : "on_request";
    } else if (lastPublished === null) {
      changeGap = "first";
    } else if (lastPublished.currency !== priceCurrency) {
      changeGap = "currency_changed";
    } else if (lastPublished.amount !== priceAmount) {
      const ratio = decimals.divide(
        decimals.parseDecimal(priceAmount, "price"),
        decimals.parseDecimal(lastPublished.amount, "previousPrice"),
        "priceChange",
      );
      change = decimals.formatDecimal(ratio.minus(ONE), "priceChange");
    } else {
      change = "0";
    }
    if (priceAmount !== null && priceCurrency !== null) {
      lastPublished = { amount: priceAmount, currency: priceCurrency };
    }

    entries.push({
      revision: revision.revision,
      observedAt: revision.observedAt,
      pageKind: revision.pageKind,
      priceAmount,
      priceCurrency,
      change,
      changeGap,
      changes: previous === null ? [] : changesBetween(previous, revision),
    });
  });

  return entries.reverse();
}

/** Cuántas veces bajó el precio publicado, en la misma moneda. */
export function priceCuts(history: readonly PriceHistoryEntry[]): number {
  return history.filter(
    (entry) => entry.change !== null && entry.change.startsWith("-"),
  ).length;
}
