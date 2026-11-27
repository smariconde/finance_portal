import { z } from "zod";

import { descriptionSimhash } from "../../../../src/modules/real-estate/domain/description-simhash";
import {
  parseListingCapture,
  type Amenity,
  type Condition,
  type LegalFlag,
  type ListingCapture,
  type PageKind,
  type PropertyType,
} from "../../../../src/modules/real-estate/domain/listing-capture";
import { listingFeatures } from "../../../../src/modules/real-estate/domain/listing-features";

import {
  boundedInteger,
  coordinate,
  foldedLabel,
  positiveDecimal,
  publishedText,
} from "../normalize";
import { PORTAL_MATCHES } from "../portal-matches";
import type {
  PortalAdapter,
  PortalDocument,
  PortalReading,
  SkipReason,
} from "../types";

/**
 * Remax Argentina (`remax-ar`), medido por el agente en Brave el 2026-11-27
 * (ADR 0089, enmienda de `F13-02`).
 *
 * La página es Angular con render en el servidor: trae
 * `<script id="ng-state" type="application/json">` con las respuestas de su
 * propia API ya resueltas. Cada respuesta es `{ u, b, s, … }` bajo una clave
 * que es un hash **inestable**, así que se busca por la URL `u`:
 *
 * - ficha: `…/api/listings/findBySlug/<slug>`, el aviso en `b.data`;
 * - listado: `…/api/listings/findAllWithEntrepreneurships`, 24 avisos en
 *   `b.data.data[]`.
 *
 * No hay navegación de aplicación de una sola página que importe: la tarjeta
 * abre la ficha en otra pestaña y el paginador recarga el documento, así que
 * leer el estado al cargar alcanza. JSON-LD sólo trae un `BreadcrumbList`.
 *
 * El ID es el uuid del aviso: `id` en la ficha, `entityId` en la tarjeta (el
 * `id` numérico de la tarjeta no existe en la ficha). El portal no publica
 * fecha de publicación ni barrio.
 */
export const REMAX_ADAPTER_VERSION = "remax-ng-state-1.0.0";

const ORIGIN = "https://www.remax.com.ar";
const DETAIL_API = "/api/listings/findBySlug/";
const SEARCH_API = "/api/listings/findAllWithEntrepreneurships";
const SEARCH_PATHS = new Set(["/listings/buy", "/listings/rent"]);

const valueObject = z.looseObject({ value: z.string() }).nullish();

/**
 * Sólo lo que el parser lee. Un campo con otro tipo rechaza ese aviso por
 * nombre; los que no se leen (contacto, fotos, descripción entera) quedan
 * fuera del esquema y nunca salen de la función.
 */
const remaxListingSchema = z.looseObject({
  id: z.union([z.string(), z.number()]),
  entityId: z.string().nullish(),
  slug: z.string(),
  title: z.string().nullish(),
  description: z.string().nullish(),
  entrepreneurship: z.boolean().nullish(),
  operation: valueObject,
  type: valueObject,
  listingStatus: valueObject,
  price: z.number().nullish(),
  priceExposure: z.boolean().nullish(),
  currency: valueObject,
  expensesPrice: z.number().nullish(),
  expensesCurrency: valueObject,
  dimensionCovered: z.number().nullish(),
  dimensionTotalBuilt: z.number().nullish(),
  dimensionLand: z.number().nullish(),
  totalRooms: z.number().nullish(),
  bedrooms: z.number().nullish(),
  bathrooms: z.number().nullish(),
  parkingSpaces: z.number().nullish(),
  yearBuilt: z.number().nullish(),
  aptCredit: z.boolean().nullish(),
  conditions: z.array(valueObject).nullish(),
  features: z.array(z.unknown()).nullish(),
  displayAddress: z.string().nullish(),
  geo: z.looseObject({ neighborhood: z.string().nullish() }).nullish(),
  location: z
    .looseObject({ coordinates: z.array(z.number()).nullish() })
    .nullish(),
  associate: z
    .looseObject({
      officeName: z.string().nullish(),
      office: z.looseObject({ name: z.string().nullish() }).nullish(),
    })
    .nullish(),
  photos: z.array(z.unknown()).nullish(),
});

type RemaxListing = z.infer<typeof remaxListingSchema>;

