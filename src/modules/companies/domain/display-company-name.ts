/**
 * Cómo se muestra el nombre legal de una empresa (`display-company-name-1.0.0`).
 *
 * La SEC publica dos de cada tres nombres en mayúsculas sostenidas («JPMORGAN
 * CHASE & CO», «SMITH A O CORP»). Al lado de «Apple Inc.» se leen como un grito,
 * así que se llevan a mayúscula inicial sólo al mostrarlos: el dato guardado no
 * cambia. Un nombre que ya trae minúsculas se deja como vino, porque su emisor
 * eligió esa grafía.
 *
 * Las palabras de hasta tres letras sin vocal, o con dígitos o símbolos, se
 * quedan en mayúsculas (IBM, 3M, AT&T, PLC); los sufijos societarios conocidos
 * toman su forma habitual.
 */
export const DISPLAY_COMPANY_NAME_VERSION = "display-company-name-1.0.0";

const SUFFIXES: Readonly<Record<string, string>> = {
  CO: "Co.",
  "CO.": "Co.",
  COS: "Cos.",
  CORP: "Corp.",
  "CORP.": "Corp.",
  INC: "Inc.",
  "INC.": "Inc.",
  LTD: "Ltd.",
  "LTD.": "Ltd.",
  "N.V.": "N.V.",
  NV: "N.V.",
  "S.A.": "S.A.",
  SA: "S.A.",
  AG: "AG",
  SE: "SE",
  LP: "LP",
  "L.P.": "L.P.",
  "&": "&",
};

/** Conectores que van en minúscula salvo al principio. */
const LOWER = new Set(["OF", "AND", "THE", "DE", "DEL", "LA", "FOR"]);

function keepsUppercase(word: string): boolean {
  // Guiones y apóstrofos separan palabras, no las vuelven siglas.
  const letters = word.replace(/[.,'’-]/gu, "");
  if (/[^A-Z]/u.test(letters)) {
    return true;
  }
  return letters.length <= 3 && !/[AEIOU]/u.test(letters);
}

function displayWord(word: string, first: boolean): string {
  const trailing = word.endsWith(",") ? "," : "";
  const bare = trailing === "" ? word : word.slice(0, -1);
  const suffix = SUFFIXES[bare];

  if (suffix !== undefined && !first) {
    return suffix + trailing;
  }
  if (!first && LOWER.has(bare)) {
    return bare.toLowerCase() + trailing;
  }
  if (keepsUppercase(bare)) {
    return bare + trailing;
  }

  return (
    bare
      .toLowerCase()
      // Cada tramo después de un guion lleva su mayúscula; después de un
      // apóstrofo, sólo si lo precede una letra sola (O'Reilly, McDonald's no).
      .replace(
        /(^|-|\/|(?<=^\p{L})['’])(\p{L})/gu,
        (_, sep: string, letter: string) => sep + letter.toUpperCase(),
      ) + trailing
  );
}

export function displayCompanyName(name: string): string {
  const trimmed = name.trim();

  if (trimmed === "" || /\p{Ll}/u.test(trimmed)) {
    return trimmed;
  }

  return trimmed
    .split(/\s+/u)
    .map((word, index) => displayWord(word, index === 0))
    .join(" ");
}
