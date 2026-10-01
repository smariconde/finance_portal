import { subtractDays } from "@/modules/temporal/domain/calendar-date";

/**
 * ¿Hay que descargar algo para ver la matriz de hoy? (`sector-price-freshness-1.0.0`,
 * [ADR 0030](../../../../docs/architecture/adr/0030-sector-prices-on-open.md)).
 *
 * La regla tiene que decidir sin calendario de feriados y sin bucles:
 *
 * - **La referencia** está al día si tiene el cierre de la última rueda hábil
 *   asentada —lunes a viernes, pasadas las 22:00 UTC— **o** si un job ya la
 *   revisó después de ese instante. Lo segundo es lo que resuelve un feriado: la
 *   fuente no tiene rueda que dar, la revisión queda registrada y no se vuelve a
 *   pedir hasta la próxima.
 * - **Una security** está al día si tiene el cierre de la **última rueda de la
 *   referencia**. El índice opera todas las ruedas que existieron, así que su
 *   última fecha es la rueda que corresponde pedir, sin adivinar feriados. Una
 *   security revisada después de que esa rueda se asentó también está al día: una
 *   suspendida no tiene el cierre y pedirlo de nuevo no lo crea.
 *
 * Las 22:00 UTC son conservadoras: la sesión regular termina a las 21:00 UTC en
 * horario estándar del Este y a las 20:00 en el de verano, y `settled-session`
 * espera una hora más. Antes de ese instante la rueda del día todavía no cuenta.
 */
export const PRICE_FRESHNESS_RULE_VERSION = "sector-price-freshness-1.0.0";
export const SESSION_SETTLED_UTC_HOUR = 22;

/** Instante desde el que la rueda `marketDate` se considera asentada. */
export function sessionSettledAt(marketDate: string): string {
  return `${marketDate}T${String(SESSION_SETTLED_UTC_HOUR).padStart(2, "0")}:00:00.000Z`;
}

function isWeekend(marketDate: string): boolean {
  const day = new Date(`${marketDate}T00:00:00.000Z`).getUTCDay();

  return day === 0 || day === 6;
}

/**
 * Última rueda hábil asentada al instante `now`. Puede ser un feriado: la regla
 * de la referencia lo absorbe con la revisión registrada.
 */
export function latestSettledWeekday(now: string): string {
  let candidate = now.slice(0, 10);

  if (Date.parse(now) < Date.parse(sessionSettledAt(candidate))) {
    candidate = subtractDays(candidate, 1);
  }

  while (isWeekend(candidate)) {
    candidate = subtractDays(candidate, 1);
  }

  return candidate;
}

export type ReferenceFreshness =
  | { readonly status: "fresh"; readonly latestClose: string }
  | {
      readonly status: "stale";
      /** `null`: no hay ningún nivel guardado. */
      readonly latestClose: string | null;
      readonly expectedSession: string;
    };

export function assessReferenceFreshness(input: {
  readonly latestClose: string | null;
  /** Instante de la revisión más reciente de la referencia por un job; `null` si ninguna. */
  readonly lastCheckedAt: string | null;
  readonly now: string;
}): ReferenceFreshness {
  const expectedSession = latestSettledWeekday(input.now);
  const { latestClose, lastCheckedAt } = input;

  if (latestClose !== null && latestClose >= expectedSession) {
    return { status: "fresh", latestClose };
  }

  if (
    latestClose !== null &&
    lastCheckedAt !== null &&
    Date.parse(lastCheckedAt) >= Date.parse(sessionSettledAt(expectedSession))
  ) {
    return { status: "fresh", latestClose };
  }

  return { status: "stale", latestClose, expectedSession };
}

/**
 * Securities del sector a las que les falta la rueda de la referencia.
 *
 * `withTargetClose` son las que ya tienen un cierre en o después de esa rueda;
 * `checkedSinceSettled`, las que un job revisó después de que se asentó. Las dos
 * cuentan como al día. El orden de salida es el de `members`.
 */
export function selectStaleSecurities<
  TMember extends { securityId: string },
>(input: {
  readonly members: readonly TMember[];
  readonly withTargetClose: ReadonlySet<string>;
  readonly checkedSinceSettled: ReadonlySet<string>;
}): TMember[] {
  return input.members.filter(
    (member) =>
      !input.withTargetClose.has(member.securityId) &&
      !input.checkedSinceSettled.has(member.securityId),
  );
}