const PROPERTY_TYPES: Readonly<Record<string, PropertyType>> = {
  casa: "house",
  casa_duplex: "house",
  casa_triplex: "house",
  chalet: "house",
  quinta: "house",
  departamento_estandar: "apartment",
  departamento_duplex: "apartment",
  departamento_triplex: "apartment",
  departamento_monoambiente: "apartment",
  loft: "apartment",
  penthouse: "apartment",
  semipiso: "apartment",
  piso: "apartment",
  ph: "ph",
  terrenos_y_lotes: "land",
  cochera: "parking",
  oficina: "office",
  local: "retail",
};

/**
 * Remax nombra las variantes con un prefijo (`departamento_penthouse`,
 * `casa_duplex`): la tabla manda y, si no está, el prefijo. Un galpón o un
 * campo no tienen tipo en el contrato y quedan afuera por nombre.
 */
function propertyTypeOf(value: string): PropertyType | undefined {
  const exact = PROPERTY_TYPES[value];
  if (exact !== undefined) return exact;
  if (value.startsWith("departamento_")) return "apartment";
  if (value.startsWith("casa_")) return "house";
  return undefined;
}

const OPERATIONS: Readonly<Record<string, "sale" | "rent">> = {
  sale: "sale",
  rent: "rent",
};

/** `listingStatus` que siguen publicados; «reservado» sigue a la vista. */
const PUBLISHED_STATUSES = new Set(["active", "reserved"]);

const PORTAL_CONDITIONS: Readonly<
  Record<string, Exclude<Condition, "unknown">>
> = {
  a_estrenar: "new",
  excelente: "good",
  muy_bueno: "good",
  bueno: "good",
  a_refaccionar: "to_renovate",
  a_reciclar: "to_renovate",
  // `en_construccion` no es una señal: ni a estrenar ni buen estado.
};

const AMENITY_LABELS: readonly (readonly [Amenity, RegExp])[] = [
  ["pool", /^(pileta|piscina)\b/u],
  ["gym", /^(gimnasio|gym)\b/u],
  ["sum", /^(sum|salon de usos multiples)\b/u],
  ["security", /^(seguridad|vigilancia)\b/u],
  // En Córdoba un quincho es el lugar de la parrilla.
  ["grill", /^(parrilla|parrillero|asador|quincho)\b/u],
  ["elevator", /^ascensor\b/u],
  ["balcony", /^balcon\b/u],
  ["garden", /^(jardin|parque)\b/u],
];

/** Tipos sin ambientes que contar: un 0 del portal no es un dato. */
const WITHOUT_ROOMS: ReadonlySet<PropertyType> = new Set(["land", "parking"]);

function stateEntries(text: string | null): readonly unknown[] | null {
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  return Object.values(parsed as Record<string, unknown>);
}

const responseSchema = z.looseObject({
  u: z.string(),
  s: z.number().optional(),
  b: z.looseObject({ data: z.unknown() }),
});

function responsesFor(
  entries: readonly unknown[],
  api: string,
): readonly z.infer<typeof responseSchema>[] {
  return entries.flatMap((entry) => {
    const parsed = responseSchema.safeParse(entry);
    if (!parsed.success) return [];
    const path = parsed.data.u.split("?")[0];
    if (!path.includes(api)) return [];
    if (parsed.data.s !== undefined && parsed.data.s !== 200) return [];
    return [parsed.data];
  });
}

function featureLabels(features: readonly unknown[]): readonly string[] {
  return features.flatMap((feature) => {
    if (typeof feature === "string") return [feature];
    if (feature === null || typeof feature !== "object") return [];
    const record = feature as Record<string, unknown>;
    return ["value", "name", "label"].flatMap((key) =>
      typeof record[key] === "string" ? [record[key] as string] : [],
    );
  });
}

function amenitiesOf(features: readonly unknown[]): Amenity[] {
  const found = new Set<Amenity>();
  for (const label of featureLabels(features)) {
    const folded = foldedLabel(label);
    for (const [amenity, pattern] of AMENITY_LABELS) {
      if (pattern.test(folded)) found.add(amenity);
    }
  }
  return [...found].sort();
}

/** Remax escribe «Manzana 253 0»: el 0 final es una altura que no cargaron. */
function declaredAddress(value: string | null | undefined): string | null {
  const text = publishedText(value, 300);
  if (text === null) return null;
  const withoutZero = text.replace(/\s+0$/u, "");
  return withoutZero === "" ? null : withoutZero;
}

