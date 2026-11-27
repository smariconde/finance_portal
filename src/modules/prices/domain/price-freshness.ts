import {
  NYSE_CALENDAR,
  type MarketCalendarDeclaration,
} from "@/modules/market-calendar/domain/declared-market-sessions";
import {
  isTradingDay,
  marketDayOf,
} from "@/modules/market-calendar/domain/market-sessions";
import {
  addCalendarDays,
  calendarDateIn,
  NEW_YORK,
} from "@/modules/market-calendar/domain/zoned-time";
import { subtractDays } from "@/modules/temporal/domain/calendar-date";

import { SETTLEMENT_DELAY_MINUTES } from "./settled-session";

/**
 * ¿Hay que descargar algo para ver la matriz de hoy? (`sector-price-freshness-2.0.0`,
 * [ADR 0030](../../../../docs/architecture/adr/0030-sector-prices-on-open.md),
 * [ADR 0088](../../../../docs/architecture/adr/0088-market-calendar-agenda.md)
 * decisión 8).
 *
 * - **La referencia** está al día si tiene el cierre de la última sesión de
 *   Nueva York asentada **o** si un job ya la revisó después de que se asentó.
 *   Desde `2.0.0` la sesión sale de `market-sessions-1.0.0`: un feriado de la
 *   NYSE no es una sesión, así que deja de pedir precios, y una sesión se
 *   asienta `SETTLEMENT_DELAY_MINUTES` después de **su** cierre regular —las
 *   13:00 de un cierre temprano, no las 16:00—, la misma espera que
 *   `settled-session-1.0.0` exige para guardar la barra.
 * - **Una security** está al día si tiene el cierre de la **última rueda de la
 *   referencia** o si un job la revisó después de que esa rueda se asentó (una
 *   acción suspendida). Si aún falta el cierre, la matriz lo informa y permite
 *   reintentarla a pedido.
 * - **Fuera de lo declarado** (`undeclared`) no se supone un calendario: rige
 *   la regla de `1.1.0`, cada día hábil asentado a las 22:00 UTC, con la
 *   revisión registrada absorbiendo el feriado. Lo nombra `basis`.
 *
 * `latestSettledWeekday` y `sessionSettledAt` quedan como estaban: los usan la
 * curva del BCE, que no opera con la NYSE, y el consenso fechado al asentarse
 * su rueda, cuyas lecturas no cambian.
 */
export const PRICE_FRESHNESS_RULE_VERSION = "sector-price-freshness-2.0.0";

/** Las versiones con las que un job de precios abierto puede haberse planeado. */
export const PRICE_FRESHNESS_RULE_VERSIONS = [
  "sector-price-freshness-1.1.0",
  PRICE_FRESHNESS_RULE_VERSION,
] as const;

export const SESSION_SETTLED_UTC_HOUR = 22;

/** Instante desde el que la rueda `marketDate` se considera asentada (`1.1.0`). */
export function sessionSettledAt(marketDate: string): string {
  return `${marketDate}T${String(SESSION_SETTLED_UTC_HOUR).padStart(2, "0")}:00:00.000Z`;
}

function isWeekend(marketDate: string): boolean {
  const day = new Date(`${marketDate}T00:00:00.000Z`).getUTCDay();

  return day === 0 || day === 6;
}

/**
 * Última rueda hábil asentada al instante `now` (`1.1.0`). Puede ser un
 * feriado: la regla de la referencia lo absorbía con la revisión registrada.
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

export type SettledSessionBasis =
  /** La sesión y su cierre salen del calendario declarado de la NYSE. */
  | "declared_calendar"
  /** Fecha fuera de lo declarado: día hábil a las 22:00 UTC, como `1.1.0`. */
  | "undeclared_weekday";

export type SettledSession = {
  readonly session: string;
  readonly settledAt: string;
  readonly basis: SettledSessionBasis;
};

/** Ninguna búsqueda hacia atrás necesita más: el hueco más largo es un fin de semana largo. */
const MAX_LOOKBACK_DAYS = 14;

/**
 * Instante desde el que la sesión `marketDate` cuenta como asentada
 * (`2.0.0`): su cierre regular declarado más la espera de `settled-session`.
 * Una fecha que no opera o que no está declarada cae en la regla `1.1.0`.
 */
export function sessionSettledInstant(
  marketDate: string,
  calendar: MarketCalendarDeclaration = NYSE_CALENDAR,
): string {
  const day = marketDayOf(marketDate, calendar);

  if (day.regular === null) return sessionSettledAt(marketDate);

  return new Date(
    Date.parse(day.regular.close.instant) + SETTLEMENT_DELAY_MINUTES * 60_000,
  ).toISOString();
}

/** La última sesión de Nueva York asentada al instante `now` (`2.0.0`). */
export function latestSettledSession(
  now: string,
  calendar: MarketCalendarDeclaration = NYSE_CALENDAR,
): SettledSession {
  const nowMs = Date.parse(now);
  let candidate = calendarDateIn(new Date(nowMs).toISOString(), NEW_YORK);

  for (let step = 0; step <= MAX_LOOKBACK_DAYS; step += 1) {
    const day = marketDayOf(candidate, calendar);

    if (day.status === "undeclared") {
      const settledAt = sessionSettledAt(candidate);
      if (!isWeekend(candidate) && nowMs >= Date.parse(settledAt)) {
        return { session: candidate, settledAt, basis: "undeclared_weekday" };
      }
    } else if (isTradingDay(day)) {
      const settledAt = sessionSettledInstant(candidate, calendar);
      if (nowMs >= Date.parse(settledAt)) {
        return { session: candidate, settledAt, basis: "declared_calendar" };
      }
    }

    candidate = addCalendarDays(candidate, -1);
  }

  throw new Error(
    `No settled New York session found within ${MAX_LOOKBACK_DAYS} days of ${now}.`,
  );
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
  const expected = latestSettledSession(input.now);
  const expectedSession = expected.session;
  const { latestClose, lastCheckedAt } = input;

  if (latestClose !== null && latestClose >= expectedSession) {
    return { status: "fresh", latestClose };
  }

  if (
    latestClose !== null &&
    lastCheckedAt !== null &&
    Date.parse(lastCheckedAt) >= Date.parse(expected.settledAt)
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
