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
 * Lectura de observaciones de un emisor con su linaje de reporte.
 *
 * Las métricas son obligatorias: el repositorio lee por sujeto con techo y un
 * linaje multiplica las filas por segmento. Si un segmento llena el techo, la
 * lectura falla en vez de devolver una historia a la que le faltan revisiones
 * (`TM-07`); quien llama pide menos métricas.
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

const ROWS_PER_SEGMENT = 1000;

export class LineageReadLimitError extends Error {
  readonly legalEntityId: string;

  constructor(legalEntityId: string) {
    super(
      `A lineage segment reached ${ROWS_PER_SEGMENT} revisions; request fewer metrics.`,
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

  const rows = [];

  for (const segment of lineage.segments) {
    const revisions = await dependencies.observations.list({
      subjectType: "legal_entity",
      subjectId: segment.legalEntityId,
      metricIds,
      limit: ROWS_PER_SEGMENT,
    });

    if (revisions.length >= ROWS_PER_SEGMENT) {
      throw new LineageReadLimitError(segment.legalEntityId);
    }

    rows.push(...revisions);
  }

  return queryLineageObservations(
    rows,
    lineage,
    { metricIds, periodType, currency },
    query,
  );
}
