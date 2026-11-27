import type { CaptureOutcome } from "../../../src/modules/real-estate/domain/capture-request";
import type { RealEstatePortal } from "../../../src/modules/real-estate/domain/listing-capture";

import type { SendFailure } from "./queue";

/**
 * Lo que el popup muestra, contado por día de Buenos Aires y portal: páginas
 * leídas, capturas, rechazos por nombre y desafíos vistos. Es la medición que
 * `F13-02` pide («la frecuencia de desafíos observada») y la base de la
 * cobertura de `F13-03`. Se guarda una ventana de 30 días.
 */
export type DayCounters = {
  readonly pages: number;
  readonly captures: number;
  readonly challenges: number;
  readonly rejectedPages: Readonly<Record<string, number>>;
  readonly skipped: Readonly<Record<string, number>>;
};

export type CaptureStatus = {
  readonly days: Readonly<
    Record<string, Readonly<Partial<Record<RealEstatePortal, DayCounters>>>>
  >;
  readonly outcomes: Readonly<Partial<Record<CaptureOutcome, number>>>;
  readonly lastSentAt: string | null;
  readonly lastFailure: {
    readonly failure: SendFailure | "batch_rejected";
    readonly at: string;
  } | null;
};

export const EMPTY_STATUS: CaptureStatus = {
  days: {},
  outcomes: {},
  lastSentAt: null,
  lastFailure: null,
};

const KEPT_DAYS = 30;

/** La fecha de Buenos Aires de un instante, `AAAA-MM-DD`. */
export function buenosAiresDate(instant: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instant));
}

const ZERO: DayCounters = {
  pages: 0,
  captures: 0,
  challenges: 0,
  rejectedPages: {},
  skipped: {},
};

function addCounts(
  base: Readonly<Record<string, number>>,
  extra: Readonly<Record<string, number>>,
): Record<string, number> {
  const out: Record<string, number> = { ...base };
  for (const [key, value] of Object.entries(extra))
    out[key] = (out[key] ?? 0) + value;
  return out;
}

export function countPage(
  status: CaptureStatus,
  source: RealEstatePortal,
  at: string,
  page:
    | {
        readonly kind: "captured";
        readonly captures: number;
        readonly skipped: Readonly<Record<string, number>>;
      }
    | { readonly kind: "rejected"; readonly reason: string }
    | { readonly kind: "challenge" },
): CaptureStatus {
  const day = buenosAiresDate(at);
  const current = status.days[day]?.[source] ?? ZERO;
  const next: DayCounters =
    page.kind === "captured"
      ? {
          ...current,
          pages: current.pages + 1,
          captures: current.captures + page.captures,
          skipped: addCounts(current.skipped, page.skipped),
        }
      : page.kind === "rejected"
        ? {
            ...current,
            pages: current.pages + 1,
            rejectedPages: addCounts(current.rejectedPages, {
              [page.reason]: 1,
            }),
          }
        : {
            ...current,
            pages: current.pages + 1,
            challenges: current.challenges + 1,
          };

  const days = {
    ...status.days,
    [day]: { ...status.days[day], [source]: next },
  };
  const kept = Object.keys(days).sort().slice(-KEPT_DAYS);
  return {
    ...status,
    days: Object.fromEntries(kept.map((key) => [key, days[key]])),
  };
}

export function countOutcomes(
  status: CaptureStatus,
  outcomes: Readonly<Partial<Record<CaptureOutcome, number>>>,
  at: string,
): CaptureStatus {
  return {
    ...status,
    outcomes: addCounts(status.outcomes, outcomes),
    lastSentAt: at,
    lastFailure: null,
  };
}

export function countFailure(
  status: CaptureStatus,
  failure: SendFailure | "batch_rejected",
  at: string,
): CaptureStatus {
  return { ...status, lastFailure: { failure, at } };
}
