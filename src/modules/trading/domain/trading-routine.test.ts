import { describe, expect, it } from "vitest";

import {
  routineItemLabelSchema,
  routineNoteSchema,
  routineSessionOf,
  sameRoutineEntry,
  sessionSchema,
  stepRoutineSession,
} from "./trading-routine";

describe("routine-session-1.0.0", () => {
  it("is today's New York session on a weekday", () => {
    // 21:30 de Buenos Aires del jueves sigue siendo jueves en Nueva York.
    expect(routineSessionOf("2026-11-13T00:30:00.000Z")).toBe("2026-11-12");
    expect(routineSessionOf("2026-11-13T15:00:00.000Z")).toBe("2026-11-13");
  });

  it("is next Monday on a weekend, the one being prepared", () => {
    expect(routineSessionOf("2026-11-14T15:00:00.000Z")).toBe("2026-11-16");
    expect(routineSessionOf("2026-11-15T23:00:00.000Z")).toBe("2026-11-16");
  });

  it("steps over weekends and never past the current routine", () => {
    const now = "2026-11-14T15:00:00.000Z";
    expect(stepRoutineSession("2026-11-16", -1, now)).toBe("2026-11-13");
    expect(stepRoutineSession("2026-11-13", 1, now)).toBe("2026-11-16");
    expect(stepRoutineSession("2026-11-16", 1, now)).toBeNull();
  });
});

describe("trading-routine-1.0.0", () => {
  it("accepts a real date only", () => {
    expect(sessionSchema.safeParse("2026-11-16").success).toBe(true);
    expect(sessionSchema.safeParse("2026-02-30").success).toBe(false);
    expect(sessionSchema.safeParse("16/11/2026").success).toBe(false);
  });

  it("cleans item labels and refuses markup", () => {
    expect(routineItemLabelSchema.parse("  Pérdida  máxima: 2 %  ")).toBe(
      "Pérdida máxima: 2 %",
    );
    expect(routineItemLabelSchema.safeParse("<b>x</b>").success).toBe(false);
    expect(routineItemLabelSchema.safeParse("x").success).toBe(false);
  });

  it("caps the note and keeps it as plain text", () => {
    expect(routineNoteSchema.parse("<script>x</script>")).toBe(
      "<script>x</script>",
    );
    expect(routineNoteSchema.safeParse("x".repeat(2001)).success).toBe(false);
  });

  it("compares checks in order and the note", () => {
    const entry = { checked: ["a", "b"], note: "" };
    expect(sameRoutineEntry(entry, { checked: ["a", "b"], note: "" })).toBe(
      true,
    );
    expect(sameRoutineEntry(entry, { checked: ["b", "a"], note: "" })).toBe(
      false,
    );
    expect(sameRoutineEntry(entry, { checked: ["a", "b"], note: "x" })).toBe(
      false,
    );
  });
});
