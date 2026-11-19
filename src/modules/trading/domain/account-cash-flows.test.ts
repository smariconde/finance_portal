import { describe, expect, it } from "vitest";

import { externalCashFlows, sessionCashFlows } from "./account-cash-flows";

const tx = (type: string, executedAt: string, netAmount: string) => ({
  type: type as never,
  executedAt,
  netAmount,
});

describe("externalCashFlows", () => {
  it("takes transfers in and out, never trades or income", () => {
    const flows = externalCashFlows([
      tx("CASH_RECEIPT", "2026-11-19T17:04:04Z", "590"),
      tx("ELECTRONIC_FUND", "2024-06-05T20:34:14Z", "966.61"),
      tx("CASH_DISBURSEMENT", "2025-08-07T09:10:32Z", "-46.76"),
      tx("TRADE", "2026-04-29T14:59:42Z", "-1000"),
      tx("DIVIDEND_OR_INTEREST", "2025-12-23T17:56:01Z", "4.73"),
    ]);
    expect(flows.map((flow) => flow.type)).toEqual([
      "CASH_RECEIPT",
      "ELECTRONIC_FUND",
      "CASH_DISBURSEMENT",
    ]);
  });

  it("keeps a withholding paired with its dividend as income", () => {
    const flows = externalCashFlows([
      tx("DIVIDEND_OR_INTEREST", "2025-12-23T17:56:01Z", "4.73"),
      tx("JOURNAL", "2025-12-23T17:56:01.000Z", "-1.42"),
      tx("JOURNAL", "2026-08-20T09:10:51Z", "-145"),
      tx("JOURNAL", "2025-08-07T09:10:32Z", "6.1"),
    ]);
    expect(flows.map((flow) => flow.netAmount)).toEqual(["-145", "6.1"]);
  });
});

describe("sessionCashFlows", () => {
  const now = "2026-11-19T18:00:00Z";

  it("nets the New York session's deposits and withdrawals", () => {
    expect(
      sessionCashFlows(
        [
          tx("CASH_RECEIPT", "2026-11-19T17:04:04Z", "590"),
          tx("JOURNAL", "2026-11-19T09:10:51Z", "-145"),
          tx("TRADE", "2026-11-19T15:00:00Z", "-300"),
        ],
        now,
      ),
    ).toBe("445");
  });

  it("leaves out another session's movements, by New York date", () => {
    expect(
      sessionCashFlows(
        [
          // 2026-11-18 a las 23:30 en Nueva York.
          tx("CASH_RECEIPT", "2026-11-19T04:30:00Z", "700"),
          tx("CASH_RECEIPT", "2026-08-17T20:01:30Z", "700"),
        ],
        now,
      ),
    ).toBe("0");
  });

  it("is zero without movements", () => {
    expect(sessionCashFlows([], now)).toBe("0");
  });
});
