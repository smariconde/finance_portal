import { z } from "zod";

import {
  isEffectiveAt,
  isKnownAt,
  refineTemporalVersion,
  temporalVersionShape,
} from "@/modules/temporal/domain/temporal-version";
import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";

/**
 * Release de un dataset de referencia (`F3-04`): una tabla publicada por una
 * fuente —las betas por industria de Damodaran, su riesgo país— observada en un
 * instante y guardada entera, fila por fila.
 *
 * Es una versión temporal más: la publicación no fecha lo que publica con
 * precisión defendible —dice «January 2026» y corrige filas a mitad de ciclo—,
 * así que `validFrom` y `availableAt` son la observación, como en el registro
 * CEDEAR (ADR 0027). Una observación con otro contenido **supersede** la release
 * vigente; la misma no escribe nada.
 */
export const datasetIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u)
  .max(64);

/** Clave estable de una fila dentro de su dataset: industria, país, año, banda. */
export const rowKeySchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
  .max(128);

/** Un valor es un decimal canónico, un texto corto o `null` si la fuente no lo da. */
export const referenceValueSchema = z.string().trim().min(1).max(64).nullable();

export const referenceRowSchema = z.object({
  key: rowKeySchema,
  /** Cómo la fuente nombra la fila, para leer. */
  label: z.string().trim().min(1).max(160),
  values: z.record(
    z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/u)
      .max(48),
    referenceValueSchema,
  ),
});

export type ReferenceRow = z.infer<typeof referenceRowSchema>;

export const referenceReleaseSchema = z
  .object({
    ...temporalVersionShape,
    releaseId: z.uuid(),
    datasetId: datasetIdSchema,
    /** La fecha tal como la página la escribe; nunca se usa como disponibilidad. */
    publishedLabel: z.string().trim().min(1).max(64).nullable(),
    parserVersion: z.string().trim().min(1).max(64),
    rowCount: z.number().int().min(1).max(5000),
    ingestionRunId: z.uuid(),
  })
  .superRefine(refineTemporalVersion);

export type ReferenceRelease = z.infer<typeof referenceReleaseSchema>;

/** Lo que el parser de una página devuelve: filas aceptadas y rechazos por nombre. */
export type ReferencePublication =
  | {
      readonly ok: true;
      readonly datasetId: string;
      readonly parserVersion: string;
      readonly publishedLabel: string | null;
      readonly rows: readonly ReferenceRow[];
      /** Fila y campo que no se entendieron; nunca el valor recibido (`TM-02`). */
      readonly rejections: readonly {
        readonly row: number;
        readonly field: string;
      }[];
    }
  | { readonly ok: false; readonly code: string };

export function isOpenRelease(release: ReferenceRelease): boolean {
  return release.validTo === null && release.supersededAt === null;
}

/**
 * Contenido que identifica una release: el dataset y sus filas en orden de clave.
 * La versión del parser queda afuera: si leyera distinto, las filas ya serían
 * otras.
 */
export function releaseContent(
  datasetId: string,
  rows: readonly ReferenceRow[],
): unknown {
  return {
    datasetId,
    rows: [...rows]
      .sort((left, right) => left.key.localeCompare(right.key))
      .map((row) => [row.key, row.label, row.values]),
  };
}

export type ReleasePlan =
  | { readonly status: "unchanged"; readonly current: ReferenceRelease }
  | {
      readonly status: "opened";
      readonly release: ReferenceRelease;
      readonly rows: readonly ReferenceRow[];
      /** La release vigente que esta reemplaza, si había. */
      readonly supersedes: ReferenceRelease | null;
    };

export type PlanReferenceReleaseInput = {
  readonly publication: Extract<ReferencePublication, { ok: true }>;
  readonly current: ReferenceRelease | null;
  readonly observedAt: string;
  readonly recordedAt: string;
  readonly sourceId: string;
  readonly sourceDocumentId: string;
  readonly ingestionRunId: string;
  readonly contentHash: string;
  readonly newId: () => string;
};

export function planReferenceRelease(
  input: PlanReferenceReleaseInput,
): ReleasePlan {
  const { publication, current, observedAt } = input;

  if (current !== null && current.contentHash === input.contentHash) {
    return { status: "unchanged", current };
  }

  if (
    current !== null &&
    Date.parse(observedAt) <= Date.parse(current.availableAt)
  ) {
    // El orden de las observaciones es lo único que fecha un cambio.
    throw new Error(
      `observation of ${publication.datasetId} does not follow its current release`,
    );
  }

  return {
    status: "opened",
    release: referenceReleaseSchema.parse({
      releaseId: input.newId(),
      datasetId: publication.datasetId,
      publishedLabel: publication.publishedLabel,
      parserVersion: publication.parserVersion,
      rowCount: publication.rows.length,
      ingestionRunId: input.ingestionRunId,
      validFrom: observedAt,
      validTo: null,
      availableAt: observedAt,
      supersededAt: null,
      sourceId: input.sourceId,
      sourceDocumentId: input.sourceDocumentId,
      contentHash: input.contentHash,
      recordedAt: input.recordedAt,
    }),
    rows: publication.rows,
    supersedes: current,
  };
}

/**
 * La release de un dataset visible al corte. Dos a la vez son el conflicto que
 * la base impide con un índice único; si aparecen igual, se declaran.
 */
export function resolveReleaseAt(
  releases: readonly ReferenceRelease[],
  datasetId: string,
  query: PointInTimeQuery,
): ReferenceRelease | null {
  const visible = releases.filter(
    (release) =>
      release.datasetId === datasetId &&
      isEffectiveAt(release, query.effectiveAt) &&
      isKnownAt(release, query),
  );

  if (visible.length > 1) {
    throw new Error(`more than one release of ${datasetId} is visible`);
  }

  return visible[0] ?? null;
}
