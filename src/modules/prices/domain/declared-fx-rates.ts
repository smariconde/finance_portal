import { z } from "zod";

import { benchmarkIdSchema } from "./declared-benchmarks";

/**
 * Tipos de cambio declarados (`F6-55`,
 * [ADR 0087](../../../../docs/architecture/adr/0087-foreign-private-issuers.md),
 * decisión 2 del owner).
 *
 * Un emisor que reporta en EUR se valúa en EUR, pero cotiza en dólares: para
 * comparar su valor por acción con el precio hace falta el cambio **del mismo
 * día** que el cierre. Sale de Yahoo, con los mismos derechos `owner_accepted`
 * que los precios, y se guarda crudo y fechado en `benchmark_prices`, como la
 * serie de referencia de la ADR 0029: un par de monedas no tiene emisor y no es
 * una security del grafo.
 *
 * El cierre de `EURUSD=X` son dólares por euro: la moneda de la respuesta es la
 * cotizada (`USD`) y la base es la de los estados (`EUR`).
 */
export const declaredFxRateSchema = z.strictObject({
  /** Clave en `benchmark_prices.benchmark_id`. */
  benchmarkId: benchmarkIdSchema,
  sourceSymbol: z.string().min(1).max(32),
  /** La moneda que se compra: la de los estados. */
  baseCurrency: z.string().regex(/^[A-Z]{3}$/u),
  /** La moneda del cierre: la del precio listado. */
  currency: z.string().regex(/^[A-Z]{3}$/u),
  label: z.string().min(1),
});

export type DeclaredFxRate = z.infer<typeof declaredFxRateSchema>;

export const DECLARED_FX_RATES: readonly DeclaredFxRate[] = Object.freeze(
  [
    {
      benchmarkId: "fx-eur-usd",
      sourceSymbol: "EURUSD=X",
      baseCurrency: "EUR",
      currency: "USD",
      label: "EUR/USD (Yahoo)",
    },
  ].map((rate) => declaredFxRateSchema.parse(rate)),
);

export function findDeclaredFxRate(benchmarkId: string): DeclaredFxRate | null {
  return (
    DECLARED_FX_RATES.find((rate) => rate.benchmarkId === benchmarkId) ?? null
  );
}

/** El par que lleva `baseCurrency` a `quoteCurrency`, o `null`. */
export function fxRateFor(
  baseCurrency: string,
  quoteCurrency: string,
): DeclaredFxRate | null {
  return (
    DECLARED_FX_RATES.find(
      (rate) =>
        rate.baseCurrency === baseCurrency && rate.currency === quoteCurrency,
    ) ?? null
  );
}
