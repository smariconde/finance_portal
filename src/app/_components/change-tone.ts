/**
 * El color de una variación entre dos lecturas de una métrica.
 *
 * El sentido lo dice siempre el signo escrito y la flecha; el color sólo lo
 * refuerza. Qué sentido se pinta de verde depende de la métrica: que suba la
 * actividad se lee distinto que que suba la inflación (decisión del owner del
 * 2026-11-16, «que se entienda el cambio»). Una métrica sin lectura obvia es
 * `neutral` y su cambio va sin color.
 */
export type ChangePolarity = "higher_is_better" | "lower_is_better" | "neutral";

export type ChangeTone = "favorable" | "unfavorable" | "flat" | "neutral";

/** El signo de un decimal en texto, sin pasar por `number`. */
export function decimalSign(value: string): -1 | 0 | 1 {
  if (/^[+-]?0*(?:\.0*)?$/u.test(value)) return 0;
  return value.startsWith("-") ? -1 : 1;
}

export function changeTone(
  value: string,
  polarity: ChangePolarity,
): ChangeTone {
  const sign = decimalSign(value);

  if (sign === 0) return "flat";
  if (polarity === "neutral") return "neutral";

  return sign > 0 === (polarity === "higher_is_better")
    ? "favorable"
    : "unfavorable";
}

/** Las clases de cada tono; contraste AA sobre `card` y `muted` en los dos temas. */
export const CHANGE_TONE_CLASS: Readonly<Record<ChangeTone, string>> = {
  favorable: "text-emerald-700 dark:text-emerald-400",
  unfavorable: "text-red-700 dark:text-red-400",
  flat: "text-muted-foreground",
  neutral: "text-foreground",
};
