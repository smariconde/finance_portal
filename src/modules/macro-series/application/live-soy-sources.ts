import type {
  EgressFetch,
  EgressFetchResponse,
} from "@/modules/ingestion/application/egress-fetch";
import type { SourceRegistryRepository } from "@/modules/ingestion/application/source-registry-repository";
import { evaluateIngestionRights } from "@/modules/ingestion/domain/source-registry-entry";
import { buildChartUrl } from "@/modules/prices/application/live-price-source";
import {
  CHART_PARSER_VERSION,
  parseChartPayload,
} from "@/modules/prices/domain/parse-chart-payload";
import { settleSession } from "@/modules/prices/domain/settled-session";

import type { ArgentinaIndicator } from "../domain/argentina-indicator";
import {
  BCR_CAC_PIZARRA_PARSER_VERSION,
  cacPizarraExportUrl,
  parseCacPizarraExport,
} from "../domain/bcr-cac-pizarra-parser";
import {
  BNA_DIVISAS_PARSER_VERSION,
  bnaDivisasUrl,
  parseBnaDivisas,
} from "../domain/bna-divisas-parser";
import { DECLARED_SOY_INDICATORS } from "../domain/declared-soy-indicators";
import {
  MAGYP_ESTIMACIONES_PARSER_VERSION,
  MAGYP_ESTIMACIONES_URL,
  MAGYP_SOY_ANNUAL_URL,
  magypEstimacionesBody,
  parseMagypAnnual,
  parseMagypEstimaciones,
  reconcileMagypEstimates,
  type MagypCampaign,
  type MagypVariable,
} from "../domain/magyp-estimaciones-parser";

import type {
  ArgentinaIndicatorSource,
  FetchedIndicatorPoints,
} from "./record-argentina-indicator";

export const CAC_PIZARRA_SOURCE_ID = "bcr-cac-pizarra";
export const CAC_PIZARRA_DATASET_ID = "bcr-cac.pizarra";
export const BNA_SOURCE_ID = "bna-fx";
export const BNA_DATASET_ID = "bna.divisas";
export const YAHOO_FUTURES_SOURCE_ID = "yahoo-finance";
export const YAHOO_FUTURES_DATASET_ID = "yahoo.futures-close";
export const MAGYP_ESTIMACIONES_SOURCE_ID = "magyp-estimaciones";
export const MAGYP_ESTIMACIONES_DATASET_ID = "magyp.estimaciones";
export const MAGYP_OPEN_DATA_SOURCE_ID = "magyp-datos-abiertos";
export const MAGYP_OPEN_DATA_DATASET_ID = "magyp.annual-csv";

/** Every daily soy leg asks for its whole history from this day. */
export const SOY_HISTORY_FROM = "2000-01-01";

export class SoySourceError extends Error {
  constructor(
    readonly code:
      | "rights_not_approved"
      | "not_declared"
      | "fetch_failed"
      | "rate_limited"
      | "unexpected_status"
      | "schema_changed"
      | "reconciliation_failed",
    readonly indicatorId: string,
    /** The parser's or the reconciliation's own reason, never a payload value. */
    readonly detail: string | null = null,
    readonly retryAfter: string | null = null,
  ) {
    super(`${code}${detail ? ` (${detail})` : ""}: ${indicatorId}`);
    this.name = "SoySourceError";
  }
}

type Dependencies = {
  readonly sourceRegistry: SourceRegistryRepository;
  readonly fetch: EgressFetch;
  readonly now: () => Date;
};

function assertDeclared(indicator: ArgentinaIndicator, sourceId: string): void {
  if (
    indicator.sourceId !== sourceId ||
    !DECLARED_SOY_INDICATORS.some(
      (item) => JSON.stringify(item) === JSON.stringify(indicator),
    )
  ) {
    throw new SoySourceError("not_declared", indicator.id);
  }
}

async function assertRights(
  registry: SourceRegistryRepository,
  sourceId: string,
  datasetId: string,
  indicatorId: string,
): Promise<void> {
  const entry = await registry.findBySourceId(sourceId);
  const rights =
    entry && entry.datasets.includes(datasetId)
      ? evaluateIngestionRights(entry, {
          storesRawPayload: false,
          storesNormalizedValues: true,
          publicDisplay: false,
        })
      : null;
  if (!rights?.allowed) {
    throw new SoySourceError("rights_not_approved", indicatorId);
  }
}

async function fetchOk(
  fetch: EgressFetch,
  request: Parameters<EgressFetch>[0],
  indicatorId: string,
): Promise<EgressFetchResponse> {
  let response: EgressFetchResponse;
  try {
    response = await fetch(request);
  } catch (error) {
    // The door's rejection code (`deadline_exceeded`, `daily_budget_exhausted`)
    // names the cause; a message could carry a URL, so it stays out.
    const code =
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : null;
    throw new SoySourceError(
      "fetch_failed",
      indicatorId,
      code !== null && /^[a-z_]{1,48}$/u.test(code) ? code : null,
    );
  }
  if (response.status === 429 || response.status === 503) {
    throw new SoySourceError(
      "rate_limited",
      indicatorId,
      null,
      response.retryAfter ?? null,
    );
  }
  if (response.status !== 200) {
    throw new SoySourceError(
      "unexpected_status",
      indicatorId,
      String(response.status),
    );
  }
  return response;
}

