import { z } from "zod";

import {
  FINVIZ_SCREENER_CATALOG_VERSION,
  isFinvizSignal,
  isFinvizView,
  type FinvizSignal,
  type FinvizViewCode,
} from "./finviz-screener-catalog";
import {
  finvizFilterQuery,
  parseFinvizFilterQuery,
  type FinvizDroppedToken,
  type FinvizSelection,
} from "./finviz-screener-url";

/**
 * Una estrategia es una pantalla de Finviz con nombre (`F11-13`), guardada como
 * revisiones en la base de trading. Se guarda la consulta tal como viaja en el
 * link —vista, señal y `f` en el orden del catálogo— y el catálogo con que se
 * validó; al leerla se vuelve a validar contra el vigente, y lo que Finviz
 * haya sacado se nombra en vez de perderse en silencio.
 */
export const FINVIZ_STRATEGY_VERSION = "finviz-screener-strategy-1.0.0";

export const FINVIZ_STRATEGY_NAME_MAX = 80;

export type FinvizStrategyFields = {
  readonly name: string;
  readonly view: FinvizViewCode;
  readonly signal: FinvizSignal | null;
  /** `f` canónico: `clave_valor` separados por coma, en el orden del catálogo. */
  readonly filters: string;
};

export type StoredFinvizStrategy = FinvizStrategyFields & {
  readonly strategyId: string;
  readonly revision: number;
  readonly version: string;
  readonly catalogVersion: string;
  readonly recordedAt: string;
};

const nameSchema = z
  .string()
  .transform((name) => name.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1).max(FINVIZ_STRATEGY_NAME_MAX));

export const finvizStrategyIdSchema = z.uuid();

/** Lo que manda el cliente: la selección y el nombre, nunca una URL. */
export const finvizStrategyFormSchema = z
  .object({
    strategyId: finvizStrategyIdSchema.nullable(),
    baseRevision: z.number().int().min(1).nullable(),
    name: nameSchema,
    view: z.string().refine(isFinvizView),
    signal: z.string().refine(isFinvizSignal).nullable(),
    filters: z.record(
      z.string().regex(/^[a-z][a-z0-9_]{1,31}$/),
      z.string().regex(/^[a-z0-9._-]{1,48}$/),
    ),
  })
  .strict()
  .superRefine((form, context) => {
    const query = finvizFilterQuery(form.filters);
    const read = parseFinvizFilterQuery(query);
    if (
      read.dropped.length > 0 ||
      Object.keys(read.filters).length !== Object.keys(form.filters).length
    )
      context.addIssue({
        code: "custom",
        path: ["filters"],
        message: "filters_outside_catalog",
      });
  });

export type FinvizStrategyForm = z.output<typeof finvizStrategyFormSchema>;

export function strategyFieldsOf(
  form: FinvizStrategyForm,
): FinvizStrategyFields {
  return {
    name: form.name,
    view: form.view as FinvizViewCode,
    signal: form.signal as FinvizSignal | null,
    filters: finvizFilterQuery(form.filters),
  };
}

export function sameStrategyFields(
  left: FinvizStrategyFields,
  right: FinvizStrategyFields,
): boolean {
  return (
    left.name === right.name &&
    left.view === right.view &&
    left.signal === right.signal &&
    left.filters === right.filters
  );
}

/** La estrategia leída contra el catálogo vigente. */
export function strategySelection(strategy: FinvizStrategyFields): {
  readonly selection: FinvizSelection;
  readonly dropped: readonly FinvizDroppedToken[];
  readonly catalogChanged: boolean;
} {
  const read = parseFinvizFilterQuery(strategy.filters);
  return {
    selection: {
      view: strategy.view,
      signal: strategy.signal,
      filters: read.filters,
    },
    dropped: read.dropped,
    catalogChanged:
      "catalogVersion" in strategy &&
      strategy.catalogVersion !== FINVIZ_SCREENER_CATALOG_VERSION,
  };
}
