import {
  FINVIZ_DEFAULT_VIEW,
  FINVIZ_FILTERS,
  finvizFilter,
  finvizOptionLabel,
  isFinvizSignal,
  isFinvizView,
  type FinvizSignal,
  type FinvizViewCode,
} from "./finviz-screener-catalog";

/**
 * Arma y lee links del screener de Finviz (`finviz-screener-url-1.0.0`). El
 * portal sólo construye una URL que el navegador del owner abre en otra
 * pestaña: no hay request del servidor a Finviz (ADR 0016).
 *
 * Medido el 2026-11-16 sobre la página guardada: Finviz reescribe
 * `screener.ashx` y `/screener` a `/screener/stocks` conservando `v`, `f` y
 * `s`, y el prefijo de cada filtro es su clave más `_` —un link viejo con
 * `ind_semiconductors` volvió como `industry_semiconductors`—. Un valor por
 * variable: elegir varios (`a|b`) o un rango propio es Elite.
 */
export const FINVIZ_SCREENER_URL_VERSION = "finviz-screener-url-1.0.0";

const SCREENER = "https://finviz.com/screener/stocks";

/** Claves que Finviz renombró y todavía acepta en un link pegado. */
const LEGACY_KEYS: Readonly<Record<string, string>> = { ind: "industry" };

const SYMBOL = /^[A-Z][A-Z0-9./-]{0,15}$/;

export type FinvizSelection = {
  readonly view: FinvizViewCode;
  readonly signal: FinvizSignal | null;
  /** Clave del filtro → valor de la opción. */
  readonly filters: Readonly<Record<string, string>>;
};

export const EMPTY_FINVIZ_SELECTION: FinvizSelection = {
  view: FINVIZ_DEFAULT_VIEW,
  signal: null,
  filters: {},
};

export type FinvizDroppedToken = {
  readonly token: string;
  readonly reason:
    | "unknown_filter"
    | "unknown_option"
    | "multiple_values"
    | "repeated_filter"
    | "unknown_signal"
    | "unknown_view";
};

/** Los filtros en el orden del catálogo, con la forma de `f`. */
export function finvizFilterQuery(
  filters: Readonly<Record<string, string>>,
): string {
  return FINVIZ_FILTERS.filter((filter) => filter.key in filters)
    .map((filter) => `${filter.key}_${filters[filter.key]}`)
    .join(",");
}

export function buildFinvizScreenerUrl(selection: FinvizSelection): string {
  const query = [`v=${selection.view}`];
  const filters = finvizFilterQuery(selection.filters);
  if (filters !== "") query.push(`f=${filters}`);
  if (selection.signal !== null) query.push(`s=${selection.signal}`);
  return `${SCREENER}?${query.join("&")}`;
}

function tokenFilter(
  token: string,
): { key: string; value: string } | FinvizDroppedToken["reason"] {
  if (token.includes("|")) return "multiple_values";
  const candidates = [
    ...FINVIZ_FILTERS.map((filter) => [filter.key, filter.key] as const),
    ...Object.entries(LEGACY_KEYS),
  ]
    .filter(([prefix]) => token.startsWith(`${prefix}_`))
    .map(([prefix, key]) => ({ key, value: token.slice(prefix.length + 1) }));
  if (candidates.length === 0) return "unknown_filter";
  return (
    candidates.find(
      ({ key, value }) => finvizOptionLabel(key, value) !== undefined,
    ) ?? "unknown_option"
  );
}

/** Lee `f`: lo que el catálogo no tiene se nombra, nunca se adivina. */
export function parseFinvizFilterQuery(query: string): {
  readonly filters: Readonly<Record<string, string>>;
  readonly dropped: readonly FinvizDroppedToken[];
} {
  const filters: Record<string, string> = {};
  const dropped: FinvizDroppedToken[] = [];
  for (const token of query.split(",").filter((part) => part !== "")) {
    const read = tokenFilter(token);
    if (typeof read === "string") {
      dropped.push({ token, reason: read });
    } else if (read.key in filters) {
      dropped.push({ token, reason: "repeated_filter" });
    } else {
      filters[read.key] = read.value;
    }
  }
  return { filters, dropped };
}

export type FinvizLinkReading =
  | {
      readonly state: "read";
      readonly selection: FinvizSelection;
      readonly dropped: readonly FinvizDroppedToken[];
    }
  | {
      readonly state: "rejected";
      readonly reason: "not_url" | "not_finviz" | "not_screener";
    };

/** Un link copiado de Finviz —cualquier vista o pestaña— vuelve a selección. */
export function readFinvizScreenerLink(text: string): FinvizLinkReading {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return { state: "rejected", reason: "not_url" };
  }
  if (
    url.protocol !== "https:" ||
    !["finviz.com", "www.finviz.com", "elite.finviz.com"].includes(url.hostname)
  )
    return { state: "rejected", reason: "not_finviz" };
  if (!/^\/screener(\.ashx|\/stocks)?\/?$/.test(url.pathname))
    return { state: "rejected", reason: "not_screener" };
  const dropped: FinvizDroppedToken[] = [];
  const viewParam = url.searchParams.get("v");
  let view = FINVIZ_DEFAULT_VIEW;
  if (viewParam !== null) {
    if (isFinvizView(viewParam)) view = viewParam;
    else dropped.push({ token: `v=${viewParam}`, reason: "unknown_view" });
  }
  const signalParam = url.searchParams.get("s");
  let signal: FinvizSignal | null = null;
  if (signalParam !== null && signalParam !== "") {
    if (isFinvizSignal(signalParam)) signal = signalParam;
    else dropped.push({ token: `s=${signalParam}`, reason: "unknown_signal" });
  }
  const read = parseFinvizFilterQuery(url.searchParams.get("f") ?? "");
  return {
    state: "read",
    selection: { view, signal, filters: read.filters },
    dropped: [...dropped, ...read.dropped],
  };
}

/** Finviz escribe las clases con guion (`BRK-B`); Schwab, con punto o barra. */
export function finvizSymbol(symbol: string): string {
  return symbol.replace(/[./]/g, "-");
}

/** La watchlist como pantalla de Finviz (`t=`), o `null` sin símbolos válidos. */
export function buildFinvizTickersUrl(
  symbols: readonly string[],
  view: FinvizViewCode = FINVIZ_DEFAULT_VIEW,
): string | null {
  const unique = [
    ...new Set(
      symbols
        .map((symbol) => symbol.trim().toUpperCase())
        .filter((symbol) => SYMBOL.test(symbol))
        .map(finvizSymbol),
    ),
  ].sort();
  if (unique.length === 0) return null;
  return `${SCREENER}?v=${view}&t=${unique.join(",")}`;
}

/** Cuántos filtros elegidos hay por clave conocida (para los contadores). */
export function finvizSelectionSize(selection: FinvizSelection): number {
  return Object.keys(selection.filters).filter(
    (key) => finvizFilter(key) !== undefined,
  ).length;
}
