import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Qué símbolos puede cotizar la página (`schwab-quote-scope-1.0.0`, ADR 0076,
 * sección 7; `F11-04`).
 *
 * Las cotizaciones se piden sólo para posiciones abiertas, y el cliente no elige
 * un ticker (`TM-03`): cada lectura de la cuenta emite un alcance firmado con la
 * subclave `quote-scope` con los símbolos que vio y un vencimiento. La acción de
 * cotizaciones verifica la firma y cotiza exactamente esos símbolos, sin volver
 * a leer la cuenta —que serían cuatro pedidos más cada 15 s—.
 *
 * El alcance no es secreto: lleva símbolos que la página ya muestra. Lo que
 * importa es que no se pueda fabricar ni extender.
 */
export const QUOTE_SCOPE_VERSION = "schwab-quote-scope-1.0.0";

/** Dos lecturas de la cuenta fuera de sesión: un alcance vivo siempre se renueva. */
export const QUOTE_SCOPE_TTL_MS = 10 * 60 * 1000;
export const QUOTE_SCOPE_MAX_SYMBOLS = 50;

const SYMBOL = /^[A-Z][A-Z0-9./-]{0,15}$/u;
const TOKEN = /^[A-Za-z0-9_-]{1,2048}\.[A-Za-z0-9_-]{43}$/u;

export type QuoteScope = {
  readonly symbols: readonly string[];
  readonly expiresAt: string;
};

function sign(key: Buffer, payload: string): Buffer {
  return createHmac("sha256", key)
    .update(`${QUOTE_SCOPE_VERSION}\n${payload}`)
    .digest();
}

/** Símbolos cotizables: los únicos que la firma admite, ordenados y sin repetir. */
export function quotableSymbols(symbols: readonly string[]): string[] {
  return [...new Set(symbols)]
    .filter((symbol) => SYMBOL.test(symbol))
    .sort()
    .slice(0, QUOTE_SCOPE_MAX_SYMBOLS);
}

export function issueQuoteScope(
  key: Buffer,
  symbols: readonly string[],
  now: string,
): string {
  const scope: QuoteScope = {
    symbols: quotableSymbols(symbols),
    expiresAt: new Date(Date.parse(now) + QUOTE_SCOPE_TTL_MS).toISOString(),
  };
  const payload = Buffer.from(JSON.stringify(scope), "utf8").toString(
    "base64url",
  );
  return `${payload}.${sign(key, payload).toString("base64url")}`;
}

export type QuoteScopeCheck =
  | { readonly ok: true; readonly scope: QuoteScope }
  | {
      readonly ok: false;
      readonly reason: "malformed" | "bad_signature" | "expired";
    };

export function verifyQuoteScope(
  key: Buffer,
  token: string,
  now: string,
): QuoteScopeCheck {
  if (!TOKEN.test(token)) return { ok: false, reason: "malformed" };

  const [payload, signature] = token.split(".") as [string, string];
  const expected = sign(key, payload);
  const received = Buffer.from(signature, "base64url");
  if (
    received.byteLength !== expected.byteLength ||
    !timingSafeEqual(received, expected)
  ) {
    return { ok: false, reason: "bad_signature" };
  }

  let scope: QuoteScope;
  try {
    scope = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }

  // Firmado por el portal, pero se revisa igual: una firma no vuelve válida
  // una forma que el emisor nunca produce.
  if (
    !Array.isArray(scope.symbols) ||
    typeof scope.expiresAt !== "string" ||
    quotableSymbols(scope.symbols).join(",") !== scope.symbols.join(",")
  ) {
    return { ok: false, reason: "malformed" };
  }

  if (!(Date.parse(now) < Date.parse(scope.expiresAt))) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, scope };
}
