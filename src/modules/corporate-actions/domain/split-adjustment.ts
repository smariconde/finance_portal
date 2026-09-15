import type { Observation } from "@/modules/observations/domain/observation";
import type { PointInTimeQuery } from "@/modules/temporal/domain/point-in-time-query";

import type { CorporateAction } from "./reporting-succession";
import {
  classifyCoherence,
  declaredShareSensitivity,
  isSplitAction,
  isSplitVisibleAt,
  laterSplitFactor,
  ShareBasisError,
  shareBasisDecimal,
  shareSensitivity,
  toBasisChange,
  type BasisChange,
} from "./share-basis";

/**
 * Lectura en la última base accionaria conocible (`latest_adjusted`).
 *
 * Las filas publicadas no se tocan. Cada valor sensible se expresa en la base del
 * último split conocible en el corte multiplicando —acciones— o dividiendo —por
 * acción— por el producto de los ratios de los splits cuya presentación es
 * posterior a la que publicó la vintage. «Conocible en el corte» es la misma regla
 * que una observación: un `as_known` anterior a la presentación del split no lo
 * ve, así que tampoco lo aplica.
 *
 * La base es la del corte, no la de `effective_at`: la fecha efectiva filtra hechos
 * y no deshace splits. Des-ajustar una vintage re-expresada para volver a una base
 * vieja agregaría el redondeo del filer una segunda vez.
 *
 * Además clasifica cada revisión: una que difiere de la anterior exactamente por los
 * splits publicados entre las dos es `split_reexpression` y no un restatement.
 */
export const SPLIT_ADJUSTMENT_VERSION = "split-adjustment-1.0.0";

export type RevisionKind = "original" | "restatement" | "split_reexpression";

export type ShareBasisAdjustment = {
  readonly transformationId: string;
  /** Producto de los ratios aplicados, como decimal canónico; `1` si no hubo. */
  readonly shareFactor: string;
  readonly corporateActionIds: readonly string[];
};

export type ShareBasis = "as_reported" | "latest_split_basis";

export type BasisRow = {
  /** La fila publicada, intacta. */
  readonly observation: Observation;
  /** El valor en la base pedida. `null` sigue siendo `null`. */
  readonly value: string | null;
  readonly basis: ShareBasis;
  /** Presente en cada fila sensible leída con `latest_adjusted`. */
  readonly adjustment: ShareBasisAdjustment | null;
  readonly revisionKind: RevisionKind;
};

function visibleChangesBySubject(
  corporateActions: readonly CorporateAction[],
  query: PointInTimeQuery,
): Map<string, BasisChange[]> {
  const bySubject = new Map<string, BasisChange[]>();

  for (const action of corporateActions) {
    if (
      !isSplitAction(action) ||
      action.subjectType !== "legal_entity" ||
      !isSplitVisibleAt(action, query)
    ) {
      continue;
    }

    const list = bySubject.get(action.subjectId);
    const change = toBasisChange(action);

    if (list === undefined) {
      bySubject.set(action.subjectId, [change]);
    } else {
      list.push(change);
    }
  }

  return bySubject;
}

/**
 * Tipo de revisión de una observación. Sólo un valor sensible puede ser una
 * re-expresión por split, y sólo si hubo splits entre sus dos vintages y la
 * diferencia cierra con su producto.
 */
function classifyRevision(
  observation: Observation,
  revisionsById: ReadonlyMap<string, Observation>,
  changes: readonly BasisChange[],
): RevisionKind {
  if (observation.restatementOfId === null) {
    return "original";
  }

  const previous = revisionsById.get(observation.restatementOfId);

  if (previous === undefined) {
    throw new ShareBasisError(
      "revision_chain_incomplete",
      "A revision arrived without the revision it restates.",
      [observation.observationId],
    );
  }

  // Clasificar es informativo y no ajusta nada: un concepto de acciones que la
  // regla no conoce queda como restatement, que nunca cambia un valor. Ajustarlo
  // sí falla, en `buildBasisRows`.
  const sensitivity = declaredShareSensitivity(observation);

  if (
    sensitivity === null ||
    sensitivity === "unclassified" ||
    previous.rawValue === null ||
    observation.rawValue === null
  ) {
    return "restatement";
  }

  const between = laterSplitFactor(
    changes,
    {
      availableAt: previous.availableAt,
      document: previous.sourceDocumentId,
    },
    {
      availableAt: observation.availableAt,
      document: observation.sourceDocumentId,
    },
  );

  if (between.changeIds.length === 0) {
    return "restatement";
  }

  return classifyCoherence({
    sensitivity,
    previous: previous.rawValue,
    next: observation.rawValue,
    factor: between.factor,
  }) === "coherent"
    ? "split_reexpression"
    : "restatement";
}

