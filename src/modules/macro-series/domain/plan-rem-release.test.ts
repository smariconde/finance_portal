import { describe, expect, it } from "vitest";

import { planRemRelease, type RemForecastVintage } from "./plan-rem-release";

const base = {
  roundMonth: "2026-10",
  publishedOn: "2026-11-05",
  availableAt: "2026-11-06T03:00:00.000Z",
  recordedAt: "2026-11-12T16:00:00.000Z",
  runId: "a2d3fb3c-3bcd-4f63-a08a-3d0ade7d1148",
  forecasts: [
    { roundMonth: "2026-10", targetMonth: "2026-10", medianPercent: "1.8" },
    { roundMonth: "2026-10", targetMonth: "2026-11", medianPercent: "1.9" },
  ],
} as const;
const open: RemForecastVintage[] = base.forecasts.map((forecast) => ({
  ...forecast,
  revision: 0,
  publishedOn: base.publishedOn,
  availableAt: base.availableAt,
  recordedAt: base.recordedAt,
  supersededAt: null,
  sourceRunId: base.runId,
}));

describe("REM release revision plan", () => {
  it("publishes original values at the official availability, not the download", () => {
    const plan = planRemRelease({ ...base, open: [] });
    expect(plan.observations).toHaveLength(2);
    expect(plan.observations[0]).toMatchObject({
      targetMonth: "2026-10",
      revision: 0,
      availableAt: "2026-11-06T03:00:00.000Z",
    });
  });

  it("keeps duplicates out and dates a correction when observed", () => {
    expect(planRemRelease({ ...base, open })).toMatchObject({
      observations: [],
      unchanged: 2,
    });
    const changed = planRemRelease({
      ...base,
      open,
      forecasts: [
        base.forecasts[0]!,
        { ...base.forecasts[1]!, medianPercent: "2.1" },
      ],
    });
    expect(changed.observations).toMatchObject([
      {
        targetMonth: "2026-11",
        revision: 1,
        medianPercent: "2.1",
        availableAt: base.recordedAt,
      },
    ]);
  });

  it("refuses missing targets, duplicate identities, non-finite values and backward time", () => {
    expect(() =>
      planRemRelease({ ...base, open, forecasts: [base.forecasts[0]!] }),
    ).toThrow("rem_target_set_changed");
    expect(() =>
      planRemRelease({
        ...base,
        open: [],
        forecasts: [base.forecasts[0]!, base.forecasts[0]!],
      }),
    ).toThrow("rem_forecast_identity_invalid");
    expect(() =>
      planRemRelease({
        ...base,
        open: [],
        forecasts: [{ ...base.forecasts[0]!, medianPercent: "Infinity" }],
      }),
    ).toThrow();
    expect(() =>
      planRemRelease({
        ...base,
        recordedAt: base.availableAt,
        open,
        forecasts: [
          { ...base.forecasts[0]!, medianPercent: "2" },
          base.forecasts[1]!,
        ],
      }),
    ).toThrow("rem_non_monotone_revision");
  });
});