function ageYears(
  yearBuilt: number | null | undefined,
  capturedAt: string,
): number | null {
  const year = boundedInteger(yearBuilt, 1800, 2100);
  if (year === null) return null;
  const age = Number(capturedAt.slice(0, 4)) - year;
  return age >= 0 && age <= 300 ? age : null;
}

type Mapped =
  | { readonly ok: true; readonly capture: ListingCapture }
  | { readonly ok: false; readonly reason: SkipReason };

export function mapRemaxListing(
  input: unknown,
  pageKind: PageKind,
  capturedAt: string,
): Mapped {
  const parsed = remaxListingSchema.safeParse(input);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return {
      ok: false,
      reason: `field_invalid:${typeof field === "string" ? field : "$"}`,
    };
  }
  const raw: RemaxListing = parsed.data;

  if (raw.entrepreneurship === true)
    return { ok: false, reason: "entrepreneurship" };

  const externalId = pageKind === "listing_detail" ? raw.id : raw.entityId;
  if (typeof externalId !== "string")
    return { ok: false, reason: "id_missing" };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(raw.slug))
    return { ok: false, reason: "slug_invalid" };

  const operation = OPERATIONS[raw.operation?.value ?? ""];
  if (operation === undefined)
    return { ok: false, reason: "operation_unmapped" };
  const propertyType = propertyTypeOf(raw.type?.value ?? "");
  if (propertyType === undefined)
    return { ok: false, reason: "property_type_unmapped" };
  if (!PUBLISHED_STATUSES.has(raw.listingStatus?.value ?? ""))
    return { ok: false, reason: "status_not_published" };

  const onRequest = raw.priceExposure === false;
  const priceAmount = onRequest ? null : positiveDecimal(raw.price);
  const priceCurrency = onRequest ? null : raw.currency?.value;
  if (!onRequest && priceAmount === null)
    return { ok: false, reason: "price_missing" };
  if (
    priceCurrency !== null &&
    priceCurrency !== "USD" &&
    priceCurrency !== "ARS"
  )
    return { ok: false, reason: "currency_unmapped" };

  const expensesAmount = positiveDecimal(raw.expensesPrice);
  const expensesCurrencyValue = raw.expensesCurrency?.value;
  const expensesCurrency =
    expensesAmount !== null &&
    (expensesCurrencyValue === "USD" || expensesCurrencyValue === "ARS")
      ? expensesCurrencyValue
      : null;

  const coordinates = raw.location?.coordinates ?? null;
  // GeoJSON: [longitud, latitud]. [0, 0] es un pin sin cargar.
  const longitude =
    coordinates?.length === 2 ? coordinate(coordinates[0], 180) : null;
  const latitude =
    coordinates?.length === 2 ? coordinate(coordinates[1], 90) : null;
  const located =
    latitude !== null &&
    longitude !== null &&
    !(latitude === "0" && longitude === "0");

  const withoutRooms = WITHOUT_ROOMS.has(propertyType);
  const portalConditions = (raw.conditions ?? []).flatMap((condition) => {
    const mapped = PORTAL_CONDITIONS[condition?.value ?? ""];
    return mapped === undefined ? [] : [mapped];
  });
  const portalLegalFlags: LegalFlag[] =
    raw.aptCredit === true ? ["credit_eligible"] : [];
  const features = listingFeatures({
    propertyType,
    texts: [raw.title ?? null, raw.description ?? null],
    portalConditions,
    portalLegalFlags,
  });

  const capture = {
    source: "remax-ar",
    externalId,
    canonicalUrl: `${ORIGIN}/listings/${raw.slug}`,
    pageKind,
    parseBasis: "embedded_state",
    operation,
    propertyType,
    priceAmount,
    priceStatus: onRequest ? "on_request" : "published",
    priceCurrency: priceCurrency ?? null,
    expensesAmount: expensesCurrency === null ? null : expensesAmount,
    expensesCurrency,
    coveredAreaM2: positiveDecimal(raw.dimensionCovered),
    totalAreaM2: positiveDecimal(raw.dimensionTotalBuilt),
    landAreaM2: positiveDecimal(raw.dimensionLand),
    rooms: withoutRooms ? null : boundedInteger(raw.totalRooms, 1, 99),
    bedrooms: withoutRooms ? null : boundedInteger(raw.bedrooms, 0, 99),
    bathrooms: withoutRooms ? null : boundedInteger(raw.bathrooms, 0, 99),
    parkingSpaces:
      pageKind === "listing_detail"
        ? boundedInteger(raw.parkingSpaces, 0, 999)
        : null,
    ageYears: ageYears(raw.yearBuilt, capturedAt),
    // `floors` es ambiguo: en un departamento de 2010 vale 4, que es el
    // edificio, no el piso de la unidad. No se lee.
    floor: null,
    amenities: amenitiesOf(raw.features ?? []),
    condition: features.condition,
    legalFlags: [...features.legalFlags],
    addressDeclared: declaredAddress(raw.displayAddress),
    neighborhood: publishedText(raw.geo?.neighborhood, 120),
    latitude: located ? latitude : null,
    longitude: located ? longitude : null,
    agency: publishedText(
      raw.associate?.office?.name ?? raw.associate?.officeName,
      200,
    ),
    publishedAt: null,
    descriptionSimhash:
      pageKind === "listing_detail"
        ? descriptionSimhash(raw.description ?? null)
        : null,
    photoDhashes: [],
    photoCount: Math.min((raw.photos ?? []).length, 999),
    capturedAt,
  };

  const checked = parseListingCapture(capture);
  if (!checked.ok) {
    const first = checked.rejection.issues[0]?.split(":")[0] ?? "$";
    return { ok: false, reason: `contract_rejected:${first}` };
  }
  return { ok: true, capture: checked.capture };
}

