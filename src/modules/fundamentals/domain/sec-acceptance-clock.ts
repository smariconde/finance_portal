/**
 * En qué reloj publica un archivo de `submissions` sus aceptaciones
 * ([ADR 0036](../../../../docs/architecture/adr/0036-sec-acceptance-clock.md)).
 *
 * La ADR 0010 midió que el `Z` de `acceptanceDateTime` es UTC real. Desde
 * principios de octubre de 2026 la SEC regenera cada archivo de un filer que
 * presenta algo con el offset de Nueva York aplicado **dos veces**: los dígitos
 * UTC leídos como hora de Nueva York y vueltos a convertir. El 10-K de Amazon
 * aceptado a las 18:44:31 de Nueva York (`23:44:31Z`), según su página índice,
 * pasó a publicarse `2026-02-06T04:44:31Z`; el archivo de ExxonMobil, que no
 * presentó nada desde septiembre, sigue en UTC. El error es por archivo —el
 * `recent` y cada histórico— y nunca por fila.
 *
 * Una fila sola no dice en qué reloj está. Un archivo entero sí: EDGAR acepta
 * presentaciones de 6:00 a 22:00 de Nueva York, así que la lectura verdadera
 * deja casi todo adentro y la otra deja afuera lo de la tarde o lo de la
 * mañana.
 *
 * Los dos errores no pesan igual. Corregir un archivo que estaba bien adelanta
 * cada aceptación cuatro o cinco horas, que es look-ahead; no corregir uno
 * corrido la deja tarde, que es conservador. Por eso la regla corrige sólo con
 * evidencia decisiva —la lectura corregida encaja y la publicada queda
 * claramente contradicha—, conserva lo publicado cuando encaja aunque nada lo
 * confirme (un filer chico que presenta siempre a media tarde) y rechaza el
 * archivo con nombre únicamente cuando ninguna lectura encaja.
 *
 * `1.1.0`: hasta ~2002 EDGAR publica sólo la fecha de aceptación, y la fila
 * trae como marcador la medianoche de Nueva York. Un marcador no dice nada del
 * reloj —EDGAR está cerrado a esa hora en las dos lecturas— y la `1.0.0` lo
 * contaba: los históricos de Incyte y NVIDIA, corridos sin duda desde 2003,
 * quedaban indeterminados por sus filas de los noventa. Peor, en un archivo
 * sano el marcador corregido cae a las 19:00 o 20:00 del día anterior y
 * empujaría a corregir de más. Una aceptación que es exactamente medianoche de
 * Nueva York en alguna de las dos lecturas se aparta de la evidencia y se
 * cuenta en `datePlaceholders`; se corrige igual que las demás.
 */
export const SEC_ACCEPTANCE_CLOCK_VERSION = "sec-acceptance-clock-1.1.0";

export type SecAcceptanceClock =
  /**
   * Lo publicado encaja en el horario de EDGAR y no hay evidencia decisiva del
   * offset doble: se lee en UTC, como midió la ADR 0010.
   */
  | "published_utc"
  /** El offset de Nueva York está aplicado dos veces y se resta. */
  | "new_york_offset_applied_twice"
  /** No hay aceptaciones con hora que leer: no hay nada que corregir. */
  | "no_acceptances"
  /** Ninguna lectura encaja: el archivo no se usa. */
  | "undetermined";

export type SecAcceptanceClockReading = {
  readonly version: string;
  readonly clock: SecAcceptanceClock;
  readonly acceptances: number;
  /** Marcadores de fecha sin hora: no son evidencia del reloj. */
  readonly datePlaceholders: number;
  /** Aceptaciones fuera del horario de EDGAR leídas como se publican. */
  readonly outsideAsPublished: number;
  /** Las mismas, después de restar el offset de Nueva York. */
  readonly outsideCorrected: number;
};

const EDGAR_OPENS_HOUR = 6;
const EDGAR_CLOSES_HOUR = 22;

const NEW_YORK_CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZoneName: "longOffset",
});

