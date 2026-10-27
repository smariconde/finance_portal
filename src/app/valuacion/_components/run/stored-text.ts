/**
 * Textos que las reglas guardan en inglés dentro del snapshot (`F6-17`).
 *
 * El snapshot no se reescribe: sus textos son parte del `input_hash`, y
 * traducirlos ahí movería el hash de cada corrida guardada. La página los
 * traduce al mostrarlos, por coincidencia exacta del cuerpo, y deja la versión
 * de la regla al final. Un texto que no está acá se muestra tal cual.
 */
const BODIES: readonly (readonly [RegExp, string])[] = [
  [
    /^The margin converges to the weakest positive margin of the measured cycle\.$/u,
    "El margen converge al peor margen positivo del ciclo medido.",
  ],
  [
    /^The margin converges to the strongest margin of the measured cycle\.$/u,
    "El margen converge al mejor margen del ciclo medido.",
  ],
  [
    /^the lowest positive annual margin of the cycle history, to four decimals\.$/u,
    "el menor margen anual positivo de la historia del ciclo, a cuatro decimales.",
  ],
  [
    /^the highest annual margin of the cycle history, to four decimals\.$/u,
    "el mayor margen anual de la historia del ciclo, a cuatro decimales.",
  ],
  [
    /^Growth at the weakest measured rate and no excess returns after year 10\.$/u,
    "Crecimiento a la tasa más baja medida en su historia y sin retornos extraordinarios después del año 10.",
  ],
  [
    /^Growth at the strongest measured rate and the company's own return on capital in perpetuity\.$/u,
    "Crecimiento a la tasa más alta medida en su historia y el retorno sobre el capital propio de la empresa para siempre.",
  ],
  [
    /^the lowest of the log-linear trend and the window CAGRs\.$/u,
    "la menor entre la tendencia y las tasas compuestas de cada ventana.",
  ],
  [
    /^the highest of the log-linear trend and the window CAGRs\.$/u,
    "la mayor entre la tendencia y las tasas compuestas de cada ventana.",
  ],
  [
    /^terminal ROIC at the terminal WACC, growth without advantage\.$/u,
    "ROIC terminal igual a la tasa de descuento terminal: crecer no agrega valor.",
  ],
  [
    /^terminal ROIC at the base year's adjusted ROIC\.$/u,
    "ROIC terminal igual al ROIC ajustado del ejercicio base.",
  ],
  [
    /^no recipe separates non-operating assets; valued at zero and named\.$/u,
    "ninguna receta separa activos no operativos; se valúan en cero y se dice.",
  ],
  [
    /^no recipe reads preferred or other senior claims; valued at zero and named\.$/u,
    "ninguna receta lee acciones preferidas u otros reclamos anteriores; se valúan en cero y se dice.",
  ],
  [
    /^no borrowing or scheduled debt maturity in the last (\d+) fiscal years, and interest is absent or within the top rating band; valued at zero and named\.$/u,
    "sin préstamos ni vencimientos de deuda en los últimos $1 ejercicios, e intereses ausentes o en la mejor banda de calificación; se valúa en cero y se dice.",
  ],
  [
    /^No noncontrolling interest is reported in the base-year balance sheet\.$/u,
    "El balance del ejercicio base no reporta participaciones no controlantes.",
  ],
  [
    /^no accepted transcription of the equity note and no option count and strike in the XBRL of the same filing; employee options are not subtracted, so the value per share is an upper bound\.$/u,
    "sin transcripción aceptada de la nota de compensación ni cantidad y precio de ejercicio de opciones en el XBRL del mismo filing; las opciones no se restan, así que el valor por acción es un techo.",
  ],
  [
    /^The accepted transcription of the equity note has no outstanding employee options\.$/u,
    "La transcripción aceptada de la nota de compensación no tiene opciones de empleados vigentes.",
  ],
  [
    /^The XBRL of the same filing reports no outstanding employee options\.$/u,
    "El XBRL del mismo filing no reporta opciones de empleados vigentes.",
  ],
];

/** `derived-assumptions-2.0.0: …`: la regla que escribió el texto. */
const VERSION_PREFIX = /^([a-z0-9-]+-\d+\.\d+\.\d+): ([^]*)$/u;

export function storedTextEs(text: string): string {
  const prefixed = VERSION_PREFIX.exec(text);
  const version = prefixed?.[1] ?? null;
  const body = prefixed?.[2] ?? text;

  for (const [pattern, spanish] of BODIES) {
    if (pattern.test(body)) {
      const translated = body.replace(pattern, spanish);
      const sentence = translated.charAt(0).toUpperCase() + translated.slice(1);
      return version === null ? sentence : `${sentence} (${version})`;
    }
  }

  return text;
}
