import { describe, expect, it } from "vitest";

import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { syntheticTrade } from "@/modules/trading/application/schwab-transaction-store.contract";
import { buildJournal } from "@/modules/trading/domain/journal";

import { projectJournal } from "./journal-projection";

function fill(id: string, quantity: string, net: string, time: string) {
  return syntheticTrade(id, {
    executedAt: time,
    netAmount: net,
    fees: "0.01",
    instrument: {
      instrumentId: "77",
      symbol: "SYN",
      assetType: "EQUITY",
      instrumentType: "COMMON_STOCK",
      description: null,
      quantity,
      price: "10",
      positionEffect: quantity.startsWith("-") ? "CLOSING" : "OPENING",
    },
  });
}

const { trades, summary } = buildJournal("acct-hmac", [
  fill("1", "10", "-100.01", "2026-11-09T15:00:00.000Z"),
  fill("2", "-10", "109.99", "2026-11-09T19:00:00.000Z"),
  fill("3", "5", "-50.01", "2026-11-10T15:00:00.000Z"),
  fill("4", "-5", "44.99", "2026-11-12T15:00:00.000Z"),
]);
const reading = {
  account: { lastFour: "6789" },
  trades,
  summary,
  entries: {},
  lastSyncAt: null,
  historyFrom: null,
  unread: [],
};

describe("projectJournal", () => {
  it("ordena del más reciente y filtra por la sesión de apertura", () => {
    const all = projectJournal(reading, { limit: 100 }, DEMO_SOURCE_REGISTRY);
    const narrowed = projectJournal(
      reading,
      { from: "2026-11-10", to: "2026-11-10", limit: 100 },
      DEMO_SOURCE_REGISTRY,
    );

    expect(
      all.journal.withheld === null &&
        all.journal.trades.map((trade) => trade.openedSession),
    ).toEqual(["2026-11-10", "2026-11-09"]);
    expect(narrowed.journal).toMatchObject({ withheld: null, matching: 1 });
  });

  it("dice cuando el límite dejó trades afuera", () => {
    const limited = projectJournal(reading, { limit: 1 }, DEMO_SOURCE_REGISTRY);

    expect(limited.journal).toMatchObject({
      withheld: null,
      matching: 2,
      truncatedToLimit: true,
    });
    expect(JSON.stringify(limited)).not.toContain("acct-hmac");
  });

  it("sin el derecho de Schwab, el diario sale con su motivo", () => {
    const registry = DEMO_SOURCE_REGISTRY.map((entry) =>
      entry.sourceId === "schwab-trader"
        ? {
            ...entry,
            rights: { ...entry.rights, ownerAssistant: "restricted" as const },
          }
        : entry,
    );

    expect(projectJournal(reading, { limit: 10 }, registry).journal).toEqual({
      withheld: [
        {
          sourceId: "schwab-trader",
          reason: "rights.ownerAssistant:restricted",
        },
      ],
    });
  });
});
