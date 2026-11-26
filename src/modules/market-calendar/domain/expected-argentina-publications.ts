import type { FreshnessGroup } from "@/modules/argentina-dashboard/domain/surface-freshness";

import type { EconomicPublication } from "./calendar-publication";

const RELEASE_GROUP: Readonly<Partial<Record<string, FreshnessGroup>>> = {
  ipc: "monetary",
  emae: "activity",
  ica: "trade",
  fiscal: "fiscal",
  rem: "rem",
};

export type ExpectedPublications = Readonly<
  Partial<Record<FreshnessGroup, string>>
>;

/** A scheduled period clears once the corresponding series has reached that month. */
export function expectedArgentinePublications(
  events: readonly EconomicPublication[],
  today: string,
  present: Readonly<Partial<Record<FreshnessGroup, string | null>>>,
): ExpectedPublications {
  const result: Partial<Record<FreshnessGroup, string>> = {};
  for (const { id, title, date, period, status } of events) {
    const group = RELEASE_GROUP[id];
    if (
      group &&
      date === today &&
      period !== null &&
      status === "scheduled" &&
      (present[group]?.slice(0, 7) ?? "") < period.slice(0, 7)
    ) {
      result[group] = title;
    }
  }
  return result;
}
