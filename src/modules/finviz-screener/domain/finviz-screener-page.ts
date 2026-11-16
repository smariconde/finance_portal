import { z } from "zod";

/**
 * Lee el catálogo de filtros que la página del screener de Finviz trae
 * embebido (`F11-13`). El owner guarda la página desde su navegador; el portal
 * nunca la baja. El parser es cerrado: una clave nueva en un filtro o en una
 * opción rechaza la página por nombre, porque puede ser una marca de Elite que
 * todavía no sabemos leer.
 *
 * Lo que es Elite —el filtro entero o una opción— no entra: el owner usa
 * Finviz gratis (ADR 0016), y un link con una opción Elite no filtra nada.
 */
export const FINVIZ_SCREENER_PAGE_PARSER_VERSION = "finviz-screener-page-1.0.0";

export const FINVIZ_FILTER_TABS = [
  "descriptive",
  "fundamental",
  "technical",
  "news",
] as const;

export type FinvizFilterTab = (typeof FINVIZ_FILTER_TABS)[number];

export type FinvizFilterOption = {
  readonly value: string;
  readonly label: string;
  /** El grupo con que Finviz ordena la lista (sector de una industria, «EPS» o
   * «Revenue» de una sorpresa); `null` si la opción va suelta. */
  readonly group: string | null;
};

export type FinvizFilter = {
  readonly key: string;
  readonly tab: FinvizFilterTab;
  readonly label: string;
  readonly title: string;
  readonly description: string;
  readonly options: readonly FinvizFilterOption[];
};

export type FinvizFilterCatalogSource = {
  readonly parserVersion: string;
  /** `screenerFiltersVersion` de la página: cambia cuando Finviz cambia filtros. */
  readonly filtersVersion: string;
  readonly screenerVersion: number;
  readonly measuredOn: string;
  readonly filters: readonly FinvizFilter[];
};

export type FinvizPageExclusion = {
  readonly key: string;
  readonly reason: "elite_only" | "no_free_options" | "not_stocks";
};

export type FinvizPageReading =
  | {
      readonly state: "read";
      readonly source: FinvizFilterCatalogSource;
      readonly excluded: readonly FinvizPageExclusion[];
      readonly eliteOptions: number;
    }
  | {
      readonly state: "rejected";
      readonly reason:
        | "props_missing"
        | "props_not_json"
        | "props_unexpected"
        | "group_unresolved"
        | "value_unexpected"
        | "duplicate_value"
        | "duplicate_filter";
      readonly detail: string;
    };

const VALUE = /^[a-z0-9._-]{1,48}$/;
const KEY = /^[a-z][a-z0-9_]{1,31}$/;

const optionSchema = z
  .object({
    value: z.string(),
    label: z.string(),
    group: z.string().optional(),
    isEliteOnly: z.boolean().optional(),
    isExcludedFromSelectAll: z.boolean().optional(),
  })
  .strict();

const filterSchema = z
  .object({
    key: z.string().regex(KEY),
    tab: z.enum([...FINVIZ_FILTER_TABS, "etf"]),
    uiType: z.enum([
      "select",
      "modalSelect",
      "floatRangeSelect",
      "tickersInput",
    ]),
    title: z
      .object({ short: z.string(), full: z.string(), description: z.string() })
      .strict(),
    screenerTypes: z.array(z.enum(["stocks", "etf"])),
    isEliteOnly: z.boolean().optional(),
    rangePrefix: z.string().optional(),
    rangeSuffix: z.string().optional(),
    maxLength: z.number().optional(),
    options: z.array(optionSchema),
    optionGroups: z
      .array(
        z
          .object({ label: z.string(), options: z.array(optionSchema) })
          .strict(),
      )
      .optional(),
  })
  .strict();

const propsSchema = z.object({
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}T/),
  settings: z.object({
    screenerVersion: z.number().int(),
    screenerFiltersVersion: z.string().regex(/^[0-9a-f]{8,64}$/),
  }),
  filters: z.object({ filters: z.array(filterSchema) }),
});

type PageFilter = z.infer<typeof filterSchema>;

const PROPS =
  /<script type="application\/json" data-ssr-props="[^"]+">([\s\S]*?)<\/script>/g;

