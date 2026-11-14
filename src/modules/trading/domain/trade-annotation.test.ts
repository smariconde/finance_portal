import { describe, expect, it } from "vitest";

import {
  adherenceTally,
  EMPTY_ANNOTATION,
  notesSchema,
  NOTES_MAX,
  plannedRewardRisk,
  plannedStopOf,
  priceInR,
  priceInputSchema,
  quantityInputSchema,
  sameAnnotation,
  tradeAnnotationSchema,
  tradeKeyFromRef,
  tradeKeyOf,
  tradeRefOf,
} from "./trade-annotation";

const ACCOUNT = "c".repeat(64);
const plan = { entry: null, stop: null, target: null, quantity: null };

describe("owner price and quantity input", () => {
  it("accepts a comma or a dot and comes out canonical", () => {
    expect(priceInputSchema.parse("123,450")).toBe("123.45");
    expect(priceInputSchema.parse(" 9.75 ")).toBe("9.75");
    expect(priceInputSchema.parse("10")).toBe("10");
    expect(quantityInputSchema.parse("0.5")).toBe("0.5");
  });

  it("reads an empty field as null, never zero", () => {
    expect(priceInputSchema.parse("")).toBeNull();
    expect(priceInputSchema.parse("   ")).toBeNull();
  });

  it("refuses zero, signs, exponents, thousands separators and non-finite text", () => {
    for (const value of [
      "0",
      "0,00",
      "-5",
      "+5",
      "1e3",
      "1.000,50",
      "1,000.50",
      "Infinity",
      "NaN",
      "12.1234567",
      "abc",
    ]) {
      expect(priceInputSchema.safeParse(value).success, value).toBe(false);
    }
  });
});

describe("notes", () => {
  it("keeps hostile markup as plain text: rendering escapes it (TM-12)", () => {
    const hostile =
      '<img src=x onerror="alert(1)"> **negrita** [x](javascript:1)';
    expect(notesSchema.parse(hostile)).toBe(hostile);
  });

  it("normalizes line endings and trailing space", () => {
    expect(notesSchema.parse("uno\r\ndos\rtres  \n")).toBe("uno\ndos\ntres");
  });

  it("refuses control characters and bidi overrides", () => {
    expect(notesSchema.safeParse("a\u0000b").success).toBe(false);
    expect(notesSchema.safeParse("precio ‮evil").success).toBe(false);
    expect(notesSchema.safeParse("tab\tok\nline").success).toBe(true);
  });

  it("caps the length", () => {
    expect(notesSchema.safeParse("x".repeat(NOTES_MAX)).success).toBe(true);
    expect(notesSchema.safeParse("x".repeat(NOTES_MAX + 1)).success).toBe(
      false,
    );
  });
});

describe("trade keys", () => {
  const trade = { accountKey: ACCOUNT, tradeId: `${ACCOUNT}:schwab:3001:41` };

  it("drops the account and round-trips through the URL segment", () => {
    const key = tradeKeyOf(trade);
    expect(key).toBe("schwab:3001:41");
    expect(tradeRefOf(key)).toBe("3001-41");
    expect(tradeKeyFromRef("3001-41")).toBe(key);
  });

  it("marks a trade opened before the history", () => {
    const key = tradeKeyOf({ ...trade, tradeId: `${trade.tradeId}:before` });
    expect(tradeRefOf(key)).toBe("3001-41-b");
    expect(tradeKeyFromRef("3001-41-b")).toBe(key);
  });

  it("refuses a segment that is not two Schwab IDs", () => {
    for (const ref of [
      "3001",
      "3001-41-x",
      "../41",
      "AAPL-1",
      "3001-41-b-b",
      "",
    ]) {
      expect(tradeKeyFromRef(ref), ref).toBeNull();
    }
  });

  it("refuses a trade of another account", () => {
    expect(() =>
      tradeKeyOf({ accountKey: "d".repeat(64), tradeId: trade.tradeId }),
    ).toThrow();
  });
});

