import { describe, expect, it } from "vitest";

import {
  consensusAt,
  ConsensusRevisionError,
  planConsensusRevisions,
  valuesOf,
  type ConsensusRevision,
} from "./consensus-revisions";
import type { FiscalYearEstimate } from "./earnings-estimates-parser";

const SECURITY = "00000000-0000-4000-8000-000000000001";
const RUN = "00000000-0000-4000-8000-0000000000aa";

function estimate(
  periodEnd: string,
  epsAverage: string,
  overrides: Partial<FiscalYearEstimate> = {},
): FiscalYearEstimate {
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
    ...overrides,
  };
}

function stored(
  fetched: FiscalYearEstimate,
  revision: number,
  availableAt: string,
): ConsensusRevision {
  return {
    securityId: SECURITY,
    periodEnd: fetched.periodEnd,
    revision,
    values: valuesOf(fetched),
    availableAt,
    supersededAt: null,
    ingestionRunId: RUN,
  };
}

describe("planConsensusRevisions", () => {
  it("opens both chains on the first capture", () => {
    const plan = planConsensusRevisions({
      securityId: SECURITY,
      open: [],
      fetched: [estimate("2026-12-31", "5"), estimate("2027-12-31", "6")],
      observedAt: "2026-11-18T15:00:00.000Z",
    });
    expect(plan.inserts.map((row) => [row.periodEnd, row.revision])).toEqual([
      ["2026-12-31", 0],
      ["2027-12-31", 0],
    ]);
    expect(plan.supersede).toEqual([]);
  });

  it("writes nothing when no number moved", () => {
    const fy1 = estimate("2026-12-31", "5");
    const plan = planConsensusRevisions({
      securityId: SECURITY,
      open: [stored(fy1, 0, "2026-11-17T15:00:00.000Z")],
      fetched: [fy1],
      observedAt: "2026-11-18T15:00:00.000Z",
    });
    expect(plan).toEqual({
      inserts: [],
      supersede: [],
      unchanged: 1,
      withdrawn: 0,
    });
  });

  it("opens a revision when any number moves, the analyst count included", () => {
    const fy1 = estimate("2026-12-31", "5");
    const plan = planConsensusRevisions({
      securityId: SECURITY,
      open: [stored(fy1, 3, "2026-11-17T15:00:00.000Z")],
      fetched: [{ ...fy1, epsAnalystCount: 11 }],
      observedAt: "2026-11-18T15:00:00.000Z",
    });
    expect(plan.supersede).toEqual([{ periodEnd: "2026-12-31", revision: 3 }]);
    expect(plan.inserts[0]).toMatchObject({
      revision: 4,
      availableAt: "2026-11-18T15:00:00.000Z",
    });
  });

  it("withdraws a fiscal year that stops coming, once", () => {
    const fy1 = estimate("2026-12-31", "5");
    const fy2 = estimate("2027-12-31", "6");
    const fy3 = estimate("2028-12-31", "7");
    const plan = planConsensusRevisions({
      securityId: SECURITY,
      open: [
        stored(fy1, 0, "2026-11-17T15:00:00.000Z"),
        stored(fy2, 0, "2026-11-17T15:00:00.000Z"),
      ],
      fetched: [fy2, fy3],
      observedAt: "2027-02-01T15:00:00.000Z",
    });
    expect(plan.withdrawn).toBe(1);
    expect(plan.inserts).toMatchObject([
      { periodEnd: "2026-12-31", revision: 1, values: null },
      { periodEnd: "2028-12-31", revision: 0 },
    ]);

    const again = planConsensusRevisions({
      securityId: SECURITY,
      open: [
        {
          ...stored(fy1, 1, "2027-02-01T15:00:00.000Z"),
          values: null,
        },
        stored(fy2, 0, "2026-11-17T15:00:00.000Z"),
        stored(fy3, 0, "2027-02-01T15:00:00.000Z"),
      ],
      fetched: [fy2, fy3],
      observedAt: "2027-02-02T15:00:00.000Z",
    });
    expect(again.inserts).toEqual([]);
  });

  it("reopens a withdrawn fiscal year that comes back", () => {
    const fy1 = estimate("2026-12-31", "5");
    const plan = planConsensusRevisions({
      securityId: SECURITY,
      open: [{ ...stored(fy1, 1, "2027-01-02T15:00:00.000Z"), values: null }],
      fetched: [fy1],
      observedAt: "2027-01-03T15:00:00.000Z",
    });
    expect(plan.inserts).toMatchObject([
      { revision: 2, values: { epsAverage: "5" } },
    ]);
  });

  it("refuses a capture that is not after the open revision", () => {
    const fy1 = estimate("2026-12-31", "5");
    expect(() =>
      planConsensusRevisions({
        securityId: SECURITY,
        open: [stored(fy1, 0, "2026-11-18T15:00:00.000Z")],
        fetched: [{ ...fy1, epsAverage: "6" }],
        observedAt: "2026-11-18T15:00:00.000Z",
      }),
    ).toThrow(ConsensusRevisionError);
  });
});

describe("consensusAt", () => {
  it("reads the revision visible at the instant and hides withdrawals", () => {
    const fy1 = estimate("2026-12-31", "5");
    const revisions: ConsensusRevision[] = [
      {
        ...stored(fy1, 0, "2026-11-17T15:00:00.000Z"),
        supersededAt: "2026-11-18T15:00:00.000Z",
      },
      {
        ...stored({ ...fy1, epsAverage: "5.5" }, 1, "2026-11-18T15:00:00.000Z"),
        supersededAt: "2027-02-01T15:00:00.000Z",
      },
      {
        ...stored(fy1, 2, "2027-02-01T15:00:00.000Z"),
        values: null,
      },
    ];
    expect(consensusAt(revisions, "2026-11-17T14:59:59.999Z")).toEqual([]);
    expect(
      consensusAt(revisions, "2026-11-18T14:59:59.999Z")[0]?.values.epsAverage,
    ).toBe("5");
    expect(
      consensusAt(revisions, "2026-11-18T15:00:00.000Z")[0]?.values.epsAverage,
    ).toBe("5.5");
    expect(consensusAt(revisions, "2027-02-01T15:00:00.000Z")).toEqual([]);
  });
});
