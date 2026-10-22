import {
  beatValuationJob,
  claimValuationJob,
  finishValuationJob,
  type ValuationJob,
} from "../domain/valuation-job";
import {
  ValuationJobConflictError,
  VALUATION_HISTORY_LIMIT,
  type ValuationJobBeat,
  type ValuationJobClaim,
  type ValuationJobFinish,
  type ValuationJobStore,
} from "../application/valuation-job-store";

/**
 * Doble del almacén. No es un modo de runtime: ningún composition root lo
 * construye.
 */
export function createInMemoryValuationJobStore(): ValuationJobStore {
  const jobs: ValuationJob[] = [];

  return {
    async findOpenByTicker(ticker) {
      return (
        jobs.find(
          (job) =>
            job.ticker === ticker &&
            (job.status === "queued" || job.status === "running"),
        ) ?? null
      );
    },
    async findLatestByTicker(ticker) {
      return (
        jobs
          .filter((job) => job.ticker === ticker)
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
          .at(0) ?? null
      );
    },
    async listCompletedByTicker(ticker, limit) {
      return jobs
        .filter((job) => job.ticker === ticker && job.status === "completed")
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, Math.min(limit, VALUATION_HISTORY_LIMIT));
    },
    async insert(job) {
      if (
        jobs.some(
          (existing) =>
            existing.ticker === job.ticker &&
            (existing.status === "queued" || existing.status === "running"),
        )
      ) {
        throw new ValuationJobConflictError();
      }

      jobs.push(job);
      return job;
    },
    async claim(claim: ValuationJobClaim) {
      const index = jobs.findIndex((job) => job.jobId === claim.jobId);
      const current = jobs[index];

      if (current === undefined) {
        return null;
      }

      const next = claimValuationJob(current, claim);

      if (next === null) {
        return null;
      }

      jobs[index] = next;
      return next;
    },
    async finish(input: ValuationJobFinish) {
      const index = jobs.findIndex((job) => job.jobId === input.jobId);
      const current = jobs[index];

      if (current === undefined) {
        return "lost";
      }

      const next = finishValuationJob(current, input);

      if (next === null) {
        return "lost";
      }

      if (
        input.followUp !== undefined &&
        jobs.some(
          (job) =>
            job.followsJobId !== null &&
            job.followsJobId === input.followUp!.followsJobId,
        )
      ) {
        throw new ValuationJobConflictError();
      }

      jobs[index] = next;

      if (input.followUp !== undefined) {
        jobs.push(input.followUp);
      }

      return "completed";
    },
    async beat(input: ValuationJobBeat) {
      const index = jobs.findIndex((job) => job.jobId === input.jobId);
      const current = jobs[index];
      const next =
        current === undefined ? null : beatValuationJob(current, input);

      if (next === null) {
        return "lost";
      }

      jobs[index] = next;
      return "alive";
    },
  };
}
