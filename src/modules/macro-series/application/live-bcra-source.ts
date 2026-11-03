import type { EgressFetch } from "@/modules/ingestion/application/egress-fetch";
import type { SourceRegistryRepository } from "@/modules/ingestion/application/source-registry-repository";
import {
  evaluateIngestionRights,
  type IngestionRightsRequest,
} from "@/modules/ingestion/domain/source-registry-entry";

import {
  assemblePages,
  parseCatalogPage,
  parseMethodologyPage,
  parseSeriesPage,
  seriesPagesInOrder,
  type BcraCatalogEntry,
  type BcraSeriesPoint,
  type ParsedPage,
  type RowRejection,
} from "../domain/bcra-monetary-parser";
import {
  BCRA_CATALOG_DATASET_ID,
  BCRA_MONETARY_SOURCE_ID,
  BCRA_OBSERVATIONS_DATASET_ID,
  catalogPageUrl,
  MAX_CATALOG_PAGES,
  MAX_METHODOLOGY_PAGES,
  MAX_SERIES_PAGES,
  methodologyPageUrl,
  seriesPageUrl,
  type BcraVariableId,
} from "../domain/bcra-monetary-source";

/**
 * Adaptador vivo de Estadísticas Monetarias v4 (ADR 0065). Las respuestas se
 * normalizan y **no se conservan**: la fila de derechos declara `rawStorage`
 * `restricted`, y el gate se negaría si esta corrida dijera que guarda el
 * cuerpo.
 */
const RIGHTS_REQUEST: IngestionRightsRequest = {
  storesRawPayload: false,
  storesNormalizedValues: true,
  publicDisplay: false,
};

export type BcraSourceErrorCode =
  | "source_not_registered"
  | "dataset_not_registered"
  | "rights_not_approved"
  | "fetch_failed"
  | "unexpected_status"
  | "rate_limited"
  | "payload_rejected"
  | "too_many_pages";

export class BcraSourceError extends Error {
  readonly code: BcraSourceErrorCode;
  readonly resource: string;
  /** `Retry-After` de un `429` o `503`, sin interpretar. */
  readonly retryAfter: string | null;

  constructor(
    code: BcraSourceErrorCode,
    resource: string,
    detail: string | null = null,
    retryAfter: string | null = null,
  ) {
    super(
      detail === null
        ? `${code}: ${resource}`
        : `${code}: ${resource}: ${detail}`,
    );
    this.name = "BcraSourceError";
    this.code = code;
    this.resource = resource;
    this.retryAfter = retryAfter;
  }
}

export type FetchedCatalog = {
  readonly entries: readonly BcraCatalogEntry[];
  readonly rejections: readonly RowRejection[];
  readonly methodologies: ReadonlyMap<number, string | null>;
  readonly methodologyRejections: readonly RowRejection[];
  /** Metodologías de ids que el catálogo no lista: se leen y se ignoran. */
  readonly orphanMethodologies: number;
  readonly requests: number;
  readonly byteLength: number;
  readonly sourceDocumentId: string;
  /** El instante en que llegó la última página: la vigencia de lo que se registre. */
  readonly observedAt: string;
};

export type FetchedSeries = {
  readonly variableId: BcraVariableId;
  readonly points: readonly BcraSeriesPoint[];
  readonly rejections: readonly RowRejection[];
  readonly coverage: "complete" | "window";
  /** Total de puntos que la fuente dice tener. */
  readonly total: number;
  readonly requests: number;
  readonly byteLength: number;
  readonly sourceDocumentId: string;
  readonly observedAt: string;
};

export type BcraSourceProvider = {
  loadCatalog(): Promise<FetchedCatalog>;
  /**
   * `complete` pagina la historia entera; `window` pide sólo la página más
   * reciente, salvo que la serie quepa entera en ella.
   */
  loadSeries(
    variableId: BcraVariableId,
    coverage: "complete" | "window",
  ): Promise<FetchedSeries>;
};

type Download = {
  readonly status: number;
  readonly body: Uint8Array;
  readonly byteLength: number;
  readonly fetchedAt: string;
};

/**
 * Lo que comparten las APIs del BCRA (ADR 0065, ADR 0067): los derechos se
 * evalúan **antes** de la red, un `429` o un `503` corta la corrida sin
 * reintento, y la paginación tiene un techo que un `count` absurdo no pasa.
 */
