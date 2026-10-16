import type { AppMode } from "@/modules/configuration/domain/config-health";
import { selectPersonalDependency } from "@/modules/configuration/domain/runtime-lock";

import type {
  OperationsMixEvidenceRecord,
  OperationsMixLineRecord,
  OperationsMixProposal,
} from "../domain/operations-mix";

/**
 * Propuestas de mix de operaciones (`F5-05`, ADR 0034).
 *
 * `record` es una transacción: la propuesta, sus líneas y su evidencia. Una
 * propuesta aceptada sin líneas no explicaría nada; líneas sin propuesta, menos.
 * Una propuesta no se pisa: preguntar de nuevo es otra fila.
 */
export type StoredOperationsMix = {
  readonly proposal: OperationsMixProposal;
  /** Sólo una aceptada tiene líneas. */
  readonly lines: readonly OperationsMixLineRecord[];
  readonly evidence: readonly OperationsMixEvidenceRecord[];
};

export interface OperationsMixRepository {
  readonly storage: "in-memory-fixture" | "personal-postgres";
  record(stored: StoredOperationsMix): Promise<void>;
  /** La última vez que se le preguntó a la escalera por este sujeto. */
  latestForSubject(legalEntityId: string): Promise<StoredOperationsMix | null>;
  /**
   * La aceptada más reciente que ya existía en `knownAt`: lo que una evaluación
   * a ese corte puede leer. Una propuesta posterior no se ve.
   */
  acceptedAsKnown(
    legalEntityId: string,
    knownAt: string,
  ): Promise<StoredOperationsMix | null>;
}

export function selectOperationsMixRepository(
  mode: AppMode,
  factories: { personal: () => OperationsMixRepository },
): OperationsMixRepository {
  return selectPersonalDependency(
    mode,
    "operations-mix-repository",
    factories.personal,
  );
}

/** Las reglas que los dos repositorios sostienen antes de escribir. */
export function assertStoredOperationsMix(stored: StoredOperationsMix): void {
  const accepted = stored.proposal.outcome === "accepted";

  if (accepted !== stored.lines.length > 0) {
    throw new Error("An operations mix has lines exactly when accepted.");
  }

  const evidenceIds = new Set(stored.evidence.map((item) => item.evidenceId));

  if (stored.lines.some((line) => !evidenceIds.has(line.evidenceId))) {
    throw new Error("Every line cites evidence that was recorded with it.");
  }
}
