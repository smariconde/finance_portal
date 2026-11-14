import { describe, expect, it } from "vitest";

import type {
  EgressFetch,
  EgressFetchRequest,
} from "@/modules/ingestion/application/egress-fetch";
import { issueQuoteScope } from "@/modules/trading/domain/quote-scope";
import {
  accountNumbersBody,
  bytes,
  cashAccountBody,
  equityPosition,
  order,
  quotesBody,
  SYNTHETIC_HASH,
} from "@/modules/trading/infrastructure/schwab-fixtures";

import {
  liveFailureCode,
  readLiveAccount,
  readLiveQuotes,
} from "./live-account-service";

const KEY = Buffer.alloc(32, 3);
const NOW = "2026-11-13T15:00:00.000Z";

function egressDouble(
  answer: (request: EgressFetchRequest) => { status?: number; body: string },
): { egress: EgressFetch; requests: EgressFetchRequest[] } {
  const requests: EgressFetchRequest[] = [];
  return {
    requests,
    egress: async (request) => {
      requests.push(request);
      const { status = 200, body } = answer(request);
      const encoded = bytes(body);
      return {
        status,
        body: encoded,
        byteLength: encoded.byteLength,
        fetchedAt: NOW,
      };
    },
  };
}

function account(positions?: readonly string[], orders = "[]") {
  return egressDouble((request) => {
    if (request.url.endsWith("/accountNumbers")) {
      return { body: accountNumbersBody() };
    }
    if (request.url.includes("/orders?")) return { body: orders };
    return { body: cashAccountBody({ positions }) };
  });
}

describe("readLiveAccount", () => {
  it("reads the account in four GETs and never returns the full number or hash", async () => {
    const double = account([equityPosition("SYN")], `[${order(7, "WORKING")}]`);
    const reading = await readLiveAccount({
      egress: double.egress,
      quoteScopeKey: KEY,
      now: () => NOW,
    });

    expect(reading.state).toBe("read");
    if (reading.state !== "read") return;
    expect(reading.account.lastFour).toBe("5678");
    expect(reading.quotableSymbols).toEqual(["SYN"]);
    expect(reading.openOrders.map((o) => o.orderId)).toEqual(["7"]);
    expect(JSON.stringify(reading)).not.toContain("12345678");
    expect(JSON.stringify(reading)).not.toContain(SYNTHETIC_HASH);

    expect(double.requests).toHaveLength(4);
    expect(double.requests.every((r) => r.sourceId === "schwab-trader")).toBe(
      true,
    );
    expect(double.requests.every((r) => r.method === undefined)).toBe(true);
    const orderUrls = double.requests
      .map((r) => new URL(r.url))
      .filter((url) => url.pathname.endsWith("/orders"));
    expect(orderUrls.map((url) => url.searchParams.get("status"))).toEqual([
      null,
      "WORKING",
    ]);
    expect(
      orderUrls.map((url) => url.searchParams.get("fromEnteredTime")),
    ).toEqual(["2026-11-06T15:00:00.000Z", "2026-09-14T15:00:00.000Z"]);
  });

  it("quotes only open stock and ETF positions", async () => {
    const reading = await readLiveAccount({
      egress: account([
        equityPosition("SYN"),
        equityPosition("ZERO", { long: "0" }),
        equityPosition("SYN 261218C00100000", { assetType: "OPTION" }),
      ]).egress,
      quoteScopeKey: KEY,
      now: () => NOW,
    });
    expect(reading.state === "read" && reading.quotableSymbols).toEqual([
      "SYN",
    ]);
  });

  it("stops at the first non-200 with its status", async () => {
    const double = egressDouble(() => ({ status: 401, body: "{}" }));
    expect(
      await readLiveAccount({
        egress: double.egress,
        quoteScopeKey: KEY,
        now: () => NOW,
      }),
    ).toEqual({ state: "failed", code: "http_401" });
    expect(double.requests).toHaveLength(1);
  });

  it("does not pick one of several accounts", async () => {
    const double = egressDouble(() => ({
      body: accountNumbersBody([
        { accountNumber: "11112222", hashValue: "B".repeat(64) },
        { accountNumber: "33334444", hashValue: "C".repeat(64) },
      ]),
    }));
    expect(
      await readLiveAccount({
        egress: double.egress,
        quoteScopeKey: KEY,
        now: () => NOW,
      }),
    ).toEqual({ state: "failed", code: "multiple_accounts_not_measured" });
  });

  it("refuses an account that is not the one accountNumbers named", async () => {
    const double = egressDouble((request) =>
      request.url.endsWith("/accountNumbers")
        ? { body: accountNumbersBody() }
        : request.url.includes("/orders?")
          ? { body: "[]" }
          : { body: cashAccountBody({ accountNumber: "87654321" }) },
    );
    expect(
      await readLiveAccount({
        egress: double.egress,
        quoteScopeKey: KEY,
        now: () => NOW,
      }),
    ).toEqual({ state: "failed", code: "account_number_mismatch" });
  });

  it("turns a missing token into not_connected", async () => {
    const egress: EgressFetch = async () => {
      throw Object.assign(new Error("Egress blocked"), {
        name: "EgressBlockedError",
        code: "credential_missing",
      });
    };
    expect(
      await readLiveAccount({ egress, quoteScopeKey: KEY, now: () => NOW }),
    ).toEqual({
      state: "failed",
      code: "not_connected",
    });
  });
});

