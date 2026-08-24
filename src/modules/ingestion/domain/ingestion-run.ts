import { z } from "zod";

import { computeContentHash } from "./content-hash";
import { ingestionFailureSchema } from "./ingestion-failure";
import {
  datasetIdSchema,
  parserVersionSchema,
  sourceIdSchema,
} from "./source-registry-entry";

/**
 * Estados de una corrida de ingesta.
 *
 * `empty`, `quarantined` y `failed` son terminales pero **no publicables**: una
 * respuesta vacía, un parser roto o una fuente caída nunca cierran el último
 * intervalo válido (`docs/data/point-in-time-contract.md`, `TM-05`).
 */
export const ingestionRunStatusSchema = z.enum([
  "running",
  "succeeded",
  "partial",
  "empty",
  "duplicate",
  "quarantined",
  "failed",
]);

export type IngestionRunStatus = z.infer<typeof ingestionRunStatusSchema>;

const TERMINAL_STATUSES: ReadonlySet<IngestionRunStatus> = new Set([
  "succeeded",
  "partial",
  "empty",
  "duplicate",
  "quarantined",
  "failed",
]);

const PUBLISHABLE_STATUSES: ReadonlySet<IngestionRunStatus> = new Set([
  "succeeded",
  "partial",
]);

export function isTerminalStatus(status: IngestionRunStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** Sólo un estado publicable habilita escribir observaciones aguas abajo. */
export function isPublishableStatus(status: IngestionRunStatus): boolean {
  return PUBLISHABLE_STATUSES.has(status);
}

export const ingestionRunCountsSchema = z.object({
  fetched: z.number().int().min(0),
  accepted: z.number().int().min(0),
  rejected: z.number().int().min(0),
  duplicate: z.number().int().min(0),
});

export type IngestionRunCounts = z.infer<typeof ingestionRunCountsSchema>;

export const EMPTY_COUNTS: IngestionRunCounts = Object.freeze({
  fetched: 0,
  accepted: 0,
  rejected: 0,
  duplicate: 0,
});

const utcTimestampSchema = z.iso.datetime({ offset: true });
const contentHashSchema = z.string().regex(/^[a-f0-9]{64}$/u);

export const ingestionRunSchema = z
  .object({
    runId: z.uuid(),
    sourceId: sourceIdSchema,
    datasetId: datasetIdSchema,
    parserVersion: parserVersionSchema,
    idempotencyKey: contentHashSchema,
    requestedAsOf: z.iso.date().nullable(),
    cursor: z.string().trim().min(1).max(512).nullable(),
    nextCursor: z.string().trim().min(1).max(512).nullable(),
    status: ingestionRunStatusSchema,
    startedAt: utcTimestampSchema,
    finishedAt: utcTimestampSchema.nullable(),
    counts: ingestionRunCountsSchema,
    contentHash: contentHashSchema.nullable(),
    failure: ingestionFailureSchema.nullable(),
    qualityFlags: z.array(z.string().trim().min(1).max(64)).max(16),
    replayOfRunId: z.uuid().nullable(),
    recordedAt: utcTimestampSchema,
  })
  .superRefine((run, context) => {
    const terminal = isTerminalStatus(run.status);

    if (terminal === (run.finishedAt === null)) {
      context.addIssue({
        code: "custom",
        path: ["finishedAt"],
        message: "finishedAt must be present exactly for terminal statuses.",
      });
    }

    if (
      run.finishedAt !== null &&
      Date.parse(run.finishedAt) < Date.parse(run.startedAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["finishedAt"],
        message: "finishedAt must not precede startedAt.",
      });
    }

    if ((run.status === "failed") !== (run.failure !== null)) {
      context.addIssue({
        code: "custom",
        path: ["failure"],
        message: "failure must be present exactly for the failed status.",
      });
    }

    const hashExpected = terminal && run.status !== "failed";
    if (hashExpected !== (run.contentHash !== null)) {
      context.addIssue({
        code: "custom",
        path: ["contentHash"],
        message:
          "contentHash must be present for every terminal run except failed.",
      });
    }

    const { fetched, accepted, rejected, duplicate } = run.counts;

    if (run.status === "running" || run.status === "failed") {
      if (accepted !== 0) {
        context.addIssue({
          code: "custom",
          path: ["counts", "accepted"],
          message: "A running or failed run cannot report accepted records.",
        });
      }
      return;
    }

    if (accepted + rejected + duplicate !== fetched) {
      context.addIssue({
        code: "custom",
        path: ["counts"],
        message: "accepted + rejected + duplicate must equal fetched.",
      });
    }

    const expectation: Record<
      Exclude<IngestionRunStatus, "running" | "failed">,
      boolean
    > = {
      succeeded: fetched > 0 && accepted === fetched,
      partial: accepted > 0 && rejected > 0,
      empty: fetched === 0,
      duplicate: fetched > 0 && duplicate === fetched,
      quarantined: fetched > 0 && accepted === 0 && rejected === fetched,
    };

    if (!expectation[run.status]) {
      context.addIssue({
        code: "custom",
        path: ["counts"],
        message: `Counts are inconsistent with status ${run.status}.`,
      });
    }
  });

export type IngestionRun = z.infer<typeof ingestionRunSchema>;

export const ingestionRunKeySchema = z.object({
  sourceId: sourceIdSchema,
  datasetId: datasetIdSchema,
  parserVersion: parserVersionSchema,
  requestedAsOf: z.iso.date().nullable(),
  cursor: z.string().trim().min(1).max(512).nullable(),
});

export type IngestionRunKey = z.infer<typeof ingestionRunKeySchema>;

/**
 * Clave de idempotencia determinista (`TM-11`): repetir el mismo dataset, as-of,
 * cursor y parser produce la misma clave y por lo tanto no duplica una corrida.
 */
export function computeIdempotencyKey(key: IngestionRunKey): string {
  return computeContentHash(ingestionRunKeySchema.parse(key));
}
