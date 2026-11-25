import { z } from "zod";

import type { ObservationRepository } from "@/modules/observations/application/observation-repository";
import { periodTypeSchema } from "@/modules/ingestion/domain/staged-record";
import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";

import {
  queryLineageObservations,
  resolveReportingLineage,
  type LineageObservationSelection,
} from "../domain/reporting-lineage";
import type { CorporateActionRepository } from "./corporate-action-repository";

/**
 * Lectura de observaciones de un emisor con su linaje de reporte y, si la consulta
 * lo pide, en la última base accionaria conocible (`latest_adjusted`).
 *
 * Las métricas son obligatorias: el repositorio lee por sujeto con techo y un
 * linaje multiplica las filas por segmento. Cada segmento se lee en páginas de
 * 1.000 con cursor por clave (`lineage-read-pages-1.0.0`, `F6-52`): GE pasaba
 * las 1.000 revisiones en una tanda de 64 conceptos y la evaluación no
 * terminaba. El techo total sigue (`TM-07`): un segmento que llega a
 * `MAX_ROWS_PER_SEGMENT` falla en vez de devolver una historia a la que le
 * faltan revisiones; nunca se trunca.
 */
export const lineageReadRequestSchema = z.object({
  legalEntityId: z.uuid(),
  metricIds: z.array(z.string().trim().min(1).max(128)).min(1).max(64),
  periodType: periodTypeSchema.optional(),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/u)
    .optional(),
});

export type LineageReadRequest = z.input<typeof lineageReadRequestSchema>;

export const LINEAGE_READ_PAGES_VERSION = "lineage-read-pages-1.0.0";

/** El techo de una página del repositorio. */
const ROWS_PER_PAGE = 1000;

/**
 * El techo de un segmento: veinte páginas. El filer más grande de Production
 * tiene 1.598 revisiones en **todos** sus conceptos (GE, 2026-11-25), así que
 * llegar acá es un error de quien pide, no una historia larga.
 */
export const MAX_ROWS_PER_SEGMENT = 20 * ROWS_PER_PAGE;

export class LineageReadLimitError extends Error {
  readonly legalEntityId: string;

  constructor(legalEntityId: string) {
    super(
      `A lineage segment reached ${MAX_ROWS_PER_SEGMENT} revisions; request fewer metrics.`,
    );
    this.name = "LineageReadLimitError";
    this.legalEntityId = legalEntityId;
  }
}

export async function readLineageObservations(
  request: LineageReadRequest,
  query: PointInTimeQuery,
  dependencies: {
    readonly corporateActions: CorporateActionRepository;
    readonly observations: ObservationRepository;
  },
): Promise<LineageObservationSelection> {
  const { legalEntityId, metricIds, periodType, currency } =
    lineageReadRequestSchema.parse(request);
  const relationships = await dependencies.corporateActions.listRelationships();
  const lineage = resolveReportingLineage(relationships, legalEntityId, query);
  // Los splits se leen siempre, también con `as_known`: la clasificación de cada
  // revisión los usa aunque ningún valor se ajuste.
  const splits = await dependencies.corporateActions.listCorporateActions({
    subjectIds: lineage.segments.map((segment) => segment.legalEntityId),
    actionTypes: ["split", "reverse_split"],
  });

  const rows = [];

  for (const segment of lineage.segments) {
    let read = 0;
    let after: { revisionGroupId: string; revisionNumber: number } | undefined;

    for (;;) {
      const page = await dependencies.observations.list({
        subjectType: "legal_entity",
        subjectId: segment.legalEntityId,
        metricIds,
        limit: ROWS_PER_PAGE,
        after,
      });

      rows.push(...page);
      read += page.length;
      if (page.length < ROWS_PER_PAGE) break;
      if (read >= MAX_ROWS_PER_SEGMENT) {
        throw new LineageReadLimitError(segment.legalEntityId);
      }
      const last = page.at(-1)!;
      after = {
        revisionGroupId: last.revisionGroupId,
        revisionNumber: last.revisionNumber,
      };
    }
  }

  return queryLineageObservations(
    rows,
    lineage,
    { metricIds, periodType, currency },
    query,
    splits,
  );
}
