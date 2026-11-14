import { describe, expect, it } from "vitest";

import {
  bytes,
  dividendTransaction,
  tradeTransaction,
} from "@/modules/trading/infrastructure/schwab-fixtures";

import {
  parseSchwabTransactions,
  transactionContentHash,
} from "./schwab-transactions";

describe("parseSchwabTransactions", () => {
  it("reads a trade with its execution time, fees and signed quantity", () => {
    const parsed = parseSchwabTransactions(
      bytes(
        `[${tradeTransaction(1, { quantity: "-10" })},${dividendTransaction(2)}]`,
      ),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const [trade, dividend] = parsed.value.transactions;
    expect(trade).toMatchObject({
      activityId: "1",
      executedAt: "2026-11-10T15:00:00.000Z",
      settledAt: null,
      netAmount: "1004.98",
      fees: "0.02",
      orderId: "81",
      instrument: {
        instrumentId: "77",
        symbol: "SYN",
        quantity: "-10",
        price: "100.5",
        positionEffect: "CLOSING",
      },
    });
    expect(dividend).toMatchObject({
      type: "DIVIDEND_OR_INTEREST",
      netAmount: "12.34",
      instrument: null,
      fees: null,
      settledAt: "2026-11-03T10:00:00.000Z",
    });
    expect(parsed.value.accountNumbers).toEqual(["12345678"]);
  });

  it("refuses a trade whose items do not add up to its net amount", () => {
    const body = tradeTransaction(1).replace(
      '"netAmount":-1005.02',
      '"netAmount":-1005.03',
    );
    expect(parseSchwabTransactions(bytes(`[${body}]`))).toEqual({
      ok: false,
      code: "net_amount_not_reconciled",
      path: "[0]",
    });
  });

  it("refuses a cash movement whose amount does not add up", () => {
    const body = dividendTransaction(2).replace(
      '"netAmount":12.34',
      '"netAmount":12.35',
    );
    expect(parseSchwabTransactions(bytes(`[${body}]`))).toMatchObject({
      code: "net_amount_not_reconciled",
    });
  });

  it("quarantines an unmeasured type or key (TM-05)", () => {
    const wire = tradeTransaction(1).replace(
      '"type":"TRADE"',
      '"type":"RECEIVE_AND_DELIVER"',
    );
    expect(parseSchwabTransactions(bytes(`[${wire}]`))).toEqual({
      ok: false,
      code: "transaction_schema_changed",
      path: "[0].type",
    });
    const extra = tradeTransaction(1).replace(
      '"status":"VALID"',
      '"status":"VALID","surprise":1',
    );
    expect(parseSchwabTransactions(bytes(`[${extra}]`))).toMatchObject({
      path: "[0].surprise",
    });
  });

  it("refuses an option trade by name", () => {
    const body = tradeTransaction(1).replace(
      '"assetType":"EQUITY"',
      '"assetType":"OPTION"',
    );
    expect(parseSchwabTransactions(bytes(`[${body}]`))).toMatchObject({
      code: "option_trade_not_measured",
    });
  });

  it("keeps the exact decimal text of a large amount", () => {
    const body = dividendTransaction(2)
      .replace('"netAmount":12.34', '"netAmount":12345678901234567.89')
      .replace('"amount":12.34', '"amount":12345678901234567.89');
    const parsed = parseSchwabTransactions(bytes(`[${body}]`));
    expect(parsed.ok && parsed.value.transactions[0]!.netAmount).toBe(
      "12345678901234567.89",
    );
  });

  it("refuses a repeated activity", () => {
    expect(
      parseSchwabTransactions(
        bytes(`[${tradeTransaction(1)},${tradeTransaction(1)}]`),
      ),
    ).toMatchObject({ code: "duplicate_activity_id" });
  });

  it("hashes content, not order", () => {
    const parsed = parseSchwabTransactions(bytes(`[${tradeTransaction(1)}]`));
    if (!parsed.ok) throw new Error("fixture");
    const [trade] = parsed.value.transactions;
    expect(transactionContentHash(trade!)).toBe(
      transactionContentHash({ ...trade! }),
    );
    expect(transactionContentHash(trade!)).not.toBe(
      transactionContentHash({ ...trade!, netAmount: "-1005.01" }),
    );
  });
});