function plain(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function screenerProps(html: string): unknown {
  for (const match of html.matchAll(PROPS)) {
    if (!match[1]!.includes('"screenerFiltersVersion"')) continue;
    return JSON.parse(match[1]!) as unknown;
  }
  return undefined;
}

class Rejection extends Error {
  constructor(
    readonly reason: Extract<
      FinvizPageReading,
      { state: "rejected" }
    >["reason"],
    readonly detail: string,
  ) {
    super(detail);
  }
}

/** El grupo de una industria es un sector y el de un subtema, un tema: se
 * resuelve contra el filtro hermano cuyas opciones contienen todos los grupos,
 * nunca contra una tabla escrita a mano. */
function groupLabels(
  filter: PageFilter,
  filters: readonly PageFilter[],
): ReadonlyMap<string, string> {
  const groups = new Set(
    filter.options.flatMap((option) =>
      option.group === undefined ? [] : [option.group],
    ),
  );
  if (groups.size === 0) return new Map();
  for (const sibling of filters) {
    if (sibling.key === filter.key) continue;
    const labels = new Map(
      sibling.options.map((option) => [option.value, option.label]),
    );
    if ([...groups].every((group) => labels.has(group))) return labels;
  }
  throw new Rejection("group_unresolved", filter.key);
}

function freeOptions(
  filter: PageFilter,
  filters: readonly PageFilter[],
): { options: FinvizFilterOption[]; elite: number } {
  const labels = groupLabels(filter, filters);
  const all = [
    ...filter.options.map((option) => ({
      option,
      group:
        option.group === undefined ? null : (labels.get(option.group) ?? null),
    })),
    ...(filter.optionGroups ?? []).flatMap((group) =>
      group.options.map((option) => ({ option, group: group.label })),
    ),
  ].filter(({ option }) => option.value !== "");
  const options: FinvizFilterOption[] = [];
  let elite = 0;
  const seen = new Set<string>();
  for (const { option, group } of all) {
    if (option.isEliteOnly === true) {
      elite += 1;
      continue;
    }
    if (!VALUE.test(option.value))
      throw new Rejection("value_unexpected", `${filter.key}:${option.value}`);
    if (seen.has(option.value))
      throw new Rejection("duplicate_value", `${filter.key}:${option.value}`);
    seen.add(option.value);
    options.push({ value: option.value, label: plain(option.label), group });
  }
  return { options, elite };
}

export function readFinvizScreenerPage(html: string): FinvizPageReading {
  let props: unknown;
  try {
    props = screenerProps(html);
  } catch {
    return { state: "rejected", reason: "props_not_json", detail: "" };
  }
  if (props === undefined)
    return { state: "rejected", reason: "props_missing", detail: "" };
  const parsed = propsSchema.safeParse(props);
  if (!parsed.success)
    return {
      state: "rejected",
      reason: "props_unexpected",
      detail: parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".")}: ${issue.code}`)
        .join("; "),
    };
  const page = parsed.data;
  try {
    const keys = new Set<string>();
    const filters: FinvizFilter[] = [];
    const excluded: FinvizPageExclusion[] = [];
    let eliteOptions = 0;
    for (const filter of page.filters.filters) {
      if (keys.has(filter.key))
        throw new Rejection("duplicate_filter", filter.key);
      keys.add(filter.key);
      if (!filter.screenerTypes.includes("stocks")) {
        excluded.push({ key: filter.key, reason: "not_stocks" });
        continue;
      }
      if (
        filter.isEliteOnly === true ||
        filter.uiType === "tickersInput" ||
        filter.tab === "etf"
      ) {
        excluded.push({ key: filter.key, reason: "elite_only" });
        continue;
      }
      const { options, elite } = freeOptions(filter, page.filters.filters);
      eliteOptions += elite;
      if (options.length === 0) {
        excluded.push({ key: filter.key, reason: "no_free_options" });
        continue;
      }
      filters.push({
        key: filter.key,
        tab: filter.tab as FinvizFilterTab,
        label: plain(filter.title.short),
        title: plain(filter.title.full),
        description: plain(filter.title.description),
        options,
      });
    }
    return {
      state: "read",
      source: {
        parserVersion: FINVIZ_SCREENER_PAGE_PARSER_VERSION,
        filtersVersion: page.settings.screenerFiltersVersion,
        screenerVersion: page.settings.screenerVersion,
        measuredOn: page.today.slice(0, 10),
        filters,
      },
      excluded,
      eliteOptions,
    };
  } catch (error) {
    if (error instanceof Rejection)
      return { state: "rejected", reason: error.reason, detail: error.detail };
    throw error;
  }
}
