import { describe, expect, it } from "vitest";

import type {
  EgressFetch,
  EgressFetchRequest,
} from "@/modules/ingestion/application/egress-fetch";
import { createInMemorySchwabTransactionStore } from "@/modules/trading/infrastructure/in-memory-schwab-transaction-store";
import {
  accountNumbersBody,
  bytes,
  dividendTransaction,
  tradeTransaction,
} from "@/modules/trading/infrastructure/schwab-fixtures";

import {
  syncSchwabTransactions,
  transactionsDue,
} from "./transaction-sync-service";

const KEY = Buffer.alloc(32, 5);
const NOW = "2026-11-14T15:00:00.000Z";

function schwab(
  windows: (from: Date, to: Date) => string | { status: number },
) {
  const requests: EgressFetchRequest[] = [];
  const egress: EgressFetch = async (request) => {
    requests.push(request);
    const url = new URL(request.url);
    let body = "{}";
    let status = 200;
    if (url.pathname.endsWith("/accountNumbers")) body = accountNumbersBody();
    else {
      const answer = windows(
        new Date(url.searchParams.get("startDate")!),
        new Date(url.searchParams.get("endDate")!),
      );
      if (typeof answer === "string") body = answer;
      else status = answer.status;
    }
    const encoded = bytes(body);
    return {
      status,
      body: encoded,
      byteLength: encoded.byteLength,
      fetchedAt: NOW,
    };
  };
  return { egress, requests };
}

const inWindow = (time: string, from: Date, to: Date) =>
  Date.parse(time) >= from.getTime() && Date.parse(time) <= to.getTime();

/** Una historia sintética: dos años con actividad y nada antes. */
function history(rows: { time: string; json: string }[]) {
  return (from: Date, to: Date) =>
    `[${rows
      .filter((row) => inWindow(row.time, from, to))
      .map((row) => row.json)
      .join(",")}]`;
}

const T_RECENT = "2026-11-10T15:00:00+0000";
const T_LAST_YEAR = "2025-06-02T15:00:00+0000";

function rows() {
  return [
    { time: T_RECENT, json: tradeTransaction(1, { time: T_RECENT }) },
    {
      time: "2026-11-12T10:00:00+0000",
      json: dividendTransaction(2, "2026-11-12T10:00:00+0000"),
    },
    { time: T_LAST_YEAR, json: tradeTransaction(3, { time: T_LAST_YEAR }) },
  ];
}

