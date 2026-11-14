import { describe, expect, it } from "vitest";

import {
  issueQuoteScope,
  quotableSymbols,
  verifyQuoteScope,
} from "./quote-scope";

const KEY = Buffer.alloc(32, 9);
const NOW = "2026-11-13T15:00:00.000Z";

describe("quote scope", () => {
  it("round-trips the symbols it signed", () => {
    const token = issueQuoteScope(KEY, ["MSFT", "AAPL", "MSFT"], NOW);
    expect(verifyQuoteScope(KEY, token, "2026-11-13T15:09:59.000Z")).toEqual({
      ok: true,
      scope: {
        symbols: ["AAPL", "MSFT"],
        expiresAt: "2026-11-13T15:10:00.000Z",
      },
    });
  });

  it("expires after ten minutes", () => {
    const token = issueQuoteScope(KEY, ["AAPL"], NOW);
    expect(verifyQuoteScope(KEY, token, "2026-11-13T15:10:00.000Z")).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("rejects a scope whose symbols were changed", () => {
    const token = issueQuoteScope(KEY, ["AAPL"], NOW);
    const [, signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({
        symbols: ["AAPL", "TSLA"],
        expiresAt: "2026-11-13T15:10:00.000Z",
      }),
    ).toString("base64url");
    expect(verifyQuoteScope(KEY, `${forged}.${signature}`, NOW)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects a scope signed with another key", () => {
    const token = issueQuoteScope(Buffer.alloc(32, 1), ["AAPL"], NOW);
    expect(verifyQuoteScope(KEY, token, NOW)).toMatchObject({
      ok: false,
      reason: "bad_signature",
    });
  });

  it.each(["", "abc", "a.b", `${"x".repeat(3000)}.${"y".repeat(43)}`])(
    "rejects a malformed token %#",
    (token) => {
      expect(verifyQuoteScope(KEY, token, NOW)).toEqual({
        ok: false,
        reason: "malformed",
      });
    },
  );

  it("signs an empty scope too: no positions, no quotes", () => {
    const token = issueQuoteScope(KEY, [], NOW);
    expect(verifyQuoteScope(KEY, token, NOW)).toMatchObject({
      ok: true,
      scope: { symbols: [] },
    });
  });

  it("drops what is not a quotable symbol", () => {
    expect(
      quotableSymbols(["aapl", "BRK/B", "SYN 261218C00100000", "A&B"]),
    ).toEqual(["BRK/B"]);
  });
});
