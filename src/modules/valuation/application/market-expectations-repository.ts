import type { AppMode } from "@/modules/configuration/domain/config-health";
import { selectPersonalDependency } from "@/modules/configuration/domain/runtime-lock";

import type { StoredMarketExpectations } from "../domain/market-expectations";

export type { StoredMarketExpectations } from "../domain/market-expectations";

/**
 * Lecturas de expectativas de la capa IA (`F6-11`, ADR 0050).
 *
 * `record` es una transacción: la lectura y las secciones del 10-K que se le
 * mandaron al modelo. Una lectura no se pisa: preguntar de nuevo es otra fila.
 */
export interface MarketExpectationsRepository {
  readonly storage: "in-memory-fixture" | "personal-postgres";
  record(stored: StoredMarketExpectations): Promise<void>;
  /** La última vez que se le preguntó a la escalera por este sujeto. */
  latestForSubject(
    legalEntityId: string,
  ): Promise<StoredMarketExpectations | null>;
  /**
   * La aceptada más reciente sobre el 10-K de ese ejercicio: la que una
   * corrida con ese año base puede mostrar al lado de lo que exige el precio.
   */
  acceptedForFiscalYear(
    legalEntityId: string,
    fiscalYearEnd: string,
  ): Promise<StoredMarketExpectations | null>;
}

export function selectMarketExpectationsRepository(
  mode: AppMode,
  factories: { personal: () => MarketExpectationsRepository },
): MarketExpectationsRepository {
  return selectPersonalDependency(
    mode,
    "market-expectations-repository",
    factories.personal,
  );
}

/** Las reglas que los dos repositorios sostienen antes de escribir. */
export function assertStoredMarketExpectations(
  stored: StoredMarketExpectations,
): void {
  const ids = stored.evidence.map((item) => item.evidenceId);

  if (stored.evidence.length === 0 || new Set(ids).size !== ids.length) {
    throw new Error("A reading records its evidence blocks, each once.");
  }

  if (
    stored.evidence.some(
      (item) => item.accessionNumber !== stored.record.accessionNumber,
    )
  ) {
    throw new Error("The evidence comes from the 10-K the reading names.");
  }
}
