import { readFileSync } from "node:fs";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_RISK_SETTINGS } from "@/modules/trading/domain/trading-rules";
import { createPostgresPreMarketStore } from "@/server/db/trading/postgres-pre-market-store";
import { createPostgresSchwabTransactionStore } from "@/server/db/trading/postgres-schwab-transaction-store";
import { createPostgresTradeAnnotationStore } from "@/server/db/trading/postgres-trade-annotation-store";
import { createPostgresTradingRiskSettingsStore } from "@/server/db/trading/postgres-trading-risk-settings-store";
import * as schema from "@/server/db/trading/schema";
import { readRiskContext, type RiskStores } from "@/server/trading/risk";
import { loadJournalState } from "@/server/trading/transactions";

/**
 * Una base de trading atrasada (`F11-15`): sin las tablas de `0005` (reglas) y
 * `0006` (plan antes de la rueda), el riesgo y el diario se leen con las
 * reglas por defecto y sin planes, y nombran lo que no leyeron. Una conexión
 * caída sigue fallando. Las dos migraciones se bajan con sus rollbacks y se
 * vuelven a aplicar con su SQL, como el ciclo de `0000` en `runtime-role`.
 */
const LAGGING = [
  // `0008` agrega columnas a las dos tablas: se baja primero y vuelve última.
  "0008_trading_books",
  "0006_pre_market_ideas",
  "0005_trading_risk_settings",
] as const;

const ACCOUNT = { accountKey: "f".repeat(64), lastFour: "5974" };
const NOW = "2026-11-16T15:00:00.000Z";

let client: Sql;

function storesOver(sql: Sql): RiskStores {
  const database = drizzle(sql, { schema });
  return {
    settings: createPostgresTradingRiskSettingsStore(database),
    journal: {
      transactions: createPostgresSchwabTransactionStore(database),
      annotations: createPostgresTradeAnnotationStore(database),
      preMarket: createPostgresPreMarketStore(database),
    },
  };
}

async function runSql(file: string): Promise<void> {
  for (const statement of readFileSync(file, "utf8").split(
    "--> statement-breakpoint",
  )) {
    if (statement.trim() !== "") await client.unsafe(statement).simple();
  }
}

beforeAll(async () => {
  client = postgres(process.env.TRADING_DATABASE_TEST_URL!.trim(), {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    onnotice: () => {},
  });
  await client`delete from pre_market_trade_links`;
  await client`delete from pre_market_ideas`;
  await client`delete from trading_risk_settings`;
  await client`delete from trade_annotations`;
  await client`delete from schwab_transactions`;
  await client`delete from schwab_transaction_runs`;
  await client`delete from schwab_transaction_sync`;
  await client`delete from schwab_accounts`;
  await createPostgresSchwabTransactionStore(
    drizzle(client, { schema }),
  ).recordAccount(ACCOUNT, NOW);
});

afterAll(async () => {
  await client`delete from schwab_accounts`;
  await client.end();
});

describe("a trading base that lags its migrations", () => {
  it("reads the risk and the journal without the missing parts, naming them", async () => {
    try {
      for (const tag of LAGGING) {
        await runSql(`drizzle-trading/rollback/${tag}.down.sql`);
      }

      const context = await readRiskContext(NOW, storesOver(client));
      expect(context.settings).toEqual(DEFAULT_RISK_SETTINGS);
      expect(context.settingsRevision).toBeNull();
      expect(context.plans).toEqual([]);
      expect(context.unread).toEqual(["risk_settings", "pre_market"]);

      const journal = await loadJournalState(storesOver(client).journal);
      expect(journal.account?.lastFour).toBe("5974");
      expect(journal.linkedPlans.size).toBe(0);
      expect(journal.unread).toEqual(["pre_market"]);
    } finally {
      for (const tag of LAGGING.toReversed()) {
        await runSql(`drizzle-trading/${tag}.sql`);
      }
    }

    const migrated = await readRiskContext(NOW, storesOver(client));
    expect(migrated.unread).toEqual([]);
  });

  it("keeps failing when the base does not answer", async () => {
    const closed = postgres("postgres://nobody@127.0.0.1:1/none", {
      max: 1,
      connect_timeout: 2,
    });
    try {
      await expect(readRiskContext(NOW, storesOver(closed))).rejects.toThrow();
    } finally {
      await closed.end();
    }
  });
});
