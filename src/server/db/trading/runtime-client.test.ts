import { describe, expect, it } from "vitest";

import { resolveTradingDatabaseUrl } from "./runtime-client";

const TRADING =
  "postgresql://runtime:secret@127.0.0.1:55432/finance_portal_trading";

function trapped(environment: Record<string, string>) {
  // Las conexiones directas son de las migraciones: el runtime no las lee.
  for (const name of ["TRADING_DATABASE_DIRECT_URL", "DATABASE_DIRECT_URL"]) {
    Object.defineProperty(environment, name, {
      get() {
        throw new Error(`${name} was read by runtime code`);
      },
    });
  }
  return environment;
}

describe("resolveTradingDatabaseUrl", () => {
  it("uses only the pooled trading URL", () => {
    expect(
      resolveTradingDatabaseUrl(
        trapped({
          TRADING_DATABASE_URL: TRADING,
          DATABASE_URL:
            "postgresql://u:p@127.0.0.1:55432/finance_portal_personal",
        }),
      ),
    ).toBe(TRADING);
  });

  it("never falls back to the analysis URL", () => {
    expect(() =>
      resolveTradingDatabaseUrl(trapped({ DATABASE_URL: TRADING })),
    ).toThrow("TRADING_DATABASE_URL is required for the trading database.");
  });

  it("refuses the analysis database under another role", () => {
    expect(() =>
      resolveTradingDatabaseUrl(
        trapped({
          TRADING_DATABASE_URL: TRADING,
          DATABASE_URL:
            "postgresql://owner:x@127.0.0.1:55432/finance_portal_trading",
        }),
      ),
    ).toThrow("TRADING_DATABASE_URL names the analysis database");
  });

  it("fails without exposing configuration values", () => {
    let message = "";
    try {
      resolveTradingDatabaseUrl({ TRADING_DATABASE_URL: "secret-not-a-url" });
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain("not a PostgreSQL URL");
    expect(message).not.toContain("secret-not-a-url");
  });
});
