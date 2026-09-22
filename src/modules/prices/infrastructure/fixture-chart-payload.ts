/**
 * Filer sintético de precios: un payload con la **forma** de la respuesta real,
 * con números inventados.
 *
 * Es sintético a propósito y no un recorte del cable. El repositorio es público
 * y la regla del proyecto prohíbe commitear payloads capturados; la única
 * excepción es el corpus congelado de la
 * [ADR 0023](../../../../docs/architecture/adr/0023-frozen-sec-extracts-rights.md),
 * que vale sólo para `sec-edgar` —una fuente cuyos derechos dicen `allowed`— y
 * no para una fuente que no concede nada
 * ([ADR 0026](../../../../docs/architecture/adr/0026-daily-prices-source.md)).
 *
 * Lo que el sintético prueba es que el parser hace lo que creemos, incluidos los
 * casos que el cable real no ofrece cuando uno quiere: una rueda sin cierre, un
 * split y un dividendo el mismo mes, un símbolo sin eventos.
 */
export const FIXTURE_CHART_SYMBOL = "SYNTH";

/** Apertura de una rueda de Nueva York: 9:30 ET = 13:30 UTC en horario de verano. */
function openingOf(isoDate: string): number {
  return Math.floor(Date.parse(`${isoDate}T13:30:00.000Z`) / 1000);
}

const NEW_YORK_SUMMER_OFFSET = -4 * 3600;

export const FIXTURE_CHART_PAYLOAD = Object.freeze({
  chart: {
    result: [
      {
        meta: {
          currency: "USD",
          symbol: FIXTURE_CHART_SYMBOL,
          gmtoffset: NEW_YORK_SUMMER_OFFSET,
          exchangeTimezoneName: "America/New_York",
        },
        timestamp: [
          openingOf("2024-06-05"),
          openingOf("2024-06-06"),
          openingOf("2024-06-07"),
          openingOf("2024-06-10"),
          openingOf("2024-06-11"),
        ],
        indicators: {
          quote: [
            {
              // La tercera rueda no publica cierre: el parser la cuenta y la
              // deja afuera en vez de rellenarla.
              close: [100, 102.5, null, 10.4, 10.55],
            },
          ],
          adjclose: [{ adjclose: [99.5, 102, null, 10.4, 10.55] }],
        },
        events: {
          splits: {
            "1718020800": {
              date: openingOf("2024-06-10"),
              numerator: 10,
              denominator: 1,
              splitRatio: "10:1",
            },
          },
          dividends: {
            "1717588800": {
              date: openingOf("2024-06-05"),
              amount: 0.25,
            },
          },
        },
      },
    ],
    error: null,
  },
});

/** Un símbolo sin eventos: la serie más común y la que no ejercita nada. */
export const FIXTURE_CHART_PAYLOAD_WITHOUT_EVENTS = Object.freeze({
  chart: {
    result: [
      {
        meta: {
          currency: "USD",
          symbol: "QUIET",
          gmtoffset: NEW_YORK_SUMMER_OFFSET,
        },
        timestamp: [openingOf("2026-09-17"), openingOf("2026-09-18")],
        indicators: { quote: [{ close: [50.25, 50.75] }] },
      },
    ],
    error: null,
  },
});

/** Lo que devuelve un símbolo que la fuente no conoce. */
export const FIXTURE_CHART_PAYLOAD_UNKNOWN_SYMBOL = Object.freeze({
  chart: {
    result: null,
    error: {
      code: "Not Found",
      description: "No data found, symbol may be delisted",
    },
  },
});
