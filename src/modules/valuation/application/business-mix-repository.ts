import type { AppMode } from "@/modules/configuration/domain/config-health";
import { selectPersonalDependency } from "@/modules/configuration/domain/runtime-lock";

import type {
  BusinessMixEvidenceRecord,
  BusinessMixLineRecord,
  BusinessMixProposal,
} from "../domain/business-mix";

/**
 * Propuestas de mezcla de negocios (`F6-48`, ADR 0086).
 *
 * `record` es una transacción: la propuesta, sus líneas y su evidencia. Una
 * propuesta aceptada sin líneas no explicaría nada; líneas sin propuesta, menos.
 * Una propuesta no se pisa: preguntar de nuevo es otra fila.
 */
export type StoredBusinessMix = {
  readonly proposal: BusinessMixProposal;
  /** Sólo una aceptada tiene líneas. */
  readonly lines: readonly BusinessMixLineRecord[];
  readonly evidence: readonly BusinessMixEvidenceRecord[];
};

export interface BusinessMixRepository {
  readonly storage: "in-memory-fixture" | "personal-postgres";
  record(stored: StoredBusinessMix): Promise<void>;
  /** La última vez que se le preguntó a la escalera por este sujeto. */
  latestForSubject(legalEntityId: string): Promise<StoredBusinessMix | null>;
  /**
   * La aceptada más reciente que ya existía en `knownAt`: lo que una evaluación
   * a ese corte puede leer. Una propuesta posterior no se ve.
   */
  acceptedAsKnown(
    legalEntityId: string,
    knownAt: string,
  ): Promise<StoredBusinessMix | null>;
}

export function selectBusinessMixRepository(
  mode: AppMode,
  factories: { personal: () => BusinessMixRepository },
): BusinessMixRepository {
  return selectPersonalDependency(
    mode,
    "business-mix-repository",
    factories.personal,
  );
}

/** Las reglas que los dos repositorios sostienen antes de escribir. */
export function assertStoredBusinessMix(stored: StoredBusinessMix): void {
  const accepted = stored.proposal.outcome === "accepted";

  if (accepted !== stored.lines.length > 0) {
    throw new Error("A business mix has lines exactly when accepted.");
  }

  const evidenceIds = new Set(stored.evidence.map((item) => item.evidenceId));

  if (stored.lines.some((line) => !evidenceIds.has(line.evidenceId))) {
    throw new Error("Every line cites evidence that was recorded with it.");
  }

  if (stored.lines.some((line) => line.axis !== stored.proposal.axis)) {
    throw new Error("Every line is of the proposal's axis.");
  }
}
