import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { SchwabTransaction } from "@/modules/trading/domain/schwab-transactions";

import type {
  SchwabTransactionStore,
  TransactionRun,
} from "./schwab-transaction-store";

/**
 * Contrato del almacén de transacciones de Schwab, contra el doble en memoria
 * (unitario) y contra PostgreSQL (integración de trading).
 */
const ACCOUNT = "a".repeat(64);
const T0 = "2026-11-14T15:00:00.000Z";
const T1 = "2026-11-14T15:01:00.000Z";

export function syntheticTrade(
  activityId: string,
  overrides: Partial<SchwabTransaction> = {},
): SchwabTransaction {
  return {
    activityId,
    type: "TRADE",
    status: "VALID",
    executedAt: "2026-11-10T15:00:00.000Z",
    settledAt: null,
    description: null,
    orderId: "1001",
    positionId: "2001",
    netAmount: "-1000.65",
    fees: "0.65",
    instrument: {
      instrumentId: "3001",
      symbol: "SYN",
      assetType: "EQUITY",
      instrumentType: "COMMON_STOCK",
      description: null,
      quantity: "100",
      price: "10",
      positionEffect: "OPENING",
    },
    ...overrides,
  };
}

function run(overrides: Partial<TransactionRun> = {}): TransactionRun {
  return {
    runId: randomUUID(),
    accountKey: ACCOUNT,
    startedAt: T0,
    finishedAt: T1,
    windowFrom: "2025-11-14T15:00:00.000Z",
    windowTo: T0,
    requests: 2,
    status: "succeeded",
    code: null,
    inserted: 1,
    revised: 0,
    withdrawn: 0,
    unchanged: 0,
    parserVersion: "schwab-transactions-1.0.0",
    ...overrides,
  };
}

export function describeSchwabTransactionStoreContract(
  label: string,
  createStore: () => SchwabTransactionStore,
): void {
  describe(`schwab transaction store contract (${label})`, () => {
    async function ready() {
      const store = createStore();
      await store.recordAccount({ accountKey: ACCOUNT, lastFour: "5678" }, T0);
      return store;
    }

    it("claims a sync once until the claim expires", async () => {
      const store = await ready();
      const first = await store.claimSync(ACCOUNT, T0, T1);
      expect(first).toMatchObject({ historyFrom: null, claimedUntil: T1 });
      expect(await store.claimSync(ACCOUNT, T0, T1)).toBeNull();
      expect(
        await store.claimSync(ACCOUNT, T1, "2026-11-14T15:02:00.000Z"),
      ).not.toBeNull();
    });

    it("applies revisions append-only and advances the sync", async () => {
      const store = await ready();
      await store.claimSync(ACCOUNT, T0, T1);
      expect(
        await store.applyRun({
          run: run(),
          claimedUntil: T1,
          revisions: [
            {
              transaction: syntheticTrade("1"),
              revision: 1,
              state: "recorded",
              contentHash: "1".repeat(64),
            },
          ],
          historyFrom: "2023-11-14T15:00:00.000Z",
          checkedThrough: T0,
        }),
      ).toBe(true);

      await store.claimSync(ACCOUNT, T1, "2026-11-14T15:03:00.000Z");
      await store.applyRun({
        run: run({
          finishedAt: "2026-11-14T15:02:00.000Z",
          inserted: 0,
          withdrawn: 1,
        }),
        claimedUntil: "2026-11-14T15:03:00.000Z",
        revisions: [
          {
            transaction: syntheticTrade("1"),
            revision: 2,
            state: "withdrawn",
            contentHash: "1".repeat(64),
          },
        ],
        historyFrom: "2023-11-14T15:00:00.000Z",
        checkedThrough: T1,
      });

      const current = await store.listCurrent(ACCOUNT);
      expect(current).toHaveLength(1);
      expect(current[0]).toMatchObject({
        activityId: "1",
        revision: 2,
        state: "withdrawn",
        netAmount: "-1000.65",
        instrument: { symbol: "SYN", quantity: "100" },
      });
      expect(await store.readSync(ACCOUNT)).toMatchObject({
        checkedThrough: T1,
        claimedUntil: null,
      });
      expect(
        (await store.listRuns(ACCOUNT, 10)).map((r) => r.withdrawn),
      ).toEqual([1, 0]);
    });

    it("keeps exact decimals and a cash movement without instrument", async () => {
      const store = await ready();
      await store.claimSync(ACCOUNT, T0, T1);
      await store.applyRun({
        run: run(),
        claimedUntil: T1,
        revisions: [
          {
            transaction: syntheticTrade("9", {
              type: "DIVIDEND_OR_INTEREST",
              netAmount: "12345678901234.56",
              fees: null,
              instrument: null,
              orderId: null,
              positionId: null,
              settledAt: "2026-11-12T05:00:00.000Z",
              description: "ORDINARY DIVIDEND",
            }),
            revision: 1,
            state: "recorded",
            contentHash: "9".repeat(64),
          },
        ],
        historyFrom: T0,
        checkedThrough: T0,
      });
      const [row] = await store.listCurrent(ACCOUNT);
      expect(row).toMatchObject({
        netAmount: "12345678901234.56",
        instrument: null,
        settledAt: "2026-11-12T05:00:00.000Z",
      });
    });

    it("writes nothing when the claim was lost", async () => {
      const store = await ready();
      await store.claimSync(ACCOUNT, T0, T1);
      expect(
        await store.applyRun({
          run: run(),
          claimedUntil: "2026-11-14T16:00:00.000Z",
          revisions: [
            {
              transaction: syntheticTrade("1"),
              revision: 1,
              state: "recorded",
              contentHash: "1".repeat(64),
            },
          ],
          historyFrom: T0,
          checkedThrough: T0,
        }),
      ).toBe(false);
      expect(await store.listCurrent(ACCOUNT)).toEqual([]);
    });

    it("records a failed run and releases the claim", async () => {
      const store = await ready();
      await store.claimSync(ACCOUNT, T0, T1);
      await store.recordFailedRun(
        run({ status: "failed", code: "http_500", inserted: 0 }),
        T1,
      );
      expect(await store.readSync(ACCOUNT)).toMatchObject({
        claimedUntil: null,
        checkedThrough: null,
      });
      expect((await store.listRuns(null, 5))[0]).toMatchObject({
        status: "failed",
        code: "http_500",
      });
    });
  });
}
