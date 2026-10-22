import "server-only";

import { readLineageObservations } from "@/modules/corporate-actions/application/read-lineage-observations";
import { COMPANY_FACTS_DATASET_ID } from "@/modules/fundamentals/application/ingest-company-facts";
import { SEC_SOURCE_ID } from "@/modules/fundamentals/application/live-company-facts-source";
import type { CompanyAssessmentDependencies } from "@/modules/valuation/application/assess-company";
import { annualFundamentalsConceptBatches } from "@/modules/valuation/domain/annual-fundamentals";
import { getCorporateActionRepository } from "@/server/persistence/get-corporate-action-repository";
import { getIngestionRunRepository } from "@/server/persistence/get-ingestion-run-repository";
import { getObservationRepository } from "@/server/persistence/get-observation-repository";

/**
 * Los lectores de fundamentals de la evaluación (`F3-01`) y del mix de
 * operaciones (`F5-05`): las filas del linaje elegidas por la consulta, con la
 * base de splits más reciente conocida al corte, y el último cierre anual que
 * registró cada ingesta (ADR 0017).
 */
export function createFundamentalReaders(
  /** El CIK vigente o, para un antecesor del linaje, el último que tuvo. */
  cikOf: (legalEntityId: string) => string | null,
): Pick<
  CompanyAssessmentDependencies,
  "readFundamentals" | "fiscalYearAnchors"
> {
  const corporateActions = getCorporateActionRepository();
  const observations = getObservationRepository();
  const ingestionRuns = getIngestionRunRepository();

  return {
    readFundamentals: async (subjectId, pointInTime) => {
      // Una lectura por tanda: los conceptos no se solapan entre tandas, así
      // que unir las filas no repite ninguna.
      const selections = await Promise.all(
        annualFundamentalsConceptBatches().map((metricIds) =>
          readLineageObservations(
            { legalEntityId: subjectId, metricIds: [...metricIds] },
            pointInTime,
            { corporateActions, observations },
          ),
        ),
      );

      return selections
        .flatMap((selection) => selection.rows)
        .map((row) => ({
          observationId: row.observation.observationId,
          subjectId: row.observation.subjectId,
          concept: row.observation.concept,
          periodType: row.observation.periodType,
          asOf: row.observation.asOf,
          periodStart: row.observation.periodStart,
          unit: row.observation.unit,
          currency: row.observation.currency,
          value: row.value,
          availableAt: row.observation.availableAt,
          recordedAt: row.observation.recordedAt,
          sourceDocumentId: row.observation.sourceDocumentId,
        }));
    },
    fiscalYearAnchors: async (subjectIds) => {
      const anchors = await Promise.all(
        subjectIds.map(async (subjectId) => {
          const subjectCik = cikOf(subjectId);

          if (subjectCik === null) {
            return null;
          }

          const run = await ingestionRuns.findLatestAnchored(
            SEC_SOURCE_ID,
            COMPANY_FACTS_DATASET_ID,
            subjectCik,
          );

          return run?.selectionAnchorOn ?? null;
        }),
      );

      return anchors.filter((anchor): anchor is string => anchor !== null);
    },
  };
}
