import type {
  EgressFetch,
  EgressFetchRequest,
} from "@/modules/ingestion/application/egress-fetch";

import {
  catalogPageUrl,
  CATALOG_PAGE_LIMIT,
  methodologyPageUrl,
  METHODOLOGY_PAGE_LIMIT,
  seriesPageUrl,
  SERIES_PAGE_LIMIT,
} from "../domain/bcra-monetary-source";

/**
 * Respuestas **sintéticas** con la forma del cable medido el 2026-11-02
 * (ADR 0065). Ninguna respuesta real entra al repositorio: los valores son
 * inventados y las descripciones, genéricas.
 *
 * Reproducen las dos rarezas que el parser fija: el `count` del catálogo es lo
 * que queda desde el `offset`, y los valores llegan con once decimales.
 */
export type FixtureCatalogRow = {
  readonly idVariable: number;
  readonly descripcion?: string;
  readonly categoria?: string;
  readonly tipoSerie?: string;
  readonly periodicidad?: string;
  readonly unidadExpresion?: string;
  readonly moneda?: string;
  readonly primerFechaInformada?: string;
  readonly ultFechaInformada?: string | null;
  /** Texto del número tal como va en el JSON. */
  readonly ultValorInformado?: string | null;
};

export type FixturePoint = {
  readonly fecha: string;
  /** Texto del número tal como va en el JSON, o `null`. */
  readonly valor: string | null;
};

/** Un decimal con los once decimales del cable: `12.5` → `12.50000000000`. */
export function wireNumber(value: string): string {
  const [integer, fraction = ""] = value.split(".");

  return `${integer}.${fraction.padEnd(11, "0")}`;
}

function catalogRowJson(row: FixtureCatalogRow): string {
  const text = (value: string) => JSON.stringify(value);

  return `{"idVariable":${row.idVariable},"descripcion":${text(row.descripcion ?? `Variable sintética ${row.idVariable}`)},"categoria":${text(row.categoria ?? "Principales Variables")},"tipoSerie":${text(row.tipoSerie ?? "Saldos")},"periodicidad":${text(row.periodicidad ?? "D")},"unidadExpresion":${text(row.unidadExpresion ?? "En millones de ARS")},"moneda":${text(row.moneda ?? "ML")},"primerFechaInformada":${text(row.primerFechaInformada ?? "2020-01-02")},"ultFechaInformada":${row.ultFechaInformada === null ? "null" : text(row.ultFechaInformada ?? "2026-10-30")},"ultValorInformado":${row.ultValorInformado === null ? "null" : (row.ultValorInformado ?? wireNumber("100"))}}`;
}

function resultset(count: number, offset: number, limit: number): string {
  return `{"count":${count},"offset":${offset},"limit":${limit}}`;
}

export function fixtureCatalogPage(
  allRows: readonly FixtureCatalogRow[],
  offset: number,
): string {
  const rows = allRows.slice(offset, offset + CATALOG_PAGE_LIMIT);

  return `{"status":200,"metadata":{"resultset":${resultset(allRows.length - offset, offset, CATALOG_PAGE_LIMIT)}},"results":[${rows.map(catalogRowJson).join(",")}]}`;
}

export function fixtureMethodologyPage(
  all: readonly { readonly id: number; readonly detalle: string | null }[],
  offset: number,
): string {
  const rows = all.slice(offset, offset + METHODOLOGY_PAGE_LIMIT);

  return `{"status":200,"metadata":{"resultset":${resultset(all.length, offset, METHODOLOGY_PAGE_LIMIT)}},"results":[${rows
    .map((row) => `{"id":${row.id},"detalle":${JSON.stringify(row.detalle)}}`)
    .join(",")}]}`;
}

/** `points` en el orden del cable: de la fecha más reciente a la más vieja. */
export function fixtureSeriesPage(
  variableId: number,
  points: readonly FixturePoint[],
  offset: number,
): string {
  const rows = points.slice(offset, offset + SERIES_PAGE_LIMIT);

  return `{"status":200,"metadata":{"resultset":${resultset(points.length, offset, SERIES_PAGE_LIMIT)}},"results":[{"idVariable":${variableId},"detalle":[${rows
    .map(
      (point) => `{"fecha":"${point.fecha}","valor":${point.valor ?? "null"}}`,
    )
    .join(",")}]}]}`;
}

/** Puntos diarios consecutivos, del más reciente al más viejo. */
export function fixtureDailyPoints(
  latestOn: string,
  count: number,
  valueOf: (index: number) => string = (index) => String(1000 + index),
): FixturePoint[] {
  const latest = Date.parse(`${latestOn}T00:00:00Z`);

  return Array.from({ length: count }, (_, index) => ({
    fecha: new Date(latest - index * 86_400_000).toISOString().slice(0, 10),
    valor: wireNumber(valueOf(count - 1 - index)),
  }));
}

export type FixtureBcraState = {
  catalog: readonly FixtureCatalogRow[];
  methodology: readonly {
    readonly id: number;
    readonly detalle: string | null;
  }[];
  series: Map<number, readonly FixturePoint[]>;
};

/**
 * Egress falso que sirve las páginas por URL, cuenta las requests y fecha cada
 * respuesta con el reloj que se le pase.
 */
export function createFixtureBcraFetch(
  state: FixtureBcraState,
  clock: () => string,
  overrides: ReadonlyMap<string, { status: number; body: string }> = new Map(),
): EgressFetch & { readonly requests: EgressFetchRequest[] } {
  const requests: EgressFetchRequest[] = [];
  const encoder = new TextEncoder();

  const fetch = async (request: EgressFetchRequest) => {
    requests.push(request);
    const override = overrides.get(request.url);
    let body: string | null = override?.body ?? null;
    let status = override?.status ?? 200;

    if (override === undefined) {
      body = resolve(request.url);
      status = body === null ? 400 : 200;
    }

    const bytes = encoder.encode(
      body ?? `{"status":400,"errorMessages":["x"]}`,
    );

    return {
      status,
      body: bytes,
      byteLength: bytes.byteLength,
      fetchedAt: clock(),
      retryAfter: status === 429 ? "60" : null,
    };
  };

  function resolve(url: string): string | null {
    for (
      let offset = 0;
      offset <= state.catalog.length;
      offset += CATALOG_PAGE_LIMIT
    ) {
      if (url === catalogPageUrl(offset)) {
        return fixtureCatalogPage(state.catalog, offset);
      }
    }

    for (
      let offset = 0;
      offset <= state.methodology.length;
      offset += METHODOLOGY_PAGE_LIMIT
    ) {
      if (url === methodologyPageUrl(offset)) {
        return fixtureMethodologyPage(state.methodology, offset);
      }
    }

    for (const [variableId, points] of state.series) {
      for (
        let offset = 0;
        offset <= points.length;
        offset += SERIES_PAGE_LIMIT
      ) {
        if (url === seriesPageUrl(variableId, offset)) {
          return fixtureSeriesPage(variableId, points, offset);
        }
      }
    }

    return null;
  }

  return Object.assign(fetch, { requests });
}
