import { canonicalDecimalFromJsonNumber } from "@/modules/fundamentals/domain/exact-json";
import {
  queryObservations,
  type ObservationSelector,
} from "@/modules/observations/domain/select-observations";
import type { Observation } from "@/modules/observations/domain/observation";
import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";
import { TemporalContractError } from "@/modules/temporal/domain/temporal-error";
import {
  isEffectiveAt,
  isKnownAt,
} from "@/modules/temporal/domain/temporal-version";

import type {
  CorporateAction,
  LegalEntityRelationship,
} from "./reporting-succession";
import {
  buildBasisRows,
  SPLIT_ADJUSTMENT_VERSION,
  type BasisRow,
} from "./split-adjustment";

/**
 * Linaje de reporte: la historia de un emisor unida a la de sus antecesores de
 * reporte, **en la lectura**.
 *
 * Los hechos del antecesor se publicaron con su propio sujeto y así quedan: unir
 * en la escritura reasignaría quién reportó cada valor. La regla vive acá, versionada,
 * y cada fila devuelta conserva su `subjectId`:
 *
 * 1. un vínculo participa sólo si es efectivo en `effective_at` y conocible en el
 *    corte con la misma regla de selección de dimensión que el resto del grafo:
 *    un `as_known` anterior a la presentación de sucesión no ve al antecesor;
 * 2. el antecesor aporta sólo hechos con `as_of` anterior a la vigencia. Si sigue
 *    presentando —como emisor de deuda, por ejemplo— eso ya no describe al grupo;
 * 3. si más de un segmento reporta el mismo hecho —el primer 10-Q del sucesor
 *    repite los comparativos del antecesor—, gana la revisión conocible más
 *    reciente. Dos revisiones del mismo instante con valores distintos no tienen
 *    desempate y son `ambiguous_revision`; con el mismo valor gana el segmento más
 *    cercano al sujeto.
 */
export const REPORTING_LINEAGE_RULE_VERSION = "reporting-lineage-1.0.0";

/** Techo de saltos: un linaje más largo que esto es un grafo roto, no historia. */
const MAX_LINEAGE_DEPTH = 16;

export type ReportingLineageSegment = {
  readonly legalEntityId: string;
  /**
   * Fecha calendaria exclusiva hasta la que el segmento aporta hechos: la vigencia
   * de la sucesión que lo reemplazó. `null` para el sujeto consultado.
   */
  readonly reportsBefore: string | null;
  /** Vínculo que trajo al segmento; `null` para el sujeto consultado. */
  readonly relationshipId: string | null;
};

export type ReportingLineage = {
  readonly ruleVersion: string;
  readonly legalEntityId: string;
  /** Del sujeto hacia atrás: el primero es el consultado. */
  readonly segments: readonly ReportingLineageSegment[];
};

export function resolveReportingLineage(
  relationships: readonly LegalEntityRelationship[],
  legalEntityId: string,
  query: PointInTimeQuery,
): ReportingLineage {
  const segments: ReportingLineageSegment[] = [
    { legalEntityId, reportsBefore: null, relationshipId: null },
  ];
  const visited = new Set([legalEntityId]);
  let current = legalEntityId;

  for (let depth = 0; depth < MAX_LINEAGE_DEPTH; depth += 1) {
    const visible = relationships.filter(
      (relationship) =>
        relationship.relationshipType === "reporting_successor" &&
        relationship.successorLegalEntityId === current &&
        isEffectiveAt(relationship, query.effectiveAt) &&
        isKnownAt(relationship, query),
    );

    if (visible.length === 0) {
      return {
        ruleVersion: REPORTING_LINEAGE_RULE_VERSION,
        legalEntityId,
        segments,
      };
    }

    if (visible.length > 1) {
      // PostgreSQL impide dos antecesores abiertos; si igual llegan, elegir uno
      // sería inventar cuál de las dos historias es la del grupo.
      throw new TemporalContractError(
        "ambiguous_identity",
        "A legal entity has more than one visible reporting predecessor.",
        visible.map((relationship) => relationship.relationshipId),
      );
    }

    const relationship = visible[0]!;
    const predecessor = relationship.predecessorLegalEntityId;

    if (visited.has(predecessor)) {
      throw new TemporalContractError(
        "ambiguous_identity",
        "The reporting lineage contains a cycle.",
        [relationship.relationshipId],
      );
    }

    // El borde de un antecesor lejano es el más temprano de la cadena: sus hechos
    // tienen que ser anteriores a su propia sucesión y a todas las siguientes.
    const laterBound = segments[segments.length - 1]!.reportsBefore;
    segments.push({
      legalEntityId: predecessor,
      reportsBefore:
        laterBound !== null && laterBound < relationship.effectiveOn
          ? laterBound
          : relationship.effectiveOn,
      relationshipId: relationship.relationshipId,
    });
    visited.add(predecessor);
    current = predecessor;
  }

  throw new TemporalContractError(
    "ambiguous_identity",
    "The reporting lineage exceeds the maximum depth.",
    [legalEntityId],
  );
}

export type LineageSelector = Omit<
  ObservationSelector,
  "subjectType" | "subjectId"
