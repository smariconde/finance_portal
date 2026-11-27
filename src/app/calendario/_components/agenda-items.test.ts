import { describe, expect, it } from "vitest";

import type { EconomicAgendaRow } from "@/server/persistence/read-economic-calendar";

import {
  agendaItems,
  datesFrom,
  filterAgenda,
  itemsByDate,
} from "./agenda-items";

function row(overrides: Partial<EconomicAgendaRow>): EconomicAgendaRow {
  return {
    id: "10",
    title: "IPC de Estados Unidos",
    date: "2026-12-10",
    period: null,
    status: "scheduled",
    key: "fred:10:2026-12-10",
    source: "FRED · BLS",
    sourceUrl: "https://fred.stlouisfed.org/release?rid=10",
    observedOn: "2026-11-26",
    time: "10:30",
    usualTime: true,
    previousDate: null,
    important: true,
    ...overrides,
  };
}

const items = agendaItems({
  unitedStates: [
    row({}),
    row({
      id: "46",
      key: "fred:46",
      title: "Precios al productor",
      important: false,
      date: "2026-12-11",
      previousDate: "2026-12-11",
    }),
  ],
  argentina: [
    row({
      id: "ipc",
      key: "indec:ipc",
      title: "IPC nacional",
      source: "INDEC",
      date: "2026-12-10",
      time: "16:00",
    }),
    row({
      id: "informe-monetario-mensual",
      key: "bcra:imm",
      title: "Informe Monetario Mensual",
      source: "BCRA",
      time: null,
      usualTime: false,
      important: false,
      status: "cancelled",
      previousDate: "2026-12-03",
      date: "2026-12-04",
    }),
  ],
  earnings: {
    observedAt: "2026-11-26T12:00:00Z",
    reports: [
      {
        symbol: "AAPL",
        date: "2026-12-10",
        fiscalDateEnding: "2026-12-31",
        estimate: null,
        currency: "USD",
        time: "post-market",
        previousDate: null,
      },
      {
        symbol: "ZZZ",
        date: "2026-12-10",
        fiscalDateEnding: null,
        estimate: null,
        currency: "USD",
        time: null,
        previousDate: null,
      },
    ] as never,
  },
  followed: ["AAPL"],
});

describe("agendaItems", () => {
  it("marca la región, el rótulo corto y la hora habitual", () => {
    const cpi = items.find((item) => item.id === "fred:10:2026-12-10")!;
    expect(cpi).toMatchObject({
      region: "us",
      short: "IPC",
      time: "10:30 habitual",
    });
    expect(items.find((item) => item.id === "indec:ipc")).toMatchObject({
      region: "ar",
      short: "IPC",
    });
  });

  it("usa el título cuando no hay rótulo declarado y nombra la cancelación", () => {
    expect(items.find((item) => item.id === "bcra:imm")).toMatchObject({
      short: "Informe Monetario Mensual",
      cancelled: true,
      previousDate: "2026-12-03",
      time: null,
    });
  });

  it("no muestra una fecha anterior igual a la actual", () => {
    expect(items.find((item) => item.id === "fred:46")!.previousDate).toBe(
      null,
    );
  });

  it("los resultados de una empresa seguida cuentan como importantes", () => {
    expect(items.find((item) => item.short === "AAPL")).toMatchObject({
      region: "earnings",
      time: "post-cierre",
      followed: true,
      important: true,
    });
    expect(items.find((item) => item.short === "ZZZ")).toMatchObject({
      time: "hora s/i",
      followed: false,
      important: false,
    });
  });

  it("ordena por fecha y pone primero lo importante", () => {
    const tenth = items.filter((item) => item.date === "2026-12-10");
    expect(tenth.at(-1)!.short).toBe("ZZZ");
    expect(items[0]!.date).toBe("2026-12-04");
  });
});

describe("filterAgenda", () => {
  it("filtra por región, importancia y empresas seguidas", () => {
    expect(
      filterAgenda(items, {
        region: "ar",
        onlyImportant: false,
        onlyFollowed: true,
      }).map((item) => item.id),
    ).toEqual(["bcra:imm", "indec:ipc"]);
    expect(
      filterAgenda(items, {
        region: "all",
        onlyImportant: true,
        onlyFollowed: false,
      }).map((item) => item.short),
    ).toEqual(["AAPL", "IPC", "IPC"]);
    expect(
      filterAgenda(items, {
        region: "earnings",
        onlyImportant: false,
        onlyFollowed: true,
      }).map((item) => item.short),
    ).toEqual(["AAPL"]);
  });
});

describe("itemsByDate y datesFrom", () => {
  it("agrupa por fecha y cuenta días corridos", () => {
    expect(itemsByDate(items).get("2026-12-10")).toHaveLength(4);
    expect(datesFrom("2026-12-30", 3)).toEqual([
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
    ]);
  });
});
