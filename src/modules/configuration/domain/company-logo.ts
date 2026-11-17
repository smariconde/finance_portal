/**
 * Localizador del proveedor y recurso propio de logos (ADR 0077).
 *
 * El proveedor requiere una clave publicable `pk_…`; la app la usa sólo desde
 * el servidor. Una clave secreta `sk_…` pegada por error o un valor vacío se
 * ignora. Las imágenes ya guardadas no necesitan esa clave.
 */
const PUBLISHABLE_KEY = /^pk_[A-Za-z0-9_-]{8,128}$/u;

/** Sólo la clase de clave admitida por el CDN. */
export function companyLogoPublishableKey(
  value: string | undefined,
): string | null {
  const key = value?.trim() ?? "";
  return PUBLISHABLE_KEY.test(key) ? key : null;
}

/** Un símbolo de listing: letras, dígitos, punto y guion, como `BRK.B`. */
const TICKER = /^[A-Z0-9][A-Z0-9.-]{0,15}$/u;

export function companyLogoSymbol(ticker: string): string | null {
  const symbol = ticker.trim().toUpperCase();
  return TICKER.test(symbol) ? symbol : null;
}

/** La imagen durable funciona incluso después de quitar la clave del proveedor. */
export function companyLogoAssetUrl(ticker: string): string | null {
  const symbol = companyLogoSymbol(ticker);
  return symbol === null
    ? null
    : `/api/company-logos/${encodeURIComponent(symbol)}`;
}

export const COMPANY_LOGO_HOST = "https://img.logo.dev";

export function companyLogoUrl(
  ticker: string,
  publishableKey: string | undefined,
): string | null {
  const key = companyLogoPublishableKey(publishableKey);
  const symbol = ticker.trim().toUpperCase();

  if (key === null || !TICKER.test(symbol)) return null;

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

/**
 * Cómo entra un logo en un contorno circular (`company-logo-fit-1.0.0`).
 *
 * El proveedor entrega dos clases de imagen: una placa llena con el fondo de
 * la marca hasta las esquinas (Amazon, NVIDIA, Uber) y un dibujo sobre
 * transparente que toca los bordes (Apple, Airbnb, P&G). La placa llena cubre
 * el círculo entero —el recorte sólo quita fondo—; el dibujo se achica al
 * cuadrado inscripto, porque cubrirlo le cortaría las puntas.
 *
 * Decide la opacidad de las cuatro esquinas, de 0 a 255: todas opacas es
 * `cover`. Sin las cuatro lecturas, `inset`, que nunca recorta.
 */
export type CompanyLogoFit = "cover" | "inset";

const OPAQUE_CORNER = 250;

export function companyLogoFit(
  cornerAlphas: readonly number[],
): CompanyLogoFit {
  return cornerAlphas.length === 4 &&
    cornerAlphas.every((alpha) => alpha >= OPAQUE_CORNER)
    ? "cover"
    : "inset";
}
