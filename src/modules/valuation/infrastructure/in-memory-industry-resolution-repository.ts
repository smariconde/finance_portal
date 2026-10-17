import {
  isOpenClassification,
  type SubjectClassification,
} from "@/modules/classification/domain/subject-classification";

import type {
  IndustryResolutionRepository,
  StoredIndustryResolution,
} from "../application/industry-resolution-repository";
import {
  DAMODARAN_INDUSTRY_ASSERTION_TAXONOMY,
  industryEvidenceRecordSchema,
  industryResolutionDocumentId,
  industryResolutionRecordSchema,
} from "../domain/industry-resolution";

/**
 * Doble en memoria del repositorio de resoluciones. Sostiene las mismas reglas
 * que el personal —una transacción, a lo sumo una aserción vigente por sujeto,
 * una resolución que no se pisa— para que el contrato corra igual sobre los
 * dos. Ninguna raíz de composición lo construye.
 */
export function createInMemoryIndustryResolutionRepository(): IndustryResolutionRepository {
  const resolutions: StoredIndustryResolution[] = [];
  let assertions: SubjectClassification[] = [];

  return {
    storage: "in-memory-fixture",
    async record({ resolution, evidence, plan }) {
      const parsed = industryResolutionRecordSchema.parse(resolution);
      const parsedEvidence = evidence.map((item) =>
        industryEvidenceRecordSchema.parse(item),
      );

      if (
        resolutions.some(
          (stored) => stored.resolution.resolutionId === parsed.resolutionId,
        )
      ) {
        throw new Error(`resolution ${parsed.resolutionId} already recorded`);
      }

      if (plan !== null && parsed.outcome !== "resolved") {
        throw new Error("Only a resolved industry is asserted.");
      }

      let next = assertions;

      for (const supersession of plan?.supersessions ?? []) {
        const matches = next.filter(
          (classification) =>
            classification.subjectId === supersession.subjectId &&
            classification.taxonomyId === plan!.taxonomyId &&
            classification.validFrom === supersession.validFrom &&
            isOpenClassification(classification),
        );

        if (matches.length !== 1) {
          throw new Error(
            `expected exactly one open classification to supersede for subject ${supersession.subjectId}`,
          );
        }

        next = next.map((classification) =>
          classification === matches[0]
            ? { ...classification, supersededAt: supersession.supersededAt }
            : classification,
        );
      }

      for (const opened of plan?.opened ?? []) {
        if (
          next.some(
            (classification) =>
              classification.subjectId === opened.subjectId &&
              classification.taxonomyId === opened.taxonomyId &&
              isOpenClassification(classification),
          )
        ) {
          throw new Error(
            `subject ${opened.subjectId} would have two open industry assertions`,
          );
        }

        next = [...next, opened];
      }

      assertions = next;
      resolutions.push({ resolution: parsed, evidence: parsedEvidence });
    },
    async latestForSubject(legalEntityId) {
      return (
        resolutions
          .filter((stored) => stored.resolution.legalEntityId === legalEntityId)
          .sort((left, right) =>
            right.resolution.resolvedAt.localeCompare(
              left.resolution.resolvedAt,
            ),
          )[0] ?? null
      );
    },
    async findResolution(resolutionId) {
      return (
        resolutions.find(
          (stored) => stored.resolution.resolutionId === resolutionId,
        ) ?? null
      );
    },
    async assertionsForSubject(legalEntityId) {
      return assertions
        .filter(
          (classification) =>
            classification.subjectId === legalEntityId &&
            classification.taxonomyId === DAMODARAN_INDUSTRY_ASSERTION_TAXONOMY,
        )
        .flatMap((classification) => {
          const stored = resolutions.find(
            (candidate) =>
              industryResolutionDocumentId(
                candidate.resolution.resolutionId,
              ) === classification.sourceDocumentId,
          );

          return stored === undefined
            ? []
            : [
                {
                  classification,
                  reading: {
                    resolutionId: stored.resolution.resolutionId,
                    industryKey: classification.code,
                    availableAt: classification.availableAt,
                    respondedModel: stored.resolution.respondedModel,
                    evidenceIds: stored.resolution.citedEvidenceIds,
                  },
                },
              ];
        });
    },
  };
}
