import { describe, expect, it } from "vitest";

import {
  accountNumbersBody,
  bytes,
  cashAccountBody,
  equityPosition,
  order,
  SYNTHETIC_ACCOUNT_NUMBER,
} from "@/modules/trading/infrastructure/schwab-fixtures";

import {
  parseSchwabAccount,
  parseSchwabAccountNumbers,
  parseSchwabOpenOrders,
} from "./schwab-account";

describe("parseSchwabAccountNumbers", () => {
  it("reads the account and its hash", () => {
    const parsed = parseSchwabAccountNumbers(bytes(accountNumbersBody()));
    expect(parsed.ok && parsed.value).toEqual([
      { accountNumber: SYNTHETIC_ACCOUNT_NUMBER, hashValue: "A".repeat(64) },
    ]);
  });

  it("rejects an unknown key by path", () => {
    const body = JSON.stringify([
      { accountNumber: "12345678", hashValue: "A".repeat(64), nickname: "x" },
    ]);
    expect(parseSchwabAccountNumbers(bytes(body))).toEqual({
      ok: false,
      code: "account_numbers_schema_changed",
      path: "[0].nickname",
    });
  });

  it("rejects a body that is not JSON", () => {
    expect(parseSchwabAccountNumbers(bytes("<html>"))).toMatchObject({
      ok: false,
      code: "invalid_json",
    });
  });
});

describe("parseSchwabAccount", () => {
  it("reads the measured CASH shape with no positions key", () => {
    const parsed = parseSchwabAccount(bytes(cashAccountBody()));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.positions).toEqual([]);
    expect(parsed.value.balances).toMatchObject({
      liquidationValue: "2512.37",
      cashAvailableForTrading: "1500.25",
      unsettledCash: "100",
      currentIntradayBuyingPower: "0",
      liquidationValueAtOpen: "2500.1",
    });
  });

  it("keeps the exact decimal text, never a double", () => {
    const body = cashAccountBody().replace(
      '"totalCash":1500.25',
      '"totalCash":12345678901234567.89',
    );
    const parsed = parseSchwabAccount(bytes(body));
    expect(parsed.ok && parsed.value.balances.totalCash).toBe(
      "12345678901234567.89",
    );
  });

  it("refuses a MARGIN account by name: its balances were never measured", () => {
    expect(
      parseSchwabAccount(bytes(cashAccountBody({ type: "MARGIN" }))),
    ).toEqual({
      ok: false,
      code: "account_type_not_measured",
      path: "securitiesAccount.type",
    });
  });

  it("quarantines a new balance key (TM-05)", () => {
    const parsed = parseSchwabAccount(
      bytes(cashAccountBody({ extraCurrentBalance: ',"newBalance":1' })),
    );
    expect(parsed).toEqual({
      ok: false,
      code: "account_schema_changed",
      path: "securitiesAccount.currentBalances.newBalance",
    });
  });

  it("reads long and short positions with their own open P&L", () => {
    const parsed = parseSchwabAccount(
      bytes(
        cashAccountBody({
          positions: [
            equityPosition("SYN"),
            equityPosition("SHO", { long: "0", short: "3" }).replace(
              '"longOpenProfitLoss":-2.88',
              '"shortOpenProfitLoss":4.5',
            ),
          ],
        }),
      ),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.positions).toMatchObject([
      { symbol: "SYN", side: "long", quantity: "10", openProfitLoss: "-2.88" },
      { symbol: "SHO", side: "short", quantity: "3", openProfitLoss: "4.5" },
    ]);
  });

  it("never nets a row with both sides", () => {
    const parsed = parseSchwabAccount(
      bytes(
        cashAccountBody({ positions: [equityPosition("SYN", { short: "2" })] }),
      ),
    );
    expect(parsed).toMatchObject({ ok: false, code: "position_both_sides" });
  });

  it("names an unknown asset type", () => {
    const parsed = parseSchwabAccount(
      bytes(
        cashAccountBody({
          positions: [equityPosition("SYN", { assetType: "CRYPTO" })],
        }),
      ),
    );
    expect(parsed).toEqual({
      ok: false,
      code: "position_schema_changed",
      path: "securitiesAccount.positions[0].instrument.assetType",
    });
  });

  it("leaves an option multiplier null when Schwab does not say it", () => {
    const parsed = parseSchwabAccount(
      bytes(
        cashAccountBody({
          positions: [
            equityPosition("SYN 261218C00100000", { assetType: "OPTION" }),
          ],
        }),
      ),
    );
    expect(parsed.ok && parsed.value.positions[0]?.optionMultiplier).toBeNull();
  });
});

describe("parseSchwabOpenOrders", () => {
  it("keeps open orders only, newest first, without duplicates across windows", () => {
    const recent = `[${order(2, "WORKING", { enteredTime: "2026-11-12T16:00:00+0000" })},${order(1, "FILLED")}]`;
    const working = `[${order(2, "WORKING", { enteredTime: "2026-11-12T16:00:00+0000" })},${order(3, "WORKING", { enteredTime: "2026-10-01T14:00:00+0000" })}]`;
    const parsed = parseSchwabOpenOrders([bytes(recent), bytes(working)]);
    expect(parsed.ok && parsed.value.map((o) => o.orderId)).toEqual(["2", "3"]);
  });

  it("finds the live legs of a filled bracket", () => {
    const bracket = order(10, "FILLED", {
      children: [
        order(11, "WORKING"),
        order(12, "AWAITING_PARENT_ORDER"),
        order(13, "CANCELED"),
      ],
    });
    const parsed = parseSchwabOpenOrders([bytes(`[${bracket}]`)]);
    expect(parsed.ok && parsed.value).toMatchObject([
      { orderId: "11", parentOrderId: "10" },
      { orderId: "12", parentOrderId: "10" },
    ]);
  });

  it("reads the price exactly", () => {
    const parsed = parseSchwabOpenOrders([bytes(`[${order(1, "WORKING")}]`)]);
    expect(parsed.ok && parsed.value[0]).toMatchObject({
      price: "95.25",
      quantity: "5",
      legs: [{ symbol: "SYN", instruction: "BUY", quantity: "5" }],
    });
  });

  it("rejects an unknown status instead of guessing whether it is open", () => {
    const parsed = parseSchwabOpenOrders([bytes(`[${order(1, "PARKED")}]`)]);
    expect(parsed).toEqual({
      ok: false,
      code: "order_schema_changed",
      path: "[0].status",
    });
  });

  it("rejects an unknown order key", () => {
    const parsed = parseSchwabOpenOrders([
      bytes(`[${order(1, "WORKING", { extra: ',"surprise":true' })}]`),
    ]);
    expect(parsed).toMatchObject({
      code: "order_schema_changed",
      path: "[0].surprise",
    });
  });

  it("reads an empty window", () => {
    expect(parseSchwabOpenOrders([bytes("[]"), bytes("[]")])).toEqual({
      ok: true,
      value: [],
    });
  });
});