export function createBcraTransport(dependencies: {
  readonly sourceRegistry: SourceRegistryRepository;
  readonly fetch: EgressFetch;
  readonly sourceId: string;
}) {
  const { sourceId } = dependencies;

  async function authorize(datasetId: string): Promise<void> {
    const entry = await dependencies.sourceRegistry.findBySourceId(sourceId);

    if (!entry) {
      throw new BcraSourceError("source_not_registered", datasetId);
    }

    if (!entry.datasets.includes(datasetId)) {
      throw new BcraSourceError("dataset_not_registered", datasetId);
    }

    const rights = evaluateIngestionRights(entry, RIGHTS_REQUEST);

    if (!rights.allowed) {
      // Fail-closed **antes** del egress: la red no se toca.
      throw new BcraSourceError(
        "rights_not_approved",
        datasetId,
        rights.blockedBy.join(", "),
      );
    }
  }

  async function download(resource: string, url: string): Promise<Download> {
    let response: Awaited<ReturnType<EgressFetch>>;

    try {
      response = await dependencies.fetch({
        sourceId: sourceId,
        url,
        accept: "application/json",
      });
    } catch (cause) {
      throw new BcraSourceError(
        "fetch_failed",
        resource,
        cause instanceof Error ? cause.message : "egress failed",
      );
    }

    if (response.status === 429 || response.status === 503) {
      // Sin reintento: la corrida se corta y el owner decide cuándo volver.
      throw new BcraSourceError(
        "rate_limited",
        resource,
        `status ${response.status}`,
        response.retryAfter ?? null,
      );
    }

    if (response.status !== 200) {
      throw new BcraSourceError(
        "unexpected_status",
        resource,
        `status ${response.status}`,
      );
    }

    return response;
  }

  /** Baja páginas hasta cubrir lo pedido, con un techo que un `count` absurdo no pasa. */
  async function paginate<Row>(
    resource: string,
    maxPages: number,
    urlOf: (offset: number) => string,
    parse: (body: Uint8Array, offset: number) => ParsedPage<Row>,
    stopAfterFirst: boolean,
  ) {
    const pages: Extract<ParsedPage<Row>, { ok: true }>[] = [];
    let byteLength = 0;
    let observedAt = "";
    let offset = 0;

    for (;;) {
      if (pages.length >= maxPages) {
        throw new BcraSourceError("too_many_pages", resource);
      }

      const response = await download(resource, urlOf(offset));
      byteLength += response.byteLength;
      observedAt = response.fetchedAt;
      const page = parse(response.body, offset);

      if (!page.ok) {
        throw new BcraSourceError("payload_rejected", resource, page.code);
      }

      pages.push(page);
      const consumed =
        page.consumed ?? page.rows.length + page.rejections.length;
      offset += consumed;

      if (stopAfterFirst || offset >= page.total || consumed === 0) {
        break;
      }
    }

    return { pages, byteLength, observedAt, requests: pages.length };
  }

  return { authorize, paginate };
}

export function createLiveBcraSource(dependencies: {
  readonly sourceRegistry: SourceRegistryRepository;
  readonly fetch: EgressFetch;
}): BcraSourceProvider {
  const { authorize, paginate } = createBcraTransport({
    ...dependencies,
    sourceId: BCRA_MONETARY_SOURCE_ID,
  });

  return {
    async loadCatalog() {
      await authorize(BCRA_CATALOG_DATASET_ID);

      const catalog = await paginate(
        "catalog",
        MAX_CATALOG_PAGES,
        catalogPageUrl,
        (body, offset) => parseCatalogPage(body, { httpStatus: 200, offset }),
        false,
      );
      const methodology = await paginate(
        "methodology",
        MAX_METHODOLOGY_PAGES,
        methodologyPageUrl,
        (body, offset) =>
          parseMethodologyPage(body, { httpStatus: 200, offset }),
        false,
      );

      const entries = assemblePages(
        catalog.pages,
        (row) => String(row.variableId),
        "complete",
      );

      if (!entries.ok) {
        throw new BcraSourceError("payload_rejected", "catalog", entries.code);
      }

      const texts = assemblePages(
        methodology.pages,
        (row) => String(row.variableId),
        "complete",
      );

      if (!texts.ok) {
        throw new BcraSourceError(
          "payload_rejected",
          "methodology",
          texts.code,
        );
      }

      const listed = new Set(entries.rows.map((entry) => entry.variableId));
      const methodologies = new Map<number, string | null>();
      let orphanMethodologies = 0;

      for (const row of texts.rows) {
        if (listed.has(row.variableId)) {
          methodologies.set(row.variableId, row.text);
        } else {
          orphanMethodologies += 1;
        }
      }

      return {
        entries: entries.rows,
        rejections: entries.rejections,
        methodologies,
        methodologyRejections: texts.rejections,
        orphanMethodologies,
        requests: catalog.requests + methodology.requests,
        byteLength: catalog.byteLength + methodology.byteLength,
        sourceDocumentId: catalogPageUrl(0),
        observedAt: methodology.observedAt,
      };
    },

    async loadSeries(variableId, coverage) {
      await authorize(BCRA_OBSERVATIONS_DATASET_ID);

      const resource = `series ${variableId}`;
      const series = await paginate(
        resource,
        MAX_SERIES_PAGES,
        (offset) => seriesPageUrl(variableId, offset),
        (body, offset) =>
          parseSeriesPage(body, { httpStatus: 200, variableId, offset }),
        coverage === "window",
      );

      if (!seriesPagesInOrder(series.pages)) {
        throw new BcraSourceError(
          "payload_rejected",
          resource,
          "unexpected_order",
        );
      }

      const first = series.pages[0]!;
      const read = series.pages.reduce(
        (sum, page) => sum + page.rows.length + page.rejections.length,
        0,
      );
      // Una ventana que alcanzó el total es la serie entera.
      const effective = read >= first.total ? "complete" : coverage;
      const assembled = assemblePages(
        series.pages,
        (row) => row.periodOn,
        effective,
      );

      if (!assembled.ok) {
        throw new BcraSourceError("payload_rejected", resource, assembled.code);
      }

      return {
        variableId,
        points: assembled.rows,
        rejections: assembled.rejections,
        coverage: effective,
        total: assembled.total,
        requests: series.requests,
        byteLength: series.byteLength,
        sourceDocumentId: seriesPageUrl(variableId, 0),
        observedAt: series.observedAt,
      };
    },
  };
}
