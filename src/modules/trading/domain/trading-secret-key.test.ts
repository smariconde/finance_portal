import { describe, expect, it } from "vitest";

import {
  deriveTradingSubkey,
  parseTradingSecretKey,
} from "@/modules/trading/domain/trading-secret-key";

const KEY = Buffer.alloc(32, 7).toString("base64");

describe("parseTradingSecretKey", () => {
  it("accepts exactly 32 bytes in base64", () => {
    const parsed = parseTradingSecretKey(`  ${KEY}\n`);
    expect(parsed.ok && parsed.key.byteLength).toBe(32);
  });

  it.each([
    ["missing", undefined, "missing"],
    ["empty", "   ", "missing"],
    ["short", Buffer.alloc(16).toString("base64"), "invalid"],
    ["hex", "a".repeat(64), "invalid"],
    [
      "url-safe base64",
      KEY.replace(/\+/gu, "-").replace(/\//gu, "_") + "x",
      "invalid",
    ],
  ])("rejects a %s key", (_, value, problem) => {
    expect(parseTradingSecretKey(value)).toEqual({ ok: false, problem });
  });
});

describe("deriveTradingSubkey", () => {
  const master = Buffer.alloc(32, 7);

  it("derives a different 32-byte key per use, deterministically", () => {
    const tokens = deriveTradingSubkey(master, "schwab-token-encryption");
    const hmac = deriveTradingSubkey(master, "account-hmac");

    expect(tokens.byteLength).toBe(32);
    expect(tokens.equals(hmac)).toBe(false);
    expect(tokens.equals(master)).toBe(false);
    expect(deriveTradingSubkey(master, "account-hmac").equals(hmac)).toBe(true);
  });

  it("refuses a master key of the wrong size", () => {
    expect(() => deriveTradingSubkey(Buffer.alloc(31), "account-hmac")).toThrow(
      "32 bytes",
    );
  });
});
