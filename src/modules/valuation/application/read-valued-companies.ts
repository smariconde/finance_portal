import type { PriceRepository } from "@/modules/prices/application/price-repository";
import type { UniverseRepository } from "@/modules/universe/application/universe-repository";
import { SP500_INDEX_ID } from "@/modules/universe/application/live-universe-source";

import { excessReturnRunSchema } from "../domain/excess-return-run";
import {
  compareWithMarketPrice,
  type MarketPriceComparisonUnavailableReason,
} from "../domain/market-implied";
import { valuationRunSchema, type ValuationRun } from "../domain/valuation-run";
import { financialMarketAt, subjectAt } from "./read-valuation-result";
import type { ValuationRunRepository } from "./valuation-run-repository";

/**
 * La lista de lo valuado (`valued-companies-1.0.0`): la última corrida de
 * cada empresa —la de `as_of` más reciente y, en empate, la registrada
 * última—, con cualquier estado, y su cierre crudo **al `as_of` de esa
 * corrida** con la misma regla que la página del ticker. Sólo lee: no encola,
 * no recalcula y no sale a la red.
 */
export const VALUED_COMPANIES_VERSION = "valued-companies-1.0.0";

/** Los métodos que la página del ticker sabe leer. */
const LISTED_METHODS = [
  "fcff_base",
  "normalized_fcff",
  "fcff_three_stage",
  "revenue_margin_survival",
  "excess_return",
] as const;

/** La primera corrida posible: antes de esto no hay precios guardados. */
const EARLIEST_AS_OF = "2000-01-01";

/** Lecturas de precios en paralelo por tanda: acota las conexiones del pool. */
const PRICE_READ_CONCURRENCY = 6;

export type ValuedCompanyMethod = (typeof LISTED_METHODS)[number];

/**
 * Una fila de la lista. Sin IDs internos: la fila se identifica por su
 * ticker, que es lo que la página enlaza.
 */
export type ValuedCompany = {
  /** El ticker al corte de la corrida; `null` si el grafo no lo tenía. */
  readonly ticker: string | null;
  readonly legalName: string | null;
  readonly method: ValuedCompanyMethod;
  readonly status: ValuationRun["status"];
  readonly asOf: string;
  readonly currency: string;
  readonly valuePerShare: string | null;
  readonly close: {
    readonly marketDate: string;
    readonly close: string;
    readonly currency: string;
  } | null;
  readonly priceToValue: string | null;
  /** Por qué no hay precio sobre valor; `null` cuando lo hay. */
  readonly comparisonGap: MarketPriceComparisonUnavailableReason | null;
};

export type ValuedCompaniesReading = {
  readonly version: typeof VALUED_COMPANIES_VERSION;
  readonly companies: readonly ValuedCompany[];
};

export type ValuedCompaniesDependencies = {
  readonly runs: Pick<ValuationRunRepository, "listLatestInWindow">;
  readonly universe: Pick<UniverseRepository, "loadState">;
  readonly prices: Pick<PriceRepository, "loadSeries" | "loadEvents">;
};

async function inBatches<T, R>(
  items: readonly T[],
  map: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];

  for (let start = 0; start < items.length; start += PRICE_READ_CONCURRENCY) {
    results.push(
      ...(await Promise.all(
        items.slice(start, start + PRICE_READ_CONCURRENCY).map(map),
      )),
    );
  }

  return results;
}

export async function readValuedCompanies(
  input: { readonly today: string },
  dependencies: ValuedCompaniesDependencies,
): Promise<ValuedCompaniesReading> {
  const [stored, state] = await Promise.all([
    dependencies.runs.listLatestInWindow({
      from: EARLIEST_AS_OF,
      to: input.today,
      methods: [...LISTED_METHODS],
      statuses: ["computed", "requires_review", "rejected"],
    }),
    dependencies.universe.loadState({
      indexId: SP500_INDEX_ID,
      versions: "all",
      limit: 50_000,
    }),
  ]);

  const companies = await inBatches(
    stored,
    async (candidate): Promise<ValuedCompany | null> => {
      const securityId = candidate.subject.securityId;
      const loadMarket = () =>
        Promise.all([
          dependencies.prices.loadSeries({
            securityId,
            from: candidate.asOf,
            to: candidate.asOf,
            limit: 2,
          }),
          dependencies.prices.loadEvents({ securityId }),
        ]);

      const financial = excessReturnRunSchema.safeParse(candidate);
      if (financial.success) {
        const run = financial.data;
        const [closes, events] = await loadMarket();
        const market = financialMarketAt(run, closes, events);
        const subject = subjectAt(state.graph, run);

        return {
          ticker: subject?.symbol ?? null,
          legalName: subject?.legalName ?? null,
          method: "excess_return",
          status: run.status,
          asOf: run.asOf,
          currency: run.currency,
          valuePerShare: market.value,
          close: market.close,
          priceToValue: market.priceToValue,
          comparisonGap:
            market.comparison.status === "compared"
              ? null
              : market.comparison.reason,
        };
      }

      const parsed = valuationRunSchema.safeParse(candidate);
      if (!parsed.success) return null;

      const run = parsed.data;
      const [closes, events] = await loadMarket();
      const comparison = compareWithMarketPrice({
        run,
        closes: closes.map(({ marketDate, close, currency }) => ({
          marketDate,
          close,
          currency,
        })),
        events,
      });
      const subject = subjectAt(state.graph, run);

      return {
        ticker: subject?.symbol ?? null,
        legalName: subject?.legalName ?? null,
        method: run.method,
        status: run.status,
        asOf: run.asOf,
        currency: run.currency,
        valuePerShare: run.result?.valuePerShare ?? null,
        close: comparison.price,
        priceToValue:
          comparison.status === "compared" ? comparison.priceToValue : null,
        comparisonGap:
          comparison.status === "compared" ? null : comparison.reason,
      };
    },
  );

  return {
    version: VALUED_COMPANIES_VERSION,
    companies: companies
      .filter((company) => company !== null)
      // La más reciente primero; en el mismo día, por nombre.
      .sort(
        (left, right) =>
          right.asOf.localeCompare(left.asOf) ||
          (left.legalName ?? left.ticker ?? "").localeCompare(
            right.legalName ?? right.ticker ?? "",
          ),
      ),
  };
}
