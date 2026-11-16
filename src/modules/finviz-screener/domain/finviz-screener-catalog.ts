import source from "./finviz-screener-filters.json";
import type {
  FinvizFilter,
  FinvizFilterCatalogSource,
  FinvizFilterTab,
} from "./finviz-screener-page";

/**
 * Catálogo versionado del screener de Finviz (`F11-13`). Los filtros salen de
 * la página que el owner guardó (`pnpm finviz:catalog`); las vistas y las
 * señales, que la página no embebe, se declaran acá con su evidencia.
 *
 * Sube de versión cada vez que el JSON cambia: el test fija el
 * `filtersVersion` que esta versión nombra.
 */
export const FINVIZ_SCREENER_CATALOG_VERSION = "finviz-screener-catalog-1.1.0";

/** El `screenerFiltersVersion` de la página medida el 2026-11-16. */
export const FINVIZ_MEASURED_FILTERS_VERSION = "5b7ead1959261a5a";

export const FINVIZ_FILTER_SOURCE = source as FinvizFilterCatalogSource;

export const FINVIZ_FILTERS: readonly FinvizFilter[] =
  FINVIZ_FILTER_SOURCE.filters;

export const FINVIZ_TAB_LABELS: Readonly<Record<FinvizFilterTab, string>> = {
  descriptive: "Descriptive",
  fundamental: "Fundamental",
  technical: "Technical",
  news: "News",
};

/**
 * Las vistas de la barra de resultados, con el código que usan los links de
 * la página medida. El Flask usaba los viejos (`210`, `310`…); Finviz los
 * acepta todavía, pero el portal arma con los actuales.
 */
export const FINVIZ_VIEWS = [
  { code: "111", label: "Overview" },
  { code: "121", label: "Valuation" },
  { code: "161", label: "Financial" },
  { code: "131", label: "Ownership" },
  { code: "141", label: "Performance" },
  { code: "171", label: "Technical" },
  { code: "151", label: "Custom" },
  { code: "211", label: "Charts" },
  { code: "411", label: "Tickers" },
  { code: "311", label: "Basic" },
  { code: "351", label: "TA" },
  { code: "321", label: "News" },
  { code: "341", label: "Snapshot" },
  { code: "711", label: "Maps" },
  { code: "611", label: "Stats" },
] as const;

export type FinvizViewCode = (typeof FINVIZ_VIEWS)[number]["code"];

/** Snapshot: la vista con gráfico y noticias por ticker (decisión del owner,
 * 2026-11-16). Un link pegado sin `v` también la toma. */
export const FINVIZ_DEFAULT_VIEW: FinvizViewCode = "341";

/**
 * Las señales del menú «Signal». La página no las embebe: son las 33 del Flask,
 * todas permitidas hoy por el `robots.txt` de Finviz. Las dos que sólo figuran
 * ahí —`f_ssr` y `f_halted`— son las opciones Elite «Short sale restricted» y
 * «Halted» de Option/Short, y quedan fuera.
 */
export const FINVIZ_SIGNALS = [
  { value: "ta_topgainers", label: "Top Gainers", group: "Price" },
  { value: "ta_toplosers", label: "Top Losers", group: "Price" },
  { value: "ta_newhigh", label: "New High", group: "Price" },
  { value: "ta_newlow", label: "New Low", group: "Price" },
  { value: "ta_mostvolatile", label: "Most Volatile", group: "Price" },
  { value: "ta_mostactive", label: "Most Active", group: "Price" },
  { value: "ta_unusualvolume", label: "Unusual Volume", group: "Price" },
  { value: "ta_overbought", label: "Overbought", group: "Price" },
  { value: "ta_oversold", label: "Oversold", group: "Price" },
  { value: "n_downgrades", label: "Downgrades", group: "News" },
  { value: "n_upgrades", label: "Upgrades", group: "News" },
  { value: "n_earningsbefore", label: "Earnings Before", group: "News" },
  { value: "n_earningsafter", label: "Earnings After", group: "News" },
  { value: "n_majornews", label: "Major News", group: "News" },
  { value: "it_latestbuys", label: "Recent Insider Buying", group: "Insider" },
  {
    value: "it_latestsales",
    label: "Recent Insider Selling",
    group: "Insider",
  },
  { value: "ta_p_horizontal", label: "Horizontal S/R", group: "Pattern" },
  { value: "ta_p_tlresistance", label: "TL Resistance", group: "Pattern" },
  { value: "ta_p_tlsupport", label: "TL Support", group: "Pattern" },
  { value: "ta_p_wedgeup", label: "Wedge Up", group: "Pattern" },
  { value: "ta_p_wedgedown", label: "Wedge Down", group: "Pattern" },
  {
    value: "ta_p_wedgeresistance",
    label: "Triangle Ascending",
    group: "Pattern",
  },
  {
    value: "ta_p_wedgesupport",
    label: "Triangle Descending",
    group: "Pattern",
  },
  { value: "ta_p_wedge", label: "Wedge", group: "Pattern" },
  { value: "ta_p_channelup", label: "Channel Up", group: "Pattern" },
  { value: "ta_p_channeldown", label: "Channel Down", group: "Pattern" },
  { value: "ta_p_channel", label: "Channel", group: "Pattern" },
  { value: "ta_p_doubletop", label: "Double Top", group: "Pattern" },
  { value: "ta_p_doublebottom", label: "Double Bottom", group: "Pattern" },
  { value: "ta_p_multipletop", label: "Multiple Top", group: "Pattern" },
  { value: "ta_p_multiplebottom", label: "Multiple Bottom", group: "Pattern" },
  {
    value: "ta_p_headandshoulders",
    label: "Head & Shoulders",
    group: "Pattern",
  },
  {
    value: "ta_p_headandshouldersinv",
    label: "Head & Shoulders Inverse",
    group: "Pattern",
  },
] as const;

export type FinvizSignal = (typeof FINVIZ_SIGNALS)[number]["value"];

const filtersByKey: ReadonlyMap<string, FinvizFilter> = new Map(
  FINVIZ_FILTERS.map((filter) => [filter.key, filter]),
);

const optionLabels: ReadonlyMap<string, string> = new Map(
  FINVIZ_FILTERS.flatMap((filter) =>
    filter.options.map((option) => [
      `${filter.key}_${option.value}`,
      option.label,
    ]),
  ),
);

export function finvizFilter(key: string): FinvizFilter | undefined {
  return filtersByKey.get(key);
}

/** La etiqueta de una opción vigente, o `undefined` si el catálogo no la tiene. */
export function finvizOptionLabel(
  key: string,
  value: string,
): string | undefined {
  return optionLabels.get(`${key}_${value}`);
}

export function isFinvizView(code: string): code is FinvizViewCode {
  return FINVIZ_VIEWS.some((view) => view.code === code);
}

export function isFinvizSignal(value: string): value is FinvizSignal {
  return FINVIZ_SIGNALS.some((signal) => signal.value === value);
}
