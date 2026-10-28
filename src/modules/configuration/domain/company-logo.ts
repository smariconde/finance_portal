/**
 * Logos de empresas cargados por el navegador desde logo.dev (ADR 0062).
 *
 * La clave publicable (`pk_…`) está pensada para el cliente: termina en el
 * HTML. Una clave con otra forma —una secreta `sk_…` pegada por error, o un
 * valor vacío— se ignora y la app muestra el monograma, en vez de exponerla.
 */
const PUBLISHABLE_KEY = /^pk_[A-Za-z0-9_-]{8,128}$/u;

/** Un símbolo de listing: letras, dígitos, punto y guion, como `BRK.B`. */
const TICKER = /^[A-Z0-9][A-Z0-9.-]{0,15}$/u;

export const COMPANY_LOGO_HOST = "https://img.logo.dev";

export function companyLogoUrl(
  ticker: string,
  publishableKey: string | undefined,
): string | null {
  const key = publishableKey?.trim() ?? "";
  const symbol = ticker.trim().toUpperCase();

  if (!PUBLISHABLE_KEY.test(key) || !TICKER.test(symbol)) return null;

  const query = new URLSearchParams({
    token: key,
    size: "64",
    format: "png",
    retina: "true",
    // Sin logo, el proveedor responde 404 en vez de inventar un monograma
    // propio, y la app dibuja el suyo.
    fallback: "404",
  });

  return `${COMPANY_LOGO_HOST}/ticker/${encodeURIComponent(symbol)}?${query.toString()}`;
}

/**
 * Las iniciales del monograma: una letra por cada una de las dos primeras
 * palabras significativas del nombre («Exxon Mobil Corp» → «EM»); con una
 * sola palabra, sus dos primeras letras («Apple Inc.» → «AP»); sin nombre,
 * el ticker. Los sufijos societarios no cuentan.
 */
const LEGAL_SUFFIXES = new Set([
  "INC",
  "CORP",
  "CORPORATION",
  "CO",
  "COMPANY",
  "LTD",
  "PLC",
  "LLC",
  "LP",
  "SA",
  "NV",
  "AG",
  "HOLDINGS",
  "GROUP",
  "THE",
  "&",
]);

export function companyInitials(name: string | null, ticker: string): string {
  const words = (name ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9& ]/gu, " ")
    .split(/\s+/u)
    .filter((word) => word.length > 0 && !LEGAL_SUFFIXES.has(word));

  if (words.length >= 2) return `${words[0]![0]}${words[1]![0]}`;
  if (words.length === 1) return words[0]!.slice(0, 2);
  return ticker.toUpperCase().slice(0, 2);
}

/** Un tono estable por ticker, para que cada monograma se distinga. */
export function companyHue(ticker: string): number {
  let hash = 0;
  for (const char of ticker.toUpperCase()) {
    hash = (hash * 31 + char.charCodeAt(0)) % 360;
  }
  return hash;
}
