import { describe, expect, it } from "vitest";

import { declaredIndecExpandedIndicator } from "./declared-indec-expanded-indicators";
import {
  publishedMonthlyRateIndicator,
  reconcileLatestIndecMonthlyRate,
} from "./indec-monthly-reconciliation";

const level = declaredIndecExpandedIndicator("ipc_nacional")!;
const rate = publishedMonthlyRateIndicator(level);
const point = (periodOn: string, value: string | null) => ({
  periodOn,
  value,
  note: null,
});

const input = {
  level,
  rate,
  levels: [point("2026-08-01", "12276.766"), point("2026-09-01", "12514.1508")],
  rates: [point("2026-09-01", "1.9")],
};

describe("latest INDEC monthly variation", () => {
  it("reconciles the national IPC level against the published rounded rate", () => {
    const result = reconcileLatestIndecMonthlyRate(input);
    expect(result).toMatchObject({
      status: "matched",
      periodOn: "2026-09-01",
      published: "1.9",
    });
    if (result.status === "matched") {
      expect(Number(result.differencePp)).toBeLessThan(0.051);
    }
  });

  it.each([
    [
      "a future published rate",
      { rates: [point("2026-10-01", "1.9")] },
      "incompatible_period",
    ],
    [
      "a skipped month",
      { levels: [point("2026-07-01", "100"), point("2026-09-01", "101")] },
      "incompatible_period",
    ],
    [
      "a missing value",
      { levels: [point("2026-08-01", "100"), point("2026-09-01", null)] },
      "missing_value",
    ],
    [
      "a zero level",
      { levels: [point("2026-08-01", "0"), point("2026-09-01", "100")] },
      "non_positive_level",
    ],
    [
      "a negative level",
      { levels: [point("2026-08-01", "-1"), point("2026-09-01", "100")] },
      "non_positive_level",
    ],
    [
      "a non-finite rate",
      { rates: [point("2026-09-01", "Infinity")] },
      "invalid_value",
    ],
    [
      "a mismatched publication",
      { rates: [point("2026-09-01", "3.5")] },
      "published_mismatch",
    ],
    [
      "a different currency",
      { rate: { ...rate, currency: "ARS" as const } },
      "incompatible_series",
    ],
  ])("refuses %s", (_label, override, reason) => {
    expect(reconcileLatestIndecMonthlyRate({ ...input, ...override })).toEqual({
      status: "refused",
      reason,
    });
  });
});
