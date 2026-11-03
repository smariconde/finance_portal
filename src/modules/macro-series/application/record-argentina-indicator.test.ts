import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createInMemoryIngestionRunRepository } from "@/modules/ingestion/infrastructure/in-memory-ingestion-run-repository";

import { readIndicatorVintages } from "../domain/argentina-indicator";
import { DECLARED_ARGENTINA_INDICATORS } from "../domain/declared-argentina-indicators";
import { InMemoryArgentinaIndicatorRepository } from "../infrastructure/in-memory-argentina-indicator-repository";

import {
  recordArgentinaIndicator,
  type ArgentinaIndicatorSource,
} from "./record-argentina-indicator";

const indicator = DECLARED_ARGENTINA_INDICATORS[0]!;

function months(count: number, value = (index: number) => String(100 + index)) {
  return Array.from({ length: count }, (_, index) => ({
    periodOn: `${2020 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`,
    value: value(index),
  }));
}

function setup() {
  let points = months(24);
  let tick = Date.parse("2026-11-03T12:00:00.000Z");
  const clock = () => {
    tick += 1000;
    return new Date(tick).toISOString();
  };
  const source: ArgentinaIndicatorSource = {
    sourceId: indicator.sourceId,
    datasetId: "argentina.series-observations",
    parserVersion: "argentina-series-api-1.0.0",
    async load() {
      return { points, observedAt: clock(), requests: 1, bytes: 100 };
    },
  };
  const repository = new InMemoryArgentinaIndicatorRepository();
  const ingestionRuns = createInMemoryIngestionRunRepository();
  const dependencies = {
    sources: [source],
    repository,
    ingestionRuns,
    now: clock,
    newId: () => randomUUID(),
  };
  return {
    repository,
    ingestionRuns,
    dependencies,
    setPoints(next: typeof points) {
      points = next;
    },
  };
}

describe("recordArgentinaIndicator", () => {
  it("records the definition and history once, then a duplicate run", async () => {
    const { repository, dependencies } = setup();

    const first = await recordArgentinaIndicator(indicator, dependencies);
    expect(first.runStatus).toBe("succeeded");
    expect(first.plan.counts.new).toBe(24);
    expect((await repository.currentDefinition(indicator.id))?.revision).toBe(
      0,
    );

    const second = await recordArgentinaIndicator(indicator, dependencies);
    expect(second.runStatus).toBe("duplicate");
    expect(second.plan.counts.unchanged).toBe(24);
    expect(await repository.allObservations(indicator.id)).toHaveLength(24);
  });

  it("keeps the earlier value visible before a revision was observed", async () => {
    const { repository, dependencies, setPoints } = setup();
    const first = await recordArgentinaIndicator(indicator, dependencies);
    setPoints(
      months(24, (index) => (index === 23 ? "999.5" : String(100 + index))),
    );
    const second = await recordArgentinaIndicator(indicator, dependencies);
    expect(second.plan.counts.revised).toBe(1);

    const all = await repository.allObservations(indicator.id);
    const before = readIndicatorVintages(indicator, all, {
      effectiveOn: "2026-11-03",
      knownAt: first.fetched.observedAt,
      knowledgeBasis: "public_availability",
    });
    const after = readIndicatorVintages(indicator, all, {
      effectiveOn: "2026-11-03",
      knownAt: second.fetched.observedAt,
      knowledgeBasis: "public_availability",
    });
    expect(before.at(-1)?.value).toBe("123");
    expect(after.at(-1)).toMatchObject({ value: "999.5", revision: 1 });
  });

  it("withdraws a date the source stops carrying instead of zeroing it", async () => {
    const { repository, dependencies, setPoints } = setup();
    await recordArgentinaIndicator(indicator, dependencies);
    setPoints(months(23));
    const outcome = await recordArgentinaIndicator(indicator, dependencies);
    expect(outcome.plan.counts.withdrawn).toBe(1);
    const open = await repository.openObservations(indicator.id);
    expect(open.at(-1)).toMatchObject({
      value: null,
      missingReason: "withdrawn",
    });
  });

  it("quarantines a mass change and publishes it only when the owner accepts", async () => {
    const { repository, ingestionRuns, dependencies, setPoints } = setup();
    await recordArgentinaIndicator(indicator, dependencies);
    setPoints(months(24, (index) => String(200 + index)));

    const refused = await recordArgentinaIndicator(indicator, dependencies);
    expect(refused.runStatus).toBe("quarantined");
    expect((await repository.openObservations(indicator.id))[0]?.value).toBe(
      "100",
    );
    const run = (
      await ingestionRuns.list({ sourceId: indicator.sourceId })
    ).find((row) => row.runId === refused.runId);
    expect(run?.qualityFlags).toContain("mass_change_guard");

    const accepted = await recordArgentinaIndicator(indicator, {
      ...dependencies,
      acceptMassChange: true,
    });
    expect(accepted.runStatus).toBe("succeeded");
    expect((await repository.openObservations(indicator.id))[0]?.value).toBe(
      "200",
    );
  });

  it("writes nothing on a dry run", async () => {
    const { repository, ingestionRuns, dependencies } = setup();
    const outcome = await recordArgentinaIndicator(indicator, {
      ...dependencies,
      dryRun: true,
    });
    expect(outcome.runId).toBeNull();
    expect(outcome.plan.counts.new).toBe(24);
    expect(await repository.allObservations(indicator.id)).toHaveLength(0);
    expect(
      await ingestionRuns.list({ sourceId: indicator.sourceId }),
    ).toHaveLength(0);
  });

  it("refuses an indicator whose source is not wired", async () => {
    const { dependencies } = setup();
    await expect(
      recordArgentinaIndicator(indicator, { ...dependencies, sources: [] }),
    ).rejects.toThrow("source_not_wired");
  });
});