describe("syncSchwabTransactions", () => {
  it("backfills year windows until an empty one", async () => {
    const store = createInMemorySchwabTransactionStore();
    const double = schwab(history(rows()));
    const result = await syncSchwabTransactions({
      egress: double.egress,
      store,
      accountKeySubkey: KEY,
      now: () => NOW,
    });

    expect(result).toEqual({
      state: "synced",
      inserted: 3,
      revised: 0,
      withdrawn: 0,
      requests: 4,
    });
    const [account] = await store.listAccounts();
    expect(account!.lastFour).toBe("5678");
    expect(account!.accountKey).toMatch(/^[0-9a-f]{64}$/u);
    expect(await store.readSync(account!.accountKey)).toMatchObject({
      historyFrom: "2023-11-15T15:03:00.000Z",
      checkedThrough: NOW,
      claimedUntil: null,
    });
    const urls = double.requests.slice(1).map((r) => new URL(r.url));
    expect(
      urls.every((u) => u.searchParams.get("types")!.includes("TRADE")),
    ).toBe(true);
  });

  it("then asks only from the last check minus seven days", async () => {
    const store = createInMemorySchwabTransactionStore();
    await syncSchwabTransactions({
      egress: schwab(history(rows())).egress,
      store,
      accountKeySubkey: KEY,
      now: () => NOW,
    });

    const later = "2026-11-14T16:00:00.000Z";
    const double = schwab(history(rows()));
    const result = await syncSchwabTransactions({
      egress: double.egress,
      store,
      accountKeySubkey: KEY,
      now: () => later,
    });
    expect(result).toMatchObject({
      state: "synced",
      inserted: 0,
      revised: 0,
      withdrawn: 0,
      requests: 2,
    });
    expect(new URL(double.requests[1]!.url).searchParams.get("startDate")).toBe(
      "2026-11-07T15:00:00.000Z",
    );
  });

  it("records a correction as a new revision and a vanished row as withdrawn", async () => {
    const store = createInMemorySchwabTransactionStore();
    await syncSchwabTransactions({
      egress: schwab(history(rows())).egress,
      store,
      accountKeySubkey: KEY,
      now: () => NOW,
    });

    const corrected = [
      {
        time: T_RECENT,
        json: tradeTransaction(1, { time: T_RECENT, netAmount: "-1005.52" }),
      },
      { time: T_LAST_YEAR, json: tradeTransaction(3, { time: T_LAST_YEAR }) },
    ];
    const later = "2026-11-14T16:00:00.000Z";
    const result = await syncSchwabTransactions({
      egress: schwab(history(corrected)).egress,
      store,
      accountKeySubkey: KEY,
      now: () => later,
    });
    expect(result).toMatchObject({ state: "synced", revised: 1, withdrawn: 1 });
    const [account] = await store.listAccounts();
    const current = await store.listCurrent(account!.accountKey);
    expect(
      current.map((row) => [row.activityId, row.revision, row.state]),
    ).toEqual([
      ["3", 1, "recorded"],
      ["1", 2, "recorded"],
      ["2", 2, "withdrawn"],
    ]);
  });

  it("quarantines a run that would change more than a tenth", async () => {
    const store = createInMemorySchwabTransactionStore();
    const many = Array.from({ length: 12 }, (_, i) => {
      const time = `2026-11-1${i % 2}T1${i % 10}:00:00+0000`;
      return { time, json: tradeTransaction(100 + i, { time }) };
    });
    await syncSchwabTransactions({
      egress: schwab(history(many)).egress,
      store,
      accountKeySubkey: KEY,
      now: () => NOW,
    });

    const later = "2026-11-14T16:00:00.000Z";
    const result = await syncSchwabTransactions({
      egress: schwab(history(many.slice(3))).egress,
      store,
      accountKeySubkey: KEY,
      now: () => later,
    });
    expect(result).toEqual({ state: "quarantined", code: "mass_change_guard" });
    const [account] = await store.listAccounts();
    expect(
      (await store.listCurrent(account!.accountKey)).every(
        (r) => r.state === "recorded",
      ),
    ).toBe(true);
    expect((await store.listRuns(null, 1))[0]).toMatchObject({
      status: "quarantined",
      withdrawn: 3,
    });

    expect(
      await syncSchwabTransactions(
        {
          egress: schwab(history(many.slice(3))).egress,
          store,
          accountKeySubkey: KEY,
          now: () => later,
        },
        { acceptMassChange: true },
      ),
    ).toMatchObject({ state: "synced", withdrawn: 3 });
  });

  it("records a failure with its code and writes no transaction", async () => {
    const store = createInMemorySchwabTransactionStore();
    const result = await syncSchwabTransactions({
      egress: schwab(() => ({ status: 500 })).egress,
      store,
      accountKeySubkey: KEY,
      now: () => NOW,
    });
    expect(result).toEqual({ state: "failed", code: "http_500" });
    expect((await store.listRuns(null, 1))[0]).toMatchObject({
      status: "failed",
      code: "http_500",
      requests: 2,
    });
    const [account] = await store.listAccounts();
    expect(await store.readSync(account!.accountKey)).toMatchObject({
      claimedUntil: null,
      historyFrom: null,
    });
  });

  it("refuses rows of another account", async () => {
    const store = createInMemorySchwabTransactionStore();
    const other = tradeTransaction(1, { accountNumber: "87654321" });
    const result = await syncSchwabTransactions({
      egress: schwab(() => `[${other}]`).egress,
      store,
      accountKeySubkey: KEY,
      now: () => NOW,
    });
    expect(result).toEqual({
      state: "failed",
      code: "account_number_mismatch",
    });
  });

  it("answers busy while another request holds the claim", async () => {
    const store = createInMemorySchwabTransactionStore();
    const first = schwab(history(rows()));
    await syncSchwabTransactions({
      egress: first.egress,
      store,
      accountKeySubkey: KEY,
      now: () => NOW,
    });
    const [account] = await store.listAccounts();
    await store.claimSync(account!.accountKey, NOW, "2026-11-14T15:05:00.000Z");
    const before = first.requests.length;
    expect(
      await syncSchwabTransactions({
        egress: first.egress,
        store,
        accountKeySubkey: KEY,
        now: () => "2026-11-14T15:02:00.000Z",
      }),
    ).toEqual({ state: "busy" });
    // Decidido en la base: no salió ningún pedido a Schwab.
    expect(first.requests.length).toBe(before);
  });
});

describe("transactionsDue", () => {
  it("is due without runs and again after the account cadence", async () => {
    const store = createInMemorySchwabTransactionStore();
    // Friday 10:00 in New York: in session, one minute.
    const friday = "2026-11-13T15:00:00.000Z";
    expect(await transactionsDue(store, friday)).toBe(true);
    await syncSchwabTransactions({
      egress: schwab(history(rows())).egress,
      store,
      accountKeySubkey: KEY,
      now: () => friday,
    });
    expect(await transactionsDue(store, "2026-11-13T15:00:30.000Z")).toBe(
      false,
    );
    expect(await transactionsDue(store, "2026-11-13T15:01:00.000Z")).toBe(true);
    // Saturday: five minutes.
    expect(await transactionsDue(store, "2026-11-14T15:00:00.000Z")).toBe(true);
  });
});
