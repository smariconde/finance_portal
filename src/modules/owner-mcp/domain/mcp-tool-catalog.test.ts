import { describe, expect, it } from "vitest";

import {
  boundedJson,
  getTradeInputSchema,
  getValuationInputSchema,
  listTradesInputSchema,
  MCP_RESPONSE_BYTE_LIMIT,
  MCP_TOOLS,
  McpResponseTooLargeError,
} from "./mcp-tool-catalog";

describe("portal-mcp-tools-1.1.0", () => {
  it("trae valuaciones y diario, nada que escriba", () => {
    expect(MCP_TOOLS.map((tool) => tool.name)).toEqual([
      "list_valuations",
      "get_valuation",
      "list_trades",
      "get_trade",
    ]);
  });

  it("las entradas son cerradas: ni claves extra ni texto libre", () => {
    expect(getValuationInputSchema.parse({ ticker: " brk.b " })).toEqual({
      ticker: "BRK.B",
    });
    expect(
      getValuationInputSchema.safeParse({ ticker: "AAPL", url: "x" }).success,
    ).toBe(false);
    expect(
      getValuationInputSchema.safeParse({ ticker: "1; DROP" }).success,
    ).toBe(false);
    expect(getTradeInputSchema.safeParse({ ref: "77-1" }).success).toBe(true);
    expect(getTradeInputSchema.safeParse({ ref: "../x" }).success).toBe(false);
    expect(listTradesInputSchema.parse({})).toEqual({ limit: 100 });
    expect(
      listTradesInputSchema.safeParse({ from: "2026-11-10", to: "2026-11-01" })
        .success,
    ).toBe(false);
    expect(listTradesInputSchema.safeParse({ limit: 501 }).success).toBe(false);
  });

  it("una respuesta sobre el tope se rechaza con su tamaño, nunca se corta", () => {
    expect(boundedJson({ a: "x" })).toEqual({ text: '{"a":"x"}', bytes: 9 });
    const large = { text: "x".repeat(MCP_RESPONSE_BYTE_LIMIT) };

    expect(() => boundedJson(large)).toThrow(McpResponseTooLargeError);
  });
});
