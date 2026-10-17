import type { ClassificationPlan } from "@/modules/classification/domain/plan-sector-classification";
import type { SubjectClassification } from "@/modules/classification/domain/subject-classification";
import type { AppMode } from "@/modules/configuration/domain/config-health";
import { selectPersonalDependency } from "@/modules/configuration/domain/runtime-lock";

import type { AiIndustryResolutionReading } from "../domain/industry-mapping";
import type {
  IndustryEvidenceRecord,
  IndustryResolutionRecord,
} from "../domain/industry-resolution";

/**
 * Resoluciones de industria y sus aserciones (`F5-03`, ADR 0033).
 *
 * `record` es una transacción: la resolución, su evidencia y —si se aceptó— la
 * aserción `damodaran-industry`. Partida, quedaría una aserción sin la
 * evidencia que la explica, o una resolución aceptada que nadie ve.
 */
export type StoredIndustryResolution = {
  readonly resolution: IndustryResolutionRecord;
  readonly evidence: readonly IndustryEvidenceRecord[];
};

export type IndustryAssertionReading = {
  readonly classification: SubjectClassification;
  readonly reading: AiIndustryResolutionReading;
};

export interface IndustryResolutionRepository {
  readonly storage: "in-memory-fixture" | "personal-postgres";
  record(input: {
    readonly resolution: IndustryResolutionRecord;
    readonly evidence: readonly IndustryEvidenceRecord[];
    /** `null` si la resolución no se aceptó: se guarda y no se afirma nada. */
    readonly plan: ClassificationPlan | null;
  }): Promise<void>;
  /** La última vez que se le preguntó a la escalera por este sujeto. */
  latestForSubject(
    legalEntityId: string,
  ): Promise<StoredIndustryResolution | null>;
  /** Una resolución por su ID, con su evidencia (`F5-06`). */
  findResolution(
    resolutionId: string,
  ): Promise<StoredIndustryResolution | null>;
  /** Aserciones `damodaran-industry` del sujeto, vigentes o no, con su resolución. */
  assertionsForSubject(
    legalEntityId: string,
  ): Promise<readonly IndustryAssertionReading[]>;
}

export function selectIndustryResolutionRepository(
  mode: AppMode,
  factories: { personal: () => IndustryResolutionRepository },
): IndustryResolutionRepository {
  return selectPersonalDependency(
    mode,
    "industry-resolution-repository",
    factories.personal,
  );
}