function pageKindOf(url: URL): PageKind | null {
  if (url.origin !== ORIGIN) return null;
  const path = url.pathname.replace(/\/+$/u, "");
  if (SEARCH_PATHS.has(path)) return "search_result";
  if (/^\/listings\/[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(path))
    return "listing_detail";
  return null;
}

/**
 * Una búsqueda de Remax: `page` desde 0, `pageSize=24` y `sort=-createdAt`
 * («más recientes»). Los demás parámetros (`landingPath`, filtros) quedan
 * como el owner los eligió, ordenados para que la misma búsqueda sea la misma
 * URL.
 */
function normalizeSearch(raw: string): string | null {
  if (!URL.canParse(raw)) return null;
  const url = new URL(raw);
  if (pageKindOf(url) !== "search_result") return null;
  const params = new URLSearchParams(url.search);
  params.delete("page");
  params.set("pageSize", "24");
  params.set("sort", "-createdAt");
  params.sort();
  return `${ORIGIN}${url.pathname.replace(/\/+$/u, "")}?${params.toString()}`;
}

function searchPageUrl(search: string, page: number): string {
  const url = new URL(search);
  url.searchParams.set("page", String(page));
  url.searchParams.sort();
  return url.toString();
}

/** La búsqueda medida el 2026-11-27: venta en Capital, Córdoba. */
const DEFAULT_SEARCH = normalizeSearch(
  `${ORIGIN}/listings/buy?page=0&pageSize=24&sort=-createdAt&landingPath=propiedades-en-venta-en-capital-cordoba&viewMode=listViewMode&filterCount=0`,
)!;

function read(document: PortalDocument): PortalReading {
  const url = URL.canParse(document.url) ? new URL(document.url) : null;
  const pageKind = url === null ? null : pageKindOf(url);
  if (pageKind === null) return { kind: "not_a_listing_page" };

  const entries = stateEntries(
    document.embeddedStates["script#ng-state"] ?? null,
  );
  if (entries === null)
    return { kind: "rejected", reason: "embedded_state_missing" };

  let listings: readonly unknown[];
  if (pageKind === "listing_detail") {
    const slug = url!.pathname.replace(/\/+$/u, "").split("/").at(-1);
    const responses = responsesFor(entries, DETAIL_API).filter((response) =>
      response.u.split("?")[0].endsWith(`${DETAIL_API}${slug}`),
    );
    if (responses.length !== 1)
      return { kind: "rejected", reason: "detail_response_missing" };
    listings = [responses[0].b.data];
  } else {
    const responses = responsesFor(entries, SEARCH_API);
    if (responses.length !== 1)
      return { kind: "rejected", reason: "search_response_missing" };
    const page = z
      .looseObject({ data: z.array(z.unknown()) })
      .safeParse(responses[0].b.data);
    if (!page.success)
      return { kind: "rejected", reason: "search_page_invalid" };
    listings = page.data.data;
  }

  const captures: ListingCapture[] = [];
  const skipped: Record<SkipReason, number> = {};
  const seen = new Set<string>();
  for (const listing of listings) {
    const mapped = mapRemaxListing(listing, pageKind, document.capturedAt);
    if (!mapped.ok) {
      skipped[mapped.reason] = (skipped[mapped.reason] ?? 0) + 1;
      continue;
    }
    if (seen.has(mapped.capture.externalId)) {
      skipped.repeated_on_page = (skipped.repeated_on_page ?? 0) + 1;
      continue;
    }
    seen.add(mapped.capture.externalId);
    captures.push(mapped.capture);
  }
  if (pageKind === "listing_detail" && captures.length === 0) {
    return {
      kind: "rejected",
      reason: Object.keys(skipped)[0] ?? "detail_unreadable",
    };
  }
  return {
    kind: "captures",
    pageKind,
    parseBasis: "embedded_state",
    captures,
    skipped,
  };
}

export const remaxAdapter: PortalAdapter = {
  sourceId: "remax-ar",
  version: REMAX_ADAPTER_VERSION,
  matches: PORTAL_MATCHES["remax-ar"],
  photoHosts: ["d1acdg20u0pmxj.cloudfront.net"],
  embeddedStateSelectors: ["script#ng-state"],
  challengeSelectors: [
    "#challenge-form",
    "#cf-challenge-running",
    "iframe[src*='challenges.cloudflare.com']",
    "#px-captcha",
    "iframe[src*='captcha-delivery.com']",
  ],
  fields: {
    externalId: {
      basis: "embedded_state",
      path: "ficha id · tarjeta entityId (uuid)",
    },
    canonicalUrl: {
      basis: "embedded_state",
      path: "https://www.remax.com.ar/listings/<slug>",
    },
    operation: { basis: "embedded_state", path: "operation.value" },
    propertyType: { basis: "embedded_state", path: "type.value" },
    priceAmount: { basis: "embedded_state", path: "price" },
    priceStatus: { basis: "embedded_state", path: "priceExposure" },
    priceCurrency: { basis: "embedded_state", path: "currency.value" },
    expensesAmount: { basis: "embedded_state", path: "expensesPrice" },
    expensesCurrency: {
      basis: "embedded_state",
      path: "expensesCurrency.value",
    },
    coveredAreaM2: { basis: "embedded_state", path: "dimensionCovered" },
    totalAreaM2: { basis: "embedded_state", path: "dimensionTotalBuilt" },
    landAreaM2: { basis: "embedded_state", path: "dimensionLand" },
    rooms: { basis: "embedded_state", path: "totalRooms" },
    bedrooms: { basis: "embedded_state", path: "bedrooms" },
    bathrooms: { basis: "embedded_state", path: "bathrooms" },
    parkingSpaces: {
      basis: "embedded_state",
      path: "parkingSpaces (sólo ficha)",
    },
    ageYears: { basis: "embedded_state", path: "yearBuilt" },
    floor: { absent: "ambiguous", note: "floors es el edificio, no la unidad" },
    amenities: { basis: "embedded_state", path: "features[].value" },
    condition: { basis: "embedded_state", path: "conditions[].value + texto" },
    legalFlags: { basis: "embedded_state", path: "aptCredit + texto" },
    addressDeclared: { basis: "embedded_state", path: "displayAddress" },
    neighborhood: {
      basis: "embedded_state",
      path: "geo.neighborhood (siempre null medido)",
    },
    latitude: { basis: "embedded_state", path: "location.coordinates[1]" },
    longitude: { basis: "embedded_state", path: "location.coordinates[0]" },
    agency: {
      basis: "embedded_state",
      path: "associate.office.name · associate.officeName",
    },
    publishedAt: {
      absent: "not_published",
      note: "ninguna fecha en el estado",
    },
    descriptionSimhash: {
      basis: "embedded_state",
      path: "description (sólo ficha)",
    },
    photoDhashes: { absent: "computed_later", note: "dHash en F13-05" },
    photoCount: {
      basis: "embedded_state",
      path: "photos.length (la tarjeta trae 5 como máximo)",
    },
  },
  pageKindOf,
  normalizeSearch,
  searchPageUrl,
  defaultSearches: [DEFAULT_SEARCH],
  read,
};
