import type { SeriesObservation } from "./series-observation";

/**
 * Conciliación con la última publicación oficial (`bcra-catalog-reconciliation-1.0.0`,
 * ADR 0065, gate de la Fase 9).
 *
 * El catálogo informa, por variable, la última fecha y el último valor. Es una
 * segunda publicación del mismo número por la misma fuente, y lo que se
 * compara es si lo guardado lo reproduce **en esa fecha**. Que los datos
 * lleguen más lejos que el catálogo —el CER se publica por adelantado— no es un
 * error: se informa.
 */
export const CATALOG_RECONCILIATION_VERSION =
  "bcra-catalog-reconciliation-1.0.0";

export type CatalogReconciliation =
  | {
      readonly status: "reconciled";
      readonly periodOn: string;
      readonly value: string;
      /** La última fecha guardada; posterior a `periodOn` si el catálogo va atrás. */
      readonly storedThroughOn: string;
    }
  | {
      readonly status: "mismatch";
      readonly periodOn: string;
      readonly published: string;
      readonly stored: string;
    }
  | {
      /** Lo guardado no llega a la fecha del catálogo, o no la tiene. */
      readonly status: "not_at_date";
      readonly periodOn: string;
    }
  | { readonly status: "not_stored" }
  | { readonly status: "no_catalog_value" };

export function reconcileWithCatalog(input: {
  readonly lastReportedOn: string | null;
  readonly lastReportedValue: string | null;
  /** Si la serie ya tuvo una primera descarga. */
  readonly stored: boolean;
  /** Revisiones vigentes desde `lastReportedOn`. */
  readonly open: readonly SeriesObservation[];
}): CatalogReconciliation {
  const { lastReportedOn, lastReportedValue } = input;

  if (lastReportedOn === null || lastReportedValue === null) {
    return { status: "no_catalog_value" };
  }

  if (!input.stored) {
    return { status: "not_stored" };
  }

  const published = input.open.filter((observation) => !observation.withdrawn);
  const atDate = published.find(
    (observation) => observation.periodOn === lastReportedOn,
  );

  if (atDate === undefined) {
    return { status: "not_at_date", periodOn: lastReportedOn };
  }

  if (atDate.value !== lastReportedValue) {
    return {
      status: "mismatch",
      periodOn: lastReportedOn,
      published: lastReportedValue,
      stored: atDate.value!,
    };
  }

  return {
    status: "reconciled",
    periodOn: lastReportedOn,
    value: lastReportedValue,
    storedThroughOn: published.reduce(
      (latest, observation) =>
        observation.periodOn > latest ? observation.periodOn : latest,
      lastReportedOn,
    ),
  };
}
