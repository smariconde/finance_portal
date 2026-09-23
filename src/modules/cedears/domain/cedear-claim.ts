/**
 * Lo que una publicación de un emisor afirma sobre uno de sus programas CEDEAR
 * ([ADR 0027](../../../../docs/architecture/adr/0027-cedear-registry-sources.md)).
 *
 * Es el punto de encuentro de los dos parsers: el JSON de Comafi y la tabla HTML
 * de Caja de Valores escriben lo mismo de maneras distintas, y del claim en
 * adelante el registro no sabe de cuál vino. Un claim todavía no es identidad:
 * el subyacente es un ticker declarado, y resolverlo contra el grafo es
 * `resolve-cedear-underlying.ts`.
 */

export type CedearProgramStatus =
  /** Habilitado para emitir y cancelar. */
  | "active"
  /**
   * Inhabilitado para emitir, o para emitir y cancelar. Los dos casos del
   * emisor caen acá porque el modelo de identidad tiene un solo estado
   * intermedio; la diferencia la decide quien lea el registro (`F7-05`).
   */
  | "suspended"
  /** Dado de baja por el emisor. */
  | "terminated"
  /** La publicación no dice nada reconocible del estado. */
  | "unknown";

export type CedearInvestorScope =
  /** «Calificado y no calificado»: cualquier inversor. */
  | "all_investors"
  /** Sólo inversores calificados. */
  | "qualified_only";

/** Fracción exacta `depositaryUnits` CEDEAR por `underlyingUnits` subyacente. */
export type CedearRatio = {
  readonly depositaryUnits: string;
  readonly underlyingUnits: string;
};

export type CedearClaim = {
  readonly cedearIsin: string;
  readonly cajaValoresCode: string;
  /** Sólo para nombrar el programa en un reporte; nunca identifica. */
  readonly programName: string;
  /**
   * Tickers de origen que la fila declara, el principal primero. Comafi repite
   * el ticker en la descripción y a veces los dos no coinciden: guardar ambos es
   * lo que permite detectar que apuntan a empresas distintas.
   */
  readonly originSymbols: readonly string[];
  /** Mercado de origen tal como lo escribe la fuente; puede ser basura. */
  readonly originMarket: string | null;
  readonly reportedUnderlyingIsin: string | null;
  readonly ratio: CedearRatio;
  readonly status: CedearProgramStatus;
  readonly investorScope: CedearInvestorScope | null;
};

export type CedearRowRejectionCode =
  /** La fila no trae ISIN del CEDEAR: sin él no hay programa que identificar. */
  | "cedear_isin_absent"
  /** Trae algo que no es un ISIN válido (forma o dígito verificador). */
  | "cedear_isin_invalid"
  | "caja_valores_code_absent"
  | "ratio_absent"
  /** Un ratio que no es `a:b`, como el `3.1` de la planilla de Comafi. */
  | "ratio_malformed"
  | "origin_symbol_absent"
  /** Dos filas con el mismo ISIN de CEDEAR: no se elige una. */
  | "duplicate_cedear_isin";

export type CedearRowRejection = {
  /** El ISIN si la fila lo trae, o el nombre del programa. */
  readonly rowLabel: string | null;
  readonly code: CedearRowRejectionCode;
};

/** Filas listadas que no son programas sobre acciones ni ETF. */
export type CedearSkippedRow = {
  readonly cedearIsin: string;
  readonly reason: "debt_program";
};

export type CedearPublicationRejectionCode =
  /** El cuerpo no tiene la forma que el parser conoce. */
  | "payload_unparsable"
  /** Tiene la forma pero ningún programa: una publicación vacía no retira nada. */
  | "no_programs"
  /** Más filas que el techo: una respuesta así es otra cosa. */
  | "too_many_rows";