describe("annotation", () => {
  it("is closed: an unknown field or emotion does not parse", () => {
    expect(
      tradeAnnotationSchema.safeParse({ ...EMPTY_ANNOTATION, html: "<b>" })
        .success,
    ).toBe(false);
    expect(
      tradeAnnotationSchema.safeParse({ ...EMPTY_ANNOTATION, emotion: "greed" })
        .success,
    ).toBe(false);
  });

  it("compares field by field", () => {
    const a = { ...EMPTY_ANNOTATION, plan: { ...plan, stop: "9.5" } };
    expect(sameAnnotation(a, { ...a, plan: { ...plan, stop: "9.5" } })).toBe(
      true,
    );
    expect(sameAnnotation(a, { ...a, plan: { ...plan, stop: "9.4" } })).toBe(
      false,
    );
    expect(sameAnnotation(a, { ...a, notes: "x" })).toBe(false);
  });

  it("gives R its stop only when one was planned", () => {
    expect(plannedStopOf(null, "USD")).toBeNull();
    expect(plannedStopOf(EMPTY_ANNOTATION, "USD")).toBeNull();
    expect(
      plannedStopOf(
        { ...EMPTY_ANNOTATION, plan: { ...plan, stop: "9.5" } },
        "USD",
      ),
    ).toEqual({ price: "9.5", currency: "USD" });
  });

  it("tallies adherence rule by rule", () => {
    expect(
      adherenceTally({
        ...EMPTY_ANNOTATION,
        adherence: {
          entry: "kept",
          stop: "broken",
          target: null,
          size: "kept",
        },
      }),
    ).toEqual({ kept: 2, broken: 1, unmarked: 1 });
  });
});

describe("planned reward to risk (trade-plan-1.0.0)", () => {
  it("uses the planned entry and names it", () => {
    expect(
      plannedRewardRisk(
        "long",
        { ...plan, entry: "10", stop: "9", target: "13" },
        "10.2",
      ),
    ).toEqual({ value: "3", entryBasis: "plan", reason: null });
  });

  it("falls back to the average entry of the fills", () => {
    expect(
      plannedRewardRisk("short", { ...plan, stop: "11", target: "8" }, "10"),
    ).toEqual({ value: "2", entryBasis: "fills", reason: null });
  });

  it("is null with a reason, never zero or infinite", () => {
    expect(plannedRewardRisk("long", plan, "10").reason).toBe("no_stop");
    expect(plannedRewardRisk("long", { ...plan, stop: "9" }, "10").reason).toBe(
      "no_target",
    );
    expect(
      plannedRewardRisk("long", { ...plan, stop: "9", target: "12" }, null)
        .reason,
    ).toBe("entry_unknown");
    expect(
      plannedRewardRisk("long", { ...plan, stop: "10", target: "12" }, "10")
        .reason,
    ).toBe("stop_on_wrong_side");
    expect(
      plannedRewardRisk("long", { ...plan, stop: "11", target: "12" }, "10")
        .reason,
    ).toBe("stop_on_wrong_side");
    expect(
      plannedRewardRisk("short", { ...plan, stop: "11", target: "12" }, "10")
        .reason,
    ).toBe("target_on_wrong_side");
  });
});

describe("price in R (trade-plan-1.0.0)", () => {
  it("puts the stop at -1 R on either side", () => {
    expect(priceInR("long", "10", "9", "9")).toBe("-1");
    expect(priceInR("short", "10", "11", "11")).toBe("-1");
    expect(priceInR("long", "10", "9", "12.5")).toBe("2.5");
    expect(priceInR("short", "10", "11", "8")).toBe("2");
    expect(priceInR("long", "10", "9", "10")).toBe("0");
  });

  it("is null without a stop, an entry or a stop on the right side", () => {
    expect(priceInR("long", "10", null, "11")).toBeNull();
    expect(priceInR("long", null, "9", "11")).toBeNull();
    expect(priceInR("long", "10", "10", "11")).toBeNull();
    expect(priceInR("long", "10", "11", "11")).toBeNull();
    expect(priceInR("short", "10", "9", "11")).toBeNull();
  });
});
