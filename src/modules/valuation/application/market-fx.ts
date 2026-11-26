import type { PriceRepository } from "@/modules/prices/application/price-repository";
import { fxRateFor } from "@/modules/prices/domain/declared-fx-rates";

/** La moneda en que cotizan los listings del grafo: NYSE y Nasdaq. */
export const LISTED_PRICE_CURRENCY = "USD";

/**
 * El tipo de cambio del día de la corrida, de su moneda a la del precio
 * listado (`F6-55`, ADR 0087). `null` en una corrida en dólares —no hay nada
 * que convertir— y sin par declarado; `market-price-comparison-1.1.0` nombra
 * cada caso.
 */
export async function loadRunFx(
  prices: Pick<PriceRepository, "loadBenchmarkSeries">,
  run: { readonly currency: string; readonly asOf: string },
): Promise<{
  readonly baseCurrency: string;
  readonly closes: readonly {
    readonly marketDate: string;
    readonly close: string;
    readonly currency: string;
  }[];
} | null> {
  if (run.currency === LISTED_PRICE_CURRENCY) return null;

  const rate = fxRateFor(run.currency, LISTED_PRICE_CURRENCY);

  if (rate === null) return null;

  const closes = await prices.loadBenchmarkSeries({
    benchmarkId: rate.benchmarkId,
    from: run.asOf,
    to: run.asOf,
    limit: 2,
  });

  return {
    baseCurrency: rate.baseCurrency,
    closes: closes.map(({ marketDate, close, currency }) => ({
      marketDate,
      close,
      currency,
    })),
  };
}
