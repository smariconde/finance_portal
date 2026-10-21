import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import {
  addMilliseconds,
  outcomeForIdentity,
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

    beforeEach(() => {
      store = harness().store;
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
  });
}
