import type { AppMode } from "@/modules/configuration/domain/config-health";
import { selectPersonalDependency } from "@/modules/configuration/domain/runtime-lock";

import type {
  EmployeeEquityEvidenceRecord,
  EmployeeEquityProposal,
} from "../domain/employee-equity";

/**
 * Transcripciones de opciones y unidades de empleados (`F4-05`, ADR 0040).
 *
 * `record` es una transacción: la propuesta y la nota que se le mandó al
 * modelo. Una propuesta no se pisa: preguntar de nuevo es otra fila.
 */
export type StoredEmployeeEquity = {
  readonly proposal: EmployeeEquityProposal;
  readonly evidence: EmployeeEquityEvidenceRecord;
};

export interface EmployeeEquityRepository {
  readonly storage: "in-memory-fixture" | "personal-postgres";
  record(stored: StoredEmployeeEquity): Promise<void>;
  /** La última vez que se le preguntó a la escalera por este sujeto. */
  latestForSubject(legalEntityId: string): Promise<StoredEmployeeEquity | null>;
  /**
   * La aceptada más reciente que ya existía en `knownAt`: lo que una corrida
   * a ese corte puede leer. Una propuesta posterior no se ve.
   */
  acceptedAsKnown(
    legalEntityId: string,
    knownAt: string,
  ): Promise<StoredEmployeeEquity | null>;
}

export function selectEmployeeEquityRepository(
  mode: AppMode,
  factories: { personal: () => EmployeeEquityRepository },
): EmployeeEquityRepository {
  return selectPersonalDependency(
    mode,
    "employee-equity-repository",
    factories.personal,
  );
}

/** Las reglas que los dos repositorios sostienen antes de escribir. */
export function assertStoredEmployeeEquity(stored: StoredEmployeeEquity): void {
  if (stored.evidence.accessionNumber !== stored.proposal.accessionNumber) {
    throw new Error("The evidence comes from the 10-K the proposal names.");
  }
}
