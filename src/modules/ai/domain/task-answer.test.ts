import { describe, expect, it } from "vitest";

import { isTransientAiAnswer } from "./task-answer";

describe("isTransientAiAnswer", () => {
  it("treats a stopped run as no answer: the model never read the evidence", () => {
    expect(
      isTransientAiAnswer({ outcome: "stopped", reason: "breaker_open" }),
    ).toBe(true);
    expect(
      isTransientAiAnswer({ outcome: "stopped", reason: "source_disabled" }),
    ).toBe(true);
  });

  it("treats a dollar cap that kept the call home as no answer", () => {
    expect(
      isTransientAiAnswer({
        outcome: "abstained",
        reason: "ai_budget_exhausted",
      }),
    ).toBe(true);
  });

  it("keeps an answer about the evidence as an answer", () => {
    expect(isTransientAiAnswer({ outcome: "accepted", reason: null })).toBe(
      false,
    );
    expect(isTransientAiAnswer({ outcome: "resolved", reason: null })).toBe(
      false,
    );
    expect(
      isTransientAiAnswer({
        outcome: "abstained",
        reason: "insufficient_evidence",
      }),
    ).toBe(false);
    expect(
      isTransientAiAnswer({ outcome: "abstained", reason: "ladder_exhausted" }),
    ).toBe(false);
  });
});
