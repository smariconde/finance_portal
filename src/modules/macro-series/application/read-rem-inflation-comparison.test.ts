import { describe, expect, it } from "vitest";

import { declaredIndecExpandedIndicator } from "../domain/declared-indec-expanded-indicators";
import { planArgentinaIndicator } from "../domain/plan-argentina-indicator";
import type { RemForecastVintage } from "../domain/plan-rem-release";
import { InMemoryArgentinaIndicatorRepository } from "../infrastructure/in-memory-argentina-indicator-repository";

import type { RemForecastRepository } from "./rem-forecast-repository";
import { readRemInflationComparison } from "./read-rem-inflation-comparison";

const forecast: RemForecastVintage = {
  roundMonth: "2026-10",
  targetMonth: "2026-10",
  revision: 0,
  medianPercent: "1.8",
  publishedOn: "2026-11-05",
  availableAt: "2026-11-06T03:00:00.000Z",
  recordedAt: "2026-11-12T16:00:00.000Z",
  supersededAt: null,
  sourceRunId: "fixture",
};

describe("REM vs observed national IPC", () => {
  it("waits for the observed IPC, then computes error for the same target month", async () => {
    const indicator = declaredIndecExpandedIndicator("ipc_nacional")!;
    const indicators = new InMemoryArgentinaIndicatorRepository();
    await indicators.apply(
      planArgentinaIndicator({
        indicator,
        currentDefinition: null,
        open: [],
        fetched: [
          { periodOn: "2026-09-01", value: "100" },
          { periodOn: "2026-10-01", value: "102" },
        ],
        observedAt: "2026-11-12T12:00:00.000Z",
        recordedAt: "2026-11-12T16:00:00.000Z",
        runId: "fixture-ipc",
        acceptMassChange: false,
      }),
      indicator.id,
    );
    const forecasts: RemForecastRepository = {
      storage: "personal-postgres",
      open: async () => [forecast],
      asKnown: async () => [forecast],
      latestRoundAsKnown: async () => [forecast],
      publish: async () => ({ status: "duplicate", accepted: 0 }),
    };
    const at = (knownAt: string) =>
      readRemInflationComparison({
        knownAt,
        knowledgeBasis: "public_availability",
        forecasts,
        indicators,
      });
    expect((await at("2026-11-11T23:00:00.000Z"))[0]).toMatchObject({
      actual: { status: "unavailable", reason: "missing_period" },
      error: { status: "unavailable", reason: "missing_actual" },
    });
    expect((await at("2026-11-13T00:00:00.000Z"))[0]).toMatchObject({
      actual: { status: "computed", monthlyPercent: "2" },
      error: { status: "computed", errorPp: "0.2" },
    });
  });
});