function dayOf(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** The board's whole history in one workbook (ADR 0071). */
export function createLiveCacPizarraSource(
  dependencies: Dependencies,
): ArgentinaIndicatorSource {
  return {
    sourceId: CAC_PIZARRA_SOURCE_ID,
    datasetId: CAC_PIZARRA_DATASET_ID,
    parserVersion: BCR_CAC_PIZARRA_PARSER_VERSION,
    async load(indicator): Promise<FetchedIndicatorPoints> {
      assertDeclared(indicator, CAC_PIZARRA_SOURCE_ID);
      await assertRights(
        dependencies.sourceRegistry,
        CAC_PIZARRA_SOURCE_ID,
        CAC_PIZARRA_DATASET_ID,
        indicator.id,
      );
      const response = await fetchOk(
        dependencies.fetch,
        {
          sourceId: CAC_PIZARRA_SOURCE_ID,
          url: cacPizarraExportUrl(
            indicator.externalId,
            dayOf(dependencies.now()),
          ),
          accept:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel",
        },
        indicator.id,
      );
      const parsed = parseCacPizarraExport(
        response.body,
        indicator.filters.producto ?? "",
      );
      if (!parsed.ok) {
        throw new SoySourceError("schema_changed", indicator.id, parsed.reason);
      }
      return {
        points: parsed.points,
        observedAt: response.fetchedAt,
        requests: 1,
        bytes: response.byteLength,
      };
    },
  };
}

/** One currency's buyer or seller quote, the whole history in one CSV. */
export function createLiveBnaSource(
  dependencies: Dependencies,
): ArgentinaIndicatorSource {
  return {
    sourceId: BNA_SOURCE_ID,
    datasetId: BNA_DATASET_ID,
    parserVersion: BNA_DIVISAS_PARSER_VERSION,
    async load(indicator): Promise<FetchedIndicatorPoints> {
      assertDeclared(indicator, BNA_SOURCE_ID);
      await assertRights(
        dependencies.sourceRegistry,
        BNA_SOURCE_ID,
        BNA_DATASET_ID,
        indicator.id,
      );
      const response = await fetchOk(
        dependencies.fetch,
        {
          sourceId: BNA_SOURCE_ID,
          url: bnaDivisasUrl(
            indicator.externalId,
            SOY_HISTORY_FROM,
            dayOf(dependencies.now()),
          ),
          accept: "text/csv",
        },
        indicator.id,
      );
      const side = indicator.filters.lado === "Venta" ? "seller" : "buyer";
      const parsed = parseBnaDivisas(
        new TextDecoder("latin1").decode(response.body),
        indicator.filters.moneda ?? "",
        side,
      );
      if (!parsed.ok) {
        throw new SoySourceError("schema_changed", indicator.id, parsed.reason);
      }
      return {
        points: parsed.points,
        observedAt: response.fetchedAt,
        requests: 1,
        bytes: response.byteLength,
      };
    },
  };
}

/**
 * A futures close from Yahoo's chart. The bar of a session still open is left
 * out (`settled-session-1.0.0`): for a future Yahoo declares the whole day as
 * the session, so a day's close enters with the next day's download.
 */
export function createLiveYahooFuturesSource(
  dependencies: Dependencies,
): ArgentinaIndicatorSource {
  return {
    sourceId: YAHOO_FUTURES_SOURCE_ID,
    datasetId: YAHOO_FUTURES_DATASET_ID,
    parserVersion: CHART_PARSER_VERSION,
    async load(indicator): Promise<FetchedIndicatorPoints> {
      assertDeclared(indicator, YAHOO_FUTURES_SOURCE_ID);
      await assertRights(
        dependencies.sourceRegistry,
        YAHOO_FUTURES_SOURCE_ID,
        YAHOO_FUTURES_DATASET_ID,
        indicator.id,
      );
      const response = await fetchOk(
        dependencies.fetch,
        {
          sourceId: YAHOO_FUTURES_SOURCE_ID,
          url: buildChartUrl(
            indicator.externalId,
            dependencies.now(),
            undefined,
            SOY_HISTORY_FROM,
          ),
          accept: "application/json",
        },
        indicator.id,
      );
      let body: unknown;
      try {
        body = JSON.parse(new TextDecoder().decode(response.body));
      } catch {
        throw new SoySourceError(
          "schema_changed",
          indicator.id,
          "invalid_json",
        );
      }
      const parsed = parseChartPayload(body);
      if (!parsed.ok) {
        throw new SoySourceError("schema_changed", indicator.id, parsed.code);
      }
      if (
        parsed.symbol !== indicator.externalId ||
        parsed.currency !== indicator.filters.currency ||
        parsed.exchange !== indicator.filters.exchange
      ) {
        throw new SoySourceError(
          "schema_changed",
          indicator.id,
          "instrument_mismatch",
        );
      }
      // A future has no splits or dividends; one would mean another instrument.
      if (parsed.splits.length > 0 || parsed.dividends.length > 0) {
        throw new SoySourceError(
          "schema_changed",
          indicator.id,
          "corporate_events",
        );
      }
      const settled = settleSession(parsed.bars, parsed, response.fetchedAt);
      return {
        points: settled.bars.map((bar) => ({
          periodOn: bar.marketDate,
          value: bar.close,
        })),
        observedAt: response.fetchedAt,
        requests: 1,
        bytes: response.byteLength,
      };
    },
  };
}

const VARIABLE_BY_LABEL: Readonly<Record<string, MagypVariable>> = {
  "Sup. Sembrada": "sown_ha",
  "Sup. Cosechada": "harvested_ha",
  Producción: "production_t",
  Rendimiento: "yield_kg_ha",
};

/**
 * Estimaciones Agrícolas, reconciled against the CC BY file. One `POST` brings
 * the four variables and one `GET` the licensed file; the outcome is kept for
 * the life of the adapter, so the four series of a run cost two requests.
 */
export function createLiveMagypSource(
  dependencies: Dependencies,
): ArgentinaIndicatorSource {
  const loaded = new Map<
    string,
    Promise<{
      readonly campaigns: readonly MagypCampaign[];
      readonly observedAt: string;
      readonly bytes: number;
    }>
  >();

  async function download(indicator: ArgentinaIndicator) {
    await assertRights(
      dependencies.sourceRegistry,
      MAGYP_ESTIMACIONES_SOURCE_ID,
      MAGYP_ESTIMACIONES_DATASET_ID,
      indicator.id,
    );
    await assertRights(
      dependencies.sourceRegistry,
      MAGYP_OPEN_DATA_SOURCE_ID,
      MAGYP_OPEN_DATA_DATASET_ID,
      indicator.id,
    );
    const estimates = await fetchOk(
      dependencies.fetch,
      {
        sourceId: MAGYP_ESTIMACIONES_SOURCE_ID,
        url: MAGYP_ESTIMACIONES_URL,
        method: "POST",
        body: new TextEncoder().encode(
          magypEstimacionesBody(indicator.externalId),
        ),
        contentType: "application/x-www-form-urlencoded",
        accept: "text/csv, application/csv",
      },
      indicator.id,
    );
    const parsed = parseMagypEstimaciones(
      estimates.body,
      indicator.filters.cultivo ?? "",
    );
    if (!parsed.ok) {
      throw new SoySourceError("schema_changed", indicator.id, parsed.reason);
    }
    const licensed = await fetchOk(
      dependencies.fetch,
      {
        sourceId: MAGYP_OPEN_DATA_SOURCE_ID,
        url: MAGYP_SOY_ANNUAL_URL,
        accept: "text/csv",
      },
      indicator.id,
    );
    const annual = parseMagypAnnual(new TextDecoder().decode(licensed.body));
    if (!annual.ok) {
      throw new SoySourceError(
        "schema_changed",
        indicator.id,
        `cc_by_${annual.reason}`,
      );
    }
    const reconciled = reconcileMagypEstimates(
      parsed.campaigns,
      annual.campaigns,
    );
    if (!reconciled.ok) {
      throw new SoySourceError(
        "reconciliation_failed",
        indicator.id,
        reconciled.campaign === null
          ? reconciled.reason
          : `${reconciled.campaign} ${reconciled.variable}`,
      );
    }
    return {
      campaigns: parsed.campaigns,
      observedAt: estimates.fetchedAt,
      bytes: estimates.byteLength + licensed.byteLength,
    };
  }

  return {
    sourceId: MAGYP_ESTIMACIONES_SOURCE_ID,
    datasetId: MAGYP_ESTIMACIONES_DATASET_ID,
    parserVersion: MAGYP_ESTIMACIONES_PARSER_VERSION,
    async load(indicator): Promise<FetchedIndicatorPoints> {
      assertDeclared(indicator, MAGYP_ESTIMACIONES_SOURCE_ID);
      const variable = VARIABLE_BY_LABEL[indicator.filters.variable ?? ""];
      if (variable === undefined) {
        throw new SoySourceError("not_declared", indicator.id);
      }
      const key = `${indicator.externalId}:${indicator.filters.cultivo}`;
      let pending = loaded.get(key);
      const first = pending === undefined;
      if (pending === undefined) {
        // A failure is kept too: the other series of the run report it
        // without asking the source again.
        pending = download(indicator);
        loaded.set(key, pending);
      }
      const { campaigns, observedAt, bytes } = await pending;
      return {
        points: campaigns.map((campaign) => ({
          periodOn: campaign.periodOn,
          value: campaign.values[variable],
        })),
        observedAt,
        requests: first ? 2 : 0,
        bytes: first ? bytes : 0,
      };
    },
  };
}