export type BasisRowsInput = {
  /** Filas ya elegidas por la política de revisión, de uno o más sujetos. */
  readonly selected: readonly Observation[];
  /** Todas las revisiones de las que salieron: la clasificación mira la anterior. */
  readonly revisions: readonly Observation[];
  readonly corporateActions: readonly CorporateAction[];
  readonly query: PointInTimeQuery;
  /**
   * Sujeto consultado. Una fila sensible de otro sujeto —un antecesor del
   * linaje— no se lleva a la base del consultado sin la conversión de acciones de
   * la sucesión, que hoy no está registrada.
   */
  readonly subjectId: string;
};

export function buildBasisRows(input: BasisRowsInput): BasisRow[] {
  const { selected, revisions, corporateActions, query, subjectId } = input;
  const revisionsById = new Map(
    revisions.map((observation) => [observation.observationId, observation]),
  );
  const changesBySubject = visibleChangesBySubject(corporateActions, query);
  const adjusted = query.adjustmentPolicy === "latest_adjusted";

  return selected.map((observation) => {
    const changes = changesBySubject.get(observation.subjectId) ?? [];
    const revisionKind = classifyRevision(observation, revisionsById, changes);
    const sensitivity = adjusted ? shareSensitivity(observation) : null;

    if (sensitivity === null) {
      return {
        observation,
        value: observation.rawValue,
        basis: "as_reported" as const,
        adjustment: null,
        revisionKind,
      };
    }

    if (observation.subjectId !== subjectId) {
      throw new ShareBasisError(
        "adjustment_across_succession",
        "A share-sensitive value of a predecessor cannot be restated into the successor's basis.",
        [observation.observationId],
      );
    }

    const later = laterSplitFactor(changes, {
      availableAt: observation.availableAt,
      document: observation.sourceDocumentId,
    });
    const shareFactor = shareBasisDecimal.formatDecimal(
      later.factor,
      "adjustment.shareFactor",
    );
    let value: string | null = null;

    if (observation.rawValue !== null) {
      const raw = shareBasisDecimal.parseDecimal(
        observation.rawValue,
        "observation.rawValue",
      );
      value = shareBasisDecimal.formatDecimal(
        sensitivity === "share_count"
          ? raw.times(later.factor)
          : shareBasisDecimal.divide(
              raw,
              later.factor,
              "adjustment.shareFactor",
            ),
        "adjustment.value",
      );
    }

    return {
      observation,
      value,
      basis: "latest_split_basis" as const,
      adjustment: {
        transformationId: SPLIT_ADJUSTMENT_VERSION,
        shareFactor,
        corporateActionIds: later.changeIds,
      },
      revisionKind,
    };
  });
}

export type RevisionClassificationCounts = {
  readonly restated: number;
  readonly splitReexpressions: number;
  readonly restatements: number;
};

/**
 * Cuenta el tipo de cada revisión sobre la historia completa: la evidencia de que
 * la clasificación separa splits de restatements reales.
 */
export function countRevisionKinds(
  revisions: readonly Observation[],
  corporateActions: readonly CorporateAction[],
  query: PointInTimeQuery,
): RevisionClassificationCounts {
  const revisionsById = new Map(
    revisions.map((observation) => [observation.observationId, observation]),
  );
  const changesBySubject = visibleChangesBySubject(corporateActions, query);
  let splitReexpressions = 0;
  let restatements = 0;

  for (const observation of revisions) {
    const kind = classifyRevision(
      observation,
      revisionsById,
      changesBySubject.get(observation.subjectId) ?? [],
    );

    if (kind === "split_reexpression") {
      splitReexpressions += 1;
    } else if (kind === "restatement") {
      restatements += 1;
    }
  }

  return {
    restated: splitReexpressions + restatements,
    splitReexpressions,
    restatements,
  };
}
