import postgres, { type Sql } from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { describeFinvizStrategyStoreContract } from "@/modules/finviz-screener/application/finviz-strategy-store.contract";
import { describeSourceBudgetStoreContract } from "@/modules/ingestion/application/source-budget-store.contract";
import { describeSchwabConnectionStoreContract } from "@/modules/trading/application/schwab-connection-store.contract";
import { describeSchwabTransactionStoreContract } from "@/modules/trading/application/schwab-transaction-store.contract";
import { describeTradeAnnotationStoreContract } from "@/modules/trading/application/trade-annotation-store.contract";
import { describeTradingRiskSettingsStoreContract } from "@/modules/trading/application/trading-risk-settings-store.contract";
import { describeTradingRoutineStoreContract } from "@/modules/trading/application/trading-routine-store.contract";
import { createPostgresFinvizStrategyStore } from "@/server/db/trading/postgres-finviz-strategy-store";
import { createPostgresSchwabConnectionStore } from "@/server/db/trading/postgres-schwab-connection-store";
import { createPostgresSchwabTransactionStore } from "@/server/db/trading/postgres-schwab-transaction-store";
import { createPostgresTradingSourceBudgetStore } from "@/server/db/trading/postgres-source-budget-store";
import { createPostgresTradeAnnotationStore } from "@/server/db/trading/postgres-trade-annotation-store";
import { createPostgresTradingRiskSettingsStore } from "@/server/db/trading/postgres-trading-risk-settings-store";
import { createPostgresTradingRoutineStore } from "@/server/db/trading/postgres-trading-routine-store";
import { createPostgresPreMarketStore } from "@/server/db/trading/postgres-pre-market-store";
import type { RoundTrip } from "@/modules/trading/domain/trade-round-trips";
import * as schema from "@/server/db/trading/schema";

/**
 * Los almacenes de la base de trading pasan los mismos contratos que sus dobles
 * en memoria: el presupuesto, el mismo que el de la base de análisis
 * (ADR 0020), la conexión con Schwab, sus transacciones y las anotaciones del
 * diario con su rutina, las reglas propias (ADR 0076) y las estrategias del
 * screener de Finviz (`F11-13`).
 */
const client: Sql = postgres(process.env.TRADING_DATABASE_TEST_URL!.trim(), {
  max: 4,
  prepare: false,
  connect_timeout: 10,
  onnotice: () => {},
});
const database = drizzle(client, { schema });

beforeEach(async () => {
  await client`delete from finviz_screener_strategies`;
  await client`delete from pre_market_trade_links`;
  await client`delete from pre_market_ideas`;
  await client`delete from trading_risk_settings`;
  await client`delete from session_routines`;
  await client`delete from routine_items`;
  await client`delete from trade_annotations`;
  await client`delete from trading_setups`;
  await client`delete from schwab_transactions`;
  await client`delete from schwab_transaction_runs`;
  await client`delete from schwab_transaction_sync`;
  await client`delete from schwab_accounts`;
  await client`delete from schwab_connection_events`;
  await client`delete from schwab_connections`;
  await client`delete from schwab_oauth_states`;
});

afterAll(async () => {
  await client.end();
});

describeSourceBudgetStoreContract("trading postgres", {
  createStore: (budgets) =>
    createPostgresTradingSourceBudgetStore(database, budgets),
});

describeSchwabConnectionStoreContract("trading postgres", () =>
  createPostgresSchwabConnectionStore(database),
);

describeSchwabTransactionStoreContract("trading postgres", () =>
  createPostgresSchwabTransactionStore(database),
);

describeTradeAnnotationStoreContract("trading postgres", () => {
  const transactions = createPostgresSchwabTransactionStore(database);
  return {
    store: createPostgresTradeAnnotationStore(database),
    recordAccount: (accountKey) =>
      transactions.recordAccount(
        { accountKey, lastFour: "5678" },
        "2026-11-14T15:00:00.000Z",
      ),
  };
});

describeTradingRoutineStoreContract("trading postgres", () =>
  createPostgresTradingRoutineStore(database),
);

describeTradingRiskSettingsStoreContract("trading postgres", () =>
  createPostgresTradingRiskSettingsStore(database),
);

describeFinvizStrategyStoreContract("trading postgres", () =>
  createPostgresFinvizStrategyStore(database),
);

const accountKey = "a".repeat(64);
const fields = {
  symbol: "AAPL",
  setupCode: "breakout",
  entry: "100",
  quantity: "50",
  manualStop: null,
  manualTarget: null,
  stopMode: "automatic" as const,
  targetMode: "one_to_two" as const,
  notes: "Ruptura del rango",
  status: "active" as const,
};
const trade = (fillId: string, openedAt = "2026-11-16T15:00:00.000Z") =>
  ({
    tradeId: `${accountKey}:schwab:123:${fillId}`,
    accountKey,
    symbol: "AAPL",
    openedAt,
    openedSession: "2026-11-16",
    status: "open",
    direction: "long",
    currency: "USD",
    assetType: "EQUITY",
  }) as RoundTrip;

