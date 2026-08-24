import { z } from "zod";

import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";
import { TemporalContractError } from "@/modules/temporal/domain/temporal-error";

import { observationSubjectTypeSchema, type Observation } from "./observation";

/**
 * Selección de observaciones bajo el contrato point-in-time.
 *
 * Ninguna función ordena por `fetched_at` ni elige "la última fila insertada":
 * la revisión vigente se decide por corte de conocimiento y número de revisión,
 * de modo que un restatement posterior no puede filtrarse en una consulta
 * anterior (`TM-06`).
 */
export const observationSelectorSchema = z.object({
  subjectType: observationSubjectTypeSchema,
  subjectId: z.uuid(),
  metricIds: z.array(z.string().trim().min(1).max(128)).max(64).optional(),
  periodType: z
    .enum(["instant", "daily", "monthly", "quarter", "annual", "ttm"])
    .optional(),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/u)
    .optional(),
});

export type ObservationSelector = z.infer<typeof observationSelectorSchema>;

function isVisibleAt(
  observation: Observation,
  query: PointInTimeQuery,
): boolean {
  if (query.revisionPolicy === "latest_restated") {
    return true;
  }

  const at = Date.parse(query.knownAt);

  if (Date.parse(observation.availableAt) > at) {
    return false;
  }

  // `system_recorded` responde qué tenía esta instalación, no qué era público.
  return (
    query.knowledgeBasis !== "system_recorded" ||
    Date.parse(observation.recordedAt) <= at
  );
}

/**
 * Revisión vigente dentro de una cadena. La cadena se ordena por
 * `revision_number` porque la publicación garantiza que cada revisión nueva es
 * conocible después de la anterior; `superseded_at` conserva esa decisión para
 * la vista actual y para el índice único de PostgreSQL.
 */
export function selectRevision(
  revisionGroup: readonly Observation[],
  query: PointInTimeQuery,
): Observation | null {
  if (revisionGroup.length === 0) {
    return null;
  }

  const groupIds = new Set(
    revisionGroup.map((observation) => observation.revisionGroupId),
  );

  if (groupIds.size > 1) {
    throw new TemporalContractError(
      "ambiguous_revision",
      "A revision chain cannot mix different revision groups.",
      [...groupIds],
    );
  }

  if (query.revisionPolicy === "latest_restated") {
    const current = revisionGroup.filter(
      (observation) => observation.supersededAt === null,
    );

    if (current.length > 1) {
      throw new TemporalContractError(
        "ambiguous_revision",
        "More than one revision is current for the same fact.",
        current.map((observation) => observation.observationId),
      );
    }

    return current[0] ?? null;
  }

  const visible = revisionGroup.filter((observation) =>
    isVisibleAt(observation, query),
  );

  if (visible.length === 0) {
    return null;
  }

  const latestRevision = Math.max(
    ...visible.map((observation) => observation.revisionNumber),
  );
  const selected = visible.filter(
    (observation) => observation.revisionNumber === latestRevision,
  );

  if (selected.length > 1) {
    throw new TemporalContractError(
      "ambiguous_revision",
      "Two revisions share the same revision number in one chain.",
      selected.map((observation) => observation.observationId),
    );
  }

  return selected[0]!;
}

/**
 * Aplica el selector, el corte económico (`effective_at`) y la política de
 * revisión. Devuelve a lo sumo una observación por cadena, ordenada de forma
 * estable para que el resultado sea reproducible.
 */
export function queryObservations(
  observations: readonly Observation[],
  selector: ObservationSelector,
  query: PointInTimeQuery,
): Observation[] {
  const parsedSelector = observationSelectorSchema.parse(selector);
  const metricIds =
    parsedSelector.metricIds === undefined
      ? null
      : new Set(parsedSelector.metricIds);
  const effectiveAt = Date.parse(query.effectiveAt);

  const groups = new Map<string, Observation[]>();

  for (const observation of observations) {
    if (
      observation.subjectType !== parsedSelector.subjectType ||
      observation.subjectId !== parsedSelector.subjectId ||
      (metricIds !== null && !metricIds.has(observation.metricId)) ||
      (parsedSelector.periodType !== undefined &&
        observation.periodType !== parsedSelector.periodType) ||
      (parsedSelector.currency !== undefined &&
        observation.currency !== parsedSelector.currency)
    ) {
      continue;
    }

    // Un hecho cuyo período todavía no ocurrió no describe la fecha pedida.
    if (Date.parse(`${observation.asOf}T00:00:00.000Z`) > effectiveAt) {
      continue;
    }

    const group = groups.get(observation.revisionGroupId);
    if (group) {
      group.push(observation);
    } else {
      groups.set(observation.revisionGroupId, [observation]);
    }
  }

  const selected: Observation[] = [];

  for (const group of groups.values()) {
    const revision = selectRevision(group, query);
    if (revision !== null) {
      selected.push(revision);
    }
  }

  return selected.sort(
    (left, right) =>
      left.metricId.localeCompare(right.metricId) ||
      left.asOf.localeCompare(right.asOf) ||
      left.revisionGroupId.localeCompare(right.revisionGroupId),
  );
}

/**
 * Colapsa cada métrica a su período más reciente dentro del corte. Un empate no
 * resuelto entre dos hechos del mismo período es un conflicto declarado, no una
 * elección arbitraria.
 */
export function selectLatestPerMetric(
  observations: readonly Observation[],
): Observation[] {
  const latest = new Map<string, Observation>();

  for (const observation of observations) {
    const key = `${observation.metricId}|${observation.periodType}|${observation.unit}|${observation.currency ?? ""}`;
    const current = latest.get(key);

    if (current === undefined || observation.asOf > current.asOf) {
      latest.set(key, observation);
      continue;
    }

    if (
      observation.asOf === current.asOf &&
      observation.revisionGroupId !== current.revisionGroupId
    ) {
      throw new TemporalContractError(
        "ambiguous_revision",
        "Two independent facts describe the same metric and period.",
        [current.revisionGroupId, observation.revisionGroupId],
      );
    }
  }

  return [...latest.values()].sort((left, right) =>
    left.metricId.localeCompare(right.metricId),
  );
}

/**
 * Guarda previa a comparar o agregar: unidades y monedas distintas no se suman
 * ni se convierten en silencio.
 */
export function assertSameUnitAndCurrency(
  observations: readonly Observation[],
): void {
  const shapes = new Set(
    observations.map(
      (observation) => `${observation.unit}|${observation.currency ?? ""}`,
    ),
  );

  if (shapes.size > 1) {
    throw new TemporalContractError(
      "currency_or_unit_mismatch",
      "Observations carry incompatible units or currencies.",
      [...shapes],
    );
  }
}
