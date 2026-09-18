/**
 * Lectura de JSON sin perder exactitud en los importes.
 *
 * `JSON.parse` convierte cada número en un `double`: `12345678901234567890` llega
 * como `12345678901234567000` y nadie se entera. Para un hecho financiero eso es
 * un valor inventado. Desde V8 11.4 el reviver recibe el **texto fuente** de cada
 * primitivo (`context.source`), así que el importe se toma de ahí y el `double`
 * se descarta.
 *
 * Sólo las claves pedidas se leen como texto: el resto del documento sigue siendo
 * un JSON normal, y un `cik` o un año fiscal no necesitan esa precisión.
 */
export class ExactJsonNumber {
  constructor(readonly source: string) {}
}

export class ExactJsonUnavailableError extends Error {
  constructor() {
    super("This runtime does not expose JSON.parse source text access.");
    this.name = "ExactJsonUnavailableError";
  }
}

type ReviverContext = { readonly source?: string };

/**
 * Parsea `text` y reemplaza los números de las claves indicadas por un
 * `ExactJsonNumber` con su texto fuente. Lanza `SyntaxError` si el texto no es
 * JSON y `ExactJsonUnavailableError` si el runtime no expone el texto fuente: sin
 * esa garantía no hay lectura exacta posible, y degradar en silencio al `double`
 * sería justamente el defecto que esto evita.
 */
export function parseJsonWithExactNumbers(
  text: string,
  exactKeys: ReadonlySet<string>,
): unknown {
  return JSON.parse(
    text,
    (key: string, value: unknown, context?: ReviverContext) => {
      if (typeof value !== "number" || !exactKeys.has(key)) {
        return value;
      }

      if (context?.source === undefined) {
        throw new ExactJsonUnavailableError();
      }

      return new ExactJsonNumber(context.source);
    },
  );
}

/** Techo del exponente: nada reportado en una moneda o en acciones lo necesita. */
const MAX_EXPONENT = 64;

/**
 * Convierte el texto de un número JSON en un decimal canónico: sin exponente,
 * sin ceros sobrantes y con `0` en vez de `-0`. La conversión es de texto a texto
 * —mueve el punto—, así que no pasa por aritmética binaria.
 *
 * Devuelve `null` para lo que no es un número JSON o no se puede escribir sin
 * exponente dentro del techo.
 */
export function canonicalDecimalFromJsonNumber(source: string): string | null {
  const match =
    /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/u.exec(source);

  if (match === null) {
    return null;
  }

  const [, sign, integerPart, fractionPart = "", exponentPart] = match;
  const exponent = exponentPart === undefined ? 0 : Number(exponentPart);

  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > MAX_EXPONENT) {
    return null;
  }

  let digits = `${integerPart}${fractionPart}`;
  let point = integerPart!.length + exponent;

  if (point <= 0) {
    digits = `${"0".repeat(1 - point)}${digits}`;
    point = 1;
  }

  if (point > digits.length) {
    digits = `${digits}${"0".repeat(point - digits.length)}`;
  }

  const integer = digits.slice(0, point).replace(/^0+(?=[0-9])/u, "");
  const fraction = digits.slice(point).replace(/0+$/u, "");
  const body = fraction.length > 0 ? `${integer}.${fraction}` : integer;

  return body === "0" ? "0" : `${sign}${body}`;
}

/**
 * Parsea `text` conservando **todos** los números como texto fuente.
 *
 * `parseJsonWithExactNumbers` toma sólo las claves que la ingesta necesita leer
 * exactas. Congelar un extracto necesita lo contrario: reescribir el documento sin
 * que ningún número cambie, incluidos los que la ingesta ni mira. Un `val` que
 * viaja por `double` y vuelve es un valor inventado, y un corpus con valores
 * inventados es peor que no tener corpus.
 */
export function parseJsonPreservingNumbers(text: string): unknown {
  return JSON.parse(
    text,
    (_key: string, value: unknown, context?: ReviverContext) => {
      if (typeof value !== "number") {
        return value;
      }

      if (context?.source === undefined) {
        throw new ExactJsonUnavailableError();
      }

      return new ExactJsonNumber(context.source);
    },
  );
}

/** Máximo de caracteres de un contenedor para escribirlo en una sola línea. */
const INLINE_WIDTH = 240;

function isPrimitiveJson(value: unknown): boolean {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    value instanceof ExactJsonNumber
  );
}

function writeJson(value: unknown, indent: string): string {
  if (value instanceof ExactJsonNumber) {
    return value.source;
  }

  if (isPrimitiveJson(value)) {
    return JSON.stringify(value) ?? "null";
  }

  const nested = `${indent}  `;
  const entries: ReadonlyArray<readonly [string | null, unknown]> =
    Array.isArray(value)
      ? value.map((item) => [null, item] as const)
      : Object.entries(value as Record<string, unknown>);

  if (entries.length === 0) {
    return Array.isArray(value) ? "[]" : "{}";
  }

  const [open, close] = Array.isArray(value)
    ? (["[", "]"] as const)
    : (["{", "}"] as const);

  const written = entries.map(
    ([key, item]) => [key, writeJson(item, nested)] as const,
  );

  // Un contenedor de puros primitivos —un punto de companyfacts, la lista de
  // tickers— va en una línea mientras entre: el diff del corpus se lee por hecho,
  // no por campo.
  if (entries.every(([, item]) => isPrimitiveJson(item))) {
    const single = `${open}${written
      .map(([key, text]) =>
        key === null ? text : `${JSON.stringify(key)}:${text}`,
      )
      .join(",")}${close}`;

    if (single.length <= INLINE_WIDTH) {
      return single;
    }
  }

  const parts = written.map(([key, text]) =>
    key === null ? text : `${JSON.stringify(key)}: ${text}`,
  );

  return `${open}\n${nested}${parts.join(`,\n${nested}`)}\n${indent}${close}`;
}

/**
 * Serializa lo que devolvió `parseJsonPreservingNumbers` sin tocar un solo dígito.
 *
 * La forma es determinista: el orden de las claves es el del documento original
 * —no se reordena nada—, así que el mismo texto descargado produce siempre el
 * mismo archivo, que es lo que permite fijarlo por hash.
 */
export function stringifyJsonPreservingNumbers(value: unknown): string {
  return `${writeJson(value, "")}\n`;
}
