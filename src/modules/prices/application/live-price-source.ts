import type { EgressFetch } from "@/modules/ingestion/application/egress-fetch";
import {
  evaluateIngestionRights,
  type IngestionRightsRequest,
} from "@/modules/ingestion/domain/source-registry-entry";
import type { SourceRegistryRepository } from "@/modules/ingestion/application/source-registry-repository";
import {
  subtractCalendarYears,
  subtractDays,
} from "@/modules/temporal/domain/calendar-date";

import {
  parseChartPayload,
  type ChartParseResult,
} from "../domain/parse-chart-payload";

export const PRICES_SOURCE_ID = "yahoo-finance";

/**
 * Adaptador vivo de la serie diaria
 * ([ADR 0026](../../../../docs/architecture/adr/0026-daily-prices-source.md)).
 *
 * Una request por security trae cinco años y dos semanas de cierres más los splits y
 * dividendos fechados. La respuesta se normaliza y **no se conserva**: la fila
 * de derechos declara `rawStorage: "restricted"`, así que el gate se negaría si
 * esta corrida dijera que guarda el payload.
 */
const RIGHTS_REQUEST: IngestionRightsRequest = {
  storesRawPayload: false,
  storesNormalizedValues: true,
  publicDisplay: false,
};

export type PriceSourceErrorCode =
  | "source_not_registered"
  | "rights_not_approved"
  | "fetch_failed"
  | "unexpected_status"
  | "payload_rejected";

export class PriceSourceError extends Error {
  readonly code: PriceSourceErrorCode;
  readonly symbol: string;
  readonly detail: string | null;

  constructor(
    code: PriceSourceErrorCode,
    symbol: string,
    detail: string | null = null,
  ) {
    super(detail === null ? code : `${code}: ${detail}`);
    this.name = "PriceSourceError";
    this.code = code;
    this.symbol = symbol;
    this.detail = detail;
  }
}

/**
 * Historia pedida. Cinco años es la ventana larga de la matriz
 * ([ADR 0016](../../../../docs/architecture/adr/0016-analysis-scope-sector-matrices.md)),
 * y la ventana es de calendario con su base en el último cierre **en o antes**
 * del inicio (`sortino-1.0.0`). Con `range=5y` la fuente devolvía desde el día
 * siguiente a ese inicio: medido el 2026-09-30, las tres series empezaban el
 * 2021-09-23 contra un inicio del 2021-09-22, y la ventana de 5 años no tenía
 * base en ninguna. El margen es el de la ventana de la SEC, y cuesta unas diez
 * filas por security.
 */
export const PRICE_HISTORY_YEARS = 5;
export const PRICE_HISTORY_MARGIN_DAYS = 14;

export function buildChartUrl(symbol: string, now: Date): string {
  const today = now.toISOString().slice(0, 10);
  const from = subtractDays(
    subtractCalendarYears(today, PRICE_HISTORY_YEARS),
    PRICE_HISTORY_MARGIN_DAYS,
  );
  const period1 = Date.parse(`${from}T00:00:00.000Z`) / 1000;
  const period2 = Math.floor(now.getTime() / 1000);

  // El símbolo va percent-encoded: un `BRK.B` es legítimo y un símbolo con un
  // carácter inesperado no debe poder construir otra ruta. El prefijo de la
  // allowlist rechazaría el intento igual, pero esto lo corta antes.
  return (
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=${period1}&period2=${period2}&interval=1d&events=div%2Csplit`
  );
}

export type PriceSourceDependencies = {
  readonly sourceRegistry: SourceRegistryRepository;
  readonly fetch: EgressFetch;
  readonly now: () => Date;
};

export type FetchedSeries = {
  readonly sourceId: string;
  readonly symbol: string;
  readonly parsed: Extract<ChartParseResult, { ok: true }>;
  readonly byteLength: number;
  readonly fetchedAt: string;
};

export type PriceSourceProvider = {
  readonly sourceId: string;
  load(symbol: string): Promise<FetchedSeries>;
};

export function createLivePriceSource(
  dependencies: PriceSourceDependencies,
): PriceSourceProvider {
  return {
    sourceId: PRICES_SOURCE_ID,
    async load(symbol: string): Promise<FetchedSeries> {
      const entry =
        await dependencies.sourceRegistry.findBySourceId(PRICES_SOURCE_ID);

      if (!entry) {
        throw new PriceSourceError("source_not_registered", symbol);
      }

      const rights = evaluateIngestionRights(entry, RIGHTS_REQUEST);

      if (!rights.allowed) {
        // Fail-closed **antes** del egress: la red no se toca. Vale también
        // cuando los derechos son `owner_accepted`, porque el que decide si una
        // decisión del owner sigue vigente es el registro, no este adaptador.
        throw new PriceSourceError(
          "rights_not_approved",
          symbol,
          rights.blockedBy.join(", "),
        );
      }

      let response: Awaited<ReturnType<EgressFetch>>;

      try {
        response = await dependencies.fetch({
          sourceId: PRICES_SOURCE_ID,
          url: buildChartUrl(symbol, dependencies.now()),
          accept: "application/json",
        });
      } catch (cause) {
        throw new PriceSourceError(
          "fetch_failed",
          symbol,
          cause instanceof Error ? cause.message : "egress failed",
        );
      }

      if (response.status !== 200) {
        throw new PriceSourceError(
          "unexpected_status",
          symbol,
          `status ${response.status}`,
        );
      }

      let body: unknown;

      try {
        body = JSON.parse(new TextDecoder().decode(response.body));
      } catch {
        throw new PriceSourceError("payload_rejected", symbol, "invalid_json");
      }

      const parsed = parseChartPayload(body);

      if (!parsed.ok) {
        throw new PriceSourceError("payload_rejected", symbol, parsed.code);
      }

      return {
        sourceId: PRICES_SOURCE_ID,
        symbol,
        parsed,
        byteLength: response.byteLength,
        fetchedAt: response.fetchedAt,
      };
    },
  };
}
