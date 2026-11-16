import { describe, expect, it } from "vitest";

import { DEFAULT_RISK_SETTINGS } from "@/modules/trading/domain/trading-rules";

import { readRiskContext } from "./risk";
import type { JournalStores } from "./transactions";
import {
  isUndefinedTable,
  readPart,
  unreadParts,
  type TradingPart,
} from "./trading-parts";

function pgError(code: string): Error {
  return Object.assign(new Error(`relation "x" does not exist`), { code });
}

/** Como lo envuelve Drizzle: el error del driver va en `cause`. */
function wrapped(code: string): Error {
  return new Error("Failed query", { cause: pgError(code) });
}

describe("isUndefinedTable", () => {
  it("reads SQLSTATE 42P01 on the error or its cause", () => {
    expect(isUndefinedTable(pgError("42P01"))).toBe(true);
    expect(isUndefinedTable(wrapped("42P01"))).toBe(true);
  });

  it("does not take a connection, permission or column error", () => {
    expect(isUndefinedTable(wrapped("ECONNREFUSED"))).toBe(false);
    expect(isUndefinedTable(wrapped("42501"))).toBe(false);
    expect(isUndefinedTable(wrapped("42703"))).toBe(false);
    expect(isUndefinedTable("42P01")).toBe(false);
    expect(isUndefinedTable(null)).toBe(false);
  });
});

describe("readPart", () => {
  it("returns the fallback and names the part when its table is missing", async () => {
    const unread = new Set<TradingPart>();
    const value = await readPart(
      "pre_market",
      unread,
      () => Promise.reject(wrapped("42P01")),
      "fallback",
    );
    expect(value).toBe("fallback");
    expect([...unread]).toEqual(["pre_market"]);
  });

  it("lets any other failure through", async () => {
    const unread = new Set<TradingPart>();
    await expect(
      readPart(
        "pre_market",
        unread,
        () => Promise.reject(wrapped("ECONNREFUSED")),
        "fallback",
      ),
    ).rejects.toThrow("Failed query");
    expect(unread.size).toBe(0);
  });

  it("orders the parts the same way every time", () => {
    expect(
      unreadParts(new Set(["annotations", "pre_market", "risk_settings"])),
    ).toEqual(["risk_settings", "pre_market", "annotations"]);
  });
});

const ACCOUNT = { accountKey: "a".repeat(64), lastFour: "5974" };

function journal(missing: ReadonlySet<TradingPart>): JournalStores {
  const missingTable = () => Promise.reject(wrapped("42P01"));
  return {
    transactions: {
      listAccounts: () => Promise.resolve([ACCOUNT]),
      listCurrent: () => Promise.resolve([]),
    },
    annotations: {
      listOwnSetups: () =>
        missing.has("annotations") ? missingTable() : Promise.resolve([]),
      listCurrentAnnotations: () =>
        missing.has("annotations") ? missingTable() : Promise.resolve([]),
    },
    preMarket: {
      listLinks: () =>
        missing.has("pre_market") ? missingTable() : Promise.resolve(new Map()),
    },
  };
}

describe("readRiskContext over a trading base that lags its migrations", () => {
  const now = "2026-11-16T15:00:00.000Z";

  it("reads the default rules and no plans, naming what it could not read", async () => {
    const context = await readRiskContext(now, {
      settings: { readCurrent: () => Promise.reject(wrapped("42P01")) },
      journal: journal(new Set(["pre_market", "annotations"])),
    });
    expect(context.settings).toEqual(DEFAULT_RISK_SETTINGS);
    expect(context.settingsRevision).toBeNull();
    expect(context.plans).toEqual([]);
    expect(context.unread).toEqual([
      "risk_settings",
      "pre_market",
      "annotations",
    ]);
  });

  it("names nothing when every table is there", async () => {
    const context = await readRiskContext(now, {
      settings: { readCurrent: () => Promise.resolve(null) },
      journal: journal(new Set()),
    });
    expect(context.unread).toEqual([]);
  });

  it("still fails on a connection error", async () => {
    await expect(
      readRiskContext(now, {
        settings: {
          readCurrent: () => Promise.reject(wrapped("ECONNREFUSED")),
        },
        journal: journal(new Set()),
      }),
    ).rejects.toThrow("Failed query");
  });
});