describe("pre-market plans, trading postgres", () => {
  it("guarda revisiones y conserva la anterior al corregir el stop", async () => {
    await createPostgresSchwabTransactionStore(database).recordAccount(
      { accountKey, lastFour: "5678" },
      "2026-11-16T10:00:00.000Z",
    );
    const store = createPostgresPreMarketStore(database);
    const ideaId = "11111111-1111-4111-8111-111111111111";
    const first = await store.save({
      accountKey,
      ideaId,
      baseRevision: null,
      fields,
      liquidationValue: "10000",
      riskPercent: "2",
      recordedAt: "2026-11-16T13:00:00.000Z",
    });
    expect(first.state).toBe("saved");
    expect(
      (
        await store.save({
          accountKey,
          ideaId,
          baseRevision: 1,
          fields: { ...fields },
          liquidationValue: "10000",
          riskPercent: "2",
          recordedAt: "2026-11-16T13:30:00.000Z",
        })
      ).state,
    ).toBe("unchanged");
    const second = await store.save({
      accountKey,
      ideaId,
      baseRevision: 1,
      fields: { ...fields, stopMode: "manual", manualStop: "95" },
      liquidationValue: "10000",
      riskPercent: "2",
      recordedAt: "2026-11-16T14:00:00.000Z",
    });
    expect(second.state).toBe("saved");
    expect(
      await store.save({
        accountKey,
        ideaId,
        baseRevision: 1,
        fields,
        liquidationValue: "10000",
        riskPercent: "2",
        recordedAt: "2026-11-16T14:30:00.000Z",
      }),
    ).toEqual({ state: "conflict" });
    const revisions = await store.listRevisions(accountKey, ideaId);
    expect(
      revisions.map((revision) => [revision.revision, revision.manualStop]),
    ).toEqual([
      [2, "95"],
      [1, null],
    ]);
    expect(
      (await store.listCurrent(accountKey)).map((idea) => idea.revision),
    ).toEqual([2]);
  });

  it("une sólo una idea inequívoca anterior al trade y congela su revisión", async () => {
    await createPostgresSchwabTransactionStore(database).recordAccount(
      { accountKey, lastFour: "5678" },
      "2026-11-16T10:00:00.000Z",
    );
    const store = createPostgresPreMarketStore(database);
    const ideaId = "22222222-2222-4222-8222-222222222222";
    await store.save({
      accountKey,
      ideaId,
      baseRevision: null,
      fields,
      liquidationValue: "10000",
      riskPercent: "2",
      recordedAt: "2026-11-16T13:00:00.000Z",
    });
    expect(
      await store.reconcile(
        accountKey,
        [trade("321")],
        "2026-11-16T16:00:00.000Z",
      ),
    ).toBe(1);
    const before = await store.readLink(accountKey, "schwab:123:321");
    expect(before?.idea.revision).toBe(1);
    expect(before?.idea.recordedAt).toBe("2026-11-16T13:00:00.000Z");
    await store.save({
      accountKey,
      ideaId,
      baseRevision: 1,
      fields: { ...fields, entry: "101" },
      liquidationValue: "10000",
      riskPercent: "2",
      recordedAt: "2026-11-16T17:00:00.000Z",
    });
    expect(
      (await store.readLink(accountKey, "schwab:123:321"))?.idea.entry,
    ).toBe("100");
    expect(
      await store.link(
        accountKey,
        ideaId,
        trade("322"),
        "2026-11-16T18:00:00.000Z",
      ),
    ).toBe("conflict");
  });

  it("no atribuye automáticamente dos ideas del mismo ticker ni una posterior", async () => {
    await createPostgresSchwabTransactionStore(database).recordAccount(
      { accountKey, lastFour: "5678" },
      "2026-11-16T10:00:00.000Z",
    );
    const store = createPostgresPreMarketStore(database);
    for (const ideaId of [
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444",
    ])
      await store.save({
        accountKey,
        ideaId,
        baseRevision: null,
        fields,
        liquidationValue: "10000",
        riskPercent: "2",
        recordedAt: "2026-11-16T13:00:00.000Z",
      });
    expect(
      await store.reconcile(
        accountKey,
        [trade("321")],
        "2026-11-16T16:00:00.000Z",
      ),
    ).toBe(0);
    expect(
      await store.link(
        accountKey,
        "33333333-3333-4333-8333-333333333333",
        trade("321", "2026-11-16T12:00:00.000Z"),
        "2026-11-16T16:00:00.000Z",
      ),
    ).toBe("ineligible");
    expect(
      await store.link(
        accountKey,
        "33333333-3333-4333-8333-333333333333",
        { ...trade("322"), currency: "EUR" },
        "2026-11-16T16:00:00.000Z",
      ),
    ).toBe("ineligible");
    expect(await store.readLink(accountKey, "schwab:123:321")).toBeNull();
  });
});