export type CedearPublication =
  | {
      readonly ok: true;
      readonly parserVersion: string;
      readonly rowsSeen: number;
      readonly claims: readonly CedearClaim[];
      readonly rejections: readonly CedearRowRejection[];
      readonly skipped: readonly CedearSkippedRow[];
      /**
       * Todos los ISIN que la publicación lista, válidos o no. Es lo que decide
       * si un programa ya registrado sigue listado: una fila rechazada sigue
       * siendo una fila, y retirar su programa por un error de tipeo sería leer
       * el error como una baja.
       */
      readonly listedIsins: ReadonlySet<string>;
    }
  | { readonly ok: false; readonly code: CedearPublicationRejectionCode };

/** Techo de filas por publicación. Los dos emisores juntos listan ~430. */
export const MAX_PUBLICATION_ROWS = 5_000;

const ISIN_SHAPE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/u;

/**
 * ISO 6166: forma y dígito verificador. Las letras se expanden a su valor en
 * base 36 y el dígito final es el Luhn de la cadena resultante. Rechazar por el
 * verificador separa un ISIN mal tipeado de uno real sin consultar a nadie.
 */
export function isValidIsin(value: string): boolean {
  if (!ISIN_SHAPE.test(value)) {
    return false;
  }

  const digits = [...value.slice(0, -1)]
    .map((character) => Number.parseInt(character, 36).toString())
    .join("");

  let sum = 0;

  for (let index = 0; index < digits.length; index += 1) {
    let digit = Number(digits[digits.length - 1 - index]);

    if (index % 2 === 0) {
      digit *= 2;
    }

    sum += Math.floor(digit / 10) + (digit % 10);
  }

  return (10 - (sum % 10)) % 10 === Number(value.at(-1));
}

const RATIO_PATTERN =
  /^([0-9]{1,6}(?:\.[0-9]{1,6})?):([0-9]{1,6}(?:\.[0-9]{1,6})?)$/u;

/** `007` → `7`, `2.50` → `2.5`: la forma canónica que exige el modelo. */
function canonicalDecimal(value: string): string {
  const [integer = "0", fraction = ""] = value.split(".");
  const trimmedInteger = integer.replace(/^0+(?=[0-9])/u, "");
  const trimmedFraction = fraction.replace(/0+$/u, "");

  return trimmedFraction.length === 0
    ? trimmedInteger
    : `${trimmedInteger}.${trimmedFraction}`;
}

export type RatioParse =
  | { readonly ok: true; readonly ratio: CedearRatio }
  | { readonly ok: false; readonly code: "ratio_absent" | "ratio_malformed" };

/**
 * `20:1`, `144 : 1` y `1 :4` son la misma forma escrita a mano; `3.1` no lo es.
 *
 * Nunca interpreta: `3.1` parece un `3:1` mal tipeado, pero también podría ser
 * otra cosa, y adivinar un ratio es inventar el precio de conversión. Se rechaza
 * por nombre y la fila no entra.
 */
export function parseCedearRatio(raw: string | null | undefined): RatioParse {
  const compact = (raw ?? "").replace(/\s+/gu, "");

  if (compact.length === 0) {
    return { ok: false, code: "ratio_absent" };
  }

  const match = RATIO_PATTERN.exec(compact);

  if (match === null) {
    return { ok: false, code: "ratio_malformed" };
  }

  const depositaryUnits = canonicalDecimal(match[1]!);
  const underlyingUnits = canonicalDecimal(match[2]!);

  if (!/[1-9]/u.test(depositaryUnits) || !/[1-9]/u.test(underlyingUnits)) {
    return { ok: false, code: "ratio_malformed" };
  }

  return { ok: true, ratio: { depositaryUnits, underlyingUnits } };
}

/** `a/b` como par de enteros escalados: `2.5` → `[25n, 10n]`. */
function toScaledInteger(value: string): readonly [bigint, bigint] {
  const [integer = "0", fraction = ""] = value.split(".");

  return [
    BigInt(`${integer}${fraction}`),
    BigInt(`1${"0".repeat(fraction.length)}`),
  ];
}

