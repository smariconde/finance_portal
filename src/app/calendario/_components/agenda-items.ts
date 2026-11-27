import { addCalendarDays } from "@/modules/market-calendar/domain/zoned-time";

import type { EconomicAgendaRow } from "@/server/persistence/read-economic-calendar";

/**
 * La agenda de `/calendario` en una sola lista: publicaciones de Estados
 * Unidos y de la Argentina. Cada ítem dice su región, que la página marca con
 * color **y** con texto. Los earnings van aparte, por semana
 * (`earnings-week.ts`).
 */
export type AgendaRegion = "us" | "ar";

export type AgendaItem = {
  readonly id: string;
  readonly date: string;
  readonly region: AgendaRegion;
  readonly title: string;
  /** Rótulo corto para la celda del mes. */
  readonly short: string;
  readonly time: string | null;
  readonly source: string;
  readonly sourceUrl: string | null;
  readonly observedOn: string | null;
  readonly previousDate: string | null;
  readonly cancelled: boolean;
  readonly important: boolean;
};

export type AgendaFilter = {
  readonly region: "all" | AgendaRegion;
  readonly onlyImportant: boolean;
};

/** Rótulos cortos de las publicaciones declaradas; el resto usa su título. */
const SHORT_TITLES: Readonly<Record<string, string>> = {
  // FRED, por `release_id`.
  "10": "IPC",
  "50": "Empleo",
  "46": "PPI",
  "53": "PIB",
  "54": "PCE",
  "9": "Ventas minoristas",
  "192": "JOLTS",
  "180": "Pedidos de desempleo",
  fomc: "FOMC",
  // INDEC, Hacienda y BCRA.
  ipc: "IPC",
  emae: "EMAE",
  ica: "Comercio exterior",
  fiscal: "Resultado fiscal",
  rem: "REM",
};

function timeOf(row: EconomicAgendaRow): string | null {
  if (row.time === null) return null;
  return row.usualTime ? `${row.time} habitual` : row.time;
}

function publicationItem(
  row: EconomicAgendaRow,
  region: "us" | "ar",
): AgendaItem {
  return {
    id: row.key,
    date: row.date,
    region,
    title: row.title,
    short: SHORT_TITLES[row.id] ?? row.title,
    time: timeOf(row),
    source: row.source,
    sourceUrl: row.sourceUrl,
    observedOn: row.observedOn,
    previousDate:
      row.previousDate !== null && row.previousDate !== row.date
        ? row.previousDate
        : null,
    cancelled: row.status === "cancelled",
    important: row.important,
  };
}

export function agendaItems(input: {
  readonly unitedStates: readonly EconomicAgendaRow[];
  readonly argentina: readonly EconomicAgendaRow[];
}): readonly AgendaItem[] {
  return [
    ...input.unitedStates.map((row) => publicationItem(row, "us")),
    ...input.argentina.map((row) => publicationItem(row, "ar")),
  ].sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      Number(right.important) - Number(left.important) ||
      left.title.localeCompare(right.title, "es"),
  );
}

export function filterAgenda(
  items: readonly AgendaItem[],
  filter: AgendaFilter,
): readonly AgendaItem[] {
  return items.filter(
    (item) =>
      (filter.region === "all" || item.region === filter.region) &&
      (!filter.onlyImportant || item.important),
  );
}

/** Los ítems agrupados por fecha. */
export function itemsByDate(
  items: readonly AgendaItem[],
): ReadonlyMap<string, readonly AgendaItem[]> {
  const byDate = new Map<string, AgendaItem[]>();
  for (const item of items) {
    const list = byDate.get(item.date);
    if (list === undefined) byDate.set(item.date, [item]);
    else list.push(item);
  }
  return byDate;
}

/** Las fechas de `from` en adelante, `days` días incluidos. */
export function datesFrom(from: string, days: number): readonly string[] {
  return Array.from({ length: days }, (_, offset) =>
    addCalendarDays(from, offset),
  );
}
