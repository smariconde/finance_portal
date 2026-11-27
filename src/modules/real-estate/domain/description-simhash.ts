/**
 * La huella de la descripción de un aviso (ADR 0089, Decisión 4): 64 bits que
 * viajan en lugar del texto. Dos avisos de la misma casa redactados por dos
 * agencias, o el mismo aviso republicado con una coma de más, quedan a pocos
 * bits de distancia; dos casas distintas, lejos.
 *
 * `description-simhash-1.0.0`:
 *
 * - normaliza: minúsculas, sin tildes (NFD sin marcas), y sólo corridas de
 *   `[a-z0-9]`; todo lo demás separa;
 * - los rasgos son los **pares de palabras** consecutivas (con menos de dos
 *   palabras no hay huella: `null`), cada uno con peso 1;
 * - cada rasgo se hashea con FNV-1a de 64 bits y suma o resta en cada bit;
 * - sale en 16 caracteres hex minúscula.
 *
 * Se calcula en el navegador con `BigInt`; ninguna dependencia. El repositorio
 * compila a ES2017, que no admite literales `1n`: van como `BigInt(…)`.
 */
export const DESCRIPTION_SIMHASH_VERSION = "description-simhash-1.0.0";

const ZERO = BigInt(0);
const ONE = BigInt(1);
const FNV_OFFSET = BigInt("0xcbf29ce484222325");
const FNV_PRIME = BigInt("0x100000001b3");
const MASK_64 = (ONE << BigInt(64)) - ONE;

export function normalizedWords(text: string): readonly string[] {
  return (
    text
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .toLowerCase()
      .match(/[a-z0-9]+/gu) ?? []
  );
}

function fnv1a64(value: string): bigint {
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash;
}

export function descriptionSimhash(text: string | null): string | null {
  if (text === null) return null;
  const words = normalizedWords(text);
  if (words.length < 2) return null;

  const weights = new Array<number>(64).fill(0);
  for (let index = 0; index + 1 < words.length; index += 1) {
    const hash = fnv1a64(`${words[index]} ${words[index + 1]}`);
    for (let bit = 0; bit < 64; bit += 1) {
      weights[bit] += (hash >> BigInt(bit)) & ONE ? 1 : -1;
    }
  }

  let result = ZERO;
  for (let bit = 0; bit < 64; bit += 1) {
    if (weights[bit] > 0) result |= ONE << BigInt(bit);
  }
  return result.toString(16).padStart(16, "0");
}

/** Bits distintos entre dos huellas de 64 bits en hex. */
export function hammingDistance64(a: string, b: string): number {
  let diff = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  while (diff > ZERO) {
    count += Number(diff & ONE);
    diff >>= ONE;
  }
  return count;
}
