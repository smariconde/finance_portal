import { describe, expect, it } from "vitest";

import {
  formatAmount,
  formatCalendarDate,
  formatPercent,
  formatShares,
  formatSignedAmount,
  formatUtcTimestamp,
  shortenHash,
} from "./display-format";
import { isValuationPolicyError } from "./valuation-error";

describe("es-AR display formatting", () => {
  it("groups thousands with a dot and separates decimals with a comma", () => {
    expect(formatAmount("96000000")).toBe("96.000.000,00");
    expect(formatAmount("1234.5")).toBe("1.234,50");
    expect(formatAmount("999")).toBe("999,00");
    expect(formatAmount("0")).toBe("0,00");
  });

  it("keeps the sign in front of the grouped magnitude", () => {
    expect(formatAmount("-1234567.891")).toBe("-1.234.567,89");
  });

  it("rounds to the requested scale under the engine policy", () => {
    // ROUND_HALF_EVEN: el empate rompe al dígito par, no siempre hacia arriba.
    expect(formatAmount("2.345")).toBe("2,34");
    expect(formatAmount("2.355")).toBe("2,36");
    expect(formatAmount("13.54613115387460161790309586190624")).toBe("13,55");
  });

  it("does not render a negative zero", () => {
    expect(formatAmount("-0.001")).toBe("0,00");
    expect(formatSignedAmount("-0.001")).toBe("0,00");
  });

  it("signs a delta only when the shown scale can sustain its direction", () => {
    expect(formatSignedAmount("1.5")).toBe("+1,50");
    expect(formatSignedAmount("-1.5")).toBe("-1,50");
    expect(formatSignedAmount("0")).toBe("0,00");
    expect(formatSignedAmount("0.001")).toBe("0,00");
  });

  it("turns a fractional rate into percentage points without float drift", () => {
    expect(formatPercent("0.09")).toBe("9,00 %");
    expect(formatPercent("0.07")).toBe("7,00 %");
    expect(formatPercent("0.005")).toBe("0,50 %");
    expect(formatPercent("0")).toBe("0,00 %");
  });

  it("shows share counts without decimals", () => {
    expect(formatShares("12500000")).toBe("12.500.000");
  });

  it("renders dates and keeps timestamps in UTC", () => {
    expect(formatCalendarDate("2024-12-31")).toBe("31/12/2024");
    expect(formatUtcTimestamp("2025-02-20T21:00:00.000Z")).toBe(
      "20/02/2025 21:00 UTC",
    );
    expect(formatUtcTimestamp("2025-06-01T00:00:00.000Z")).toBe(
      "01/06/2025 00:00 UTC",
    );
  });

  it("rejects a malformed date or timestamp instead of guessing one", () => {
    for (const operation of [
      () => formatCalendarDate("31/12/2024"),
      () => formatUtcTimestamp("2025-02-20T21:00:00"),
    ]) {
      try {
        operation();
        throw new Error("Expected a rejection.");
      } catch (error) {
        expect(isValuationPolicyError(error, "invalid_decimal")).toBe(true);
      }
    }
  });

  it("rejects a value that is not a canonical decimal", () => {
    try {
      formatAmount("1e5");
      throw new Error("Expected a rejection.");
    } catch (error) {
      expect(isValuationPolicyError(error, "invalid_decimal")).toBe(true);
    }
  });

  it("shortens a hash without losing its ends", () => {
    const hash = "fb0277d0".padEnd(60, "a").concat("8c25");

    expect(shortenHash(hash)).toBe("fb0277d0…8c25");
    expect(shortenHash("short")).toBe("short");
  });
});
