import type { EgressFetch } from "@/modules/ingestion/application/egress-fetch";
import type { SourceRegistryRepository } from "@/modules/ingestion/application/source-registry-repository";

import {
  assembleFxPages,
  parseFxCurrencies,
  parseFxQuotesPage,
  type FxCurrencyEntry,
} from "../domain/bcra-fx-parser";
import {
  BCRA_FX_CURRENCIES_DATASET_ID,
  BCRA_FX_QUOTES_DATASET_ID,
  BCRA_FX_SOURCE_ID,
  buenosAiresDate,
  DECLARED_FX_CURRENCIES,
  findDeclaredFxCurrency,
  fxCurrenciesUrl,
  fxQuotesUrl,
  MAX_FX_PAGES,
} from "../domain/bcra-fx-source";
import {
  type BcraCatalogEntry,
  type ParsedPage,
  type RowRejection,
} from "../domain/bcra-monetary-parser";

import {
  BcraSourceError,
  createBcraTransport,
  type BcraSourceProvider,
} from "./live-bcra-source";

/**
 * Adaptador vivo de Estadísticas Cambiarias v1 (ADR 0067). Implementa la misma
 * interfaz que el monetario, así que el registro de definiciones y de puntos es
 * el mismo: cambia la fuente, no la regla.
 *
 * El «catálogo» es el maestro de monedas filtrado por las declaradas. La unidad
 * y la primera fecha son declaraciones medidas, porque el maestro sólo publica
 * código y denominación; la fuente no publica metodología.
 */
export function createLiveBcraFxSource(dependencies: {
  readonly sourceRegistry: SourceRegistryRepository;
  readonly fetch: EgressFetch;
  readonly now: () => string;
}): BcraSourceProvider {
  const { authorize, paginate } = createBcraTransport({
    sourceRegistry: dependencies.sourceRegistry,
    fetch: dependencies.fetch,
    sourceId: BCRA_FX_SOURCE_ID,
  });

  return {
    async loadCatalog() {
      await authorize(BCRA_FX_CURRENCIES_DATASET_ID);

      let ambiguous: readonly string[] = [];
      const master = await paginate<FxCurrencyEntry>(
        "currencies",
        1,
        () => fxCurrenciesUrl(),
        (body): ParsedPage<FxCurrencyEntry> => {
          const parsed = parseFxCurrencies(body, 200);

          if (parsed.ok) {
            ambiguous = parsed.ambiguous;
          }

          return parsed.ok
            ? {
                ok: true,
                total: parsed.currencies.length,
                offset: 0,
                rows: parsed.currencies,
                rejections: [],
              }
            : parsed;
        },
        true,
      );
      const names = new Map(
        master.pages[0]!.rows.map((entry) => [entry.isoCode, entry.name]),
      );
      const entries: BcraCatalogEntry[] = [];
      const rejections: RowRejection[] = [];

      for (const [row, currency] of DECLARED_FX_CURRENCIES.entries()) {
        // Una declarada con dos nombres se rechaza por nombre y no se retira.
        if (ambiguous.includes(currency.isoCode)) {
          rejections.push({
            row,
            variableId: currency.isoNumeric,
            field: "codigo",
          });
          continue;
        }

        const name = names.get(currency.isoCode);

        // Una moneda que el maestro deja de listar no se inventa: el plan la
        // retira, con la guarda de bajas masivas de por medio.
        if (name === undefined) {
          continue;
        }

        entries.push({
          variableId: currency.isoNumeric,
          description: name,
          category: "Cotizaciones",
          seriesType: "Tipo de cambio",
          frequency: "daily",
          unit: currency.unit,
          currencyCode: "ARS",
          firstReportedOn: currency.firstReportedOn,
          lastReportedOn: null,
          lastReportedValue: null,
        });
      }

      return {
        entries,
        rejections,
        methodologies: new Map(
          entries.map((entry) => [entry.variableId, null] as const),
        ),
        methodologyRejections: [],
        orphanMethodologies: 0,
        requests: master.requests,
        byteLength: master.byteLength,
        sourceDocumentId: fxCurrenciesUrl(),
        observedAt: master.observedAt,
      };
    },

    async loadSeries(isoNumeric, coverage) {
      const currency = findDeclaredFxCurrency(isoNumeric);

      if (currency === null) {
        throw new BcraSourceError(
          "dataset_not_registered",
          `currency ${isoNumeric}`,
        );
      }

      await authorize(BCRA_FX_QUOTES_DATASET_ID);

      const resource = `quotes ${currency.isoCode}`;
      const untilOn = buenosAiresDate(dependencies.now());
      const series = await paginate(
        resource,
        MAX_FX_PAGES,
        (offset) => fxQuotesUrl(currency.isoCode, offset, untilOn),
        (body, offset) =>
          parseFxQuotesPage(body, {
            httpStatus: 200,
            isoCode: currency.isoCode,
            isoNumeric,
            offset,
          }),
        coverage === "window",
      );

      const assembled = assembleFxPages(series.pages, coverage);

      if (!assembled.ok) {
        throw new BcraSourceError("payload_rejected", resource, assembled.code);
      }

      const effective = assembled.complete ? "complete" : "window";

      return {
        variableId: isoNumeric,
        points: assembled.rows,
        rejections: assembled.rejections,
        coverage: effective,
        total: assembled.total,
        requests: series.requests,
        byteLength: series.byteLength,
        sourceDocumentId: fxQuotesUrl(currency.isoCode, 0, untilOn),
        observedAt: series.observedAt,
      };
    },
  };
}
