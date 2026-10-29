import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import {
  VALUATION_DATA_RULE_VERSION,
  type ValuationDataStep,
} from "../domain/valuation-data-step";
import { VALUATION_QUALITATIVE_RULE_VERSION } from "../domain/valuation-qualitative-step";
import {
  addMilliseconds,
  outcomeForAssessment,
  outcomeForDataStep,
  outcomeForIdentity,
  outcomeForQualitativeStep,
  queueValuationJob,
  VALUATION_JOB_STALE_AFTER_MS,
} from "../domain/valuation-job";
import {
  ValuationJobConflictError,
  type ValuationJobStore,
} from "./valuation-job-store";

/**
 * Contrato del almacén de corridas por ticker (ADR 0045), corrido contra el
 * doble en memoria y contra PostgreSQL. Cada caso usa un ticker propio.
 */
export type ValuationJobStoreContractHarness = {
  readonly store: ValuationJobStore;
  /** Una corrida que el almacén puede referenciar: en PostgreSQL, una fila real. */
  readonly recordRun: () => Promise<string>;
};

const T0 = "2026-10-21T15:00:00.000Z";

function ticker(): string {
  return `T${randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase()}`;
}

export function describeValuationJobStoreContract(
  label: string,
  harness: () => ValuationJobStoreContractHarness,
): void {
  describe(`valuation job store (${label})`, () => {
    let store: ValuationJobStore;
    let recordRun: () => Promise<string>;

    beforeEach(() => {
      ({ store, recordRun } = harness());
    });

    it("lista sólo los terminados del ticker, el más nuevo primero y con techo", async () => {
      const symbol = ticker();
      const ids: string[] = [];

      for (let index = 0; index < 3; index += 1) {
        const at = addMilliseconds(T0, index * 1_000);
        const job = queueValuationJob({
          jobId: randomUUID(),
          ticker: symbol,
          knownAt: at,
          createdAt: at,
        });
        const token = randomUUID();
        await store.insert(job);
        await store.claim({
          jobId: job.jobId,
          startedAt: at,
          claimToken: token,
          staleBefore: at,
        });
        await store.finish({
          jobId: job.jobId,
          claimToken: token,
          finishedAt: at,
          outcome: outcomeForIdentity("not_found"),
        });
        ids.push(job.jobId);
      }

      await store.insert(
        queueValuationJob({
          jobId: randomUUID(),
          ticker: symbol,
          knownAt: addMilliseconds(T0, 5_000),
          createdAt: addMilliseconds(T0, 5_000),
        }),
      );

      expect(
        (await store.listCompletedByTicker(symbol, 20)).map((job) => job.jobId),
      ).toEqual([...ids].reverse());
      expect(await store.listCompletedByTicker(symbol, 2)).toHaveLength(2);
      expect(await store.listCompletedByTicker(symbol, 10_000)).toHaveLength(3);
      expect(await store.listCompletedByTicker(ticker(), 20)).toEqual([]);
    });

    it("cierra con la corrida registrada y con el motivo del snapshot (1.1.0)", async () => {
      const reading = {
        legalEntityId: randomUUID(),
        securityId: randomUUID(),
        listingId: null,
        cik: "0000320193",
        hasAnnualFundamentals: true,
        methodStatus: "selected",
        assetProfile: "non_financial_mature",
        method: "fcff_base",
        rigor: "standard",
        unsupportedReason: null,
      } as const;
      const valuationRunId = await recordRun();

      for (const outcome of [
        outcomeForAssessment(reading, {
          valuationRunId,
          runStatus: "computed",
        }),
        outcomeForAssessment(reading, { gap: "market_unavailable" }),
        outcomeForAssessment(
          {
            ...reading,
            assetProfile: "high_growth",
            method: "fcff_three_stage",
            rigor: "screening",
          },
          { gap: "growth_tax_jurisdictions_not_reconciled" },
        ),
      ]) {
        const symbol = ticker();
        const job = queueValuationJob({
          jobId: randomUUID(),
          ticker: symbol,
          knownAt: T0,
          createdAt: T0,
        });
        const token = randomUUID();
        await store.insert(job);
        await store.claim({
          jobId: job.jobId,
          startedAt: T0,
          claimToken: token,
          staleBefore: T0,
        });

        expect(
          await store.finish({
            jobId: job.jobId,
            claimToken: token,
            finishedAt: addMilliseconds(T0, 1),
            outcome,
          }),
        ).toBe("completed");

        const done = await store.findLatestByTicker(symbol);

        expect(done?.ruleVersion).toBe("valuation-job-1.3.0");
        expect(done?.gap).toBe(outcome.gap);
        expect(done?.snapshotGap).toBe(outcome.snapshotGap);
        expect(done?.valuationRunId).toBe(outcome.valuationRunId);
        expect(done?.runStatus).toBe(outcome.runStatus);
      }
    });

    it("guarda un pedido abierto y rechaza el segundo del mismo ticker", async () => {
      const symbol = ticker();
      const job = queueValuationJob({
        jobId: randomUUID(),
        ticker: symbol,
        knownAt: T0,
        createdAt: T0,
      });

      await store.insert(job);

      expect(await store.findOpenByTicker(symbol)).toEqual(job);
      expect(await store.findLatestByTicker(symbol)).toEqual(job);
      await expect(
        store.insert(
          queueValuationJob({
            jobId: randomUUID(),
            ticker: symbol,
            knownAt: T0,
            createdAt: addMilliseconds(T0, 1),
          }),
        ),
      ).rejects.toBeInstanceOf(ValuationJobConflictError);
    });

    it("un job cerrado deja encolar otro y el último es el más nuevo", async () => {
      const symbol = ticker();
      const first = queueValuationJob({
        jobId: randomUUID(),
        ticker: symbol,
        knownAt: T0,
        createdAt: T0,
      });
      await store.insert(first);
      const token = randomUUID();
      const running = await store.claim({
        jobId: first.jobId,
        startedAt: addMilliseconds(T0, 1),
        claimToken: token,
        staleBefore: addMilliseconds(T0, 1),
      });

      expect(running?.status).toBe("running");
      expect(
        await store.finish({
          jobId: first.jobId,
          claimToken: token,
          finishedAt: addMilliseconds(T0, 2),
          outcome: outcomeForIdentity("not_found"),
        }),
      ).toBe("completed");
      expect(await store.findOpenByTicker(symbol)).toBeNull();

      const second = queueValuationJob({
        jobId: randomUUID(),
        ticker: symbol,
        knownAt: addMilliseconds(T0, 3),
        createdAt: addMilliseconds(T0, 3),
      });
      await store.insert(second);

      expect((await store.findLatestByTicker(symbol))?.jobId).toBe(
        second.jobId,
      );
      expect((await store.findOpenByTicker(symbol))?.jobId).toBe(second.jobId);
    });

    it("el cierre exige el token, y un arranque viejo se puede retomar", async () => {
      const symbol = ticker();
      const job = queueValuationJob({
        jobId: randomUUID(),
        ticker: symbol,
        knownAt: T0,
        createdAt: T0,
      });
      await store.insert(job);
      const token = randomUUID();
      await store.claim({
        jobId: job.jobId,
        startedAt: T0,
        claimToken: token,
        staleBefore: T0,
      });

      expect(
        await store.claim({
          jobId: job.jobId,
          startedAt: addMilliseconds(T0, 1_000),
          claimToken: randomUUID(),
          staleBefore: T0,
        }),
      ).toBeNull();
      expect(
        await store.finish({
          jobId: job.jobId,
          claimToken: randomUUID(),
          finishedAt: addMilliseconds(T0, 2),
          outcome: outcomeForIdentity("conflict"),
        }),
      ).toBe("lost");

      const nextToken = randomUUID();
      const reclaimed = await store.claim({
        jobId: job.jobId,
        startedAt: addMilliseconds(T0, VALUATION_JOB_STALE_AFTER_MS + 1),
        claimToken: nextToken,
        staleBefore: addMilliseconds(T0, VALUATION_JOB_STALE_AFTER_MS + 1),
      });

      expect(reclaimed?.claimToken).toBe(nextToken);
      expect(
        await store.finish({
          jobId: job.jobId,
          claimToken: token,
          finishedAt: addMilliseconds(T0, VALUATION_JOB_STALE_AFTER_MS + 2),
          outcome: outcomeForIdentity("not_found"),
        }),
      ).toBe("lost");
      expect(
        await store.finish({
          jobId: job.jobId,
          claimToken: nextToken,
          finishedAt: addMilliseconds(T0, VALUATION_JOB_STALE_AFTER_MS + 2),
          outcome: outcomeForIdentity("not_found"),
        }),
      ).toBe("completed");
      expect((await store.findLatestByTicker(symbol))?.gap).toBe(
        "unresolved_ticker",
      );
    });

    it("cierra con el paso de datos y encola el que continúa en la misma escritura (1.2.0)", async () => {
      const symbol = ticker();
      const job = queueValuationJob({
        jobId: randomUUID(),
        ticker: symbol,
        knownAt: T0,
        createdAt: T0,
      });
      const token = randomUUID();
      const entity = randomUUID();
      const dataStep: ValuationDataStep = {
        ruleVersion: VALUATION_DATA_RULE_VERSION,
        fundamentals: { status: "ingested", filers: 1 },
        sic: { status: "observed", code: "7372" },
        prices: { status: "ingested" },
        audit: {
          status: "passed",
          chains: 3,
          notExercised: ["as_known_excludes_later_revision"],
        },
      };
      const finishedAt = addMilliseconds(T0, 10);
      const followUp = queueValuationJob({
        jobId: randomUUID(),
        ticker: symbol,
        knownAt: finishedAt,
        createdAt: finishedAt,
        followsJobId: job.jobId,
      });

      await store.insert(job);
      await store.claim({
        jobId: job.jobId,
        startedAt: T0,
        claimToken: token,
        staleBefore: T0,
      });
      expect(
        await store.finish({
          jobId: job.jobId,
          claimToken: token,
          finishedAt,
          outcome: outcomeForDataStep(
            { legalEntityId: entity, securityId: null, listingId: null },
            "data_ingested",
            dataStep,
          ),
          followUp,
        }),
      ).toBe("completed");

      const [done] = await store.listCompletedByTicker(symbol, 5);

      expect(done?.gap).toBe("data_ingested");
      expect(done?.dataStep).toEqual(dataStep);
      expect(await store.findOpenByTicker(symbol)).toMatchObject({
        jobId: followUp.jobId,
        followsJobId: job.jobId,
        status: "queued",
      });
    });

    it("cierra con lo que le preguntó a la IA y encola el que continúa (1.3.0)", async () => {
      const symbol = ticker();
      const job = queueValuationJob({
        jobId: randomUUID(),
        ticker: symbol,
        knownAt: T0,
        createdAt: T0,
      });
      const token = randomUUID();
      const dataStep: ValuationDataStep = {
        ruleVersion: VALUATION_DATA_RULE_VERSION,
        fundamentals: { status: "present" },
        sic: { status: "present" },
        prices: { status: "current", latestClose: "2026-10-20" },
        audit: { status: "passed", chains: 3, notExercised: [] },
      };
      const qualitativeStep = {
        ruleVersion: VALUATION_QUALITATIVE_RULE_VERSION,
        industry: { status: "accepted", rung: 1 },
        employeeEquity: { status: "skipped", reason: "already_asked" },
        operationsMix: { status: "abstained", reason: "ladder_exhausted" },
        chargedNanoUsd: 2_600_000,
      } as const;
      const finishedAt = addMilliseconds(T0, 10);
      const followUp = queueValuationJob({
        jobId: randomUUID(),
        ticker: symbol,
        knownAt: finishedAt,
        createdAt: finishedAt,
        followsJobId: job.jobId,
      });

      await store.insert(job);
      await store.claim({
        jobId: job.jobId,
        startedAt: T0,
        claimToken: token,
        staleBefore: T0,
      });
      expect(
        await store.finish({
          jobId: job.jobId,
          claimToken: token,
          finishedAt,
          outcome: outcomeForQualitativeStep(
            { legalEntityId: randomUUID(), securityId: null, listingId: null },
            dataStep,
            qualitativeStep,
          ),
          followUp,
        }),
      ).toBe("completed");

      const [done] = await store.listCompletedByTicker(symbol, 5);

      expect(done).toMatchObject({
        gap: "qualitative_resolved",
        ruleVersion: "valuation-job-1.3.0",
        qualitativeStep,
      });
      expect((await store.findOpenByTicker(symbol))?.jobId).toBe(
        followUp.jobId,
      );
    });

    it("un cierre perdido no encola el que continúa", async () => {
      const symbol = ticker();
      const job = queueValuationJob({
        jobId: randomUUID(),
        ticker: symbol,
        knownAt: T0,
        createdAt: T0,
      });

      await store.insert(job);
      await store.claim({
        jobId: job.jobId,
        startedAt: T0,
        claimToken: randomUUID(),
        staleBefore: T0,
      });

      expect(
        await store.finish({
          jobId: job.jobId,
          claimToken: randomUUID(),
          finishedAt: T0,
          outcome: outcomeForIdentity("not_found"),
          followUp: queueValuationJob({
            jobId: randomUUID(),
            ticker: symbol,
            knownAt: T0,
            createdAt: T0,
            followsJobId: job.jobId,
          }),
        }),
      ).toBe("lost");
      expect((await store.findOpenByTicker(symbol))?.jobId).toBe(job.jobId);
    });

    it("el latido exige el token y un job que late no se retoma", async () => {
      const symbol = ticker();
      const job = queueValuationJob({
        jobId: randomUUID(),
        ticker: symbol,
        knownAt: T0,
        createdAt: T0,
      });
      const token = randomUUID();
      const beatAt = addMilliseconds(T0, VALUATION_JOB_STALE_AFTER_MS);
      const later = addMilliseconds(beatAt, 1_000);

      await store.insert(job);
      await store.claim({
        jobId: job.jobId,
        startedAt: T0,
        claimToken: token,
        staleBefore: T0,
      });

      expect(
        await store.beat({
          jobId: job.jobId,
          claimToken: randomUUID(),
          at: beatAt,
        }),
      ).toBe("lost");
      expect(
        await store.beat({ jobId: job.jobId, claimToken: token, at: beatAt }),
      ).toBe("alive");
      expect(
        await store.claim({
          jobId: job.jobId,
          startedAt: later,
          claimToken: randomUUID(),
          staleBefore: addMilliseconds(later, -VALUATION_JOB_STALE_AFTER_MS),
        }),
      ).toBeNull();
      expect((await store.findOpenByTicker(symbol))?.heartbeatAt).toBe(beatAt);
    });
  });
}
