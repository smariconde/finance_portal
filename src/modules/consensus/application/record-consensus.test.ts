import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { IngestionRun } from "@/modules/ingestion/domain/ingestion-run";
import { createInMemoryIngestionRunRepository } from "@/modules/ingestion/infrastructure/in-memory-ingestion-run-repository";

import { parseEarningsEstimates } from "../domain/earnings-estimates-parser";
import {
  fixtureEstimateRow,
  fixtureEstimatesBody,
  fixtureTwoFiscalYearsBody,
} from "../infrastructure/fixture-earnings-estimates";
import { createInMemoryConsensusRepository } from "../infrastructure/in-memory-consensus-repository";
import type { ConsensusSource } from "./live-consensus-source";
import { recordConsensus } from "./record-consensus";

const SECURITY = "00000000-0000-4000-8000-000000000001";

function harness(bodies: string[], instants: string[]) {
  const appended: IngestionRun[] = [];
  const base = createInMemoryIngestionRunRepository();
  const ingestionRuns = {
    ...base,
    async append(run: IngestionRun) {
      const stored = await base.append(run);
      appended.push(stored);
      return stored;
    },
  };
  const repository = createInMemoryConsensusRepository({
    runs: () => appended,
  });
  let ids = 0;
  let clock = 0;
  const observed = [...instants];
  const source: ConsensusSource = {
    sourceId: "alpha-vantage",
    parserVersion: "av-earnings-estimates-1.0.0",
    async load(symbol) {
      const body = bodies.shift();
      const observedAt = observed.shift();
      if (body === undefined || observedAt === undefined) {
        throw new Error("unexpected fetch");
      }
      const parsed = parseEarningsEstimates(body, symbol);
      if (!parsed.ok) throw new Error(parsed.reason);
      return {
        symbol,
        fiscalYears: parsed.fiscalYears,
        quartersDropped: parsed.quartersDropped,
        observedAt,
        byteLength: body.length,
      };
    },
  };
  const dependencies = {
    source,
    repository,
    ingestionRuns,
    now: () => new Date(Date.UTC(2026, 10, 18, 15, 0, clock++)).toISOString(),
    newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
    hashContent: (input: string) =>
      createHash("sha256").update(input).digest("hex"),
  };
  return { dependencies, repository, appended };
}

describe("recordConsensus", () => {
  it("records the first capture, then a duplicate run that still dates it", async () => {
    const { dependencies, repository, appended } = harness(
      [fixtureTwoFiscalYearsBody("AAPL"), fixtureTwoFiscalYearsBody("AAPL")],
      ["2026-11-18T15:00:00.000Z", "2026-11-19T15:00:00.000Z"],
    );
    const command = { securityId: SECURITY, symbol: "AAPL" };

    const first = await recordConsensus(command, dependencies);
    expect(first.runStatus).toBe("succeeded");
    expect(first.plan.inserts).toHaveLength(2);
    expect(first.quartersDropped).toBe(2);
    expect(repository.all()).toHaveLength(2);

    const second = await recordConsensus(command, dependencies);
    expect(second.runStatus).toBe("duplicate");
    expect(repository.all()).toHaveLength(2);
    expect(appended.map((run) => [run.status, run.subjectKey])).toEqual([
      ["succeeded", SECURITY],
      ["duplicate", SECURITY],
    ]);
    expect(await repository.captures(SECURITY)).toHaveLength(2);
  });

  it("supersedes a moved fiscal year and withdraws one that stopped coming", async () => {
    const { dependencies, repository } = harness(
      [
        fixtureTwoFiscalYearsBody("AAPL"),
        fixtureEstimatesBody("AAPL", [
          fixtureEstimateRow({
            date: "2027-12-31",
            eps_estimate_average: "6.2000",
            eps_estimate_high: "6.6000",
            eps_estimate_low: "5.4000",
          }),
          fixtureEstimateRow({
            date: "2028-12-31",
            eps_estimate_average: "7.0000",
            eps_estimate_high: "7.5000",
            eps_estimate_low: "6.5000",
          }),
        ]),
      ],
      ["2026-11-18T15:00:00.000Z", "2027-02-01T15:00:00.000Z"],
    );
    const command = { securityId: SECURITY, symbol: "AAPL" };
    await recordConsensus(command, dependencies);
    const second = await recordConsensus(command, dependencies);

    expect(second.runStatus).toBe("succeeded");
    expect(second.plan.withdrawn).toBe(1);
    const open = await repository.loadOpen(SECURITY);
    expect(
      open
        .map((row) => [row.periodEnd, row.revision, row.values?.epsAverage])
        .sort(),
    ).toEqual([
      ["2026-12-31", 1, undefined],
      ["2027-12-31", 1, "6.2"],
      ["2028-12-31", 0, "7"],
    ]);
  });

  it("writes nothing on a dry run", async () => {
    const { dependencies, repository, appended } = harness(
      [fixtureTwoFiscalYearsBody("AAPL")],
      ["2026-11-18T15:00:00.000Z"],
    );
    const outcome = await recordConsensus(
      { securityId: SECURITY, symbol: "AAPL" },
      { ...dependencies, dryRun: true },
    );
    expect(outcome.runId).toBeNull();
    expect(outcome.plan.inserts).toHaveLength(2);
    expect(repository.all()).toHaveLength(0);
    expect(appended).toHaveLength(0);
  });
});
