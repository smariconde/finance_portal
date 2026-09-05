/**
 * Etiqueta comercial del mercado → MIC (ISO 10383), como convención versionada.
 *
 * La SEC publica "Nasdaq" o "NYSE", que son nombres, no identidades de venue. El
 * modelo de identidad exige un MIC en el listing, así que la traducción tiene
 * que ser una regla citable y no una heurística: una etiqueta que no está en el
 * mapa **rechaza** el constituyente en vez de adivinarle un mercado.
 *
 * `OTC` no aparece a propósito. Los mercados over-the-counter no se identifican
 * con un único MIC y ninguna empresa del S&P 500 cotiza ahí; una fila así es una
 * señal de que la lista y el índice no coinciden, no un caso a completar.
 */
export const VENUE_MAP_VERSION = "venue-map-1.0.0";

export type Venue = {
  readonly mic: string;
  readonly country: string;
  readonly quoteCurrency: string;
};

const US_EQUITY: Omit<Venue, "mic"> = {
  country: "US",
  quoteCurrency: "USD",
};

const VENUES_BY_LABEL: ReadonlyMap<string, Venue> = new Map([
  ["nasdaq", { mic: "XNAS", ...US_EQUITY }],
  ["nasdaq global select", { mic: "XNGS", ...US_EQUITY }],
  ["nyse", { mic: "XNYS", ...US_EQUITY }],
  ["new york stock exchange", { mic: "XNYS", ...US_EQUITY }],
  ["nyse american", { mic: "XASE", ...US_EQUITY }],
  ["nyse arca", { mic: "ARCX", ...US_EQUITY }],
  ["cboe", { mic: "BATS", ...US_EQUITY }],
  ["cboe bzx", { mic: "BATS", ...US_EQUITY }],
]);

/** Devuelve `null` cuando la etiqueta no está mapeada: no hay venue por defecto. */
export function resolveVenue(exchangeLabel: string | null): Venue | null {
  if (exchangeLabel === null) {
    return null;
  }

  return (
    VENUES_BY_LABEL.get(
      exchangeLabel.trim().toLowerCase().replace(/\s+/gu, " "),
    ) ?? null
  );
}
