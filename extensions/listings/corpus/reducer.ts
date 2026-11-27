import { createHash } from "node:crypto";

import type { RealEstatePortal } from "../../../src/modules/real-estate/domain/listing-capture";
import type { ExportedPage } from "../capture/messages";
import type { PortalDocument } from "../portals/types";

/**
 * El reductor de capturas reales (ADR 0089, Decisión 10). Una página que el
 * owner exportó desde el popup pasa por acá antes de entrar al repositorio
 * público como oráculo del adapter.
 *
 * `listing-corpus-reducer-1.0.0` trabaja con **lista blanca**: de cada aviso
 * quedan sólo las claves que el parser lee, y de las respuestas del estado
 * embebido sólo las de avisos. Así un campo nuevo que el portal agregue
 * mañana —un teléfono, un correo— no entra por omisión. Además:
 *
 * - la descripción no entra (puede traer teléfonos y nombres): su SimHash y
 *   `listing-features-1.0.0` se prueban con fixtures sintéticas;
 * - las fotos quedan como objetos vacíos, para conservar la cuenta;
 * - del agente queda sólo el nombre de la oficina, que es la `agency`;
 * - los encabezados de las respuestas, el JSON-LD y la consulta de las URLs
 *   no entran.
 */
export const LISTING_CORPUS_REDUCER_VERSION = "listing-corpus-reducer-1.0.0";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

type PortalReduction = {
  /** El selector del estado embebido que se conserva. */
  readonly stateSelector: string;
  /** Una respuesta del estado entra si su URL contiene alguno de estos. */
  readonly responseApis: readonly string[];
  /** Dónde están los avisos dentro de `b.data`: el objeto o una lista. */
  readonly listingsAt: (data: Json) => {
    readonly listings: Json[];
    readonly wrap: (reduced: Json[]) => Json;
  };
  /** Las claves de un aviso que sobreviven, con su reducción. */
  readonly keep: Readonly<Record<string, (value: Json) => Json>>;
};

const asIs = (value: Json) => value;
const valueOnly = (value: Json): Json =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? { value: (value.value ?? null) as Json }
    : null;
const valueList = (value: Json): Json =>
  Array.isArray(value) ? value.map(valueOnly) : null;
const featureLabels = (value: Json): Json =>
  Array.isArray(value)
    ? value.map((feature) =>
        feature !== null &&
        typeof feature === "object" &&
        !Array.isArray(feature)
          ? { value: typeof feature.value === "string" ? feature.value : null }
          : null,
      )
    : null;
const emptyObjects = (value: Json): Json =>
  Array.isArray(value) ? value.map(() => ({})) : null;
const coordinatesOnly = (value: Json): Json =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? { coordinates: (value.coordinates ?? null) as Json }
    : null;
const neighborhoodOnly = (value: Json): Json =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? { neighborhood: (value.neighborhood ?? null) as Json }
    : null;
const officeOnly = (value: Json): Json => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return null;
  const office = value.office;
  return {
    officeName: typeof value.officeName === "string" ? value.officeName : null,
    office:
      office !== null && typeof office === "object" && !Array.isArray(office)
        ? { name: typeof office.name === "string" ? office.name : null }
        : null,
  };
};

const REDUCTIONS: Readonly<Partial<Record<RealEstatePortal, PortalReduction>>> =
  {
    "remax-ar": {
      stateSelector: "script#ng-state",
      responseApis: [
        "/api/listings/findBySlug/",
        "/api/listings/findAllWithEntrepreneurships",
      ],
      listingsAt: (data) => {
        if (
          data !== null &&
          typeof data === "object" &&
          !Array.isArray(data) &&
          Array.isArray(data.data)
        ) {
          const page = data;
          return {
            listings: page.data as Json[],
            wrap: (reduced) => ({
              data: reduced,
              page: (page.page ?? null) as Json,
              pageSize: (page.pageSize ?? null) as Json,
              totalPages: (page.totalPages ?? null) as Json,
              totalItems: (page.totalItems ?? null) as Json,
            }),
          };
        }
        return { listings: [data], wrap: (reduced) => reduced[0] };
      },
      keep: {
        id: asIs,
        entityId: asIs,
        slug: asIs,
        internalId: asIs,
        title: asIs,
        entrepreneurship: asIs,
        operation: valueOnly,
        type: valueOnly,
        listingStatus: valueOnly,
        price: asIs,
        priceExposure: asIs,
        currency: valueOnly,
        expensesPrice: asIs,
        expensesCurrency: valueOnly,
        dimensionCovered: asIs,
        dimensionTotalBuilt: asIs,
        dimensionLand: asIs,
        dimensionUncovered: asIs,
        dimensionSemicovered: asIs,
        totalRooms: asIs,
        bedrooms: asIs,
        bathrooms: asIs,
        toilets: asIs,
        floors: asIs,
        parkingSpaces: asIs,
        yearBuilt: asIs,
        aptCredit: asIs,
        conditions: valueList,
        features: featureLabels,
        displayAddress: asIs,
        geo: neighborhoodOnly,
        location: coordinatesOnly,
        associate: officeOnly,
        photos: emptyObjects,
      },
    },
  };

