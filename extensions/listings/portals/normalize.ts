/**
 * Conversiones que comparten los adapters: de lo que publica un portal a la
 * forma canónica del contrato `listing-capture-1.0.0`. Ninguna inventa un
 * valor: lo que no es un positivo finito vuelve `null`.
 */

/**
 * Un número publicado como decimal canónico: sin exponente, sin ceros de más,
 * redondeado a `fractionDigits`. Cero, negativos y no finitos son `null`: un
 * portal que muestra «0 m²» no publicó la superficie.
 */
export function positiveDecimal(
  value: number | null | undefined,
  fractionDigits = 2,
): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    return null;
  if (value >= 1e12) return null;
  const fixed = value.toFixed(fractionDigits);
  const trimmed = fixed.includes(".")
    ? fixed.replace(/0+$/u, "").replace(/\.$/u, "")
    : fixed;
  return /[1-9]/u.test(trimmed) ? trimmed : null;
}

/** Una coordenada a seis decimales, canónica; fuera de rango es `null`. */
export function coordinate(
  value: number | null | undefined,
  limit: number,
): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (Math.abs(value) > limit) return null;
  const fixed = value.toFixed(6);
  const trimmed = fixed.replace(/0+$/u, "").replace(/\.$/u, "");
  return trimmed === "-0" ? "0" : trimmed;
}

/** Un entero dentro de `[min, max]`, o `null`. */
export function boundedInteger(
  value: number | null | undefined,
  min: number,
  max: number,
): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value >= min && value <= max ? value : null;
}

/** Texto publicado: sin controles, espacios colapsados y recortado a `max`. */
export function publishedText(
  value: string | null | undefined,
  max: number,
): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]+/gu, " ");
  const collapsed = clean.replace(/\s+/gu, " ").trim();
  if (collapsed === "") return null;
  return collapsed.length > max ? collapsed.slice(0, max).trimEnd() : collapsed;
}

/** Minúsculas sin tildes, para comparar etiquetas de un portal. */
export function foldedLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}
