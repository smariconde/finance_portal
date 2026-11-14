import { describe, expect, it } from "vitest";

import {
  bytes,
  quotesBody,
} from "@/modules/trading/infrastructure/schwab-fixtures";

import { parseSchwabQuotes } from "./schwab-quotes";

describe("parseSchwabQuotes", () => {
  it("reads the measured equity shape exactly, keyed by symbol", () => {
    const parsed = parseSchwabQuotes(bytes(quotesBody(["SYN", "ABC"])));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.quotes.map((quote) => quote.symbol)).toEqual([
      "ABC",
      "SYN",
    ]);
    expect(parsed.value.quotes[0]).toMatchObject({
      lastPrice: "101.2",
      netPercentChange: "-0.2955665",
      quotedAt: "2025-11-13T18:53:20.000Z",
      realtime: true,
    });
  });

  it("reports invalid symbols without failing the others", () => {
    const body = quotesBody(["SYN"]).replace(
      /\}$/u,
      ',"errors":{"invalidSymbols":["ZZZZ"]}}',
    );
    const parsed = parseSchwabQuotes(bytes(body));
    expect(parsed.ok && parsed.value.invalidSymbols).toEqual(["ZZZZ"]);
  });

  it("quarantines a new quote key (TM-05)", () => {
    const parsed = parseSchwabQuotes(bytes(quotesBody(["SYN"], ',"nAV":1')));
    expect(parsed).toEqual({
      ok: false,
      code: "quote_schema_changed",
      path: "<symbol>.quote.nAV",
    });
  });

  it("refuses a quote whose key and symbol disagree", () => {
    const body = quotesBody(["SYN"]).replace(
      '"symbol":"SYN"',
      '"symbol":"OTH"',
    );
    expect(parseSchwabQuotes(bytes(body))).toMatchObject({
      ok: false,
      code: "quote_symbol_mismatch",
    });
  });

  it("refuses an option quote: its shape was not measured", () => {
    const body = quotesBody(["SYN"]).replace(
      '"assetMainType":"EQUITY"',
      '"assetMainType":"OPTION"',
    );
    expect(parseSchwabQuotes(bytes(body))).toMatchObject({
      ok: false,
      code: "quote_schema_changed",
      path: "<symbol>.assetMainType",
    });
  });

  it("refuses an array body", () => {
    expect(parseSchwabQuotes(bytes("[]"))).toMatchObject({
      ok: false,
      code: "quotes_schema_changed",
    });
  });
});