export type ReducedPage = {
  readonly reducer: typeof LISTING_CORPUS_REDUCER_VERSION;
  readonly source: RealEstatePortal;
  /** La versión del adapter que leyó la página al exportarla. */
  readonly adapterVersion: string;
  readonly document: PortalDocument;
};

export class CorpusReductionError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "CorpusReductionError";
  }
}

function reduceListing(listing: Json, keep: PortalReduction["keep"]): Json {
  if (listing === null || typeof listing !== "object" || Array.isArray(listing))
    return null;
  const out: { [key: string]: Json } = {};
  for (const [key, reduce] of Object.entries(keep)) {
    if (key in listing) out[key] = reduce(listing[key] ?? null);
  }
  return out;
}

/** Reduce una página exportada. Lanza por nombre si no es lo que se espera. */
export function reducePage(exported: ExportedPage): ReducedPage {
  if (exported.exportVersion !== "listing-page-export-1.0.0")
    throw new CorpusReductionError("export_version_unknown");
  const reduction = REDUCTIONS[exported.source];
  if (reduction === undefined)
    throw new CorpusReductionError("portal_without_reduction");
  const stateText = exported.document.embeddedStates[reduction.stateSelector];
  if (typeof stateText !== "string")
    throw new CorpusReductionError("state_missing");

  let state: Json;
  try {
    state = JSON.parse(stateText) as Json;
  } catch {
    throw new CorpusReductionError("state_not_json");
  }
  if (state === null || typeof state !== "object" || Array.isArray(state))
    throw new CorpusReductionError("state_not_object");

  const kept: { [key: string]: Json } = {};
  let index = 0;
  for (const entry of Object.values(state)) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry))
      continue;
    const u = entry.u;
    if (
      typeof u !== "string" ||
      !reduction.responseApis.some((api) => u.includes(api))
    )
      continue;
    const body = entry.b;
    if (body === null || typeof body !== "object" || Array.isArray(body))
      continue;
    const { listings, wrap } = reduction.listingsAt(
      (body.data ?? null) as Json,
    );
    kept[`r${index}`] = {
      // Sólo la ruta: la consulta puede traer parámetros de seguimiento.
      u: u.split("?")[0],
      s: (entry.s ?? null) as Json,
      b: {
        data: wrap(
          listings.map((listing) => reduceListing(listing, reduction.keep)),
        ),
      },
    };
    index += 1;
  }
  if (index === 0) throw new CorpusReductionError("no_listing_response");

  const url = new URL(exported.document.url);
  return {
    reducer: LISTING_CORPUS_REDUCER_VERSION,
    source: exported.source,
    adapterVersion: exported.adapterVersion,
    document: {
      url: `${url.origin}${url.pathname}`,
      capturedAt: exported.document.capturedAt,
      embeddedStates: { [reduction.stateSelector]: JSON.stringify(kept) },
      jsonLd: [],
    },
  };
}

/** El archivo tal como se congela: JSON estable, dos espacios, salto final. */
export function corpusFileText(page: ReducedPage): string {
  return `${JSON.stringify(page, null, 2)}\n`;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export type CorpusManifestEntry = {
  readonly file: string;
  readonly sha256: string;
  readonly source: RealEstatePortal;
  readonly capturedAt: string;
  readonly reducer: typeof LISTING_CORPUS_REDUCER_VERSION;
};

export type CorpusManifest = {
  readonly corpus: "listing-capture-corpus";
  readonly entries: readonly CorpusManifestEntry[];
};