/**
 * Igualdad de fracciones, no de texto: `2:1` y `4:2` son el mismo ratio. Se
 * compara por producto cruzado en enteros, sin pasar por un `number` binario.
 */
export function ratiosEqual(left: CedearRatio, right: CedearRatio): boolean {
  const [leftDepositary, leftDepositaryScale] = toScaledInteger(
    left.depositaryUnits,
  );
  const [leftUnderlying, leftUnderlyingScale] = toScaledInteger(
    left.underlyingUnits,
  );
  const [rightDepositary, rightDepositaryScale] = toScaledInteger(
    right.depositaryUnits,
  );
  const [rightUnderlying, rightUnderlyingScale] = toScaledInteger(
    right.underlyingUnits,
  );

  return (
    leftDepositary *
      leftUnderlyingScale *
      rightUnderlying *
      rightDepositaryScale ===
    rightDepositary *
      rightUnderlyingScale *
      leftUnderlying *
      leftDepositaryScale
  );
}

/** Minúsculas, sin tildes ni asteriscos y con los espacios colapsados. */
export function normalizeLabel(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/gu, "")
    .replace(/\*/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

/**
 * Estado del programa desde las observaciones del emisor.
 *
 * El emisor escribe a mano y con errores —«Inhablitado»—, así que se compara
 * contra el texto normalizado y con la errata corregida. Lo que no se reconoce
 * es `unknown`, nunca `active` por defecto.
 */
export function parseProgramStatus(
  raw: string | null | undefined,
): CedearProgramStatus {
  if (raw === null || raw === undefined) {
    return "unknown";
  }

  const label = normalizeLabel(raw).replace(/inhablitado/gu, "inhabilitado");

  if (label.includes("dado de baja")) {
    return "terminated";
  }

  // «Inhabilitado para emitir», «… y cancelar», «… -Habilitado para cancelar» y
  // la misma idea escrita al revés: «Habilitado para cancelar y inhabilitado
  // para emitir». En todos el programa no emite.
  if (label.includes("inhabilitado para emitir")) {
    return "suspended";
  }

  if (label === "habilitado para emitir y cancelar") {
    return "active";
  }

  return "unknown";
}

export function parseInvestorScope(
  raw: string | null | undefined,
): CedearInvestorScope | null {
  if (raw === null || raw === undefined) {
    return null;
  }

  const label = normalizeLabel(raw);

  if (label === "calificado y no calificado") {
    return "all_investors";
  }

  if (label === "calificado" || label === "solo calificado") {
    return "qualified_only";
  }

  return null;
}

/**
 * Cierre común de los dos parsers: dos filas con el mismo ISIN no se desempatan
 * —elegir una sería inventar cuál vale—, y una publicación sin ningún programa
 * se rechaza entera en vez de leerse como «el emisor dio de baja todo».
 */
export function finishPublication(
  parserVersion: string,
  rowsSeen: number,
  claims: readonly CedearClaim[],
  rejections: readonly CedearRowRejection[],
  skipped: readonly CedearSkippedRow[],
  listedIsins: ReadonlySet<string>,
): CedearPublication {
  if (listedIsins.size === 0) {
    return { ok: false, code: "no_programs" };
  }

  const counts = new Map<string, number>();

  for (const claim of claims) {
    counts.set(claim.cedearIsin, (counts.get(claim.cedearIsin) ?? 0) + 1);
  }

  const duplicated = new Set(
    [...counts].filter(([, count]) => count > 1).map(([isin]) => isin),
  );

  return {
    ok: true,
    parserVersion,
    rowsSeen,
    claims: claims.filter((claim) => !duplicated.has(claim.cedearIsin)),
    rejections: [
      ...rejections,
      ...[...duplicated].map((isin) => ({
        rowLabel: isin,
        code: "duplicate_cedear_isin" as const,
      })),
    ],
    skipped,
    listedIsins,
  };
}
