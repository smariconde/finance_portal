import { describe, expect, it } from "vitest";

import { InMemoryPriceRepository } from "@/modules/prices/infrastructure/in-memory-price-repository";

import {
  valuesOf,
  type ConsensusRevision,
} from "../domain/consensus-revisions";
import type { FiscalYearEstimate } from "../domain/earnings-estimates-parser";
import { createInMemoryConsensusRepository } from "../infrastructure/in-memory-consensus-repository";
import { loadForwardMultiples } from "./load-forward-multiples";

const SECURITY = "00000000-0000-4000-8000-000000000001";
const ENTITY = "00000000-0000-4000-8000-0000000000e1";
const RUN = "00000000-0000-4000-8000-0000000000aa";

function estimate(periodEnd: string, epsAverage: string): FiscalYearEstimate {
  return {
    periodEnd,
    epsAverage,
    epsHigh: null,
    epsLow: null,
    epsAnalystCount: 10,
    epsAverage7DaysAgo: null,
    epsAverage30DaysAgo: null,
    epsAverage60DaysAgo: null,
    epsAverage90DaysAgo: null,
    epsRevisionsUp7Days: null,
    epsRevisionsDown7Days: null,
    epsRevisionsUp30Days: null,
    epsRevisionsDown30Days: null,
    revenueAverage: null,
    revenueHigh: null,
    revenueLow: null,
    revenueAnalystCount: null,
  };
}

function revision(
  fetched: FiscalYearEstimate,
  number: number,
  availableAt: string,
  supersededAt: string | null = null,
): ConsensusRevision {
  return {
    securityId: SECURITY,
    periodEnd: fetched.periodEnd,
    revision: number,
    values: valuesOf(fetched),
    availableAt,
    supersededAt,
    ingestionRunId: RUN,
  };
}

async function setup(options: {
  readonly captures: string[];
  readonly revisions: ConsensusRevision[];
  readonly closes: readonly [string, string][];
}) {
  const prices = new InMemoryPriceRepository();
  await prices.writeSeries(
    options.closes.map(([marketDate, close]) => ({
      securityId: SECURITY,
      marketDate,
      close,
      currency: "USD",
    })),
    [],
  );
  const consensus = createInMemoryConsensusRepository({
    revisions: options.revisions,
  });
  return {
    prices,
    consensus: {
      ...consensus,
      captures: async () => options.captures,
    },
  };
}

describe("loadForwardMultiples", () => {
  it("reads today's P/E on the last close and each point with what was known then", async () => {
    const dependencies = await setup({
      captures: ["2026-11-16T15:00:00.000Z", "2026-11-18T15:00:00.000Z"],
      revisions: [
        revision(
          estimate("2026-12-31", "5"),
          0,
          "2026-11-16T15:00:00.000Z",
          "2026-11-18T15:00:00.000Z",
        ),
        revision(estimate("2026-12-31", "10"), 1, "2026-11-18T15:00:00.000Z"),
        revision(estimate("2027-12-31", "10"), 0, "2026-11-16T15:00:00.000Z"),
      ],
      closes: [
        ["2026-11-13", "100"],
        ["2026-11-16", "100"],
        ["2026-11-17", "100"],
        ["2026-11-18", "100"],
      ],
    });

    const view = await loadForwardMultiples(
      {
        securityId: SECURITY,
        legalEntityId: ENTITY,
        now: "2026-11-18T23:00:00.000Z",
      },
      dependencies,
    );

    // Today: FY1 10 and FY2 10, so NTM is 10 and the P/E is 10.
    expect(view.current.forwardPe).toBe("10");
    expect(view.years.map((year) => year.values.epsAverage)).toEqual([
      "10",
      "10",
    ]);
    // The 13th precedes the first capture: no point. The 16th and 17th saw
    // FY1 at 5; the 18th's session settled after the second capture.
    expect(view.history.map((point) => point.marketDate)).toEqual([
      "2026-11-16",
      "2026-11-17",
      "2026-11-18",
    ]);
    expect(Number(view.history[0]!.forwardPe)).toBeGreaterThan(10);
    expect(view.history[2]!.forwardPe).toBe("10");
    expect(view.firstCaptureAt).toBe("2026-11-16T15:00:00.000Z");
    expect(view.threshold).toBeNull();
  });

  it("is empty with a reason before any capture, and reads the owner's last threshold", async () => {
    const dependencies = await setup({
      captures: [],
      revisions: [],
      closes: [["2026-11-18", "100"]],
    });
    await dependencies.consensus.declareThreshold({
      thresholdId: "00000000-0000-4000-8000-0000000000t1",
      legalEntityId: ENTITY,
      metric: "forward_pe",
      value: "12",
      reason: null,
      declaredAt: "2026-11-17T00:00:00.000Z",
    });
    const view = await loadForwardMultiples(
      {
        securityId: SECURITY,
        legalEntityId: ENTITY,
        now: "2026-11-18T23:00:00.000Z",
      },
      dependencies,
    );
    expect(view.current.forwardPeReason).toBe("no_consensus");
    expect(view.history).toEqual([]);
    expect(view.threshold?.value).toBe("12");

    await dependencies.consensus.declareThreshold({
      thresholdId: "00000000-0000-4000-8000-0000000000t2",
      legalEntityId: ENTITY,
      metric: "forward_pe",
      value: null,
      reason: null,
      declaredAt: "2026-11-18T00:00:00.000Z",
    });
    expect(
      (
        await loadForwardMultiples(
          {
            securityId: SECURITY,
            legalEntityId: ENTITY,
            now: "2026-11-18T23:00:00.000Z",
          },
          dependencies,
        )
      ).threshold,
    ).toBeNull();
  });

  it("keeps showing today's consensus when the last close is weeks old", async () => {
    const dependencies = await setup({
      captures: ["2026-11-18T15:00:00.000Z"],
      revisions: [
        revision(estimate("2026-12-31", "5"), 0, "2026-11-18T15:00:00.000Z"),
        revision(estimate("2027-12-31", "6"), 0, "2026-11-18T15:00:00.000Z"),
      ],
      closes: [["2026-09-30", "100"]],
    });
    const view = await loadForwardMultiples(
      {
        securityId: SECURITY,
        legalEntityId: ENTITY,
        now: "2026-11-18T23:00:00.000Z",
      },
      dependencies,
    );
    expect(view.current.closeDate).toBe("2026-09-30");
    expect(view.current.forwardPeReason).toBe("stale_consensus");
    expect(view.years.map((year) => year.periodEnd)).toEqual([
      "2026-12-31",
      "2027-12-31",
    ]);
    expect(view.history).toEqual([]);
  });
});
