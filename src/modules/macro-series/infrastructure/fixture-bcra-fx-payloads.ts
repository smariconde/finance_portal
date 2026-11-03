import type {
  EgressFetch,
  EgressFetchRequest,
} from "@/modules/ingestion/application/egress-fetch";

import { BCRA_FX_PAGE_LIMIT } from "../domain/bcra-fx-source";

/**
 * Respuestas **sintéticas** de Estadísticas Cambiarias v1 (ADR 0067): ninguna
 * respuesta real entra al repositorio. Reproducen lo que el parser fija: el
 * `count` es el total de días, los valores llegan con ocho decimales y un día
 * puede traer la misma moneda más de una vez.
 */
export type FixtureFxDay = {
  readonly fecha: string;
  /** Una cotización por entrada, como texto del JSON. Varias = copias del día. */
  readonly quotes: readonly string[];
};

/** `1534` → `1534.00000000`, como el cable. */
export function fxWireNumber(value: string): string {
  const [integer, fraction = ""] = value.split(".");

  return `${integer}.${fraction.padEnd(8, "0")}`;
}

export function fixtureFxDays(
  latestOn: string,
  count: number,
  valueOf: (index: number) => string = (index) => String(1000 + index),
): FixtureFxDay[] {
  const latest = Date.parse(`${latestOn}T00:00:00Z`);

  return Array.from({ length: count }, (_, index) => ({
    fecha: new Date(latest - index * 86_400_000).toISOString().slice(0, 10),
    quotes: [fxWireNumber(valueOf(count - 1 - index))],
  }));
}

export function fixtureFxCurrencies(
  currencies: readonly { codigo: string; denominacion: string }[],
): string {
  return `{"status":200,"results":[${currencies
    .map(
      (currency) =>
        `{"codigo":${JSON.stringify(currency.codigo)},"denominacion":${JSON.stringify(currency.denominacion)}}`,
    )
    .join(",")}]}`;
}

/**
 * Una página como la del cable: `offset` y `limit` cuentan cotizaciones, así
 * que un día con copias puede quedar partido entre dos páginas.
 */
export function fixtureFxQuotesPage(
  isoCode: string,
  days: readonly FixtureFxDay[],
  offset: number,
): string {
  const quotes = days.flatMap((day) =>
    day.quotes.map((quote) => ({ fecha: day.fecha, quote })),
  );
  const slice = quotes.slice(offset, offset + BCRA_FX_PAGE_LIMIT);
  const page: FixtureFxDay[] = [];

  for (const entry of slice) {
    const last = page.at(-1);

    if (last?.fecha === entry.fecha) {
      page[page.length - 1] = {
        ...last,
        quotes: [...last.quotes, entry.quote],
      };
    } else {
      page.push({ fecha: entry.fecha, quotes: [entry.quote] });
    }
  }

  return `{"status":200,"metadata":{"resultset":{"count":${quotes.length},"offset":${offset},"limit":${BCRA_FX_PAGE_LIMIT}}},"results":[${page
    .map(
      (day) =>
        `{"fecha":"${day.fecha}","detalle":[${day.quotes
          .map(
            (quote) =>
              `{"codigoMoneda":"${isoCode}","descripcion":"MONEDA SINTÉTICA","tipoPase":0.00000000,"tipoCotizacion":${quote}}`,
          )
          .join(",")}]}`,
    )
    .join(",")}]}`;
}

export type FixtureFxState = {
  currencies: readonly { codigo: string; denominacion: string }[];
  quotes: Map<string, readonly FixtureFxDay[]>;
};

/**
 * Egress falso de la API cambiaria: sirve por ruta y `offset`, sin mirar las
 * fechas pedidas, y cuenta las requests.
 */
export function createFixtureBcraFxFetch(
  state: FixtureFxState,
  clock: () => string,
): EgressFetch & { readonly requests: EgressFetchRequest[] } {
  const requests: EgressFetchRequest[] = [];
  const encoder = new TextEncoder();

  const fetch = async (request: EgressFetchRequest) => {
    requests.push(request);
    const url = new URL(request.url);
    let body: string | null = null;

    if (url.pathname.endsWith("/Maestros/Divisas")) {
      body = fixtureFxCurrencies(state.currencies);
    } else {
      const isoCode = url.pathname.split("/").at(-1)!;
      const days = state.quotes.get(isoCode);

      if (days !== undefined) {
        body = fixtureFxQuotesPage(
          isoCode,
          days,
          Number(url.searchParams.get("offset")),
        );
      }
    }

    const bytes = encoder.encode(
      body ?? `{"status":400,"errorMessages":["x"]}`,
    );

    return {
      status: body === null ? 400 : 200,
      body: bytes,
      byteLength: bytes.byteLength,
      fetchedAt: clock(),
      retryAfter: null,
    };
  };

  return Object.assign(fetch, { requests });
}