function newYorkClock(instantMs: number): {
  readonly secondOfDay: number;
  readonly offsetMs: number;
} {
  const parts = Object.fromEntries(
    NEW_YORK_CLOCK.formatToParts(new Date(instantMs)).map((part) => [
      part.type,
      part.value,
    ]),
  );
  // `GMT-05:00` o `GMT-04:00`: Nueva York nunca está en `GMT` a secas.
  const offset = /^GMT([+-])([0-9]{2}):([0-9]{2})$/u.exec(
    parts.timeZoneName ?? "",
  );

  if (offset === null) {
    throw new Error("El huso de Nueva York no devolvió un offset legible.");
  }

  const sign = offset[1] === "-" ? -1 : 1;

  return {
    secondOfDay:
      Number(parts.hour) * 3600 +
      Number(parts.minute) * 60 +
      Number(parts.second),
    offsetMs: sign * (Number(offset[2]) * 60 + Number(offset[3])) * 60_000,
  };
}

function withinEdgarHours(instantMs: number): boolean {
  const { secondOfDay } = newYorkClock(instantMs);

  return (
    secondOfDay >= EDGAR_OPENS_HOUR * 3600 &&
    secondOfDay <= EDGAR_CLOSES_HOUR * 3600
  );
}

/**
 * La aceptación verdadera de un instante publicado con el offset dos veces.
 *
 * La SEC tomó los dígitos UTC `U` como hora local de Nueva York y los convirtió:
 * `P = U − offset`, con el offset del instante `P`. Invertirlo es restar ese
 * mismo offset (negativo en Nueva York, así que el instante retrocede).
 */
function removeNewYorkOffset(instantMs: number): number {
  return instantMs + newYorkClock(instantMs).offsetMs;
}

/**
 * Margen de la lectura ganadora: los avisos `EFFECT` los genera la propia SEC
 * fuera de horario (dos de mil en el archivo de ExxonMobil).
 */
function tolerance(acceptances: number): number {
  return Math.max(2, Math.ceil(acceptances / 100));
}

/** Instantes ISO ya validados; los inválidos se rechazan antes, por fila. */
export function readSecAcceptanceClock(
  instants: readonly string[],
): SecAcceptanceClockReading {
  let outsideAsPublished = 0;
  let outsideCorrected = 0;
  let datePlaceholders = 0;

  for (const instant of instants) {
    const published = Date.parse(instant);
    const corrected = removeNewYorkOffset(published);

    if (
      newYorkClock(published).secondOfDay === 0 ||
      newYorkClock(corrected).secondOfDay === 0
    ) {
      datePlaceholders += 1;
      continue;
    }

    if (!withinEdgarHours(published)) {
      outsideAsPublished += 1;
    }

    if (!withinEdgarHours(corrected)) {
      outsideCorrected += 1;
    }
  }

  const evidence = instants.length - datePlaceholders;
  const reading = {
    version: SEC_ACCEPTANCE_CLOCK_VERSION,
    acceptances: instants.length,
    datePlaceholders,
    outsideAsPublished,
    outsideCorrected,
  };

  // Sin ninguna aceptación con hora no hay reloj que decidir ni nada que la
  // lectura cambie de orden: un marcador corrido o no sigue siendo un día.
  if (evidence === 0) {
    return { ...reading, clock: "no_acceptances" };
  }

  const fits = (outside: number) => outside <= tolerance(evidence);

  // Corregir exige que lo publicado quede claramente contradicho, no sólo que
  // la corrección encaje: con pocas filas a media tarde encajan las dos.
  if (
    fits(outsideCorrected) &&
    outsideAsPublished >= 2 * outsideCorrected + 5
  ) {
    return { ...reading, clock: "new_york_offset_applied_twice" };
  }

  if (fits(outsideAsPublished)) {
    return { ...reading, clock: "published_utc" };
  }

  return { ...reading, clock: "undetermined" };
}

/** La aceptación en UTC real según la lectura del archivo. */
export function correctSecAcceptance(
  instant: string,
  clock: Exclude<SecAcceptanceClock, "undetermined">,
): string {
  return clock === "new_york_offset_applied_twice"
    ? new Date(removeNewYorkOffset(Date.parse(instant))).toISOString()
    : instant;
}

/**
 * Bandera de la corrida que leyó al menos un archivo corregido. La aceptación
 * publicada es la misma que con un archivo en UTC, así que la corrida es la
 * única que puede decir que hubo que corregirla.
 */
export const ACCEPTANCE_CLOCK_CORRECTED_FLAG = "acceptance_clock_corrected";

export function acceptanceClockFlags(
  readings: readonly (SecAcceptanceClockReading | null)[],
): string[] {
  return readings.some(
    (reading) => reading?.clock === "new_york_offset_applied_twice",
  )
    ? [ACCEPTANCE_CLOCK_CORRECTED_FLAG]
    : [];
}