>;

export type LineageObservationSelection = {
  readonly lineage: ReportingLineage;
  /** Filas publicadas elegidas, intactas. */
  readonly observations: readonly Observation[];
  /**
   * Las mismas filas con su valor en la base pedida por `adjustmentPolicy`, la
   * transformación aplicada y el tipo de revisión. Es lo que consume un cálculo.
   */
  readonly rows: readonly BasisRow[];
  readonly adjustment: {
    readonly policy: PointInTimeQuery["adjustmentPolicy"];
    readonly ruleVersion: string | null;
  };
  /** Hechos que reportó más de un segmento y cómo se resolvieron. */
  readonly overlaps: {
    readonly sameValue: number;
    readonly differentValue: number;
  };
};

/**
 * Dos importes son el mismo valor aunque la base los devuelva con otra escala:
 * `numeric` conserva los ceros que traiga el texto de entrada.
 */
function isSameValue(left: string | null, right: string | null): boolean {
  if (left === null || right === null) {
    return left === right;
  }

  return (
    canonicalDecimalFromJsonNumber(left) ===
    canonicalDecimalFromJsonNumber(right)
  );
}

/** Clave lógica sin sujeto: el mismo hecho dicho por dos filers del linaje. */
function factKey(observation: Observation): string {
  return [
    observation.metricId,
    observation.concept,
    observation.asOf,
    observation.periodStart ?? "",
    observation.periodEnd ?? "",
    observation.periodType,
    observation.unit,
    observation.currency ?? "",
    observation.sourceId,
    observation.datasetId,
    observation.valueBasis,
  ].join("|");
}

/**
 * `corporateActions` es obligatorio y no tiene default: una lectura
 * `latest_adjusted` sin los splits del linaje devolvería valores sin ajustar
 * etiquetados como ajustados.
 */
export function queryLineageObservations(
  observations: readonly Observation[],
  lineage: ReportingLineage,
  selector: LineageSelector,
  query: PointInTimeQuery,
  corporateActions: readonly CorporateAction[],
): LineageObservationSelection {
  type Candidate = { observation: Observation; segment: number };
  const byFact = new Map<string, Candidate[]>();
  // Las revisiones se eligen con la base reportada; el ajuste se aplica después,
  // sobre la fila ya elegida.
  const revisionQuery: PointInTimeQuery = {
    ...query,
    adjustmentPolicy: "as_known",
  };

  lineage.segments.forEach((segment, index) => {
    const selected = queryObservations(
      observations,
      {
        ...selector,
        subjectType: "legal_entity",
        subjectId: segment.legalEntityId,
      },
      revisionQuery,
    );

    for (const observation of selected) {
      if (
        segment.reportsBefore !== null &&
        observation.asOf >= segment.reportsBefore
      ) {
        continue;
      }

      const key = factKey(observation);
      const candidates = byFact.get(key);
      const candidate = { observation, segment: index };

      if (candidates) {
        candidates.push(candidate);
      } else {
        byFact.set(key, [candidate]);
      }
    }
  });

  const chosen: Observation[] = [];
  let sameValueOverlaps = 0;
  let differentValueOverlaps = 0;

  for (const candidates of byFact.values()) {
    if (candidates.length === 1) {
      chosen.push(candidates[0]!.observation);
      continue;
    }

    const reference = candidates[0]!.observation.rawValue;

    if (
      candidates.every((candidate) =>
        isSameValue(candidate.observation.rawValue, reference),
      )
    ) {
      sameValueOverlaps += 1;
    } else {
      differentValueOverlaps += 1;
    }

    const ordered = [...candidates].sort(
      (left, right) =>
        Date.parse(right.observation.availableAt) -
          Date.parse(left.observation.availableAt) ||
        left.segment - right.segment,
    );
    const first = ordered[0]!.observation;
    const tied = ordered.filter(
      (candidate) =>
        Date.parse(candidate.observation.availableAt) ===
        Date.parse(first.availableAt),
    );

    if (
      tied.some(
        (candidate) =>
          !isSameValue(candidate.observation.rawValue, first.rawValue),
      )
    ) {
      throw new TemporalContractError(
        "ambiguous_revision",
        "Two filers in the lineage state different values at the same instant.",
        tied.map((candidate) => candidate.observation.observationId),
      );
    }

    chosen.push(first);
  }

  const ordered = chosen.sort(
    (left, right) =>
      left.metricId.localeCompare(right.metricId) ||
      left.asOf.localeCompare(right.asOf) ||
      factKey(left).localeCompare(factKey(right)),
  );

  return {
    lineage,
    observations: ordered,
    rows: buildBasisRows({
      selected: ordered,
      revisions: observations,
      corporateActions,
      query,
      subjectId: lineage.legalEntityId,
    }),
    adjustment: {
      policy: query.adjustmentPolicy,
      ruleVersion:
        query.adjustmentPolicy === "latest_adjusted"
          ? SPLIT_ADJUSTMENT_VERSION
          : null,
    },
    overlaps: {
      sameValue: sameValueOverlaps,
      differentValue: differentValueOverlaps,
    },
  };
}