describe("liveFailureCode", () => {
  it("names a budget refusal apart from a door refusal", () => {
    const budget = Object.assign(new Error("x"), {
      name: "SourceRequestRefusedError",
      code: "daily_budget_exhausted",
    });
    const door = Object.assign(new Error("x"), {
      name: "EgressBlockedError",
      code: "deadline_exceeded",
    });
    expect(liveFailureCode(budget)).toBe("source_daily_budget_exhausted");
    expect(liveFailureCode(door)).toBe("egress_deadline_exceeded");
    expect(liveFailureCode(new Error("plain"))).toBe("unexpected");
  });
});

describe("readLiveQuotes", () => {
  it("quotes exactly the signed symbols through marketdata", async () => {
    const double = egressDouble(() => ({ body: quotesBody(["AAA", "SYN"]) }));
    const reading = await readLiveQuotes(
      { egress: double.egress, quoteScopeKey: KEY, now: () => NOW },
      issueQuoteScope(KEY, ["SYN", "AAA"], NOW),
    );
    expect(
      reading.state === "read" && reading.quotes.map((q) => q.symbol),
    ).toEqual(["AAA", "SYN"]);
    expect(double.requests).toHaveLength(1);
    const url = new URL(double.requests[0]!.url);
    expect(double.requests[0]!.sourceId).toBe("schwab-marketdata");
    expect(url.searchParams.get("symbols")).toBe("AAA,SYN");
    expect(url.searchParams.get("fields")).toBe("quote");
  });

  it("spends nothing on an empty scope", async () => {
    const double = egressDouble(() => ({ body: "{}" }));
    const reading = await readLiveQuotes(
      { egress: double.egress, quoteScopeKey: KEY, now: () => NOW },
      issueQuoteScope(KEY, [], NOW),
    );
    expect(reading).toMatchObject({ state: "read", quotes: [] });
    expect(double.requests).toHaveLength(0);
  });

  it("does not leave with a forged or expired scope", async () => {
    const double = egressDouble(() => ({ body: "{}" }));
    const deps = { egress: double.egress, quoteScopeKey: KEY, now: () => NOW };
    expect(await readLiveQuotes(deps, "forged.scope")).toEqual({
      state: "scope_rejected",
    });
    expect(
      await readLiveQuotes(
        deps,
        issueQuoteScope(KEY, ["SYN"], "2026-11-13T14:00:00.000Z"),
      ),
    ).toEqual({ state: "scope_rejected" });
    expect(double.requests).toHaveLength(0);
  });

  it("refuses a symbol it did not ask for", async () => {
    const double = egressDouble(() => ({ body: quotesBody(["SYN", "OTH"]) }));
    expect(
      await readLiveQuotes(
        { egress: double.egress, quoteScopeKey: KEY, now: () => NOW },
        issueQuoteScope(KEY, ["SYN"], NOW),
      ),
    ).toEqual({ state: "failed", code: "quote_symbol_not_requested" });
  });
});
