import type {
  ClassificationQuery,
  ClassificationRepository,
  SectorClassificationSummary,
} from "../application/classification-repository";
import { classificationQuerySchema } from "../application/classification-repository";
import type { SectorClassificationPlan } from "../domain/plan-sector-classification";
import {
  isOpenClassification,
  type SubjectClassification,
} from "../domain/subject-classification";

/**
 * Doble de test, no un modo de runtime. Ningún composition root lo construye.
 *
 * Corre el **mismo contrato** que el adaptador de PostgreSQL, incluida la
 * invariante del índice único: una segunda aserción vigente para el mismo sujeto
 * en la misma taxonomía se rechaza acá igual que en la base. Un doble más
 * permisivo que la base deja pasar en los tests exactamente lo que la base
 * después rechaza en producción.
 */
export class InMemoryClassificationRepository implements ClassificationRepository {
  readonly storage = "in-memory-fixture" as const;

  private readonly rows: SubjectClassification[] = [];

  constructor(seed: readonly SubjectClassification[] = []) {
    this.rows = [...seed];
  }

  async loadClassifications(
    query: ClassificationQuery,
  ): Promise<readonly SubjectClassification[]> {
    const { taxonomyId, limit } = classificationQuerySchema.parse(query);
    const matches = this.rows.filter((row) => row.taxonomyId === taxonomyId);

    if (matches.length > limit) {
      throw new Error(
        `classification read exceeded its limit of ${limit} rows for ${taxonomyId}`,
      );
    }

    return matches.map((row) => ({ ...row }));
  }

  async applySectorPlan(
    plan: SectorClassificationPlan,
  ): Promise<SectorClassificationSummary> {
    for (const supersession of plan.supersessions) {
      const target = this.rows.find(
        (row) =>
          row.subjectId === supersession.subjectId &&
          row.taxonomyId === plan.taxonomyId &&
          row.validFrom === supersession.validFrom &&
          isOpenClassification(row),
      );

      if (target === undefined) {
        throw new Error(
          `no open classification to supersede for subject ${supersession.subjectId}`,
        );
      }

      const index = this.rows.indexOf(target);
      this.rows[index] = {
        ...target,
        supersededAt: supersession.supersededAt,
      };
    }

    for (const opened of plan.opened) {
      const conflict = this.rows.find(
        (row) =>
          row.subjectType === opened.subjectType &&
          row.subjectId === opened.subjectId &&
          row.taxonomyId === opened.taxonomyId &&
          isOpenClassification(row),
      );

      if (conflict !== undefined) {
        throw new Error(
          `subject ${opened.subjectId} already has an open classification in ${opened.taxonomyId}`,
        );
      }

      this.rows.push({ ...opened });
    }

    return {
      ruleVersion: plan.ruleVersion,
      taxonomyId: plan.taxonomyId,
      taxonomyVersion: plan.taxonomyVersion,
      applied: {
        opened: plan.opened.length,
        superseded: plan.supersessions.length,
      },
      unchanged: plan.counts.unchanged,
      rejected: plan.counts.rejected,
      notReasserted: plan.counts.notReasserted,
    };
  }
}
