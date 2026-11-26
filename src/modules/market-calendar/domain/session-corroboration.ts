import type { MarketDay } from "./market-sessions";
import { BUENOS_AIRES, wallTimeIn } from "./zoned-time";

/**
 * Lo declarado contra lo que dice el broker para un día (`F12-01`, ADR 0088
 * decisión 2, `session-corroboration-1.0.0`). Coincide cuando los dos dicen que
 * no opera, o cuando la sesión regular abre y cierra en el mismo instante. Si no
 * coinciden, para ese día vale el broker —es donde se opera— y la diferencia se
 * nombra. El horario extendido sólo lo sabe el broker y se informa tal cual.
 */
export const SESSION_CORROBORATION_VERSION = "session-corroboration-1.0.0";

export type BrokerSession = {
  readonly start: string;
  readonly end: string;
};

export type BrokerMarketDay = {
  readonly date: string;
  readonly regularMarket: BrokerSession | null;
  readonly preMarket: BrokerSession | null;
  readonly postMarket: BrokerSession | null;
};

export type SessionDifference =
  /** Lo declarado dice que opera y el broker que no, o al revés. */
  | "open_status"
  | "regular_open"
  | "regular_close"
  /** La fecha está fuera de lo declarado: sólo hay lo del broker. */
  | "undeclared";

export type BrokerHoursBa = {
  readonly regular: { readonly open: string; readonly close: string } | null;
  /** Desde el comienzo del pre-market hasta el final del after-hours. */
  readonly extended: { readonly open: string; readonly close: string } | null;
};

export type SessionCorroboration = {
  readonly date: string;
  readonly matches: boolean;
  readonly differences: readonly SessionDifference[];
  /** Lo que dice el broker, en hora de Buenos Aires. */
  readonly broker: BrokerHoursBa;
};

function ba(instant: string): string {
  return wallTimeIn(instant, BUENOS_AIRES);
}

function brokerHours(day: BrokerMarketDay): BrokerHoursBa {
  const regular = day.regularMarket;
  const first = day.preMarket ?? regular;
  const last = day.postMarket ?? regular;
  return {
    regular:
      regular === null
        ? null
        : { open: ba(regular.start), close: ba(regular.end) },
    extended:
      first === null || last === null || (first === regular && last === regular)
        ? null
        : { open: ba(first.start), close: ba(last.end) },
  };
}

export function corroborateSession(
  declared: MarketDay,
  broker: BrokerMarketDay,
): SessionCorroboration {
  if (declared.date !== broker.date) {
    throw new RangeError("A corroboration compares one date.");
  }

  const differences: SessionDifference[] = [];
  if (declared.status === "undeclared") {
    differences.push("undeclared");
  } else {
    const declaredOpen = declared.regular !== null;
    const brokerOpen = broker.regularMarket !== null;
    if (declaredOpen !== brokerOpen) {
      differences.push("open_status");
    } else if (declared.regular !== null && broker.regularMarket !== null) {
      if (
        Date.parse(declared.regular.open.instant) !==
        Date.parse(broker.regularMarket.start)
      ) {
        differences.push("regular_open");
      }
      if (
        Date.parse(declared.regular.close.instant) !==
        Date.parse(broker.regularMarket.end)
      ) {
        differences.push("regular_close");
      }
    }
  }

  return {
    date: declared.date,
    matches: differences.length === 0,
    differences,
    broker: brokerHours(broker),
  };
}
