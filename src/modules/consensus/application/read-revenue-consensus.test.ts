import { describe, expect, it } from "vitest";

import type { ConsensusRevision } from "../domain/consensus-revisions";
import { readRevenueConsensusAt } from "./read-revenue-consensus";

const SECURITY = "44444444-4444-4444-8444-444444444444";
const FIRST = "2026-11-18T14:00:00.000Z";
const SECOND = "2026-11-19T14:00:00.000Z";

function values(revenueAverage: string) {
  return {
    epsAverage: "2",
    epsHigh: "2.2",
    epsLow: "1.8",
    epsAnalystCount: 10,
    epsAverage7DaysAgo: null,
    epsAverage30DaysAgo: null,
    epsAverage60DaysAgo: null,
    epsAverage90DaysAgo: null,
    epsRevisionsUp7Days: null,
    epsRevisionsDown7Days: null,
    epsRevisionsUp30Days: null,
    epsRevisionsDown30Days: null,
    revenueAverage,
    revenueHigh: "120",
    revenueLow: "90",
    revenueAnalystCount: 8,
  };
}

const revisions: ConsensusRevision[] = [
  {
    securityId: SECURITY,
    periodEnd: "2026-12-31",
    revision: 0,
    values: values("100"),
    availableAt: FIRST,
    supersededAt: SECOND,
    ingestionRunId: "run-1",
  },
  {
    securityId: SECURITY,
    periodEnd: "2026-12-31",
    revision: 1,
    values: values("105"),
    availableAt: SECOND,
    supersededAt: null,
    ingestionRunId: "run-2",
  },
  {
    securityId: SECURITY,
    periodEnd: "2027-12-31",
    revision: 0,
    values: values("110"),
    availableAt: FIRST,
    supersededAt: null,
    ingestionRunId: "run-1",
  },
];

const repository = {
  loadRevisions: async () => revisions,
  captures: async () => [SECOND, FIRST],
};

describe("readRevenueConsensusAt", () => {
  it("reads the revisions in force and the last capture at the cutoff", async () => {
    const before = await readRevenueConsensusAt(
      { securityId: SECURITY, knownAt: "2026-11-18T20:00:00.000Z" },
      repository,
    );

    expect(before.capturedAt).toBe(FIRST);
    expect(before.years).toEqual([
      {
        periodEnd: "2026-12-31",
        revenueAverage: "100",
        revenueLow: "90",
        revenueHigh: "120",
        analystCount: 8,
        availableAt: FIRST,
      },
      expect.objectContaining({ periodEnd: "2027-12-31", availableAt: FIRST }),
    ]);

    const after = await readRevenueConsensusAt(
      { securityId: SECURITY, knownAt: "2026-11-19T20:00:00.000Z" },
      repository,
    );

    // A capture that changed nothing for FY2 still dates the consensus.
    expect(after.capturedAt).toBe(SECOND);
    expect(after.years[0]).toMatchObject({
      revenueAverage: "105",
      availableAt: SECOND,
    });
  });

  it("sees nothing before the first capture", async () => {
    const reading = await readRevenueConsensusAt(
      { securityId: SECURITY, knownAt: "2026-11-17T00:00:00.000Z" },
      repository,
    );

    expect(reading).toEqual({ capturedAt: null, years: [] });
  });
});
