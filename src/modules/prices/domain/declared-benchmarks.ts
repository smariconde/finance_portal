import { z } from "zod";

import { calendarDateSchema } from "@/modules/temporal/domain/temporal-version";

/**
 * Series de referencia declaradas (`F7-05`,
 * [ADR 0029](../../../../docs/architecture/adr/0029-reference-series-sector-risk-matrix.md)).
 *
 * Un índice **no es una security**: el modelo de identidad exige que toda
 * security tenga un emisor legal, y `^SP500TR` no lo tiene. Inventarle uno para
 * reusar `security_prices` corrompería la invariante de la que depende todo el
 * grafo. La referencia es una serie propia, con su base de retorno declarada.
 *
 * La base es parte de la declaración y no de la lectura: `^SP500TR` ya reinvierte
 * los dividendos, así que su retorno es el cambio de nivel, y la fórmula que la
 * compara con las empresas (`total-return-1.0.0`) la recibe sin eventos. Si la
 * fuente publicara un split o un dividendo para ella, la base dejaría de ser la
 * declarada y la ingesta se niega.
 */
export const benchmarkIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
  .max(64);

export const declaredBenchmarkSchema = z.object({
  benchmarkId: benchmarkIdSchema,
  /** Índice cuya población representa (`index_memberships.index_id`). */
  indexId: z.string().min(1),
  label: z.string().min(1),
  /** Símbolo con el que se pide a la fuente: nunca una clave. */
  sourceSymbol: z.string().min(1).max(32),
  returnBasis: z.enum(["total_return", "price"]),
  currency: z.string().length(3),
});

export type DeclaredBenchmark = z.infer<typeof declaredBenchmarkSchema>;

export const SP500_TOTAL_RETURN_BENCHMARK_ID = "sp500-total-return";

export const DECLARED_BENCHMARKS: readonly DeclaredBenchmark[] = Object.freeze(
  [
    {
      benchmarkId: SP500_TOTAL_RETURN_BENCHMARK_ID,
      indexId: "sp500",
      label: "S&P 500 Total Return",
      sourceSymbol: "^SP500TR",
      returnBasis: "total_return",
      currency: "USD",
    },
  ].map((benchmark) => declaredBenchmarkSchema.parse(benchmark)),
);

export function findDeclaredBenchmark(
  benchmarkId: string,
): DeclaredBenchmark | null {
  return (
    DECLARED_BENCHMARKS.find(
      (benchmark) => benchmark.benchmarkId === benchmarkId,
    ) ?? null
  );
}

/** Un nivel diario de la serie de referencia. */
export const benchmarkCloseSchema = z.object({
  benchmarkId: benchmarkIdSchema,
  marketDate: calendarDateSchema,
  close: z
    .string()
    .trim()
    .regex(
      /^[0-9]+(?:\.[0-9]+)?$/u,
      "A benchmark level is a non-negative decimal.",
    ),
  currency: z.string().trim().length(3).toUpperCase(),
});

export type BenchmarkClose = z.infer<typeof benchmarkCloseSchema>;
